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
# PaddleOCR reads photos and scanned pages; without it the reader falls back to Tesseract only.
# Python 3.11 (bookworm) is within the 3.9–3.13 range the OCR worker supports.
COPY server/ocr/requirements.txt /tmp/ocr-requirements.txt
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/ocr-venv \
 && /opt/ocr-venv/bin/pip install --no-cache-dir -r /tmp/ocr-requirements.txt \
 && rm /tmp/ocr-requirements.txt
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/templates ./templates
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node deploy/docker-entrypoint.sh /usr/local/bin/kedu-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/kedu-entrypoint && chmod 0755 /usr/local/bin/kedu-entrypoint && mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/kedu-entrypoint"]
CMD ["node", "--import", "tsx", "server/index.ts"]
