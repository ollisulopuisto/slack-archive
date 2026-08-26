# Multi-stage, because the thing that runs is compiled output.
#
# This is the whole point of containerising this service. It was deployed by
# building on a laptop and copying lib/ to the host - lib/ is gitignored build
# output, so the running artifact could not be traced to any commit. Here the
# compile happens inside the image from a known checkout, and the image is
# tagged with that commit.

FROM node:18-slim AS builder
# No build toolchain: nothing here compiles any more. The search database used
# to be `sqlite3`, a node-gyp addon with no musl prebuilt, which is why this
# stage carried python3/make/g++. It is now node-sqlite3-wasm - a .wasm file,
# identical on every platform and architecture.
WORKDIR /app

# Everything is copied BEFORE npm ci, which costs the dependency layer cache but
# is what makes the build work at all: package.json has
# `"prepare": "npm run compile"`, and npm runs it at the end of install. With
# only package*.json present it fires before src/ exists and tsc fails. With the
# source already here it compiles exactly as intended.
COPY . .
RUN npm ci

# Debian rather than Alpine, i.e. glibc rather than musl.
#
# The size argument for Alpine is not an argument here: this image renders an
# archive whose pages are 900 MB and whose attachments are 41 GB, so thirty
# megabytes of base image is not a number worth optimising. What musl costs is
# real: prebuilt native binaries are built for glibc, so anything with a native
# addon compiles from source or does not work - this project already uses a
# WebAssembly SQLite instead of a native one for exactly that reason - and musl
# differs at runtime too, in its allocator and its much smaller default thread
# stack, which is the kind of difference that produces a segfault rather than
# an error message.
#
# We have an unexplained segfault on this image on arm64. Changing the base
# does not diagnose it, but it removes a variable that was only ever there for
# a saving we do not need.
FROM node:18-slim AS runtime
WORKDIR /app

# node_modules is copied rather than reinstalled, which also keeps the runtime
# stage free of `prepare` (it runs tsc, and the compile already happened).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package*.json ./
COPY bin ./bin
COPY static ./static
COPY scripts ./scripts

# What publishing needs, and nothing else: the archive renders here, so the
# thing that puts it on a web host runs here too rather than on whichever
# machine happens to have a shell. bash because the script is bash; rsync and
# ssh because that is the transport. bash is already in the base here.
RUN apt-get update \
  && apt-get install --no-install-recommends -y openssh-client rsync \
  && rm -rf /var/lib/apt/lists/*

# Drop devDependencies now that the compile is done. `prune` does not run
# lifecycle scripts, so `prepare` stays quiet.
RUN npm prune --omit=dev

# The archive tree is a mounted volume. Creating it here only guarantees the
# mount point exists and is owned by the unprivileged user when nothing is
# mounted over it.
RUN mkdir -p /app/slack-archive && chown -R node:node /app

# No EXPOSE and no server: this image archives a workspace and exits. The bot
# that used to live here has moved to backlog, which has its own gate, its own
# search and its own deployment.
USER node
ENV NODE_ENV=production

# The version this image IS, baked at build time from the CalVer the pipeline
# already computes for the tag.
#
# Until now nothing inside the image knew its own version, so the infra repo
# declared it by hand in the Quadlet (Environment=APP_VERSION=...) and the
# dashboard read that. A hand-maintained copy of "which build is running" drifts:
# paikallislehti's sat two deploys behind before anything compared them. Baking
# it here makes the image self-describing, and the Quadlet line can go away.
#
# Placed immediately before CMD so a version change invalidates only this layer.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# The archiver, which is what this image is for. Callers that want something
# else - a rerun with different exclusions, a publish render - pass their own
# command; the NAS job does exactly that.
CMD ["node", "bin/slack-archive.js", "--automatic"]
