export const RULE_LABEL: Record<string, string> = { report: '業務報告書', expense: '経費', payment: '振込日' };
export const STAGE_LABEL: Record<string, string> = {
  eve: '締め日の前日', closing: '締め日', final: '提出期限日（再通知）', before: '事前の知らせ', on: '当日',
};
export const jstTime = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
