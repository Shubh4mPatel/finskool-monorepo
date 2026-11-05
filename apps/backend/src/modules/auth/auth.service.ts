import { createHash, randomBytes, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Redis } from "ioredis";
import {
  refreshTokenKey,
  selectedCommunityKey,
  adminPasswordResetOtpKey,
  adminPasswordResetCooldownKey,
  adminPasswordResetCypherKey,
} from "../../lib/redis.js";
import { hitRateLimit } from "../../lib/rate-limit.js";
import { revokeRefreshTokensFor } from "../../lib/refresh-tokens.js";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { generateUploadUrl, avatarExtension, inspectUploadedAvatar, deleteUploadedAvatar, AVATAR_FOLDER, AVATAR_MAX_BYTES } from "../../lib/minio.js";
import { getAccessibleCommunityIds } from "../../lib/community-access.js";
import { notificationsQueue, NEW_MEMBER_REGISTERED_EMAIL_JOB, NOTIFICATIONS_PUBSUB_CHANNEL, PASSWORD_RESET_OTP_EMAIL_JOB } from "../../lib/queue.js";
import type { LiveNotificationEvent } from "../../lib/queue.js";
import { formatEmailDate } from "../../lib/email-templates.js";
import { routingData, RoutingModule } from "../../lib/notification-routing.js";
import { NotificationType } from "../notifications/notifications.dto.js";
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  TooManyRequestsError,
} from "../../shared/errors/index.js";
import type {
  AuthTokensInternal,
  AuthResponseDTO,
  LoginDTO,
  PublicUserDTO,
  CommunityInfoDTO,
  RegisterDTO,  UpdateEmailDTO,
  UpdateNameDTO,
  ChangePasswordDTO,
  UpdateNotificationsDTO,} from "./auth.dto.js";
import type { JwtPayload } from "../../middlewares/auth.middleware.js";

const BCRYPT_ROUNDS = 12;

// Admin forgot-password: a 6-digit code emailed to the admin, then a single-use "cypher" that authorizes the
// password change (mirrors the mobile flow, but admin-only and with its own Redis keys).
const RESET_OTP_TTL_SECONDS = 10 * 60;
const RESET_OTP_RESEND_COOLDOWN_SECONDS = 60;
const RESET_MAX_OTP_ATTEMPTS = 5;
const RESET_CYPHER_TTL_SECONDS = 10 * 60;
const RESET_INVALID_CODE = "Invalid or expired code. Please request a new one.";

