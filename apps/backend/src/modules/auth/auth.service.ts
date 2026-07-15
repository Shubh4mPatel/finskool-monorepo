import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Redis } from "ioredis";
import { refreshTokenKey, selectedCommunityKey } from "../../lib/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { generateUploadUrl, deleteFile } from "../../lib/minio.js";
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from "../../shared/errors/index.js";
import type {
  AuthTokensInternal,
  AuthResponseDTO,
  LoginDTO,
  PublicUserDTO,
  CommunityInfoDTO,
  RegisterDTO,  UpdateEmailDTO,
  ChangePasswordDTO,
  UpdateNotificationsDTO,} from "./auth.dto.js";
import type { JwtPayload } from "../../middlewares/auth.middleware.js";

const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

type DbUser = {
  id: string;
  name: string;
  phone: string;
  email: string;
  passwordHash: string | null;
  role: string;
  avatarUrl: string | null;
  postNotificationsEnabled: boolean;
};

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async register(data: RegisterDTO): Promise<AuthTokensInternal> {
    logger.info({ phone: data.phone }, "auth.register: attempt");

    if (data.password !== data.confirmPassword) {
      throw new BadRequestError("Passwords do not match");
    }

    // User must already exist (pre-created by admin)
    const user = await this.db.user.findUnique({
      where: { phone: data.phone },
    });
    if (!user) {
      throw new ForbiddenError(
        "This phone number is not in the list. Please contact your admin.",
        "PHONE_NOT_APPROVED",
      );
    }
    if (user.passwordHash) {
      throw new ConflictError(
        "This phone number has already been registered. Please log in.",
        "ALREADY_REGISTERED",
      );
    }
    if (!user.isActive) {
      throw new ForbiddenError(
        "Your access has been revoked. Please contact your admin.",
        "PHONE_INACTIVE",
      );
    }

    // Check if the new email conflicts with another user (admin may have used a different email)
    if (data.email !== user.email) {
      const emailTaken = await this.db.user.findFirst({
        where: { email: data.email, id: { not: user.id } },
      });
      if (emailTaken)
        throw new ConflictError("This email address is already registered");
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const updated = await this.db.user.update({
      where: { id: user.id },
      data: { name: data.fullName, email: data.email, passwordHash },
    });

    // Mark phone as registered
    await this.db.approvedPhone.update({
      where: { phone: data.phone },
      data: { isRegistered: true },
    });

    logger.info({ userId: updated.id }, "auth.register: success");
    return this.issueTokens(updated);
  }

  async login(data: LoginDTO): Promise<AuthTokensInternal> {
    logger.info({ email: data.email }, "auth.login: attempt");

    const user = await this.db.user.findUnique({
      where: { email: data.email },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedError("Invalid email or password");
    }
    if (!user.isActive) {
      throw new UnauthorizedError(
        "Your account has been deactivated. Please contact your admin.",
      );
    }
    if (!user.passwordHash) {
      throw new UnauthorizedError(
        "You have not registered yet. Please sign up first to set your password.",
        "NOT_REGISTERED",
      );
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      logger.warn({ email: data.email }, "auth.login: invalid password");
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.role !== "admin" && !(await this.hasActiveSubscription(user.id))) {
      throw new UnauthorizedError(
        "Your subscription has expired. Please contact your admin to renew.",
        "SUBSCRIPTION_EXPIRED",
      );
    }

    logger.info({ userId: user.id }, "auth.login: success");
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: JwtPayload;
    try {
      // Refresh token has no exp — verify only checks signature
      payload = jwt.verify(refreshToken, env.jwt.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedError("Invalid refresh token");
    }

    if (payload.type !== "refresh") {
      throw new UnauthorizedError("Invalid token type");
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await this.redis.get(refreshTokenKey(tokenHash));
    if (!stored || stored !== payload.sub) {
      throw new UnauthorizedError("Refresh token revoked or not found");
    }

    const user = await this.db.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) throw new UnauthorizedError("User not found");
    if (!user.isActive) {
      throw new UnauthorizedError(
        "Your account has been deactivated. Please contact your admin.",
      );
    }

    if (user.role !== "admin" && !(await this.hasActiveSubscription(user.id))) {
      throw new UnauthorizedError(
        "Your subscription has expired. Please contact your admin to renew.",
        "SUBSCRIPTION_EXPIRED",
      );
    }

    const communities = await this.fetchUserCommunities(user.id);
    const communityIds = communities.map((c) => c.id);

    // Restore previously selected community (validate it's still a valid subscription)
    const savedComm = await this.redis.get(selectedCommunityKey(user.id));
    const selectedCommunityId =
      savedComm && communityIds.includes(savedComm)
        ? savedComm
        : communityIds.length === 1
          ? (communityIds[0] ?? null)
          : null;

    const accessToken = this.signToken(
      {
        sub: user.id,
        role: user.role as "admin" | "member",
        type: "access",
        communityIds,
        selectedCommunityId,
      },
      env.jwt.accessExpiresIn,
    );
    return { accessToken };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.redis.del(refreshTokenKey(tokenHash));
  }

  async getMe(userId: string): Promise<AuthResponseDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedError("User not found");
    if (!user.isActive) {
      throw new UnauthorizedError(
        "Your account has been deactivated. Please contact your admin.",
      );
    }
    const communities = await this.fetchUserCommunities(user.id);
    return { user: this.toPublicUser(user), communities };
  }

  async selectCommunity(
    userId: string,
    communityId: string,
    currentCommunityIds: string[],
  ): Promise<string> {
    if (!currentCommunityIds.includes(communityId)) {
      throw new ForbiddenError(
        "You do not have access to this community",
        "COMMUNITY_ACCESS_DENIED",
      );
    }
    // Persist selection so token refresh can restore it
    await this.redis.set(selectedCommunityKey(userId), communityId);

    const communities = await this.fetchUserCommunities(userId);
    const communityIds = communities.map((c) => c.id);
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError("User not found");

    return this.signToken(
      {
        sub: userId,
        role: user.role as "admin" | "member",
        type: "access",
        communityIds,
        selectedCommunityId: communityId,
      },
      env.jwt.accessExpiresIn,
    );
  }

  private async issueTokens(user: DbUser): Promise<AuthTokensInternal> {
    const role = user.role as "admin" | "member";
    const communities = await this.fetchUserCommunities(user.id);
    const communityIds = communities.map((c) => c.id);

    // Auto-select the only community; for multiple communities user must select manually
    const selectedCommunityId =
      communityIds.length === 1 ? (communityIds[0] ?? null) : null;
    if (selectedCommunityId) {
      await this.redis.set(selectedCommunityKey(user.id), selectedCommunityId);
    }

    const accessToken = this.signToken(
      { sub: user.id, role, type: "access", communityIds, selectedCommunityId },
      env.jwt.accessExpiresIn,
    );
    // Refresh token has no expiry in the JWT — Redis presence is the sole validity gate
    const refreshToken = jwt.sign(
      { sub: user.id, role, type: "refresh" } as object,
      env.jwt.secret,
    );

    const tokenHash = hashToken(refreshToken);
    // No TTL — refresh token is permanent until logout or admin suspension
    await this.redis.set(refreshTokenKey(tokenHash), user.id);

    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(user),
      communities,
    };
  }

  private async fetchUserCommunities(
    userId: string,
  ): Promise<CommunityInfoDTO[]> {
    const subscriptions = await this.db.subscription.findMany({
      where: { userId, isActive: true, validUntil: { gte: startOfToday() } },
      select: {
        community: {
          select: { id: true, name: true, slug: true, coverImageUrl: true },
        },
      },
    });
    return subscriptions.map((s) => s.community);
  }

  private async hasActiveSubscription(userId: string): Promise<boolean> {
    const count = await this.db.subscription.count({
      where: { userId, isActive: true, validUntil: { gte: startOfToday() } },
    });
    return count > 0;
  }

  private signToken(payload: JwtPayload, expiresIn: string): string {
    return jwt.sign(payload as object, env.jwt.secret, {
      expiresIn,
    } as jwt.SignOptions);
  }

  async updateEmail(userId: string, data: UpdateEmailDTO): Promise<PublicUserDTO> {
    const existing = await this.db.user.findFirst({
      where: { email: data.email, id: { not: userId } },
    });
    if (existing) throw new ConflictError('This email address is already in use');

    const updated = await this.db.user.update({
      where: { id: userId },
      data: { email: data.email },
    });
    logger.info({ userId }, 'auth.updateEmail: success');
    return this.toPublicUser(updated);
  }

  async changePassword(userId: string, data: ChangePasswordDTO): Promise<void> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found');
    if (!user.passwordHash) throw new BadRequestError('No password set for this account');

    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestError('Current password is incorrect');

    const newHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    await this.db.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    logger.info({ userId }, 'auth.changePassword: success');
  }

  async updateNotifications(userId: string, data: UpdateNotificationsDTO): Promise<PublicUserDTO> {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { postNotificationsEnabled: data.postNotificationsEnabled },
    });
    logger.info({ userId, postNotificationsEnabled: data.postNotificationsEnabled }, 'auth.updateNotifications: success');
    return this.toPublicUser(updated);
  }

  async getAvatarUploadUrl(filename: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    return generateUploadUrl(filename, 'avatars');
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<PublicUserDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found');

    if (user.avatarUrl) {
      await deleteFile(user.avatarUrl).catch(() => {});
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    logger.info({ userId }, 'auth.updateAvatar: success');
    return this.toPublicUser(updated);
  }

  private toPublicUser(user: DbUser): PublicUserDTO {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      postNotificationsEnabled: user.postNotificationsEnabled,
    };
  }
}
