// API 흐름 테스트: D1 대신 node:sqlite
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
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

const env = { DB: fakeD1() };
async function call(path, { method = 'GET', body } = {}) {
  const res = await handleApi(new Request('https://x.pages.dev/api' + path, {
    method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' },
  }), env);
  return { status: res.status, data: await res.json() };
}

test('처음 열면 부서 5개·규칙·10월 예시가 들어 있다', async () => {
  const { status, data } = await call('/month?ym=2026-10');
  assert.equal(status, 200);
  assert.deepEqual(data.depts.map((d) => d.name), ['자립지원', '늘사랑주간보호', '주간활동', '활동지원', '방과후활동']);
  assert.deepEqual(data.depts.map((d) => d.ci), [3, 1, 2, 5, 4]);
  assert.equal(data.rows.length, 14);
  assert.equal(data.rows[0].prog, '일자리사업(환경미화)');
  assert.deepEqual(data.rows[0].sel, { wd: [1, 2, 3, 4], add: [], off: [] });
  assert.equal(data.rows[0].yieldOk, true);
  assert.match(data.rules, /이용시간을 지킵니다/);
  assert.equal(data.adminSet, false);
  assert.equal(data.confirmed, false);
});

test('줄 넣기·고치기·지우기, 그날만 바꾼 칸', async () => {
  const row = { id: 'abc1', dept: '주간활동', person: '김', prog: '미술', sel: { wd: [3], add: [], off: [21] }, time: '10:00~11:00', note: '', yieldOk: false, pend: null };
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row } })).status, 200);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row } })).status, 409);
  await call('/rows/abc1', { method: 'PUT', body: { row: { ...row, prog: '미술치료' } } });
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'op1', type: 'remove', d: 7, rowId: 'abc1', pend: null } } });
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'op2', type: 'add', d: 8, blk: { dept: '주간활동', prog: '산책', time: '13:00~14:00', half: 'pm' }, pend: null } } });
  let { data } = await call('/month?ym=2026-10');
  assert.equal(data.rows.at(-1).prog, '미술치료');
  assert.deepEqual(data.ops.map((o) => o.id), ['op1', 'op2']);
  assert.equal(data.ops[0].rowId, 'abc1');
  assert.deepEqual(data.ops[1].blk, { dept: '주간활동', prog: '산책', time: '13:00~14:00', half: 'pm' });
  // 줄을 지우면 그 줄의 '이날 빼기'도 같이 지워진다
  await call('/rows/abc1', { method: 'DELETE' });
  ({ data } = await call('/month?ym=2026-10'));
  assert.equal(data.rows.find((r) => r.id === 'abc1'), undefined);
  assert.deepEqual(data.ops.map((o) => o.id), ['op2']);
  await call('/ops/op2', { method: 'DELETE' });
  assert.equal((await call('/rows/nope', { method: 'PUT', body: { row } })).status, 404);
});

test('승인·반려는 시안의 규칙대로', async () => {
  const base = { dept: '활동지원', person: '', prog: '교육', sel: { wd: [2], add: [], off: [] }, time: '14:00~15:00', note: '', yieldOk: false };
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { ...base, id: 'n1', pend: { kind: 'new' } } } });
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { ...base, id: 'e1', prog: '새 이름', pend: { kind: 'edit', prev: base } } } });
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { ...base, id: 'd1', pend: { kind: 'del', prev: base } } } });
  let { data } = await call('/approve', { method: 'POST', body: { kind: 'row', id: 'n1', ok: false } });
  assert.equal(data.rows.find((r) => r.id === 'n1'), undefined); // 새 줄 반려 → 삭제
  ({ data } = await call('/approve', { method: 'POST', body: { kind: 'row', id: 'e1', ok: false } }));
  const e1 = data.rows.find((r) => r.id === 'e1');
  assert.equal(e1.prog, '교육'); assert.equal(e1.pend, null); // 변경 반려 → 이전 값
  ({ data } = await call('/approve', { method: 'POST', body: { kind: 'row', id: 'd1', ok: true } }));
  assert.equal(data.rows.find((r) => r.id === 'd1'), undefined); // 삭제 승인 → 삭제
  for (const id of ['e1']) await call('/rows/' + id, { method: 'DELETE' });
});

