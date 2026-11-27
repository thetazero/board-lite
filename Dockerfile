# board-lite as a public website: see docs/deploy.md.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NODE_NO_WARNINGS=1 BOARD_LITE_DATA=/data PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY src ./src
COPY web ./web
COPY docs/rules.md ./docs/rules.md
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server/server.ts"]
