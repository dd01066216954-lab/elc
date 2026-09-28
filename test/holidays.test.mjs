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
