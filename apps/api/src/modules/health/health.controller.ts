import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import IORedis from 'ioredis';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NOTIFICATIONS_REDIS_CONNECTION } from '../../common/queue/queue.constants';

interface DependencyCheck {
  status: 'ok' | 'error';
  error?: string;
}

// Bounded so a dead dependency reports `error` instead of hanging the probe —
// the shared Redis connection retries forever by design (BullMQ requirement).
const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  // Phase 1 makes JwtAuthGuard global (auth.module.ts) — health checks
  // (load-balancer probes) must stay reachable without a token, so this is
  // explicitly marked @Public() rather than accidentally locked out.
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    // Phase 20 (ARCHITECTURE.md §AP observability hooks, "without
    // introducing unrelated monitoring infrastructure") — extends this
    // Phase 0 liveness check with real dependency readiness, exactly the
    // extension point this controller's own Phase 0 doc comment invited
    // ("A DB-readiness check can be added once Phase 1+ gives the app
    // something real to check connectivity against"). Deliberately does
    // NOT introduce a new APM/tracing SDK or a parallel metrics
    // endpoint — this is the one, already-established `GET /health`
    // route, now reporting on the two real external dependencies this
    // process has (Postgres via PrismaService, Redis via the shared
    // BullMQ connection) instead of a new monitoring surface.
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'error';

    return {
      status,
      service: 'exam-sync-api',
      timestamp: new Date().toISOString(),
      dependencies: { database, redis },
    };
  }

  // Phase 24 (production deployment) — pure liveness probe: "is the Node
  // process up and answering HTTP", no dependency checks. Distinct from
  // GET /health above, which is really a READINESS check (DB + Redis).
  // Container orchestrators restart a process that fails liveness; if
  // liveness were coupled to DB/Redis, a slow-starting Postgres would get
  // a perfectly healthy API process kill-looped for no reason. Keep this
  // route trivial on purpose — no dependency calls, ever.
  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok', service: 'exam-sync-api', timestamp: new Date().toISOString() };
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    try {
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  }
}
