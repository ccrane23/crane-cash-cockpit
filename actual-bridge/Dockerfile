# Start slim. @actual-app/api pulls in better-sqlite3 (native). If a prebuilt
# binary isn't available for this base and npm tries to compile from source, the
# build will fail on missing python3/make/g++. If that happens, change the base
# image to the full `node:20` (which bundles build tools) and note it here.
FROM node:20-slim

WORKDIR /app

# No package-lock is committed for this tiny internal service; the build runs on
# the Hetzner host (which has network), so `npm install` resolves at build time.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=5007
EXPOSE 5007

CMD ["node", "src/server.js"]
