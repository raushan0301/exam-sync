#!/usr/bin/env node
/**
 * Module-boundary check (ARCHITECTURE.md §AW, ADR-001, IMPLEMENTATION_PLAN.md Phase 0 DoD).
 *
 * Rule: a file inside apps/api/src/modules/<A>/** may not import a file inside
 * apps/api/src/modules/<B>/** (A !== B) unless the import resolves to <B>'s
 * public barrel (index.ts or <B>.module.ts). Modules may freely import
 * apps/api/src/common/** and anything outside apps/api/src/modules.
 *
 * This exists because a plain ESLint glob rule cannot reliably distinguish
 * "deep" cross-module imports from legitimate barrel imports once relative
 * paths are involved (see ADR-001 implementation notes). Resolving each
 * import specifier against the filesystem, as this script does, is exact.
 */
const fs = require('fs');
const path = require('path');

const MODULES_ROOT = path.resolve(__dirname, '..', 'apps', 'api', 'src', 'modules');
const IMPORT_RE = /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;

/** @returns {string[]} */
function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function moduleOf(filePath) {
  const rel = path.relative(MODULES_ROOT, filePath);
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep)[0];
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null; // package import, not our concern
  const base = path.resolve(path.dirname(fromFile), specifier);
  // Mirror real Node/TS module resolution: a file match (base.ts) or an
  // explicit directory-index (base/index.ts) always wins over treating the
  // bare directory itself as "the file" — `fs.existsSync(base)` is true for
  // directories too, which previously caused a directory-style import like
  // `'../academic-structure'` to resolve to the directory (basename
  // "academic-structure", not "index.ts") and be wrongly flagged as a
  // boundary violation even though it's a legitimate barrel import.
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base];
  return candidates.find((c) => fs.existsSync(c)) || `${base}.ts`;
}

function isPublicBarrel(targetFile, targetModule) {
  const base = path.basename(targetFile);
  return base === 'index.ts' || base === `${targetModule}.module.ts`;
}

function main() {
  if (!fs.existsSync(MODULES_ROOT)) {
    console.log('[module-boundaries] no modules directory found yet — skipping (nothing to check).');
    return 0;
  }

  const files = listTsFiles(MODULES_ROOT);
  const violations = [];

  for (const file of files) {
    const ownModule = moduleOf(file);
    if (!ownModule) continue;
    const src = fs.readFileSync(file, 'utf8');

    const specifiers = new Set();
    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) specifiers.add(m[1]);
    }

    for (const spec of specifiers) {
      const resolved = resolveSpecifier(file, spec);
      if (!resolved) continue;
      const targetModule = moduleOf(resolved);
      if (!targetModule || targetModule === ownModule) continue;

      if (!isPublicBarrel(resolved, targetModule)) {
        violations.push(
          `${path.relative(process.cwd(), file)}: imports "${spec}" — reaches into module "${targetModule}" ` +
            `internals from module "${ownModule}". Only "${targetModule}/index.ts" or "${targetModule}/${targetModule}.module.ts" ` +
            `may be imported across module boundaries (ARCHITECTURE.md §AW, ADR-001).`
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error('\nModule boundary violations found:\n');
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error(`\n${violations.length} violation(s). See ARCHITECTURE.md §AW and docs/adr/001-modular-monolith.md.\n`);
    return 1;
  }

  console.log(`[module-boundaries] OK — ${files.length} file(s) scanned under apps/api/src/modules, no cross-module boundary violations.`);
  return 0;
}

process.exit(main());
