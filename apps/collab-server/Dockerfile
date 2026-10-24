# ====================================================================
# SyncSpace Collaboration WebSocket Server Dockerfile
# Multi-stage production build for Node.js 20 on Linux
# ====================================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for Prisma native engine support
RUN apk add --no-cache openssl

# Copy workspace package manifests
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY apps/collab-server/package.json ./apps/collab-server/
COPY apps/web/package.json ./apps/web/

# Install all workspace dependencies
RUN npm ci

# Copy Prisma schema and application source code
COPY packages/db ./packages/db
COPY apps/collab-server ./apps/collab-server

# Generate Prisma client and compile TypeScript to dist/
RUN npm run db:generate
RUN npm run build:collab

# Prune devDependencies for a lean production image
RUN npm prune --production

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1234
ENV HOST=0.0.0.0

RUN apk add --no-cache openssl curl

# Create non-root system user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 syncspace

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/apps/collab-server/package.json ./apps/collab-server/package.json
COPY --from=builder /app/apps/collab-server/dist ./apps/collab-server/dist

USER syncspace

EXPOSE 1234

# Healthcheck for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:1234/health || exit 1

CMD ["node", "apps/collab-server/dist/index.js"]
