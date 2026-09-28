// API 전체 흐름 테스트: D1 대신 node:sqlite, 특일 정보 API 대신 가짜 응답
import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../lib/api.js';

// D1이 쓰는 모양(prepare/bind/first/all/run/batch)만 흉내
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

// 가짜 특일 정보 API: 2026년 9·10월 (10/5 대체공휴일은 일부러 빠진 상태)
const API = {
  '2026-09': [['20260924', '추석'], ['20260925', '추석'], ['20260926', '추석']],
  '2026-10': [['20261003', '개천절'], ['20261009', '한글날']],
};
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const ym = `${u.searchParams.get('solYear')}-${u.searchParams.get('solMonth')}`;
  const item = (API[ym] || []).map(([locdate, dateName]) => ({ locdate: Number(locdate), dateName, isHoliday: 'Y' }));
  return new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: item.length ? { item } : '' } } }));
};

const env = { DB: fakeD1(), APP_PASSWORD: 'pw', HOLIDAY_API_KEY: 'key' };
let cookie = '';
async function call(path, { method = 'GET', body } = {}) {
  const res = await handleApi(new Request('https://x.pages.dev/api' + path, {
    method, body: body ? JSON.stringify(body) : undefined, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  }), env);
  const set = res.headers.get('Set-Cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

test('로그인 전에는 막히고, 비밀번호가 맞으면 들어감', async () => {
  assert.strictEqual((await call('/people')).status, 401);
  assert.strictEqual((await call('/login', { method: 'POST', body: { password: 'x' } })).status, 401);
  assert.strictEqual((await call('/login', { method: 'POST', body: { password: 'pw' } })).status, 200);
  assert.deepStrictEqual((await call('/people')).data.people, []);
});

test('처음 켜면 9월 예시가 들어 있음', async () => {
  const r = await call('/months/2026-09');
  assert.match(r.data.data.title, /^9월/);
});

test('공휴일: API에 없는 10/5 대체공휴일을 계산해 넣음', async () => {
  const r = await call('/holidays/2026-10');
  assert.deepStrictEqual(r.data.holidays, { '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날' });
  assert.strictEqual(r.data.warning, null);
  const sep = await call('/holidays/2026-09');
  assert.deepStrictEqual(Object.keys(sep.data.holidays), ['2026-09-24', '2026-09-25', '2026-09-26']);
});

test('기관 휴무일과 같은 날이면 이름을 한 번만', async () => {
  await call('/custom-holidays', { method: 'POST', body: { date: '2026-10-05', name: '대체공휴일' } });
  await call('/custom-holidays', { method: 'POST', body: { date: '2026-10-30', name: '센터 개관기념일' } });
  const r = await call('/holidays/2026-10');
  assert.strictEqual(r.data.holidays['2026-10-05'], '대체공휴일');
  assert.strictEqual(r.data.holidays['2026-10-30'], '센터 개관기념일');
});

test('저장과 동시 편집 충돌', async () => {
  const a = await call('/months/2026-10', { method: 'PUT', body: { data: { title: 'A', days: {} }, baseUpdatedAt: null } });
  assert.strictEqual(a.status, 200);
  const stale = await call('/months/2026-10', { method: 'PUT', body: { data: { title: 'B', days: {} }, baseUpdatedAt: null } });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.data.data.title, 'A');
  const forced = await call('/months/2026-10', { method: 'PUT', body: { data: { title: 'B', days: {} }, baseUpdatedAt: null, force: true } });
  assert.strictEqual(forced.status, 200);
  assert.strictEqual((await call('/months/2026-10')).data.data.title, 'B');
});

test('참여자 저장', async () => {
  const r = await call('/people', { method: 'PUT', body: { people: [{ name: '가', tags: ['탁구', '2부'] }, { name: ' ', tags: [] }], baseUpdatedAt: null } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await call('/people')).data.people, [{ name: '가', tags: ['탁구', '2부'] }]);
});

test('반 나누기 설정 저장 · 저장된 달 목록', async () => {
  assert.strictEqual((await call('/settings')).data.tagGroups, null);
  await call('/settings', { method: 'PUT', body: { tagGroups: [{ name: '조리', tags: ['오전조', ' 오후조 ', ''] }] } });
  assert.deepStrictEqual((await call('/settings')).data.tagGroups, [{ name: '조리', tags: ['오전조', '오후조'] }]);
  assert.deepStrictEqual((await call('/months')).data.months, ['2026-09', '2026-10']);
});
