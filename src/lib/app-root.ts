import path from 'path';

// Next.js standalone's generated server.js calls process.chdir(__dirname) at
// startup, so process.cwd() resolves to .next/standalone at runtime instead of
// the project root. APP_ROOT stays anchored to the real project root via an env
// var, which is loaded (by node --env-file-if-exists) before that chdir happens.
export const APP_ROOT = process.env.APP_ROOT
  ? path.resolve(process.env.APP_ROOT)
  : process.cwd();
