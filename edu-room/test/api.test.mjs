// API 흐름 테스트: D1 대신 node:sqlite, 특일 정보 API 대신 가짜 응답
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
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

// 가짜 특일 정보 API: 2026년 9·10월 (10/5 대체공휴일은 일부러 빠진 상태 → 직접 계산해서 채워야 함)
const API = {
  '2026-09': [['20260924', '추석'], ['20260925', '추석'], ['20260926', '추석']],
  '2026-10': [['20261003', '개천절'], ['20261009', '한글날']],
};
let apiCalls = 0, apiDown = false;
globalThis.fetch = async (url) => {
  apiCalls++;
  if (apiDown) throw new Error('fetch failed');
  const u = new URL(url);
  const ym = `${u.searchParams.get('solYear')}-${u.searchParams.get('solMonth')}`;
  const item = (API[ym] || []).map(([locdate, dateName]) => ({ locdate: Number(locdate), dateName, isHoliday: 'Y' }));
  return new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: item.length ? { item } : '' } } }));
};

const env = { DB: fakeD1(), HOLIDAY_API_KEY: 'key' };
const T = {}; // 토큰들
async function call(path, { method = 'GET', body, as, ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (as) headers.Authorization = 'Bearer ' + (T[as] || as);
  const res = await handleApi(new Request('https://x.pages.dev/api' + path, { method, body: body ? JSON.stringify(body) : undefined, headers }), env);
  return { status: res.status, data: await res.json() };
}
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const row = (id, dept, extra = {}) => ({ id, dept, person: '', prog: '테스트', sel: { wd: [3], add: [], off: [] }, time: '10:00~11:00', note: '', yieldOk: false, pend: null, ...extra });
const month = async (ym = '2026-10') => (await call('/month?ym=' + ym)).data;

test('처음 열면 부서 5개·규칙·10월 예시, 공휴일은 API 에서 (대체공휴일 계산 포함)', async () => {
  const data = await month();
  assert.deepEqual(data.depts.map((d) => d.name), ['자립지원', '늘사랑주간보호', '주간활동', '활동지원', '방과후활동']);
  assert.deepEqual(data.depts.map((d) => d.ci), [3, 1, 2, 5, 4]);
  assert.equal(data.rows.length, 14);
  assert.deepEqual(data.rows[0].sel, { wd: [1, 2, 3, 4], add: [], off: [] });
  assert.match(data.rules, /이용시간을 지킵니다/);
  assert.equal(data.adminSet, false);
  assert.deepEqual(data.holidays, { '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날' });
  assert.equal(data.today, kstToday());
});

test('공휴일: 일주일 안에는 다시 안 받고, API 가 안 되면 저장된 값, 아무것도 없으면 null', async () => {
  const n = apiCalls;
  await month();
  assert.equal(apiCalls, n);
  apiDown = true;
  assert.equal((await month('2027-03')).holidays, null);      // 받은 적 없음 → 화면 기본 목록
  env.DB.raw.exec('UPDATE holiday_fetches SET fetched_at = 0'); // 오래됨 → 다시 받으려다 실패
  assert.equal((await month()).holidays['2026-10-09'], '한글날');
  apiDown = false;
});

test('들어가기: 처음 관리자 비밀번호 정하기, 부서 토큰, 토큰 없으면 못 고침', async () => {
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '12' } })).status, 400);
  let r = await call('/login', { method: 'POST', body: { admin: true, pin: '1234' } });
  assert.equal(r.status, 200); T.admin = r.data.token;
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '9999' } })).status, 401);
  r = await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '' } }); // 비밀번호 없는 부서
  assert.equal(r.status, 200); T.ju = r.data.token;
  T.ja = (await call('/login', { method: 'POST', body: { dept: '자립지원' } })).data.token;
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('x0', '주간활동') } })).status, 401);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('x0', '주간활동') }, as: 'garbage.sig' })).status, 401);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('x0', '주간활동') }, as: T.ju.slice(0, -2) + 'xx' })).status, 401);
});

