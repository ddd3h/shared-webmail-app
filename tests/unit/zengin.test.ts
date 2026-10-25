import { describe, it, expect } from 'vitest';
import {
  buildDataRecord, buildEnd, buildHeader, buildTrailer, buildZengin, encodeSingleByte, toZenginKana, validateHeader, validateRow,
  type ZenginHeader, type ZenginRow,
} from '@/lib/zengin';

const header: ZenginHeader = {
  categoryCode: '21', clientCode: '1234567890', clientName: 'カ）チャート', transferDate: '2026-10-31',
  bankCode: '0001', bankName: 'ミズホ', branchCode: '123', branchName: 'シンジュク', accountType: 'ordinary', accountNumber: '1234567',
};
const row = (o: Partial<ZenginRow> = {}): ZenginRow => ({
  bankCode: '0009', bankName: 'ミツイスミトモ', branchCode: '234', branchName: 'シブヤ', accountType: 'ordinary', accountNumber: '7654321', holder: 'ド）ビーエス', amount: 98334, ...o,
});

describe('toZenginKana（文字の変換）', () => {
  const cases: [string, string | null][] = [
    ['カ）エーシヤ', 'ｶ)ｴ-ｼﾔ'],
    ['ヤマダ タロウ', 'ﾔﾏﾀﾞ ﾀﾛｳ'],
    ['ガギグゲゴ', 'ｶﾞｷﾞｸﾞｹﾞｺﾞ'],
    ['パピプペポ', 'ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ'],
    ['ヴァイオリン', 'ｳﾞｱｲｵﾘﾝ'],
    ['シャチョウ ッ ャュョ', 'ｼﾔﾁﾖｳ ﾂ ﾔﾕﾖ'],
    ['やまだ たろう', 'ﾔﾏﾀﾞ ﾀﾛｳ'],              // ひらがな
    ['ＡＢＣ１２３', 'ABC123'],                    // 全角英数
    ['abc-xyz', 'ABC-XYZ'],                         // 小文字
    ['（カ）　テスト', '(ｶ) ﾃｽﾄ'],                // 全角括弧・全角スペース
    ['ﾔﾏﾀﾞ', 'ﾔﾏﾀﾞ'],                              // 半角カナはそのまま
    ['ｱｰｲ', 'ｱ-ｲ'],                                 // 半角の長音
    ['「テスト」', '｢ﾃｽﾄ｣'],
    ['山田太郎', null],                              // 漢字は変換できない
    ['カ&エ', null],                                  // 使えない記号
    ['テスト,', null],
    ['ｱ😀', null],
    ['', ''],
  ];
  for (const [input, expected] of cases) {
    it(`「${input}」→ ${expected === null ? '変換不可' : `「${expected}」`}`, () => expect(toZenginKana(input)).toBe(expected));
  }
});

describe('レコードの桁数と位置', () => {
  it('ヘッダ・データ・トレーラ・エンドはどれも120桁', () => {
    for (const r of [buildHeader(header), buildDataRecord(row()), buildTrailer(3, 123456), buildEnd()]) expect(r).toHaveLength(120);
  });

  it('ヘッダの各項目が仕様どおりの位置にある', () => {
    const h = buildHeader(header);
    expect(h.slice(0, 1)).toBe('1');
    expect(h.slice(1, 3)).toBe('21');           // 種別コード
    expect(h.slice(3, 4)).toBe('0');            // コード区分
    expect(h.slice(4, 14)).toBe('1234567890');  // 委託者コード
    expect(h.slice(14, 54).trimEnd()).toBe('ｶ)ﾁﾔ-ﾄ'); // 委託者名 40桁
    expect(h.slice(54, 58)).toBe('1031');       // 取組日 MMDD
    expect(h.slice(58, 62)).toBe('0001');       // 仕向銀行番号
    expect(h.slice(62, 77).trimEnd()).toBe('ﾐｽﾞﾎ'.replace('ﾐｽﾞﾎ', 'ﾐｽﾞﾎ'));
    expect(h.slice(77, 80)).toBe('123');        // 仕向支店番号
    expect(h.slice(95, 96)).toBe('1');          // 預金種目（普通）
    expect(h.slice(96, 103)).toBe('1234567');   // 口座番号
    expect(h.slice(103)).toBe(' '.repeat(17));
  });

  it('データレコードの各項目が仕様どおりの位置にある', () => {
    const d = buildDataRecord(row());
    expect(d.slice(0, 1)).toBe('2');
    expect(d.slice(1, 5)).toBe('0009');             // 被仕向銀行番号
    expect(d.slice(5, 20).trimEnd()).toBe('ﾐﾂｲｽﾐﾄﾓ');
    expect(d.slice(20, 23)).toBe('234');            // 被仕向支店番号
    expect(d.slice(38, 42)).toBe('    ');           // 手形交換所番号
    expect(d.slice(42, 43)).toBe('1');              // 預金種目
    expect(d.slice(43, 50)).toBe('7654321');        // 口座番号
    expect(d.slice(50, 80).trimEnd()).toBe('ﾄﾞ)ﾋﾞ-ｴｽ');
    expect(d.slice(80, 90)).toBe('0000098334');     // 振込金額 10桁ゼロ埋め
    expect(d.slice(90, 91)).toBe('0');              // 新規コード
  });

  it('口座番号が7桁未満なら左をゼロで埋める', () => {
    expect(buildDataRecord(row({ accountNumber: '12345' })).slice(43, 50)).toBe('0012345');
  });

  it('預金種目: 普通=1 当座=2 貯蓄=4（受取人側）', () => {
    for (const [t, code] of [['ordinary', '1'], ['checking', '2'], ['savings', '4']] as const) {
      expect(buildDataRecord(row({ accountType: t })).slice(42, 43)).toBe(code);
    }
  });

  it('受取人名は30桁で切り詰められ、桁数は崩れない', () => {
    const long = 'ア'.repeat(45);
    const d = buildDataRecord(row({ holder: long }));
    expect(d).toHaveLength(120);
    expect(d.slice(50, 80)).toBe('ｱ'.repeat(30));
  });

  it('トレーラは件数6桁・合計金額12桁', () => {
    const t = buildTrailer(12, 3456789);
    expect(t.slice(0, 1)).toBe('8');
    expect(t.slice(1, 7)).toBe('000012');
    expect(t.slice(7, 19)).toBe('000003456789');
  });

  it('エンドは「9」とスペース', () => {
    expect(buildEnd()).toBe('9' + ' '.repeat(119));
  });
});

