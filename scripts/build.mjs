// `npm run build`: the production build with enough memory for the type check.
// The type check of this app needs about 800 MB. Node sizes its default limit from the machine's RAM (about 490 MB on a small server),
// so the build died with "JavaScript heap out of memory" right after "Running TypeScript ...". The limit is raised here unless
// the person has already set one (NODE_OPTIONS=--max-old-space-size=... npm run build).
import { spawnSync } from 'node:child_process';

const LIMIT_MB = 1536;
const existing = process.env.NODE_OPTIONS ?? '';
const NODE_OPTIONS = /--max-old-space-size/.test(existing) ? existing : `${existing} --max-old-space-size=${LIMIT_MB}`.trim();

const r = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS } });
process.exit(r.status ?? 1);