test('처음 여는 다음 달은 매주 반복 줄만 가져오고, 두 번 가져오지 않는다', async () => {
  await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { id: 'p1', dept: '자립지원', person: '', prog: '대기', sel: { wd: [1], add: [], off: [] }, time: '9:00~10:00', note: '', yieldOk: false, pend: { kind: 'new' } } } });
  let { data } = await call('/month?ym=2026-11');
  // 10월 예시 14줄 중 요일로 고른 12줄 (자립시어터 12일, 보수교육 14일은 빠짐), 승인 대기 새 줄도 빠짐
  assert.equal(data.rows.length, 12);
  assert.deepEqual(data.imported, { from: '10월', n: 12 });
  assert.ok(data.rows.every((r) => r.sel.add.length === 0 && r.sel.off.length === 0 && r.pend === null));
  ({ data } = await call('/month?ym=2026-11'));
  assert.equal(data.rows.length, 12);
  await call('/month/notice', { method: 'POST', body: { ym: '2026-11' } });
  ({ data } = await call('/month?ym=2026-11'));
  assert.equal(data.imported, null);
  // 전 달이 없으면 빈 달
  ({ data } = await call('/month?ym=2026-08'));
  assert.equal(data.rows.length, 0);
  // 이용시간 빠른 선택용: 다른 달에서 쓴 시간
  assert.ok(data.times.some((t) => t.dept === '방과후활동' && t.time === '14:30~17:30'));
  await call('/rows/p1', { method: 'DELETE' });
});

test('확정·전부 지우기', async () => {
  let { data } = await call('/month/confirm', { method: 'POST', body: { ym: '2026-11', confirmed: true } });
  assert.equal(data.confirmed, true);
  ({ data } = await call('/month/clear', { method: 'POST', body: { ym: '2026-11' } }));
  assert.equal(data.rows.length, 0); assert.equal(data.confirmed, false);
  ({ data } = await call('/month?ym=2026-10'));
  assert.ok(data.rows.length >= 14); // 다른 달은 그대로
});

test('비밀번호: 해시로만 저장, 처음 관리자 비밀번호 정하기', async () => {
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '12' } })).status, 400);
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '1234' } })).status, 200);
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '9999' } })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { admin: true, pin: '1234' } })).status, 200);
  assert.equal((await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '' } })).status, 200); // 비밀번호 없는 부서
  await call('/depts', { method: 'PUT', body: { action: 'pin', name: '주간활동', pin: '5555' } });
  assert.equal((await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '' } })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { dept: '주간활동', pin: '5555' } })).status, 200);
  const raw = await env.DB.prepare("SELECT pin_hash FROM depts WHERE name = '주간활동'").first();
  assert.ok(!raw.pin_hash.includes('5555') && raw.pin_hash.includes('$'));
  const { data } = await call('/month?ym=2026-10');
  assert.equal(data.adminSet, true);
  assert.equal(data.depts.find((d) => d.name === '주간활동').hasPin, true);
  assert.ok(!JSON.stringify(data).includes('pin_hash'));
});

test('부서 이름을 바꾸면 모든 달의 일정 부서명도 바뀐다', async () => {
  await call('/ops', { method: 'POST', body: { ym: '2026-10', op: { id: 'op9', type: 'add', d: 15, blk: { dept: '방과후활동', prog: '', time: '15:00~16:00', half: 'pm' }, pend: null } } });
  await call('/depts', { method: 'PUT', body: { action: 'rename', name: '방과후활동', to: '방과후' } });
  const oct = (await call('/month?ym=2026-10')).data, nov = (await call('/month?ym=2026-11')).data;
  assert.ok(oct.rows.some((r) => r.dept === '방과후') && !oct.rows.some((r) => r.dept === '방과후활동'));
  assert.equal(oct.ops.find((o) => o.id === 'op9').blk.dept, '방과후');
  assert.equal(oct.depts.at(-1).name, '방과후');
  assert.equal((await call('/depts', { method: 'PUT', body: { action: 'rename', name: '방과후', to: '자립지원' } })).status, 409);
  await call('/depts', { method: 'PUT', body: { action: 'add', name: '새부서' } });
  const add = (await call('/month?ym=2026-10')).data.depts.at(-1);
  assert.deepEqual(add, { name: '새부서', ci: 0, hasPin: false });
  await call('/depts', { method: 'PUT', body: { action: 'remove', name: '새부서' } });
  assert.equal((await call('/month?ym=2026-10')).data.depts.length, 5);
  assert.equal(nov.rows.length, 0);
});

test('이상한 값은 막는다', async () => {
  assert.equal((await call('/month?ym=2026-13')).status, 400);
  assert.equal((await call('/rows', { method: 'POST', body: { ym: '2026-10', row: { id: 'a b' } } })).status, 400);
  assert.equal((await call('/nothing')).status, 404);
});