describe('buildZengin（ファイル全体）', () => {
  it('ヘッダ＋データ×N＋トレーラ＋エンドを CRLF で並べ、件数・合計が一致する', () => {
    const f = buildZengin(header, [row({ amount: 1000 }), row({ amount: 2500 }), row({ amount: 98334 })]);
    const lines = f.text.split('\r\n');
    expect(lines.pop()).toBe(''); // 末尾も CRLF
    expect(lines).toHaveLength(6);
    expect(lines.map(l => l[0])).toEqual(['1', '2', '2', '2', '8', '9']);
    expect(lines.every(l => l.length === 120)).toBe(true);
    expect(f.count).toBe(3);
    expect(f.total).toBe(101834);
    expect(lines[4].slice(1, 7)).toBe('000003');
    expect(lines[4].slice(7, 19)).toBe('000000101834');
  });

  it('バイト列は1文字1バイトで、半角カナは 0xA1〜0xDF になる', () => {
    const f = buildZengin(header, [row({ holder: 'ヤマダ' })]);
    expect(f.bytes.length).toBe(f.text.length);
    expect(f.bytes.length).toBe(4 * 122); // 4レコード × (120 + CRLF)
    const dataStart = 122;
    const holder = f.bytes.slice(dataStart + 50, dataStart + 53);
    expect([...holder]).toEqual([0xd4, 0xcf, 0xc0].map((b, i) => (i === 2 ? 0xc0 : b))); // ﾔ ﾏ ﾀ
    expect(f.bytes.some(b => b > 0xdf)).toBe(false);
  });

  it('1件もなければエラー', () => {
    expect(() => buildZengin(header, [])).toThrow();
  });

  it('不正な行があると、何件目かを示してエラー', () => {
    expect(() => buildZengin(header, [row(), row({ holder: '山田' })])).toThrow(/2件目/);
  });

  it('ヘッダが不正ならエラー', () => {
    expect(() => buildZengin({ ...header, clientCode: '123' }, [row()])).toThrow(/委託者コード/);
  });
});

describe('validateRow / validateHeader', () => {
  const bad: [string, Partial<ZenginRow>, RegExp][] = [
    ['銀行コードなし', { bankCode: '' }, /銀行コード/],
    ['銀行コードが3桁', { bankCode: '001' }, /銀行コード/],
    ['支店コードなし', { branchCode: '' }, /支店コード/],
    ['口座番号が8桁', { accountNumber: '12345678' }, /口座番号/],
    ['口座番号が3桁', { accountNumber: '123' }, /口座番号/],
    ['名義が漢字', { holder: '株式会社A' }, /カナ/],
    ['名義が空', { holder: '  ' }, /カナ/],
    ['金額が0', { amount: 0 }, /0円以下/],
    ['金額が負', { amount: -1 }, /0円以下/],
    ['金額が小数', { amount: 10.5 }, /0円以下/],
    ['金額が100億円', { amount: 10_000_000_000 }, /上限/],
  ];
  for (const [label, patch, re] of bad) {
    it(`行: ${label}`, () => expect(validateRow(row(patch))).toMatch(re));
  }
  it('行: 正常なら null', () => expect(validateRow(row())).toBeNull());
  it('行: 銀行名・支店名が漢字でもエラーにせず、空白で出力する（銀行はコードで特定する）', () => {
    const r = row({ bankName: 'みずほ銀行', branchName: '新宿支店' });
    expect(validateRow(r)).toBeNull();
    const rec = buildDataRecord(r);
    expect(rec).toHaveLength(120);
    expect(rec.slice(5, 20)).toBe(' '.repeat(15));
    expect(rec.slice(23, 38)).toBe(' '.repeat(15));
    expect(rec.slice(1, 5)).toBe('0009');
  });
  it('行: 上限ちょうど（9,999,999,999円）は正常', () => expect(validateRow(row({ amount: 9_999_999_999 }))).toBeNull());

  it('ヘッダ: 各項目の不足を指摘する', () => {
    expect(validateHeader({ ...header, clientName: '' })).toMatch(/委託者名/);
    expect(validateHeader({ ...header, bankCode: '' })).toMatch(/仕向銀行/);
    expect(validateHeader({ ...header, branchCode: '12' })).toMatch(/仕向支店/);
    expect(validateHeader({ ...header, accountNumber: '123' })).toMatch(/口座番号/);
    expect(validateHeader({ ...header, transferDate: '10/31' })).toMatch(/振込指定日/);
    expect(validateHeader(header)).toBeNull();
  });
});

describe('encodeSingleByte', () => {
  it('ASCIIはそのまま、半角カナは 0xA1〜0xDF', () => {
    expect([...encodeSingleByte('A1 ｱﾝﾟ')]).toEqual([0x41, 0x31, 0x20, 0xb1, 0xdd, 0xdf]);
  });
  it('漢字などはエラー', () => {
    expect(() => encodeSingleByte('山')).toThrow();
  });
});
