import { PrismaClient } from '@prisma/client';
import { DATABASE_URL, ENCRYPTION_KEY_HEX } from './constants';

// factories encrypt account numbers with the same key the server under test uses
process.env.ENCRYPTION_KEY_HEX ||= ENCRYPTION_KEY_HEX;

// One client per worker process, pointed at the E2E database (never the dev one).
const g = globalThis as any;
export const db: PrismaClient = g.__e2eDb ?? (g.__e2eDb = new PrismaClient({ datasourceUrl: DATABASE_URL }));
