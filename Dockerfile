FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json openapi.json ./
COPY shared ./shared
COPY db ./db
COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kirana/shared build \
  && pnpm --filter @kirana/db build \
  && pnpm --filter @kirana/server build \
  && pnpm --filter @kirana/web build
RUN pnpm --filter @kirana/server deploy --prod /out \
  && cp -r /app/web/dist /out/public \
  && cp -r /app/db/migrations /out/migrations \
  && cp -r /app/db/seed /out/seed

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
  PORT=8080 \
  DATA_DIR=/data \
  WEB_DIST_DIR=/app/public \
  KIRANA_MIGRATIONS_DIR=/app/migrations \
  KIRANA_SEED_DIR=/app/seed \
  TZ=UTC
WORKDIR /app
COPY --from=build /out /app
# DATA_DIR default: create the mountpoint as root so a bare `docker run`
# (no volume) boots; compose mounts ./data over it.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/index.js"]
