export type DbTarget = { host: string; port: number; user: string; password: string; database: string; isLocal: boolean };
export function parseDbTarget(url: string): DbTarget | null;
export function splitArgs(argv: string[]): { migrate: boolean; command: string[] };
export function composeEnv(target: Pick<DbTarget, 'port' | 'user' | 'password' | 'database'>, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