test('부서는 자기 부서 것만 (API 로 직접 보내도 403)', async () => {
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('j1', '주간활동') }, as: 'ju' })).status, 200);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('j2', '활동지원') }, as: 'ju' })).status, 403);
  // 자립지원 줄(seed0)을 주간활동이 고치거나 지우거나, 자기 줄을 다른 부서로 바꾸기
  const seed0 = (await month()).rows[0];
  assert.equal((await call('/rows/seed0', { method: 'PUT', body: { row: { ...seed0, prog: '해킹' } }, as: 'ju' })).status, 403);
  assert.equal((await call('/rows/seed0', { method: 'DELETE', as: 'ju' })).status, 403);
  assert.equal((await call('/rows/j1', { method: 'PUT', body: { row: row('j1', '자립지원') }, as: 'ju' })).status, 403);
  // 현황표 칸: 다른 부서 이름으로 새 칸, 다른 부서 일정 빼기
  assert.equal((await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'o1', type: 'add', d: 7, blk: { dept: '자립지원', prog: '', time: '13:00~14:00', half: 'pm' } } }, as: 'ju' })).status, 403);
  assert.equal((await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'o2', type: 'remove', d: 7, rowId: 'seed0' } }, as: 'ju' })).status, 403);
  assert.equal((await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'o3', type: 'remove', d: 7, rowId: 'seed0' } }, as: 'ja' })).status, 200);
  assert.equal((await call('/ops/o3', { method: 'DELETE', as: 'ju' })).status, 403);
  assert.equal((await call('/ops/o3', { method: 'DELETE', as: 'ja' })).status, 200);
  // 관리자만 할 수 있는 것
  for (const [path, body] of [['/month/clear', { ym: '2026-10' }], ['/month/confirm', { ym: '2026-10', confirmed: true }],
    ['/approve', { kind: 'row', id: 'j1', ok: true }], ['/month/period', { ym: '2026-10', from: '', to: '' }], ['/month/notice', { ym: '2026-10' }]]) {
    assert.equal((await call(path, { method: 'POST', body, as: 'ju' })).status, 403, path);
  }
  assert.equal((await call('/depts', { method: 'PUT', body: { action: 'pin', name: '주간활동', pin: '' }, as: 'ju' })).status, 403);
  assert.equal((await call('/settings', { method: 'PUT', body: { rules: 'x' }, as: 'ju' })).status, 403);
  assert.equal((await month()).rows.length, 15); // 지워진 것 없음
  // 부서가 승인 대기 표시를 마음대로 풀 수 없다 (기간·확정 아닌 달에서도)
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('a1', '활동지원', { pend: { kind: 'new' } }) }, as: 'admin' });
  T.hw = (await call('/login', { method: 'POST', body: { dept: '활동지원' } })).data.token;
  await call('/rows/a1', { method: 'PUT', body: { row: row('a1', '활동지원', { prog: '바꿈' }) }, as: 'hw' });
  assert.equal((await month()).rows.find((r) => r.id === 'a1').pend.kind, 'new');
  await call('/rows/a1', { method: 'DELETE', as: 'admin' });
});

test('겹치면 양보는 관리자만 정할 수 있다', async () => {
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('y1', '주간활동', { yieldOk: true }) }, as: 'ju' });
  assert.equal((await month()).rows.find((r) => r.id === 'y1').yieldOk, false);
  await call('/rows/y1', { method: 'PUT', body: { row: row('y1', '주간활동', { yieldOk: true }) }, as: 'admin' });
  await call('/rows/y1', { method: 'PUT', body: { row: row('y1', '주간활동', { yieldOk: false, prog: '부서가 고침' }) }, as: 'ju' });
  const y1 = (await month()).rows.find((r) => r.id === 'y1');
  assert.equal(y1.yieldOk, true); assert.equal(y1.prog, '부서가 고침');
  await call('/rows/y1', { method: 'DELETE', as: 'admin' });
});

