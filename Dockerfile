# syntax=docker/dockerfile:1
# Mirrors the pm2 layout (cwd = project root, server at .next/standalone/server.js)
# so APP_ROOT and the embedded collab server resolve exactly as they do on bare metal.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM build AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 APP_ROOT=/app COLLAB_HOST=0.0.0.0
EXPOSE 3000 1234
CMD ["node", "--env-file-if-exists=.env", ".next/standalone/server.js"]
