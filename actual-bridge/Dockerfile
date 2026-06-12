# Use the full node:20 base, NOT node:20-slim.
#
# @actual-app/api pulls in better-sqlite3 (native). On node:20-slim there's no
# prebuilt binary for this combination, so npm compiles it from source and the
# build fails with "gyp ERR! find Python / Could not find any Python installation"
# — slim ships no Python or build toolchain. The full node:20 image bundles
# Python + make + g++, so the native compile just works. We chose the larger base
# over adding apt-get build deps to keep the Dockerfile simple. Do not relitigate.
FROM node:20

WORKDIR /app

# No package-lock is committed for this tiny internal service; the build runs on
# the Hetzner host (which has network), so `npm install` resolves at build time.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=5007
EXPOSE 5007

CMD ["node", "src/server.js"]
