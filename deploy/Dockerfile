# syntax=docker/dockerfile:1.7
# The API image: Node 22, the built server, and the map app (app/) as static files.
# Build from the repo root:  docker build -f deploy/Dockerfile .
# Ignore rules: deploy/Dockerfile.dockerignore (used by BuildKit for this Dockerfile).

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @rodokmen/server... \
 && pnpm --filter @rodokmen/shared --filter @rodokmen/server run build \
 && pnpm --filter @rodokmen/server deploy --prod --legacy /out \
 && mkdir -p /repo/app

FROM node:22-bookworm-slim
ARG RELEASE=dev
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_DIR=/srv/app RELEASE=$RELEASE
WORKDIR /srv/server
COPY --from=build /out ./
COPY --from=build /repo/app /srv/app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=6s --start-period=40s --retries=3 CMD ["node", "dist/cli.js", "health"]
CMD ["node", "dist/main.js"]
