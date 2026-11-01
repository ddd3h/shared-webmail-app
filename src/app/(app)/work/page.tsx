'use client';
import { useEffect, useState } from 'react';
import AttendancePanel from '@/components/work/AttendancePanel';
import ReportsPanel from '@/components/work/ReportsPanel';
import PayrollPanel from '@/components/work/PayrollPanel';
import AdminPanel from '@/components/work/AdminPanel';
import { TYPE_LABEL, type WorkerType } from '@/components/work/ui';
import { paysSalary, usesAttendance, usesReports } from '@/lib/work';

type Me = { id: string; name: string; role: string; worker_type: WorkerType; is_finance?: boolean };
type Tab = { key: string; label: string };

// Which tabs a person gets depends on their 区分: 従業員=勤怠, 業務委託=業務報告, 全員=自分の明細, 管理者=管理.
function tabsFor(me: Me): Tab[] {
  const tabs: Tab[] = [];
  if (usesAttendance(me.worker_type)) tabs.push({ key: 'attendance', label: '勤怠' });
  if (usesReports(me.worker_type)) tabs.push({ key: 'reports', label: '業務報告' });
  tabs.push({ key: 'payroll', label: paysSalary(me.worker_type) ? '給与明細' : '報酬明細' });
  if (me.is_finance) tabs.push({ key: 'admin', label: '管理' }); // administrators and 経理担当
  return tabs;
}

export default function WorkPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState('');

  useEffect(() => {
    let current = true; // a late answer (dev mode asks twice) must not undo a tab the person already chose
    fetch('/api/work/me').then(r => r.json()).then((d: Me) => { if (current) { setMe(d); setTab(t => t || tabsFor(d)[0].key); } }).catch(() => {});
    return () => { current = false; };
  }, []);

  if (!me) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const tabs = tabsFor(me);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-40">
          <h1 className="text-xl font-bold text-gray-900">勤怠・給与</h1>
          <p className="hidden md:block text-xs text-gray-500 mt-0.5">{me.name} さん（{TYPE_LABEL[me.worker_type]}）</p>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200 scrollbar-none">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.label}</button>
        ))}
      </div>
      <div key={tab} className="tab-fade">
        {tab === 'attendance' && <AttendancePanel />}
        {tab === 'reports' && <ReportsPanel monthly={me.worker_type === 'quasi_contractor'} />}
        {tab === 'payroll' && <PayrollPanel noun={paysSalary(me.worker_type) ? '給与' : '報酬'} />}
        {tab === 'admin' && <AdminPanel isAdmin={me.role === 'admin'} />}
      </div>
    </div>
  );
}