test('확정된 달: 부서 변경은 서버가 승인 대기로, 관리자는 바로', async () => {
  await call('/month/confirm', { method: 'POST', body: { ym: '2026-10', confirmed: true }, as: 'admin' });
  // 새 줄 → new (화면이 pend 없이 보내도)
  let r = await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('j3', '주간활동') }, as: 'ju' });
  assert.equal(r.data.fixed, true);
  // 고침 → edit, 이전 값 보관
  r = await call('/rows/j1', { method: 'PUT', body: { row: row('j1', '주간활동', { prog: '새이름' }) }, as: 'ju' });
  assert.equal(r.data.fixed, true);
  // 한 번 더 고쳐도 이전 값은 처음 것
  await call('/rows/j1', { method: 'PUT', body: { row: row('j1', '주간활동', { prog: '새이름2' }) }, as: 'ju' });
  // 지움 → 삭제 대기
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('j4', '주간활동') }, as: 'admin' });
  r = await call('/rows/j4', { method: 'DELETE', as: 'ju' });
  assert.equal(r.data.fixed, true);
  // 승인 대기 새 줄은 부서가 바로 지울 수 있다
  await call('/rows/j3', { method: 'DELETE', as: 'ju' });
  // 현황표: 새 칸 → new, 빼기 → new
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'o4', type: 'add', d: 8, blk: { dept: '주간활동', prog: '', time: '13:00~14:00', half: 'pm' } } }, as: 'ju' });
  let data = await month();
  const j1 = data.rows.find((x) => x.id === 'j1');
  assert.equal(j1.prog, '새이름2'); assert.equal(j1.pend.kind, 'edit'); assert.equal(j1.pend.prev.prog, '테스트');
  assert.equal(data.rows.find((x) => x.id === 'j3'), undefined);
  assert.equal(data.rows.find((x) => x.id === 'j4').pend.kind, 'del');
  assert.equal(data.ops.find((x) => x.id === 'o4').pend.kind, 'new');
  // 관리자 변경은 확정 여부와 상관없이 바로
  r = await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('m1', '주간활동') }, as: 'admin' });
  assert.equal(r.data.fixed, false);
  // 승인·반려
  data = (await call('/approve', { method: 'POST', body: { kind: 'row', id: 'j1', ok: false }, as: 'admin' })).data;
  assert.equal(data.rows.find((x) => x.id === 'j1').prog, '테스트');
  data = (await call('/approve', { method: 'POST', body: { kind: 'row', id: 'j4', ok: true }, as: 'admin' })).data;
  assert.equal(data.rows.find((x) => x.id === 'j4'), undefined);
  data = (await call('/approve', { method: 'POST', body: { kind: 'op', id: 'o4', ok: true }, as: 'admin' })).data;
  assert.equal(data.ops.find((x) => x.id === 'o4').pend, null);
  await call('/month/confirm', { method: 'POST', body: { ym: '2026-10', confirmed: false }, as: 'admin' });
  for (const id of ['j1', 'm1']) await call('/rows/' + id, { method: 'DELETE', as: 'admin' });
  await call('/ops/o4', { method: 'DELETE', as: 'admin' });
});

test('신청 기간 밖이면 승인 대기, 안이면 바로 (한국 날짜 기준)', async () => {
  const t = kstToday();
  await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: addDays(t, -10), to: addDays(t, -1) }, as: 'admin' });
  let r = await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('p1', '주간활동') }, as: 'ju' });
  assert.equal(r.data.fixed, true);
  await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: addDays(t, 1), to: '' }, as: 'admin' });
  r = await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('p2', '주간활동') }, as: 'ju' });
  assert.equal(r.data.fixed, true); // 아직 기간 전
  await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: t, to: t }, as: 'admin' });
  r = await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('p3', '주간활동') }, as: 'ju' });
  assert.equal(r.data.fixed, false);
  const data = await month();
  assert.deepEqual(['p1', 'p2', 'p3'].map((id) => (data.rows.find((x) => x.id === id).pend || {}).kind || null), ['new', 'new', null]);
  assert.deepEqual(data.period, { from: t, to: t });
  // 전부 지워도 신청 기간은 남는다, 이상한 날짜는 막는다
  assert.equal((await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: t, to: addDays(t, -1) }, as: 'admin' })).status, 400);
  assert.equal((await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: '10/20' }, as: 'admin' })).status, 400);
  await call('/month/period', { method: 'POST', body: { ym: '2026-10', from: '', to: '' }, as: 'admin' });
  assert.equal((await month()).period, null);
  for (const id of ['p1', 'p2', 'p3']) await call('/rows/' + id, { method: 'DELETE', as: 'admin' });
});

