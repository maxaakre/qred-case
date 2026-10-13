# Production image: compiled JavaScript and production dependencies only.
# Base images are pinned by digest, so a re-pushed tag cannot change what is built.
# Dependabot opens a pull request when the tag moves.

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Compiles to dist/ (with the spec and migrations), then drops dev dependencies.
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Not root: a compromised process cannot change the image's files.
USER node
EXPOSE 3000
# Readiness outside compose too (plain docker, ECS): /health checks the database as well.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
# Node runs as PID 1 and gets SIGTERM directly, so the graceful shutdown in server.ts runs.
CMD ["node", "dist/src/server.js"]
