# UNTESTED: Docker is not installed on the build machine, so this image has never been built or run.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8791 DB_PATH=/data/app.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY fixtures ./fixtures
COPY tsconfig.json ./
VOLUME /data
EXPOSE 8791
# NOTE: the server binds 127.0.0.1 by design; to reach it from outside the container set a reverse proxy in the same
# network namespace or change the bind address deliberately — the demo identity switcher is NOT authentication.
CMD ["npx", "tsx", "server/index.ts"]
