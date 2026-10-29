import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/freee', () => ({ createDeal: vi.fn(), freeeReady: vi.fn(), loadFreeeConfig: vi.fn() }));
import { accountFor, dealDetails, type Movement } from '@/lib/freee-sync';

const MAP = { salary: { account_item_id: 1, tax_code: 0 }, expense: { account_item_id: 2, tax_code: 136 }, 'expense:交通費': { account_item_id: 3, tax_code: 0 } };
const move = (parts: Movement['parts']): Movement => ({ source_type: 'payslip', source_id: 'p', date: '2026-10-25', amount: parts.reduce((s, p) => s + p.amount, 0), description: 'd', parts, documents: [] });

describe('freeeに送る取引の組み立て', () => {
  it('経費は科目の指定があればそれ、なければ「経費の立替金」の科目', () => {
    expect(accountFor(MAP, 'expense:交通費')).toEqual({ account_item_id: 3, tax_code: 0 });
    expect(accountFor(MAP, 'expense:会議費')).toEqual({ account_item_id: 2, tax_code: 136 });
    expect(accountFor(MAP, 'salary')).toEqual({ account_item_id: 1, tax_code: 0 });
  });
  it('給与以外の科目は、他の指定で代わりにはしない', () => {
    expect(accountFor(MAP, 'executive')).toBeUndefined();
    expect(accountFor({}, 'expense:交通費')).toBeUndefined();
  });
  it('明細は、割り当てた科目・税区分・金額で並ぶ。0円以下の部分は入れない', () => {
    const r = dealDetails(move([{ key: 'salary', amount: 100000, description: 'a' }, { key: 'expense:交通費', amount: 3000, description: 'b' }, { key: 'expense:会議費', amount: 0, description: 'c' }]), MAP);
    expect(r).toEqual({ ok: true, details: [{ account_item_id: 1, tax_code: 0, amount: 100000, description: 'a' }, { account_item_id: 3, tax_code: 0, amount: 3000, description: 'b' }] });
  });
  it('科目が未設定なら、何が足りないかを日本語で返す', () => {
    expect(dealDetails(move([{ key: 'executive', amount: 1, description: 'a' }]), MAP)).toEqual({ ok: false, error: '勘定科目が未設定です: 役員報酬' });
    expect(dealDetails(move([{ key: 'expense:交際費', amount: 1, description: 'a' }]), {})).toEqual({ ok: false, error: '勘定科目が未設定です: 経費（交際費）' });
  });
});