interface ResetOtpRecord {
  hash: string;
  attempts: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateResetOtp(): string {
  // randomInt is cryptographically secure, unlike Math.random.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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
  // Nullable at the DB level (a member added by admin has none until they
  // register), but every codepath that reaches toPublicUser/issueTokens is
  // already past registration (passwordHash set), which requires a real
  // email — see register() below. Asserted non-null once, in toPublicUser.
  email: string | null;
  passwordHash: string | null;
  role: string;
  isSuperAdmin: boolean;
  avatarUrl: string | null;
  postNotificationsEnabled: boolean;
};

// The website is the admin console. Members use the Finskool mobile app (its own login, with its own
// session), so a member signing in here is told where to go rather than being let in.
export const ADMIN_ONLY_MESSAGE = "This website is for admins only. Please log in from the Finskool mobile app.";

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
    if (user.status !== "active") {
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

    // Mark phone as registered — also sync name/email here, since ApprovedPhone
    // (not User) is what the admin members list reads from; without this, a
    // member who edits their name/email at registration would show correctly
    // on their own side but keep showing the admin's original placeholder value.
    await this.db.approvedPhone.update({
      where: { phone: data.phone },
      data: { name: data.fullName, email: data.email, status: 'registered' },
    });

    const communities = await this.fetchUserCommunities(updated.id);
    const approvedPhone = await this.db.approvedPhone.findUnique({
      where: { phone: data.phone },
      select: { addedBy: true },
    });
    const addedByAdmin = approvedPhone?.addedBy
      ? await this.db.user.findUnique({ where: { id: approvedPhone.addedBy }, select: { id: true, name: true, email: true } })
      : null;

    if (addedByAdmin) {
      const activeSubscriptions = await this.db.subscription.findMany({
        where: { userId: updated.id, isActive: true, validUntil: { gte: startOfToday() } },
        select: { id: true, communityId: true },
      });

      for (const community of communities) {
        try {
          await notificationsQueue.add(
            NEW_MEMBER_REGISTERED_EMAIL_JOB,
            {
              adminEmail: addedByAdmin.email!, // admin accounts always have email
              adminName: addedByAdmin.name,
              memberName: updated.name,
              phone: updated.phone,
              communityName: community.name,
              registeredDate: new Date().toISOString(),
            },
            { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
          );
        } catch (err) {
          logger.error({ err, userId: updated.id, communityId: community.id }, "auth.register: failed to enqueue new-member-registered email job");
        }

        const subscriptionId = activeSubscriptions.find(s => s.communityId === community.id)?.id;
        if (subscriptionId) {
          const registeredDate = new Date();
          const message = `Joined ${community.name} on ${formatEmailDate(registeredDate)}.`;
          try {
            await this.db.notification.create({
              data: {
                communityId: community.id,
                userId: addedByAdmin.id,
                type: NotificationType.NewMemberRegistered,
                sourceId: subscriptionId,
                title: `${updated.name} has registered`,
                message,
                data: routingData({ module: RoutingModule.Member, id: updated.id, communityId: community.id }),
              },
            });
            await this.redis.publish(
              NOTIFICATIONS_PUBSUB_CHANNEL,
              JSON.stringify({
                userId: addedByAdmin.id,
                type: NotificationType.NewMemberRegistered,
                communityId: community.id,
                message,
                sourceId: subscriptionId,
              } satisfies LiveNotificationEvent),
            );
          } catch (err) {
            logger.error({ err, userId: updated.id, communityId: community.id }, "auth.register: failed to create new-member-registered notification");
          }
        }
      }
    }

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
    if (user.status !== "active") {
      throw new UnauthorizedError(
        "Your account has been deactivated. Please contact your admin.",
      );
    }
    if (!user.passwordHash) {
      throw new UnauthorizedError(
        "You have not registered yet. Please register in the Finskool mobile app.",
        "NOT_REGISTERED",
      );
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      logger.warn({ email: data.email }, "auth.login: invalid password");
      throw new UnauthorizedError("Invalid email or password");
    }

    // Checked after the password so a wrong password never reveals that an email belongs to a member.
    if (user.role !== "admin") throw new ForbiddenError(ADMIN_ONLY_MESSAGE, "ADMIN_ONLY");

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
    if (user.status !== "active") {
      throw new UnauthorizedError(
        "Your account has been deactivated. Please contact your admin.",
      );
    }

    // Web sessions issued to members before the site became admin-only stop here.
    if (user.role !== "admin") throw new UnauthorizedError(ADMIN_ONLY_MESSAGE, "ADMIN_ONLY");

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

    const accessToken = await this.signAccessToken(
      { id: user.id, role: user.role as "admin" | "member", isSuperAdmin: user.isSuperAdmin },
      communityIds,
      selectedCommunityId,
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
    if (user.status !== "active") {
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

    return this.signAccessToken(
      { id: userId, role: user.role as "admin" | "member", isSuperAdmin: user.isSuperAdmin },
      communityIds,
      communityId,
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

    const accessToken = await this.signAccessToken({ id: user.id, role, isSuperAdmin: user.isSuperAdmin }, communityIds, selectedCommunityId);
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
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            tags: true,
            coverImageUrl: true,
            badgeUrl: true,
            _count: { select: { subscriptions: { where: { isActive: true } } } },
          },
        },
      },
    });
    return subscriptions.map((s) => {
      const { _count, ...community } = s.community;
      return { ...community, memberCount: _count.subscriptions };
    });
  }

  private signToken(payload: JwtPayload, expiresIn: string): string {
    return jwt.sign(payload as object, env.jwt.secret, {
      expiresIn,
    } as jwt.SignOptions);
  }

  private async computeAccessibleCommunityIds(
    userId: string,
    role: string,
  ): Promise<string[] | null> {
    // Members have no admin-scoped community grants. [] (not null) so this
    // field can never be misread as "unrestricted" if ever consulted without
    // an accompanying role check.
    if (role !== "admin") return [];
    return getAccessibleCommunityIds(this.db, userId);
  }

  private async signAccessToken(
    user: { id: string; role: "admin" | "member"; isSuperAdmin: boolean },
    communityIds: string[],
    selectedCommunityId: string | null,
  ): Promise<string> {
    const accessibleCommunityIds = await this.computeAccessibleCommunityIds(user.id, user.role);
    return this.signToken(
      {
        sub: user.id,
        role: user.role,
        type: "access",
        communityIds,
        selectedCommunityId,
        accessibleCommunityIds,
        isSuperAdmin: user.isSuperAdmin,
      },
      env.jwt.accessExpiresIn,
    );
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
    // Keep ApprovedPhone in sync — the admin members list reads name/email from
    // there, not User (see the same note on register() above). updateMany, not
    // update: a self-registered user has no ApprovedPhone row at all, and
    // `.update()` throws (P2025) when its `where` matches nothing — which
    // used to mean this call crashed with an unhandled 500 for exactly that
    // population, even though the User write just above it had already
    // succeeded. updateMany affecting 0 rows is a silent, correct no-op
    // instead. Wrapped in try/catch too, matching this codebase's convention
    // for secondary/denormalized writes elsewhere (e.g. every
    // notificationsQueue.add call site) — a transient failure syncing this
    // display copy must never fail the primary write, which already succeeded.
    try {
      await this.db.approvedPhone.updateMany({
        where: { phone: updated.phone },
        data: { email: data.email },
      });
    } catch (err) {
      logger.error({ err, userId }, 'auth.updateEmail: failed to sync ApprovedPhone');
    }
    logger.info({ userId }, 'auth.updateEmail: success');
    return this.toPublicUser(updated);
  }

  async updateName(userId: string, data: UpdateNameDTO): Promise<PublicUserDTO> {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { name: data.name },
    });
    // See updateEmail's comment just above for why this is updateMany + try/catch.
    try {
      await this.db.approvedPhone.updateMany({
        where: { phone: updated.phone },
        data: { name: data.name },
      });
    } catch (err) {
      logger.error({ err, userId }, 'auth.updateName: failed to sync ApprovedPhone');
    }
    logger.info({ userId }, 'auth.updateName: success');
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

  /**
   * Step 1 of "Forgot password" on the admin console. Always resolves silently, whether or not `email` belongs
   * to an admin, so the response can never be used to find out which emails are registered. Only an active admin
   * who has a password gets a code; members are ignored here (they reset from the mobile app).
   */
  async forgotPassword(email: string, ip: string | undefined): Promise<void> {
    await hitRateLimit(this.redis, `rl:admin-forgot:ip:${ip ?? "unknown"}`, 10, 60 * 60);

    const user = await this.db.user.findUnique({ where: { email } });
    const eligible =
      !!user && !user.deletedAt && user.status === "active" && user.role === "admin" && !!user.passwordHash && !!user.email;
    if (!eligible) {
      logger.info({ email }, "auth.forgotPassword: no-op (no matching admin account)");
      return;
    }

    // Also silent on cooldown: a 429 here would itself reveal that a reset was just requested for this email.
    if (await this.redis.get(adminPasswordResetCooldownKey(email))) {
      logger.info({ email }, "auth.forgotPassword: no-op (cooldown active)");
      return;
    }

    const otp = generateResetOtp();
    const record: ResetOtpRecord = { hash: hashToken(otp), attempts: 0 };
    await this.redis.set(adminPasswordResetOtpKey(email), JSON.stringify(record), "EX", RESET_OTP_TTL_SECONDS);
    await this.redis.set(adminPasswordResetCooldownKey(email), "1", "EX", RESET_OTP_RESEND_COOLDOWN_SECONDS);

    try {
      await notificationsQueue.add(
        PASSWORD_RESET_OTP_EMAIL_JOB,
        { toEmail: user.email!, name: user.name, otp, expiryMinutes: RESET_OTP_TTL_SECONDS / 60 },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      );
    } catch (err) {
      // Swallowed: the caller gets the same generic answer either way; ops still sees it in the logs.
      logger.error({ err, email }, "auth.forgotPassword: failed to enqueue reset OTP email job");
    }
    logger.info({ userId: user.id }, "auth.forgotPassword: code sent");
  }

  /**
   * Step 2: checks the emailed code. On success returns a short-lived single-use cypher (not a login) that
   * resetPassword() redeems. One message for "no code" and "wrong code" so this step can't tell a mistyped email
   * from a mistyped code. Five wrong guesses burn the code.
   */
  async verifyResetOtp(email: string, otp: string, ip: string | undefined): Promise<{ cypher: string; cypherExpiresInSeconds: number }> {
    await hitRateLimit(this.redis, `rl:admin-reset-verify:ip:${ip ?? "unknown"}`, 30, 10 * 60);

    const raw = await this.redis.get(adminPasswordResetOtpKey(email));
    if (!raw) throw new BadRequestError(RESET_INVALID_CODE, "OTP_INVALID");

    const record = JSON.parse(raw) as ResetOtpRecord;
    if (record.attempts >= RESET_MAX_OTP_ATTEMPTS) {
      await this.redis.del(adminPasswordResetOtpKey(email));
      throw new TooManyRequestsError("Too many incorrect attempts. Please request a new code.", "OTP_LOCKED");
    }

    if (hashToken(otp) !== record.hash) {
      const ttl = await this.redis.ttl(adminPasswordResetOtpKey(email));
      const updated: ResetOtpRecord = { ...record, attempts: record.attempts + 1 };
      await this.redis.set(adminPasswordResetOtpKey(email), JSON.stringify(updated), "EX", ttl > 0 ? ttl : RESET_OTP_TTL_SECONDS);
      throw new BadRequestError(RESET_INVALID_CODE, "OTP_INVALID");
    }

    // Single use: the code is gone the moment it is right.
    await this.redis.del(adminPasswordResetOtpKey(email));

    // Re-check: the account may have been suspended or removed since the code was sent.
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status !== "active" || user.role !== "admin") {
      throw new BadRequestError(RESET_INVALID_CODE, "OTP_INVALID");
    }

    const cypher = randomBytes(32).toString("hex");
    await this.redis.set(adminPasswordResetCypherKey(hashToken(cypher)), user.id, "EX", RESET_CYPHER_TTL_SECONDS);
    logger.info({ userId: user.id }, "auth.verifyResetOtp: success, cypher issued");
    return { cypher, cypherExpiresInSeconds: RESET_CYPHER_TTL_SECONDS };
  }

  /**
   * Step 3: sets the new password. The cypher is the only authorization (no session involved) and is deleted as
   * soon as it is presented, so it cannot be replayed. Every existing web session of the admin is ended, so the
   * old password (or a stolen session) stops working everywhere; the admin signs in again with the new one.
   */
  async resetPassword(cypher: string, newPassword: string, ip: string | undefined): Promise<void> {
    await hitRateLimit(this.redis, `rl:admin-reset:ip:${ip ?? "unknown"}`, 20, 60 * 60);

    const key = adminPasswordResetCypherKey(hashToken(cypher));
    const userId = await this.redis.get(key);
    if (!userId) throw new BadRequestError("This reset session has expired. Please start again.", "RESET_TOKEN_INVALID");
    await this.redis.del(key);

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== "active" || user.role !== "admin") {
      throw new BadRequestError("This reset session is no longer valid.", "RESET_TOKEN_INVALID");
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash } });
    const revoked = await revokeRefreshTokensFor(this.redis, user.id);
    logger.info({ userId: user.id, sessionsEnded: revoked }, "auth.resetPassword: success");
  }

  async updateNotifications(userId: string, data: UpdateNotificationsDTO): Promise<PublicUserDTO> {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { postNotificationsEnabled: data.postNotificationsEnabled },
    });
    logger.info({ userId, postNotificationsEnabled: data.postNotificationsEnabled }, 'auth.updateNotifications: success');
    return this.toPublicUser(updated);
  }

  /**
   * Link for uploading a profile picture. The file name's extension decides the stored name, so it must be a
   * supported type; the optional size lets the app be told "too big" before it uploads anything. The upload
   * itself can't be limited by the link, so the type and size are enforced again when the picture is saved.
   */
  async getAvatarUploadUrl(filename: string, sizeBytes?: number): Promise<{ uploadUrl: string; publicUrl: string }> {
    if (!avatarExtension(filename)) {
      throw new BadRequestError("Only JPG, PNG and WebP images are allowed", "AVATAR_TYPE_INVALID");
    }
    if (sizeBytes !== undefined && sizeBytes > AVATAR_MAX_BYTES) {
      throw new BadRequestError("The picture must be 5 MB or smaller", "AVATAR_TOO_LARGE");
    }
    return generateUploadUrl(filename, AVATAR_FOLDER);
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<PublicUserDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found');

    const check = await inspectUploadedAvatar(avatarUrl);
    if (!check.ok) {
      switch (check.reason) {
        case "foreign_url":
          throw new BadRequestError("Use the publicUrl returned when you asked for the upload link", "AVATAR_URL_INVALID");
        case "not_uploaded":
          throw new BadRequestError("The picture was not uploaded. Upload it first, then save it", "AVATAR_NOT_UPLOADED");
        case "too_large":
          throw new BadRequestError("The picture must be 5 MB or smaller", "AVATAR_TOO_LARGE");
        default:
          throw new BadRequestError("Only JPG, PNG and WebP images are allowed", "AVATAR_TYPE_INVALID");
      }
    }

    // Replace the old picture (never the one just saved, and only our own avatar files).
    if (user.avatarUrl && user.avatarUrl !== avatarUrl) {
      await deleteUploadedAvatar(user.avatarUrl);
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
      email: user.email!, // guaranteed by registration — see the DbUser.email comment above
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      avatarUrl: user.avatarUrl,
      postNotificationsEnabled: user.postNotificationsEnabled,
    };
  }
}
