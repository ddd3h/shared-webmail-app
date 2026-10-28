// 全銀フォーマット（全国銀行協会 総合振込・給与振込データ）の生成。副作用なしの純粋関数。
//
// 1ファイル = 120バイト固定長のレコードを CRLF で並べたもの:
//   ヘッダ(1) → データ(2) × N → トレーラ(8) → エンド(9)
// 文字は半角カナ・英大文字・数字・一部記号に限られるため、1文字=1バイトで書き出せる（シフトJISの単バイト領域）。

export type PayeeAccountType = 'ordinary' | 'checking' | 'savings';

// 種別コード: 21=総合振込 / 11=給与振込 / 12=賞与振込
export type CategoryCode = '21' | '11' | '12';
export const CATEGORY_LABEL: Record<CategoryCode, string> = { '21': '総合振込', '11': '給与振込', '12': '賞与振込' };

export type ZenginHeader = {
  categoryCode: CategoryCode;
  clientCode: string;          // 委託者コード（10桁の数字。銀行から割り当てられる）
  clientName: string;          // 委託者名（カナ）
  transferDate: string;        // 振込指定日 YYYY-MM-DD（ヘッダには MMDD で入る）
  bankCode: string;            // 仕向銀行（委託者の取引銀行）4桁
  bankName: string;
  branchCode: string;          // 仕向支店 3桁
  branchName: string;
  accountType: PayeeAccountType;
  accountNumber: string;       // 委託者の口座番号 7桁
};

export type ZenginRow = {
  bankCode: string;            // 被仕向銀行 4桁
  bankName: string;
  branchCode: string;          // 被仕向支店 3桁
  branchName: string;
  accountType: PayeeAccountType;
  accountNumber: string;       // 4〜7桁（7桁に左ゼロ埋めする）
  holder: string;              // 受取人名（カナ）
  amount: number;              // 振込金額（円）
};

export const RECORD_LENGTH = 120;
export const MAX_AMOUNT = 9_999_999_999;

// ---- 文字の変換 ---------------------------------------------------------------------------------

const BASE: Record<string, string> = {
  ア: 'ｱ', イ: 'ｲ', ウ: 'ｳ', エ: 'ｴ', オ: 'ｵ', カ: 'ｶ', キ: 'ｷ', ク: 'ｸ', ケ: 'ｹ', コ: 'ｺ',
  サ: 'ｻ', シ: 'ｼ', ス: 'ｽ', セ: 'ｾ', ソ: 'ｿ', タ: 'ﾀ', チ: 'ﾁ', ツ: 'ﾂ', テ: 'ﾃ', ト: 'ﾄ',
  ナ: 'ﾅ', ニ: 'ﾆ', ヌ: 'ﾇ', ネ: 'ﾈ', ノ: 'ﾉ', ハ: 'ﾊ', ヒ: 'ﾋ', フ: 'ﾌ', ヘ: 'ﾍ', ホ: 'ﾎ',
  マ: 'ﾏ', ミ: 'ﾐ', ム: 'ﾑ', メ: 'ﾒ', モ: 'ﾓ', ヤ: 'ﾔ', ユ: 'ﾕ', ヨ: 'ﾖ',
  ラ: 'ﾗ', リ: 'ﾘ', ル: 'ﾙ', レ: 'ﾚ', ロ: 'ﾛ', ワ: 'ﾜ', ヲ: 'ｦ', ン: 'ﾝ',
  // 小さい文字は大きい文字として扱う（全銀の決まり）
  ァ: 'ｱ', ィ: 'ｲ', ゥ: 'ｳ', ェ: 'ｴ', ォ: 'ｵ', ッ: 'ﾂ', ャ: 'ﾔ', ュ: 'ﾕ', ョ: 'ﾖ', ヮ: 'ﾜ',
  ヴ: 'ｳﾞ',
  // 長音・ハイフン類は「-」に
  ー: '-', '－': '-', '−': '-', '―': '-', '‐': '-',
  // 記号
  '（': '(', '）': ')', '「': '｢', '」': '｣', '　': ' ', '．': '.', '／': '/',
};
for (const c of 'カキクケコサシスセソタチツテトハヒフヘホ') {
  const voiced = String.fromCharCode(c.charCodeAt(0) + 1);
  BASE[voiced] = BASE[c] + 'ﾞ';
}
for (const c of 'ハヒフヘホ') BASE[String.fromCharCode(c.charCodeAt(0) + 2)] = BASE[c] + 'ﾟ';

const ALLOWED = /^[A-Z0-9 ()./\-｢｣ｦ-ﾟ]$/; // ASCII subset + ｢ ｣ + 半角カナ(ｦ-ﾟ)

// 全銀で使える文字（半角カナ・英大文字・数字・( ) . - / ｢ ｣ スペース）に変換する。
// ひらがな・全角英数・小文字は自動変換。漢字など変換できない文字が1つでもあれば null。
export function toZenginKana(input: string): string | null {
  let out = '';
  for (let ch of input.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x3041 && cp <= 0x3096) ch = String.fromCodePoint(cp + 0x60); // ひらがな → カタカナ
    else if (cp >= 0xff01 && cp <= 0xff5e) ch = String.fromCodePoint(cp - 0xfee0); // 全角ASCII → ASCII
    const mapped = BASE[ch] ?? (ch === 'ｰ' ? '-' : ch.toUpperCase()); // ｰ(半角長音) → -
    if (![...mapped].every(m => ALLOWED.test(m))) return null;
    out += mapped;
  }
  return out;
}

