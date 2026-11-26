import { describe, it, expect } from 'vitest';
import { isJumpToStart, isNavLabel, isSafeDetail, keyLabel, pathPattern } from '@/lib/editor-jump';
import { collabSignature, collabUsersFromStates } from '@/lib/collab-users';

describe('keyLabel: 打った文字は記録しない', () => {
  it('文字のキーは char。ローマ字（IME の打鍵）も、かなも char', () => {
    expect(keyLabel({ key: 'k' })).toBe('char');
    expect(keyLabel({ key: 'あ' })).toBe('char');
    expect(keyLabel({ key: 'K', shiftKey: true })).toBe('S+char');
    expect(keyLabel({ key: 'å', altKey: true })).toBe('A+char'); // Option で打つ記号も文字
  });
  it('スペース・Enter・矢印・IME の Process は名前で残す', () => {
    expect(keyLabel({ key: ' ' })).toBe('Space');
    expect(keyLabel({ key: 'Enter' })).toBe('Enter');
    expect(keyLabel({ key: 'ArrowUp', metaKey: true })).toBe('M+ArrowUp');
    expect(keyLabel({ key: 'Process' })).toBe('Process');
  });
  it('Cmd/Ctrl と一緒のアルファベットはショートカットなので、その文字を残す', () => {
    expect(keyLabel({ key: 'z', metaKey: true })).toBe('M+z');
    expect(keyLabel({ key: 'A', ctrlKey: true, shiftKey: true })).toBe('CS+a');
  });
});

describe('isNavLabel: カーソルをわざと動かすキー', () => {
  it('矢印・Home・Cmd/Ctrl のショートカットは nav、文字やスペースは違う', () => {
    expect(isNavLabel('ArrowLeft')).toBe(true);
    expect(isNavLabel('M+ArrowUp')).toBe(true);
    expect(isNavLabel('C+a')).toBe(true);
    expect(isNavLabel('Space')).toBe(false);
    expect(isNavLabel('char')).toBe(false);
    expect(isNavLabel('S+char')).toBe(false);
  });
});

describe('isSafeDetail: サーバーで、文字が混じっていないことを確かめる', () => {
  it('キーの名前は keyLabel が出すものだけ', () => {
    expect(isSafeDetail('kd', 'Space')).toBe(true);
    expect(isSafeDetail('kd', 'M+z')).toBe(true);
    expect(isSafeDetail('kd', 'S+char')).toBe(true);
    expect(isSafeDetail('kd', 'k')).toBe(false);          // Cmd/Ctrl なしの文字
    expect(isSafeDetail('kd', 'konnichiha')).toBe(false); // ローマ字
    expect(isSafeDetail('kd', 'S+k')).toBe(false);
  });
  it('入力の種類と、トランザクションの印の名前だけ', () => {
    expect(isSafeDetail('bi', 'insertCompositionText')).toBe(true);
    expect(isSafeDetail('bi', 'こんにちは')).toBe(false);
    expect(isSafeDetail('tr', 'DS|y-sync$,remote')).toBe(true);
    expect(isSafeDetail('tr', 'D|')).toBe(true);
    expect(isSafeDetail('tr', 'D|こんにちは')).toBe(false);
    expect(isSafeDetail('tr', 'hello')).toBe(false);
  });
  it('ほかの種類には何も付けられない', () => {
    expect(isSafeDetail('cu', '')).toBe(true);
    expect(isSafeDetail('cu', 'abc')).toBe(false);
  });
});

describe('isJumpToStart: 本文の先頭に飛んだか', () => {
  it('文の途中から先頭へ飛んだら true', () => {
    expect(isJumpToStart({ oldFrom: 40, newFrom: 1, start: 1 })).toBe(true);
    expect(isJumpToStart({ oldFrom: 5, newFrom: 1, start: 1 })).toBe(true);
  });
  it('先頭へ飛んで、そこに何文字か入ったあとでも true', () => {
    expect(isJumpToStart({ oldFrom: 80, newFrom: 4, start: 1 })).toBe(true);
  });
  it('変換中の文節が範囲で選ばれていた（40〜43）ところから先頭へ飛んでも true', () => {
    expect(isJumpToStart({ oldFrom: 40, newFrom: 1, start: 1 })).toBe(true);
  });
  it('1行目で IME の変換で数文字戻るだけなら false', () => {
    expect(isJumpToStart({ oldFrom: 14, newFrom: 11, start: 1 })).toBe(false);
    expect(isJumpToStart({ oldFrom: 4, newFrom: 2, start: 1 })).toBe(false);
  });
  it('先頭から選んだ範囲を打ち替えたときは false（選択の始まりがもう先頭）', () => {
    expect(isJumpToStart({ oldFrom: 1, newFrom: 2, start: 1 })).toBe(false);
  });
  it('先へ進むのは false', () => {
    expect(isJumpToStart({ oldFrom: 1, newFrom: 2, start: 1 })).toBe(false);
    expect(isJumpToStart({ oldFrom: 10, newFrom: 11, start: 1 })).toBe(false);
  });
});

describe('pathPattern: 記録の id は落とす', () => {
  it('スレッドの id は :id に', () => {
    expect(pathPattern('/threads/cm4abcdefghijklmnopqrstu')).toBe('/threads/:id');
    expect(pathPattern('/threads/123?x=1')).toBe('/threads/:n');
    expect(pathPattern('/compose')).toBe('/compose');
  });
});

describe('collab-users: 参加者リストは、人が変わったときだけ変わる', () => {
  const states = (caret: number, name = '佐藤') => new Map<number, unknown>([
    [1, { user: { name, color: '#f00', id: 'u1' }, cursor: { anchor: caret, head: caret } }],
    [2, { user: { name: '鈴木', color: '#00f', id: 'u2' }, cursor: null }],
    [3, { user: { name, color: '#f00', id: 'u1' } }], // 同じ人の別タブ
    [4, {}],                                            // まだ名乗っていない
  ]);
  it('同じ人は1回だけ、名乗っていない接続は数えない', () => {
    expect(collabUsersFromStates(states(3))).toEqual([
      { clientId: 1, name: '佐藤', color: '#f00', id: 'u1' },
      { clientId: 2, name: '鈴木', color: '#00f', id: 'u2' },
    ]);
  });
  it('カーソルが動いただけなら同じ、名前が変わったら違う', () => {
    const a = collabSignature(collabUsersFromStates(states(3)));
    expect(collabSignature(collabUsersFromStates(states(9)))).toBe(a);
    expect(collabSignature(collabUsersFromStates(states(9, '佐藤 太郎')))).not.toBe(a);
  });
});
