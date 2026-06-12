# Use the full node:22 base, NOT slim and NOT node:20.
#
# Two SDK constraints pin this choice:
#
#  1. better-sqlite3 (pulled in by @actual-app/api) is native. On *-slim images
#     there's no prebuilt binary, so npm compiles from source and fails with
#     "gyp ERR! find Python / Could not find any Python installation" — slim ships
#     no Python/build toolchain. The full base bundles Python + make + g++, so the
#     compile just works. We chose the larger base over apt-get build deps to keep
#     this Dockerfile simple.
#
#  2. The SDK has browser-only code that references the `navigator` global at
#     runtime — on node:20 the bridge crash-looped with "ReferenceError: navigator
#     is not defined". Node 22 added `navigator` as a global, so it matches what
#     the SDK assumes. (This is the 3rd environment bug we've hit in this SDK.)
#
# Do not relitigate; do not downgrade.
FROM node:22

WORKDIR /app

# No package-lock is committed for this tiny internal service; the build runs on
# the Hetzner host (which has network), so `npm install` resolves at build time.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=5007
EXPOSE 5007

CMD ["node", "src/server.js"]
