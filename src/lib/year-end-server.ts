// DB side of 年末調整: the declaration is stored as encrypted JSON, one row per person per year.
import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { jstDateString } from '@/lib/work';
import { blankYearEnd, yearEndSchema, type YearEndData, type YearEndStatus } from '@/lib/year-end';

export const currentYear = () => Number(jstDateString(new Date()).slice(0, 4));

/** The years offered in the form: last year (its adjustment is done in January / February), this year and next year (the forms go out in autumn). */
export const offeredYears = (): number[] => { const y = currentYear(); return [y - 1, y, y + 1]; };

export type Declaration = { year: number; status: YearEndStatus | 'none'; data: YearEndData; submitted_at: Date | null; confirmed_at: Date | null; updated_at: Date | null };

type Row = { year: number; status: string; data_enc: string; submitted_at: Date | null; confirmed_at: Date | null; updated_at: Date };

/** An unreadable or outdated blob is treated as empty rather than failing the page. */
export async function openRow(row: Row): Promise<Declaration> {
  let data = blankYearEnd();
  try {
    const parsed = yearEndSchema.safeParse(JSON.parse(await decrypt(row.data_enc)));
    if (parsed.success) data = parsed.data;
  } catch { /* keep the blank */ }
  return { year: row.year, status: row.status as YearEndStatus, data, submitted_at: row.submitted_at, confirmed_at: row.confirmed_at, updated_at: row.updated_at };
}

export async function loadDeclaration(userId: string, year: number): Promise<Declaration> {
  const row = await prisma.year_end_declarations.findUnique({ where: { user_id_year: { user_id: userId, year } } });
  return row ? openRow(row) : { year, status: 'none', data: blankYearEnd(), submitted_at: null, confirmed_at: null, updated_at: null };
}

export const sealData = (d: YearEndData) => encrypt(JSON.stringify(d));
