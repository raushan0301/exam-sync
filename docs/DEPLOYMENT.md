# Exam-Sync — Production Deployment (Phase 24)

This is the final backend phase. It packages the API (`apps/api`) and web
app (`apps/web`) for production and documents the real, honest deployment
procedure. It does **not** provision any cloud infrastructure — that
requires the user's own cloud account, domain, and credentials (see
"Out of scope" at the end).

## Images

- `apps/api/Dockerfile` — multi-stage build. Stage 1/2 install the full
  npm-workspaces tree at the monorepo root and compile `@exam-sync/db`,
  `@exam-sync/domain-logic`, then `@exam-sync/api` (Nest `dist/`). Stage 3
  installs production-only deps, installs `openssl` (the CLI — required so
  Prisma's engine-detection step can read the base image's actual libssl
  version) and regenerates the Prisma client against the prod-only tree,
  fetching the `prisma` CLI at the SAME version as the already-resolved
  `@prisma/client` (read dynamically from `node_modules`, never hardcoded —
  an earlier version of this stage hardcoded a stale CLI version and hit a
  real version-mismatch error at build time). Stage 4 is the runtime:
  `node:20-alpine` + `tini` (correct SIGTERM forwarding to PID 1), running
  as a non-root user (`examsync`). The current `node:20-alpine` base
  (Alpine 3.23) ships `libssl.so.3` natively and no longer has an
  `openssl1.1-compat` package available at all — Prisma's engine resolution
  auto-selects the matching `linux-musl-openssl-3.0.x` query-engine binary
  when `openssl` is present at generate time, so no extra runtime-stage
  OpenSSL package is needed. Verified end-to-end: the built image's bundled
  engine is `libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node`, and
  the Prisma client module loads with no shared-library error.
- `apps/web/Dockerfile` — same root-level `npm ci` approach, `next build`
  then `next start`, non-root, `tini`. Does not add `output: 'standalone'`
  or otherwise touch `apps/web` application config — out of scope for this
  phase.
- `infra/docker/docker-compose.prod.yml` — wires postgres + redis (official
  images, named volumes) + a one-shot `migrate` service + `api` + `web`.
  All secrets/URLs come from `infra/docker/.env.production` (copy from
  `.env.production.example`, names only, no committed values).

## Deployment procedure

```bash
# 1. From the repo root:
cp infra/docker/.env.production.example infra/docker/.env.production
# edit infra/docker/.env.production with real values

# 2. Build images
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.production build

# 3. Start postgres + redis first (api/migrate depend on their healthchecks)
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.production up -d postgres redis

# 4. Run migrations (production-safe, non-interactive — NOT `migrate dev`)
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.production run --rm migrate

# 5. Start api + web
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.production up -d api web

# 6. Verify
curl -sf http://localhost:3000/health/live   # liveness — always 200 once process is up
curl -sf http://localhost:3000/health        # readiness — 200 only once DB+Redis are reachable
```

Re-running `up -d` after a code change rebuilds and replaces the affected
containers; run the `migrate` step again first if the change includes a new
migration.

## Environment variables / secrets required (names only)

