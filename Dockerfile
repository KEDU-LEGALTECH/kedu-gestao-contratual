# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations
COPY templates ./templates
RUN npm run build && npm prune --omit=dev
# Fail during build rather than shipping an image with a missing TS runtime.
RUN node --import tsx -e "console.log('TypeScript runtime available')"

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/app/data/kedu.sqlite
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/templates ./templates
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