// 1文字1バイトに書き出す（ASCII はそのまま、半角カナ U+FF61〜FF9F は 0xA1〜0xDF）。
export function encodeSingleByte(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp < 0x80) bytes[i] = cp;
    else if (cp >= 0xff61 && cp <= 0xff9f) bytes[i] = cp - 0xff61 + 0xa1;
    else throw new Error(`全銀データに使えない文字です: ${text[i]}`);
  }
  return bytes;
}

// ---- 検証 ---------------------------------------------------------------------------------------

const digits = (s: string, n: number) => new RegExp(`^\\d{${n}}$`).test(s);

// 問題があれば日本語の理由、なければ null。
export function validateRow(r: ZenginRow): string | null {
  if (!r.bankCode || !digits(r.bankCode, 4)) return '銀行コード（4桁）が未登録です';
  if (!r.branchCode || !digits(r.branchCode, 3)) return '支店コード（3桁）が未登録です';
  if (!/^\d{4,7}$/.test(r.accountNumber)) return '口座番号は全銀では7桁まで（4〜7桁）です';
  if (!r.holder.trim() || toZenginKana(r.holder) === null) return '口座名義はカナ（全角カタカナ・英数字）で登録してください';
  if (!Number.isInteger(r.amount) || r.amount <= 0) return '振込金額が0円以下です';
  if (r.amount > MAX_AMOUNT) return '振込金額が上限（99億円）を超えています';
  return null;
}

export function validateHeader(h: ZenginHeader): string | null {
  if (!digits(h.clientCode, 10)) return '委託者コード（10桁の数字）が未設定です';
  if (!h.clientName.trim() || toZenginKana(h.clientName) === null) return '委託者名（カナ）が未設定、または全銀で使えない文字があります';
  if (!digits(h.bankCode, 4)) return '仕向銀行コード（4桁）が未設定です';
  if (!digits(h.branchCode, 3)) return '仕向支店コード（3桁）が未設定です';
  if (!digits(h.accountNumber, 7)) return '委託者の口座番号（7桁）が未設定です';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.transferDate)) return '振込指定日が正しくありません';
  return null;
}

// ---- 組み立て -----------------------------------------------------------------------------------

const left = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)); // 文字は左詰め・スペース埋め
const num = (v: number | string, n: number) => String(v).padStart(n, '0'); // 数字は右詰め・ゼロ埋め
// 銀行名・支店名は参考情報（銀行はコードで特定する）なので、カナにできない名前は空白で出力する。
const kana = (s: string, n: number) => left(toZenginKana(s) ?? '', n);

const PAYEE_TYPE: Record<PayeeAccountType, string> = { ordinary: '1', checking: '2', savings: '4' };
const CLIENT_TYPE: Record<PayeeAccountType, string> = { ordinary: '1', checking: '2', savings: '9' };

export function buildHeader(h: ZenginHeader): string {
  const mmdd = h.transferDate.slice(5, 7) + h.transferDate.slice(8, 10);
  return (
    '1' + h.categoryCode + '0' + num(h.clientCode, 10) + kana(h.clientName, 40) + mmdd +
    num(h.bankCode, 4) + kana(h.bankName, 15) + num(h.branchCode, 3) + kana(h.branchName, 15) +
    CLIENT_TYPE[h.accountType] + num(h.accountNumber, 7) + ' '.repeat(17)
  );
}

export function buildDataRecord(r: ZenginRow): string {
  return (
    '2' + num(r.bankCode, 4) + kana(r.bankName, 15) + num(r.branchCode, 3) + kana(r.branchName, 15) +
    '    ' + PAYEE_TYPE[r.accountType] + num(r.accountNumber, 7) + kana(r.holder, 30) + num(r.amount, 10) +
    '0' + ' '.repeat(10) + ' '.repeat(10) + '7' + ' ' + ' '.repeat(7)
  );
}

export const buildTrailer = (count: number, total: number) => '8' + num(count, 6) + num(total, 12) + ' '.repeat(101);
export const buildEnd = () => '9' + ' '.repeat(119);

export type ZenginFile = { text: string; bytes: Uint8Array; count: number; total: number };

// 検証済みの前提で組み立てる。問題があれば例外（呼び出し側は事前に validate* で理由を集める）。
export function buildZengin(header: ZenginHeader, rows: ZenginRow[]): ZenginFile {
  const hp = validateHeader(header);
  if (hp) throw new Error(hp);
  if (rows.length === 0) throw new Error('振込先が1件もありません');
  rows.forEach((r, i) => { const p = validateRow(r); if (p) throw new Error(`${i + 1}件目: ${p}`); });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const records = [buildHeader(header), ...rows.map(buildDataRecord), buildTrailer(rows.length, total), buildEnd()];
  for (const r of records) if (r.length !== RECORD_LENGTH) throw new Error(`レコード長が${RECORD_LENGTH}ではありません（${r.length}）`);
  const text = records.join('\r\n') + '\r\n';
  return { text, bytes: encodeSingleByte(text), count: rows.length, total };
}
