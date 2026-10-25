'use client';
import { useCallback, useEffect, useState } from 'react';
import AttendancePanel from './AttendancePanel';
import ReportsPanel from './ReportsPanel';
import PayrollPanel from './PayrollPanel';
import { Notice, TYPE_LABEL, btnPrimary, inp, api, type WorkerType } from './ui';

type Member = { id: string; name: string; email: string; role: string; worker_type: WorkerType; is_accounting: boolean };
const SECTIONS = [
  { key: 'members', label: '区分・設定' },
  { key: 'attendance', label: '勤怠の確認' },
  { key: 'reports', label: '業務報告' },
  { key: 'payroll', label: '給与・報酬の管理' },
] as const;
type Section = typeof SECTIONS[number]['key'];

export default function AdminPanel() {
  const [section, setSection] = useState<Section>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [target, setTarget] = useState('');
  const [reportTarget, setReportTarget] = useState('');
  const [settings, setSettings] = useState<{ daily_minutes: string; auto_break_minutes: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [u, s] = await Promise.all([fetch('/api/work/users'), fetch('/api/work/settings')]);
    if (u.ok) { const d = await u.json(); setMembers(d.items); }
    if (s.ok) { const d = await s.json(); setSettings({ daily_minutes: String(d.daily_minutes), auto_break_minutes: String(d.auto_break_minutes) }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function setType(id: string, worker_type: WorkerType) {
    const res = await api(`/api/work/users/${id}`, 'PATCH', { worker_type });
    if (res.ok) { setMembers(ms => ms.map(m => m.id === id ? { ...m, worker_type } : m)); flash('success', '区分を更新しました'); } else flash('error', '更新に失敗しました');
  }
  async function setAccounting(id: string, is_accounting: boolean) {
    const res = await api(`/api/work/users/${id}`, 'PATCH', { is_accounting });
    if (res.ok) { setMembers(ms => ms.map(m => m.id === id ? { ...m, is_accounting } : m)); flash('success', is_accounting ? '経理担当にしました（全銀データの作成・口座の確認ができます）' : '経理担当を外しました'); } else flash('error', '更新に失敗しました');
  }
  async function saveSettings() {
    if (!settings) return;
    const res = await api('/api/work/settings', 'PUT', { daily_minutes: Number(settings.daily_minutes), auto_break_minutes: Number(settings.auto_break_minutes) });
    flash(res.ok ? 'success' : 'error', res.ok ? '勤怠の設定を保存しました' : '保存に失敗しました。0以上の整数を入力してください');
  }

  const employees = members.filter(m => m.worker_type === 'employee');
  const contractors = members.filter(m => m.worker_type === 'contractor');
  useEffect(() => { if (!target && employees[0]) setTarget(employees[0].id); }, [employees, target]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)} className={`rounded-full px-3 py-1.5 text-sm ${section === s.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{s.label}</button>
        ))}
      </div>
      <Notice msg={msg} />

      {section === 'members' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">名前</th><th className="px-3 py-2 text-left">区分</th><th className="px-3 py-2 text-left">経理担当</th><th className="px-3 py-2 text-left hidden sm:table-cell">使える機能</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {members.map(m => (
                  <tr key={m.id}>
                    <td className="px-3 py-2"><div className="font-medium text-gray-900">{m.name}{m.role === 'admin' && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-700">管理者</span>}</div><div className="text-xs text-gray-400">{m.email}</div></td>
                    <td className="px-3 py-2">
                      <select className={`${inp} max-w-[9rem]`} value={m.worker_type} onChange={e => setType(m.id, e.target.value as WorkerType)} aria-label={`${m.name}の区分`}>
                        {(Object.keys(TYPE_LABEL) as WorkerType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {m.role === 'admin'
                        ? <span className="text-xs text-gray-400">管理者</span>
                        : <input type="checkbox" className="h-4 w-4" checked={m.is_accounting} onChange={e => setAccounting(m.id, e.target.checked)} aria-label={`${m.name}を経理担当にする`} />}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 hidden sm:table-cell">{m.worker_type === 'employee' ? '打刻・勤怠・給与明細' : m.worker_type === 'contractor' ? '業務報告書・報酬明細' : '報酬明細'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {settings && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 max-w-xl">
              <h3 className="text-sm font-semibold text-gray-900">勤怠の設定</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-600">所定労働時間（分/日）</label><input type="number" min={0} max={1440} className={inp} value={settings.daily_minutes} onChange={e => setSettings({ ...settings, daily_minutes: e.target.value })} /><p className="text-[11px] text-gray-400 mt-1">これを超えた分を残業として集計します（480 = 8時間）</p></div>
                <div><label className="text-xs text-gray-600">自動休憩（分）</label><input type="number" min={0} max={240} className={inp} value={settings.auto_break_minutes} onChange={e => setSettings({ ...settings, auto_break_minutes: e.target.value })} /><p className="text-[11px] text-gray-400 mt-1">休憩を打刻しなかった6時間以上の勤務から差し引きます（0で無効）</p></div>
              </div>
              <button className={btnPrimary} onClick={saveSettings}>設定を保存</button>
            </div>
          )}
        </div>
      )}

      {section === 'attendance' && (
        <div className="space-y-3">
          <select className={`${inp} max-w-[16rem]`} value={target} onChange={e => setTarget(e.target.value)}>
            {employees.length === 0 && <option value="">従業員がいません</option>}
            {employees.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {target && <AttendancePanel key={target} userId={target} />}
        </div>
      )}

      {section === 'reports' && (
        <div className="space-y-3">
          <select className={`${inp} max-w-[16rem]`} value={reportTarget} onChange={e => setReportTarget(e.target.value)}>
            <option value="">業務委託の全員</option>
            {contractors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <ReportsPanel key={reportTarget} admin userId={reportTarget || undefined} />
        </div>
      )}

      {section === 'payroll' && <PayrollPanel manage members={members} />}
    </div>
  );
}
