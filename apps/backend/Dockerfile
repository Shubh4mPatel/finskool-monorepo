# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (shared by every stage) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: hot-reloading dev server. Source is bind-mounted by compose,
#      so the COPY here just seeds an image that can run standalone too. ----
FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ---- builder: generate Prisma client + compile TS -> dist ----
FROM deps AS builder
WORKDIR /app
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---- runtime: production image that runs the compiled app ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Reuse deps' node_modules (includes the `prisma` CLI + dotenv that
# `prisma migrate deploy` needs at startup).
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
