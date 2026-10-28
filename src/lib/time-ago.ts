// How long ago, in words a person would say
export function ago(iso: string, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}日前`;
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

