/**
 * Phase 23 load-test runner. Uses autocannon's Node API directly (no
 * external binary). Runs one named scenario against the real running dev
 * server and writes autocannon's raw JSON result to load-tests/results/.
 *
 * Usage (from apps/api/):
 *   npx ts-node load-tests/run-scenario.ts <scenario> [--connections N] [--duration SECS]
 *
 * Scenarios: auth-login-baseline | auth-login-rate-limit | departments-list |
 *            subjects-list | rooms-list | quizzes-list | notifications-list
 */
import autocannon from 'autocannon';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3000';
const RESULTS_DIR = path.join(__dirname, 'results');

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function saveResult(name: string, result: autocannon.Result) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESULTS_DIR, `${name}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nSaved: ${file}`);
  return file;
}

function printSummary(result: autocannon.Result) {
  console.log(`requests: ${result.requests.total}, errors: ${result.errors}, non2xx/3xx: ${result.non2xx}`);
  const lat = result.latency as unknown as Record<string, number>;
  console.log(`latency ms  p50=${lat.p50} p95=${lat.p97_5 ?? lat.p95} p99=${lat.p99} max=${lat.max}`);
  console.log(`throughput req/sec avg=${result.requests.average}`);
  console.log(`status codes:`, result['statusCodeStats' as keyof typeof result]);
}

async function run() {
  const scenario = process.argv[2];
  const connArgIdx = process.argv.indexOf('--connections');
  const durArgIdx = process.argv.indexOf('--duration');
  const rateArgIdx = process.argv.indexOf('--rate');
  const connections = connArgIdx > -1 ? Number(process.argv[connArgIdx + 1]) : 20;
  const duration = durArgIdx > -1 ? Number(process.argv[durArgIdx + 1]) : 10;
  const overallRate = rateArgIdx > -1 ? Number(process.argv[rateArgIdx + 1]) : undefined;

  let opts: autocannon.Options;

  switch (scenario) {
    case 'auth-login-baseline': {
      opts = {
        url: `${BASE_URL}/auth/login`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@dev.local', password: 'DevOnly!ChangeMe123' }),
        connections: 1,
        amount: 4, // stay under the 5/min throttle
      };
      break;
    }
    case 'auth-login-rate-limit': {
      opts = {
        url: `${BASE_URL}/auth/login`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@dev.local', password: 'DevOnly!ChangeMe123' }),
        connections: 10,
        amount: 30, // deliberately exceed 5/min/IP
      };
      break;
    }
    case 'departments-list':
    case 'subjects-list':
    case 'rooms-list':
    case 'quizzes-list':
    case 'notifications-list': {
      const token = await login('admin@dev.local', 'DevOnly!ChangeMe123');
      const pathMap: Record<string, string> = {
        'departments-list': '/departments',
        'subjects-list': '/subjects',
        'rooms-list': '/rooms',
        'quizzes-list': '/quizzes',
        'notifications-list': '/me/notifications',
      };
      opts = {
        url: `${BASE_URL}${pathMap[scenario]}`,
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        connections,
        duration,
        ...(overallRate ? { overallRate } : {}),
      };
      break;
    }
    default:
      console.error(`Unknown scenario: ${scenario}`);
      process.exit(1);
  }

  console.log(`Running scenario "${scenario}" with opts:`, { ...opts, headers: undefined });
  const result = await autocannon(opts!);
  printSummary(result);
  saveResult(scenario, result);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
