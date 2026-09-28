import test from 'node:test';
import assert from 'node:assert';
import { parseHolidayResponse } from '../lib/api.js';

const wrap = (items, code = '00') => JSON.stringify({ response: { header: { resultCode: code, resultMsg: 'NORMAL SERVICE.' }, body: { items, numOfRows: 50, pageNo: 1, totalCount: 0 } } });

test('여러 공휴일 (배열)', () => {
  const rows = parseHolidayResponse(wrap({ item: [
    { dateKind: '01', dateName: '개천절', isHoliday: 'Y', locdate: 20261003, seq: 1 },
    { dateKind: '01', dateName: '대체공휴일', isHoliday: 'Y', locdate: 20261005, seq: 1 },
    { dateKind: '01', dateName: '한글날', isHoliday: 'Y', locdate: 20261009, seq: 1 },
  ] }));
  assert.deepStrictEqual(rows, [
    { date: '2026-10-03', name: '개천절' },
    { date: '2026-10-05', name: '대체공휴일' },
    { date: '2026-10-09', name: '한글날' },
  ]);
});

test('공휴일 하나 (객체)', () => {
  assert.deepStrictEqual(parseHolidayResponse(wrap({ item: { dateName: '성탄절', isHoliday: 'Y', locdate: 20261225 } })),
    [{ date: '2026-12-25', name: '성탄절' }]);
});

test('공휴일 없는 달 (빈 문자열)', () => {
  assert.deepStrictEqual(parseHolidayResponse(wrap('')), []);
});

test('쉬는 날이 아닌 기념일은 뺌', () => {
  assert.deepStrictEqual(parseHolidayResponse(wrap({ item: { dateName: '국군의 날', isHoliday: 'N', locdate: 20261001 } })), []);
});

test('키 오류(XML)·결과 코드 오류는 실패', () => {
  assert.throws(() => parseHolidayResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'));
  assert.throws(() => parseHolidayResponse(wrap('', '30')));
});

import { substituteHolidays } from '../lib/holidays.js';

const H = (list) => list.map(([date, name]) => ({ date, name }));
const subs = (list) => substituteHolidays(H(list)).map((r) => r.date);

test('대체공휴일: 국경일이 토·일요일', () => {
  assert.deepStrictEqual(subs([['2026-10-03', '개천절'], ['2026-10-09', '한글날']]), ['2026-10-05']);
  assert.deepStrictEqual(subs([['2026-08-15', '광복절']]), ['2026-08-17']);
  assert.deepStrictEqual(subs([['2026-03-01', '삼일절']]), ['2026-03-02']);
  assert.deepStrictEqual(subs([['2026-05-05', '어린이날'], ['2026-05-24', '부처님오신날']]), ['2026-05-25']);
  assert.deepStrictEqual(subs([['2027-12-25', '기독탄신일']]), ['2027-12-27']);
});

test('대체공휴일: 신정·현충일은 없음', () => {
  assert.deepStrictEqual(subs([['2028-01-01', '1월1일'], ['2025-06-06', '현충일'], ['2027-06-06', '현충일']]), []);
});

test('대체공휴일: 설·추석은 일요일과 겹칠 때만 (토요일은 아님)', () => {
  // 2026 추석 9/24(목)~26(토) → 없음
  assert.deepStrictEqual(subs([['2026-09-24', '추석'], ['2026-09-25', '추석'], ['2026-09-26', '추석']]), []);
  // 2024 설 2/9(금)~11(일) → 2/12(월)
  assert.deepStrictEqual(subs([['2024-02-09', '설날'], ['2024-02-10', '설날'], ['2024-02-11', '설날']]), ['2024-02-12']);
});

test('대체공휴일: 추석이 일요일과 겹치고 뒤에 한글날 (2025년 10월)', () => {
  assert.deepStrictEqual(subs([
    ['2025-10-03', '개천절'], ['2025-10-05', '추석'], ['2025-10-06', '추석'], ['2025-10-07', '추석'], ['2025-10-09', '한글날'],
  ]), ['2025-10-08']);
});

test('대체공휴일: 같은 날 겹친 공휴일은 하루만 (2025 어린이날 = 부처님오신날)', () => {
  assert.deepStrictEqual(subs([['2025-05-05', '어린이날'], ['2025-05-05', '부처님오신날']]), ['2025-05-06']);
});

test('대체공휴일: 추석 연휴 안에 개천절 (2028년)', () => {
  assert.deepStrictEqual(subs([['2028-10-02', '추석'], ['2028-10-03', '추석'], ['2028-10-03', '개천절'], ['2028-10-04', '추석']]), ['2028-10-05']);
});

test('대체공휴일: API가 이미 준 날은 다시 넣지 않음', () => {
  assert.deepStrictEqual(subs([['2026-10-03', '개천절'], ['2026-10-05', '대체공휴일']]), []);
});
