# Multi-stage, because the thing that runs is compiled output.
#
# This is the whole point of containerising this service. It was deployed by
# building on a laptop and copying lib/ to the host - lib/ is gitignored build
# output, so the running artifact could not be traced to any commit. Here the
# compile happens inside the image from a known checkout, and the image is
# tagged with that commit.

FROM node:18-alpine AS builder
# sqlite3 is a native module and there is no prebuilt binary for musl, so
# node-gyp compiles it here.
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Everything is copied BEFORE npm ci, which costs the dependency layer cache but
# is what makes the build work at all: package.json has
# `"prepare": "npm run compile"`, and npm runs it at the end of install. With
# only package*.json present it fires before src/ exists and tsc fails. With the
# source already here it compiles exactly as intended, and the same install
# builds the native modules.
COPY . .
RUN npm ci

FROM node:18-alpine AS runtime
WORKDIR /app

# node_modules comes from the builder with its compiled bindings intact.
# Reinstalling here instead was the first attempt and it failed at runtime:
# `npm ci --omit=dev --ignore-scripts` skips node-gyp, so sqlite3 arrived with
# no binding at all - "Could not locate the bindings file". --ignore-scripts was
# needed there only to stop `prepare` running without a compiler, so copying
# sidesteps both problems.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package*.json ./
COPY bin ./bin
COPY static ./static

# Drop devDependencies now that the compile is done. `prune` does not run
# lifecycle scripts, so `prepare` stays quiet, and it leaves the already-built
# native modules of the production deps alone.
RUN npm prune --omit=dev

# The archive tree is a mounted volume. Creating it here only guarantees the
# mount point exists and is owned by the unprivileged user when nothing is
# mounted over it.
RUN mkdir -p /app/slack-archive && chown -R node:node /app

# No EXPOSE: bot mode is a Slack socket-mode client. Outbound WebSocket only.
USER node
ENV NODE_ENV=production

CMD ["node", "bin/slack-archive.js", "--bot"]
