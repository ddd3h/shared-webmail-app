import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// PRISMA_LOG_QUERIES=1 prints every SQL statement (to see how many a screen costs: scripts/measure-queries.mjs)
export const prisma = global.prisma ?? new PrismaClient(process.env.PRISMA_LOG_QUERIES === '1' ? { log: ['query'] } : undefined);
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