test('비밀번호: 해시로만 저장, 바꾸면 그 부서 기기는 다시 들어와야, 이름을 바꿔도 토큰은 그대로', async () => {
  await call('/depts', { method: 'PUT', body: { action: 'pin', name: '주간활동', pin: '5555' }, as: 'admin' });
  const raw = await env.DB.prepare("SELECT pin_hash FROM depts WHERE name = '주간활동'").first();
  assert.ok(!raw.pin_hash.includes('5555') && raw.pin_hash.includes('$'));
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('k1', '주간활동') }, as: 'ju' })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '' } })).status, 401);
  T.ju = (await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '5555' } })).data.token;
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('k1', '주간활동') }, as: 'ju' })).status, 200);
  const d = await month();
  assert.equal(d.adminSet, true);
  assert.equal(d.depts.find((x) => x.name === '주간활동').hasPin, true);
  assert.ok(!JSON.stringify(d).includes('pin_hash') && !JSON.stringify(d).includes('$'));
  // 이름 바꾸기 → 토큰 그대로, 일정 부서명도 바뀜
  await call('/depts', { method: 'PUT', body: { action: 'rename', name: '주간활동', to: '주간' }, as: 'admin' });
  assert.equal((await call('/rows/k1', { method: 'PUT', body: { row: row('k1', '주간', { prog: '이름바뀜' }) }, as: 'ju' })).status, 200);
  assert.ok((await month()).rows.filter((r) => r.dept === '주간').length >= 3);
  await call('/depts', { method: 'PUT', body: { action: 'rename', name: '주간', to: '주간활동' }, as: 'admin' });
  await call('/rows/k1', { method: 'DELETE', as: 'ju' });
  // 관리자 비밀번호를 바꾸면 바꾼 사람은 새 토큰, 예전 관리자 토큰은 못 씀
  const old = T.admin;
  const r = await call('/settings', { method: 'PUT', body: { adminPin: '4321' }, as: 'admin' });
  T.admin = r.data.token;
  assert.equal((await call('/month/notice', { method: 'POST', body: { ym: '2026-10' }, as: old })).status, 401);
  assert.equal((await call('/month/notice', { method: 'POST', body: { ym: '2026-10' }, as: 'admin' })).status, 200);
  await call('/depts', { method: 'PUT', body: { action: 'pin', name: '주간활동', pin: '' }, as: 'admin' });
});

test('비밀번호를 5번 틀리면 5분 막기 (맞는 비밀번호도), 다른 곳에서는 됨', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '0000' }, ip: '9.9.9.9' })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '0000' }, ip: '9.9.9.9' })).status, 429);
  const r = await call('/login', { method: 'POST', body: { admin: true, pin: '4321' }, ip: '9.9.9.9' });
  assert.equal(r.status, 429); assert.match(r.data.error, /분 뒤/);
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '4321' }, ip: '8.8.8.8' })).status, 200);
});

