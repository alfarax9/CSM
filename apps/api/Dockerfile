# Build dari root repo: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci -w @csm/shared -w @csm/api --include-workspace-root \
 && npm run build -w @csm/shared \
 && npm run build -w @csm/api \
 && cp -r apps/api/src/generated apps/api/dist/generated

# Dependency produksi saja. Skrip install dimatikan: shared & client Prisma sudah dibangun di tahap build.
FROM node:24-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @csm/api --include-workspace-root=false \
 && mkdir -p apps/api/node_modules

FROM node:24-slim
# Prisma CLI (migrate deploy) butuh OpenSSL; image slim tidak menyertakannya.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/schemas ./packages/shared/schemas
COPY --from=build /repo/apps/api/package.json /repo/apps/api/prisma.config.ts ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
WORKDIR /repo/apps/api
EXPOSE 4000
# Migrasi dijalankan sebelum server aktif (PRD §9 "Host VPS" · Deploy).
CMD ["sh", "-c", "/repo/node_modules/.bin/prisma migrate deploy && node dist/server.js"]
