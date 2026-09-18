# Production image for @exam-sync/api (Phase 24).
#
# This is an npm-workspaces monorepo: apps/api depends on the workspace
# packages @exam-sync/db and @exam-sync/domain-logic (see apps/api/package.json).
# npm workspaces symlinks those into apps/api/node_modules, so `npm ci` MUST
# run at the monorepo root (with the root lockfile) — running it inside
# apps/api alone would not resolve the "*" workspace deps correctly.
#
# Multi-stage: a full `deps+build` stage compiles TypeScript for the two
# workspace packages the API imports plus the API itself; the runtime stage
# ships only production dependencies + compiled dist/, as a non-root user.

# ---- Stage 1: install all workspace deps (needed to compile) ----
FROM node:20-alpine AS deps
WORKDIR /repo
# `openssl` (the CLI) must be present before any `prisma generate` run in
# this stage or its descendants (stage 2 `build`, and the compose file's
# `migrate` service which targets `build` directly) — see the identical,
# more detailed comment in stage 3 (`prod-deps`) below for why: without it,
# Prisma's libssl-version detection silently fails and it bundles the wrong
# query-engine binary, which then fails to load at runtime against this
# same Alpine base's actual `libssl.so.3` (confirmed failure mode: `docker
# compose run migrate` errored "Could not parse schema engine response:
# ... Error load[ing shared library libssl.so.1.1]").
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain-logic/package.json packages/domain-logic/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/api/package.json apps/api/package.json
# workers/ are separate deployables (not needed by the api image) but are
# listed in the root workspaces glob, so npm needs their manifests present
# for `npm ci` to resolve the workspace graph.
COPY workers workers
RUN npm ci

# ---- Stage 2: build (compile TS -> dist for db, domain-logic, api) ----
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/domain-logic packages/domain-logic
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
# Prisma client is generated from schema.prisma into node_modules/.prisma —
# not committed, must run before @exam-sync/db (and thus the api) compiles.
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build --workspace=@exam-sync/db
RUN npm run build --workspace=@exam-sync/domain-logic
RUN npm run build --workspace=@exam-sync/api

# ---- Stage 3: production-only deps (no devDependencies, no TS compiler) ----
FROM node:20-alpine AS prod-deps
WORKDIR /repo
# `openssl` (the CLI) must be present BEFORE `prisma generate` runs below:
# Prisma detects the runtime's libssl version by shelling out to `openssl
# version`, not by inspecting `libssl.so.3` directly. Without it, detection
# silently fails and Prisma falls back to bundling the OLDER
# `openssl-1.1.x` query-engine binary — which then fails at container
# startup against this same Alpine base's actual `libssl.so.3` (confirmed:
# without this line, the bundled engine was
# `libquery_engine-linux-musl-arm64-openssl-1.1.x.so.node`, the wrong one).
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain-logic/package.json packages/domain-logic/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/api/package.json apps/api/package.json
COPY workers workers
RUN npm ci --omit=dev --ignore-scripts
# Prisma's generated client is a runtime dependency of @exam-sync/db, but the
# "generate" step needs the CLI (a devDependency) and the schema file —
# regenerate it here against the prod-only node_modules tree.
COPY packages/db/prisma packages/db/prisma
# The Prisma CLI (a devDependency, absent from this --omit=dev tree) must be
# fetched via npx to run `generate` here — but its version MUST match the
# already-installed @prisma/client's resolved version, or the generated
# client and the CLI's expectations diverge (this previously hardcoded
# `prisma@5.19.1` — the package.json devDependency range's literal text —
# while the lockfile actually resolves @prisma/client to 5.22.0, causing a
# real version-mismatch error at generate time). Read the ACTUAL installed
# @prisma/client version instead of hardcoding a version that will drift
# from the lockfile again the next time it's bumped.
RUN PRISMA_VERSION="$(node -p "require('@prisma/client/package.json').version")" && \
    npx --package="prisma@${PRISMA_VERSION}" prisma generate --schema packages/db/prisma/schema.prisma

# ---- Stage 4: runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# tini forwards SIGTERM correctly to the Node process (PID 1 signal-handling
# gotcha) — `docker stop` / a container orchestrator's rolling restart sends
# SIGTERM and expects app.enableShutdownHooks() (main.ts) to get it promptly.
#
# NOTE on OpenSSL: an earlier version of this Dockerfile installed the
# (now-nonexistent) `openssl1.1-compat` package here. The CURRENT
# `node:20-alpine` base (Alpine 3.23) ships `libssl.so.3` natively, and the
# correctly-generated engine binary IS `linux-musl-...-openssl-3.0.x` (fixed
# in stage 3 by installing `openssl` there before `prisma generate` runs) —
# but Prisma's CLIENT also re-detects the OpenSSL version at every process
# STARTUP (not just at generate time), and that runtime detection likewise
# shells out to `openssl`. Without the `openssl` CLI present in THIS final
# stage too, that startup check silently fails and Prisma guesses the wrong
# runtime target ("linux-musl-arm64-openssl-1.1.x"), then can't find the
# (correctly-generated, actually-present) 3.0.x engine file on disk and
# crashes on every boot. Confirmed by actually running this image as a real
# container (not just a module `require()` smoke check, which doesn't
# exercise this path) — `PrismaClientInitializationError: ... located for
# runtime "linux-musl-arm64-openssl-1.1.x" ... was generated for
# "linux-musl-arm64-openssl-3.0.x"`. `openssl` must be present in every
# stage that either generates OR runs the Prisma client.
RUN apk add --no-cache tini openssl

RUN addgroup -S examsync && adduser -S examsync -G examsync

COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/db/dist /repo/packages/db/dist
COPY --from=build /repo/packages/db/package.json /repo/packages/db/package.json
COPY --from=build /repo/packages/domain-logic/dist /repo/packages/domain-logic/dist
COPY --from=build /repo/packages/domain-logic/package.json /repo/packages/domain-logic/package.json
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json

USER examsync
WORKDIR /repo/apps/api
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
