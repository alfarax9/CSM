# Build dari root repo: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci -w @csm/shared -w @csm/web --include-workspace-root \
 && npm run build -w @csm/shared \
 && npm run build -w @csm/web

FROM node:24-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