test('처음 여는 다음 달은 매주 반복 줄만 가져오고, 두 번 가져오지 않는다', async () => {
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('q1', '자립지원', { sel: { wd: [1], add: [], off: [] }, pend: { kind: 'new' } }) }, as: 'admin' });
  let data = await month('2026-11');
  assert.equal(data.rows.length, 12); // 예시 14줄 중 요일로 고른 12줄, 승인 대기 새 줄은 빠짐
  assert.deepEqual(data.imported, { from: '10월', n: 12 });
  assert.ok(data.rows.every((r) => r.sel.add.length === 0 && r.sel.off.length === 0 && r.pend === null));
  assert.equal((await month('2026-11')).rows.length, 12);
  await call('/month/notice', { method: 'POST', body: { ym: '2026-11' }, as: 'admin' });
  assert.equal((await month('2026-11')).imported, null);
  data = await month('2026-08');
  assert.equal(data.rows.length, 0);
  assert.ok(data.times.some((t) => t.dept === '방과후활동' && t.time === '14:30~17:30'));
  await call('/rows/q1', { method: 'DELETE', as: 'admin' });
  data = (await call('/month/clear', { method: 'POST', body: { ym: '2026-11' }, as: 'admin' })).data;
  assert.equal(data.rows.length, 0);
  assert.ok((await month()).rows.length >= 14);
});

test('신청서 줄을 지우면 그날만 옮긴 칸·이날 빼기도 같이 지워지고, 예전에 남은 것도 정리', async () => {
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: row('z1', '자립지원') }, as: 'admin' });
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'zr', type: 'remove', d: 14, rowId: 'z1' } }, as: 'admin' });
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'za', type: 'add', d: 15, blk: { dept: '자립지원', prog: '테스트', time: '15:00~16:00', half: 'pm', rowId: 'z1', from: 14 } } }, as: 'admin' });
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'zb', type: 'add', d: 16, blk: { dept: '자립지원', prog: '하루', time: '15:00~16:00', half: 'pm' } } }, as: 'admin' });
  assert.deepEqual((await month()).ops.filter((o) => o.id.startsWith('z')).map((o) => o.id), ['zr', 'za', 'zb']);
  await call('/rows/z1', { method: 'DELETE', as: 'admin' });
  assert.deepEqual((await month()).ops.filter((o) => o.id.startsWith('z')).map((o) => o.id), ['zb']); // 줄과 상관없는 하루 칸은 남음
  // 예전 방식으로 남아 버린 칸 (줄은 없는데 칸만 있음) → 불러올 때 정리
  env.DB.raw.exec(`INSERT INTO ops (id, room, ym, d, type, row_id, blk, updated_at) VALUES
    ('zo', '4f-edu', '2026-10', 20, 'add', NULL, '{"dept":"자립지원","prog":"남은칸","time":"9:00~10:00","half":"am","rowId":"gone1"}', 0),
    ('zq', '4f-edu', '2026-10', 21, 'remove', 'gone1', NULL, 0)`);
  assert.deepEqual((await month()).ops.filter((o) => o.id.startsWith('z')).map((o) => o.id), ['zb']);
  await call('/ops/zb', { method: 'DELETE', as: 'admin' });
});

test('부서 더하기·빼기, 이상한 값은 막는다', async () => {
  await call('/depts', { method: 'PUT', body: { action: 'add', name: '새부서' }, as: 'admin' });
  assert.deepEqual((await month()).depts.at(-1), { name: '새부서', ci: 0, hasPin: false, manager: '' });
  await call('/depts', { method: 'PUT', body: { action: 'manager', name: '새부서', manager: ' 김민수 ' }, as: 'admin' });
  assert.equal((await month()).depts.at(-1).manager, '김민수');
  assert.equal((await call('/depts', { method: 'PUT', body: { action: 'manager', name: '새부서', manager: '해킹' }, as: 'hw' })).status, 403);
  assert.equal((await call('/depts', { method: 'PUT', body: { action: 'rename', name: '새부서', to: '자립지원' }, as: 'admin' })).status, 409);
  await call('/depts', { method: 'PUT', body: { action: 'remove', name: '새부서' }, as: 'admin' });
  assert.equal((await month()).depts.length, 5);
  assert.equal((await call('/month?ym=2026-13')).status, 400);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { id: 'a b' } }, as: 'admin' })).status, 400);
  assert.equal((await call('/nothing', { method: 'POST', as: 'admin' })).status, 404);
});
