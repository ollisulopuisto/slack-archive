# Multi-stage, because the thing that runs is compiled output.
#
# This is the whole point of containerising this service. It was deployed by
# building on a laptop and copying lib/ to the host - lib/ is gitignored build
# output, so the running artifact could not be traced to any commit. Here the
# compile happens inside the image from a known checkout, and the image is
# tagged with that commit.

FROM node:18-alpine AS builder
WORKDIR /app

# --ignore-scripts is required, not stylistic: package.json has
# `"prepare": "npm run compile"`, which npm runs at the end of install. At that
# point src/ has not been copied yet, so tsc would fail the build with a pile
# of "file not found" errors that look nothing like the real cause.
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run compile

FROM node:18-alpine AS runtime
WORKDIR /app

# Production dependencies only. --ignore-scripts again: typescript lives in
# devDependencies, so the `prepare` hook would try to compile with no compiler.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Only the built output and what it needs at runtime. src/ and the TypeScript
# toolchain stay behind in the builder stage.
COPY --from=builder /app/lib ./lib
COPY bin ./bin
COPY static ./static

# The archive tree is a mounted volume. Creating it here only guarantees the
# mount point exists and is owned by the unprivileged user when nothing is
# mounted over it.
RUN mkdir -p /app/slack-archive && chown -R node:node /app

# No EXPOSE: bot mode is a Slack socket-mode client. Outbound WebSocket only.
USER node
ENV NODE_ENV=production

CMD ["node", "bin/slack-archive.js", "--bot"]
