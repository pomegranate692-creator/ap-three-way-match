# Public-demo image: synthetic data only. UNTESTED as an image (no Docker on the build machine); the same
# server start was exercised locally with PUBLIC_DEMO=1. See docs/DEPLOY.md.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
# DB_PATH is ephemeral on purpose: the demo resets itself to synthetic data on every start and every 24 h.
ENV NODE_ENV=production PORT=8791 DB_PATH=/tmp/ap-data/app.db ENABLE_OCR=0 ENABLE_LLM=0
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY fixtures/manifest.json ./fixtures/manifest.json
COPY fixtures/pdf ./fixtures/pdf
COPY tsconfig.json ./
EXPOSE 8791
# PUBLIC_DEMO=1 and DEMO_PASSWORD come from the host's settings (fly.toml / render.yaml / secrets), never from this file.
# Without PUBLIC_DEMO the server binds 127.0.0.1 only, which is unreachable from outside a container.
CMD ["npx", "tsx", "server/index.ts"]
