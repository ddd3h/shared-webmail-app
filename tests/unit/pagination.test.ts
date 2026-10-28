import { describe, it, expect } from 'vitest';
import { pageNumbers, pageWindow, parsePaging } from '@/lib/pagination';

const q = (s: string) => new URLSearchParams(s);

describe('ページ指定の読み取り', () => {
  it('指定がなければ 1ページ目・50件', () => {
    expect(parsePaging(q(''))).toEqual({ page: 1, pageSize: 50 });
  });
  it('数字ならその値を使う', () => {
    expect(parsePaging(q('page=3&pageSize=20'))).toEqual({ page: 3, pageSize: 20 });
  });
  it('数字でない・0・負・小数は既定に戻す', () => {
    expect(parsePaging(q('page=abc&pageSize=0'))).toEqual({ page: 1, pageSize: 50 });
    expect(parsePaging(q('page=-2&pageSize=1.5'))).toEqual({ page: 1, pageSize: 50 });
  });
  it('1ページの件数には上限（200）がある', () => {
    expect(parsePaging(q('pageSize=100000')).pageSize).toBe(200);
  });
});

describe('読む範囲', () => {
  it('2ページ目は skip=50', () => {
    expect(pageWindow(2, 120, 50)).toEqual({ page: 2, pages: 3, skip: 50, take: 50 });
  });
  it('最後のページより先は、最後のページに戻す', () => {
    expect(pageWindow(9, 120, 50)).toMatchObject({ page: 3, skip: 100 });
  });
  it('0件でも 1ページ（空）として扱う', () => {
    expect(pageWindow(1, 0, 50)).toEqual({ page: 1, pages: 1, skip: 0, take: 50 });
  });
  it('ちょうど割り切れる件数でも、空のページは作らない', () => {
    expect(pageWindow(1, 100, 50).pages).toBe(2);
  });
});

describe('ページ番号のボタン', () => {
  it('少なければ全部並べる', () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 1)).toEqual([1]);
  });
  it('多いときは先頭・末尾・今のページの前後2つ。間は … にする', () => {
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, '…', 20]);
    expect(pageNumbers(10, 20)).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20]);
    expect(pageNumbers(20, 20)).toEqual([1, '…', 18, 19, 20]);
  });
  it('1ページ分だけ空くときは … でなく番号を出す', () => {
    expect(pageNumbers(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, '…', 20]);
  });
});
