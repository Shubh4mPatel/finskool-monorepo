# syntax=docker/dockerfile:1

# Build context is the monorepo ROOT (see docker-compose.dev.yml /
# docker/docker-compose.production.yml), not this directory — npm workspaces
# needs every workspace's package.json present to validate against the root
# package-lock.json, even though --workspace scopes what actually gets
# installed to just this backend (+ hoisted root deps).

# ---- deps: install this workspace's dependencies from the root lock file ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm ci --workspace=apps/backend --include-workspace-root

# ---- dev: hot-reloading dev server. Source is bind-mounted by compose,
#      so the COPY here just seeds an image that can run standalone too. ----
FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY apps/backend/tsconfig.json apps/backend/prisma.config.ts ./apps/backend/
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/email-template ./apps/backend/email-template
COPY apps/backend/src ./apps/backend/src
RUN npm run prisma:generate --workspace=apps/backend
WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ---- builder: generate Prisma client + compile TS -> dist ----
FROM deps AS builder
WORKDIR /app
COPY apps/backend/tsconfig.json apps/backend/prisma.config.ts ./apps/backend/
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/src ./apps/backend/src
RUN npm run prisma:generate --workspace=apps/backend
RUN npm run build --workspace=apps/backend

# ---- runtime: production image that runs the compiled app ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Reuse deps' node_modules (includes the `prisma` CLI + dotenv that
# `prisma migrate deploy` needs at startup).
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/src/generated ./apps/backend/src/generated
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY apps/backend/email-template ./apps/backend/email-template
COPY apps/backend/docker-entrypoint.sh ./apps/backend/docker-entrypoint.sh
RUN chmod +x apps/backend/docker-entrypoint.sh
WORKDIR /app/apps/backend
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
