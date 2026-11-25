# Game server image. Build context: the repository root
#   docker build -f apps/server/Dockerfile .
FROM node:22-slim

WORKDIR /app
RUN corepack enable

# Dependencies first (cached while the lockfile does not change).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/module-format/package.json packages/module-format/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @tabletop/server...

COPY packages/core packages/core
COPY packages/module-format packages/module-format
COPY apps/server apps/server

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
EXPOSE 8080
WORKDIR /app/apps/server
# Node runs directly (not through pnpm) so it receives SIGTERM and saves the tables.
CMD ["node", "--import", "tsx", "src/index.ts"]
