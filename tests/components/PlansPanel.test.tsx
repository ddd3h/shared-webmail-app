import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlansPanel from '@/components/autoflow/PlansPanel';

// 「下書きを今すぐ作る」: 月ではなく振込日を選ぶ。11/25 振込分は、役員の11月分と準業務委託の10月分。
const PAY_DATES = [
  { date: '2026-10-26', groups: [{ worker_type: 'quasi_contractor', month: '2026-09' }] },
  { date: '2026-11-25', groups: [{ worker_type: 'executive', month: '2026-11' }, { worker_type: 'quasi_contractor', month: '2026-10' }] },
  { date: '2026-12-25', groups: [{ worker_type: 'executive', month: '2026-12' }, { worker_type: 'quasi_contractor', month: '2026-11' }] },
];
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
let generated: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-24T03:00:00Z')); // 11/24 12:00 JST
  generated = [];
  fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url === '/api/autoflow/plans') return ok({ plans: [], users: [], pay_dates: PAY_DATES });
    if (url.startsWith('/api/autoflow/extras')) return ok({ extras: [] });
    if (url === '/api/autoflow/fixed/generate') {
      const body = JSON.parse(init?.body ?? '{}');
      generated.push(body);
      return ok({ dry: body.dry, pay_date: body.pay_date, drafts: [
        { user_id: 'u1', user_name: '役員A', month: '2026-11', label: '役員報酬', amount: 200000, status: 'exists', pay_date: '2026-12-25' },
        { user_id: 'u2', user_name: '準委託B', month: '2026-10', label: '業務委託報酬', amount: 40000, status: 'new', pay_date: '2026-11-25' },
      ] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('PlansPanel: 振込日を選んで下書きを作る', () => {
  it('今日のあとの最初の振込日が選ばれていて、何月分を払うかが見える', async () => {
    render(<PlansPanel />);
    const select = await screen.findByLabelText('振込日');
    expect(select).toHaveValue('2026-11-25');
    expect(screen.getByRole('option', { name: '11/25(水)振込分（役員 11月分・準業務委託 10月分）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '11/25(水)振込分の下書きを作る' })).toBeInTheDocument();
  });

  it('押すと pay_date で作り、人ごとの月と、支払日が違う作成済みの下書きの警告を出す', async () => {
    const user = userEvent.setup();
    render(<PlansPanel />);
    await user.click(await screen.findByRole('button', { name: '11/25(水)振込分の下書きを作る' }));
    await waitFor(() => expect(generated).toEqual([{ pay_date: '2026-11-25', dry: false }]));
    expect(await screen.findByText('10月分')).toBeInTheDocument();
    expect(screen.getByText('11月分')).toBeInTheDocument();
    expect(screen.getByText(/この下書きの支払日は 12\/25\(金\) です/)).toBeInTheDocument();
  });

  it('別の振込日を選べば、その日の分を作る', async () => {
    const user = userEvent.setup();
    render(<PlansPanel />);
    await user.selectOptions(await screen.findByLabelText('振込日'), '2026-12-25');
    await user.click(screen.getByRole('button', { name: '作る内容を確認' }));
    await waitFor(() => expect(generated).toEqual([{ pay_date: '2026-12-25', dry: true }]));
  });
});
