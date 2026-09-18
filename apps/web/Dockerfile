# Production image for @exam-sync/web (Phase 24).
# Same monorepo-root `npm ci` requirement as apps/api/Dockerfile — apps/web
# has no workspace-package dependencies today, but installing at the root
# keeps one consistent, correct build context/lockfile story across images.
#
# Deliberately does NOT touch apps/web/next.config.js (e.g. `output:
# standalone`) or any other application code/config — Phase 24 is
# deployment-only and apps/web application config is out of scope for this
# phase. This build therefore ships full node_modules + .next, not a
# trimmed standalone bundle.

FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain-logic/package.json packages/domain-logic/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY workers workers
RUN npm ci

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read from the runtime environment — must be supplied as a build arg.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build --workspace=@exam-sync/web

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini
RUN addgroup -S examsync && adduser -S examsync -G examsync
WORKDIR /repo/apps/web

COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/web/node_modules /repo/apps/web/node_modules
COPY --from=build /repo/apps/web/.next /repo/apps/web/.next
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json
COPY --from=build /repo/apps/web/next.config.js /repo/apps/web/next.config.js

USER examsync
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