**postgres**
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`

**api** (`apps/api`)
- `DATABASE_URL` (assembled by docker-compose from the postgres vars above —
  set directly only if running the api image outside this compose file)
- `REDIS_URL` (same — assembled from the redis service name in compose)
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `PORT` (defaults to 3000)
- `NODE_ENV` (set to `production` by the image/compose)

**web** (`apps/web`)
- `NEXT_PUBLIC_API_URL` (build-time — baked into the client bundle, not a
  runtime env var; passed as a Docker build arg)

**redis**: no credentials in this topology (no `requirepass` configured) —
if this ever sits on a network the API isn't co-located on, add one; the
placeholder compose here assumes redis is not publicly reachable.

## Database / Redis setup

- **Migrations**: `prisma migrate deploy` is the production-safe command
  (applies pending migrations non-interactively, never generates new ones,
  never prompts) — as opposed to `prisma migrate dev`, which is
  interactive/dev-only and must never run against a production database.
  Verified during this phase:
  - `npx prisma migrate status` against the real dev DB (`exam_sync`, all 21
    migrations) reported "Database schema is up to date!"
  - A throwaway database (`exam_sync_deploy_test`, created and dropped by
    this phase's work, never touching `exam_sync`/`exam_sync_test`) had all
    21 migrations applied from zero with `prisma migrate deploy` — full
    migration history applies cleanly on a fresh database.
  - Confirmed the Phase 20 `audit_logs` protections
    (`REVOKE DELETE ON "audit_logs" FROM "exam_sync"` + the append-only
    `BEFORE UPDATE` trigger) are captured in migration
    `20260915180108_phase20_audit_logs` and were present on the freshly
    migrated throwaway database — a new production deploy gets them
    automatically.

- **Backup** (`pg_dump`, run against the postgres container or host):
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml exec postgres \
    pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "exam_sync_$(date +%Y%m%d%H%M%S).dump"
  ```
  Take this immediately before every deploy that includes a migration.

- **Restore**:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < exam_sync_20260101000000.dump
  ```

## Health / monitoring endpoints

- `GET /health/live` — pure liveness: process is up and answering HTTP, no
  dependency calls. Added this phase (`apps/api/src/modules/health/health.controller.ts`).
  Use for a container orchestrator's liveness probe / restart-on-failure
  decision — a slow-starting Postgres must never cause a healthy API
  process to be kill-looped.
- `GET /health` — readiness: checks Postgres (`SELECT 1` via Prisma) and
  Redis (`PING`) and returns `{status: "ok"|"error", dependencies: {...}}`.
  This was already a Phase 20 endpoint — kept unchanged. Use for
  load-balancer / "should this instance receive traffic" decisions.

## Process management / restart strategy

- The compose file sets `restart: unless-stopped` on postgres, redis, api,
  and web — Docker restarts a crashed container automatically, but this is
  a single-host convenience, not a substitute for a real orchestrator.
- A real production deployment should run this behind an orchestrator (ECS,
  Kubernetes, Nomad, etc.) with its own restart/rolling-update semantics,
  using `GET /health/live` as the liveness probe and `GET /health` as the
  readiness probe. Which specific orchestrator/cloud provider to use is the
  user's own infrastructure decision — intentionally not chosen here.

## Rollback procedure (honest)

Prisma does not generate down-migrations. There is no `prisma migrate
down`. The real, supported rollback options are:

1. **Application code rollback**: redeploy the previous image tag
   (`docker compose ... up -d` with the prior image) — safe as long as no
   migration ran since that image was last deployed, since the schema is
   still compatible.
2. **Schema rollback**: if a migration did run, restoring compatibility
   requires either:
   - Restoring the database from the pre-deploy `pg_dump` backup taken in
     the deployment procedure above (loses any writes made after the
     backup — acceptable only within an agreed maintenance window), or
   - Hand-authoring a new forward migration that reverses the specific
     schema change (the established technique in this project's migration
     history for hand-edited SQL) and deploying that.
   There is no automatic, lossless schema rollback — plan every migration
   with this in mind (e.g. additive-first changes where practical).

## Out of scope / manual steps required (stopped here deliberately)

These require real credentials/accounts this environment does not have —
documented as manual steps rather than invented:

- Provisioning a managed Postgres/Redis instance (or any cloud compute) and
  pointing `DATABASE_URL`/`REDIS_URL` at it.
- A real domain name, DNS records, and TLS certificates (e.g. via a reverse
  proxy/load balancer terminating TLS in front of `api`/`web`) — this
  compose file serves plain HTTP on the ports given.
- A secrets manager (AWS Secrets Manager, Vault, etc.) instead of a
  `.env.production` file — the file-based approach here is the honest
  baseline; swapping it for a secrets manager is a per-provider integration
  this repo does not decide.
- Any specific cloud provider's container orchestrator setup (ECS task
  definitions, Kubernetes manifests, etc.).
