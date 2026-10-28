// 4층 교육장 현황표 API — Cloudflare Pages Functions(functions/api/[[path]].js)에서 부른다.
// 화면 파일(public/)은 Pages가 그대로 내보내고, /api/* 만 여기서 처리한다.
//
// Cloudflare 화면에서 넣는 설정 (README 참고)
//   D1 바인딩   DB                (표는 lib/schema.js 가 처음에 저절로 만든다)
//   비밀 변수   HOLIDAY_API_KEY   공공데이터포털 특일 정보 서비스키 (없으면 화면에 들어 있는 2026~2027 공휴일을 씀)
//
// 권한 (화면 버튼이 보이든 말든 서버가 다시 확인한다)
//   보기(GET /api/month)        누구나
//   신청서 줄·그날만 바꾼 칸    부서 토큰은 자기 부서 것만. 확정된 달이나 신청 기간 밖이면 서버가 승인 대기로 저장
//   승인·확정·지우기·기간·부서·규칙  관리자 토큰만

import { ensureSchema, ROOM } from './schema.js';
import { substituteHolidays, fetchHolidayApi, explainHolidayError } from './holidays.js';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEPT_DAYS = 180, ADMIN_HOURS = 12;      // 토큰 유효 기간
const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000; // 비밀번호 5번 틀리면 5분 막기
const HOLIDAY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 임시공휴일 대비 일주일마다 다시 확인

export async function handleApi(request, env) {
  if (!env.DB) return json({ error: '데이터베이스(DB)가 연결되지 않았어요. 설정을 확인해 주세요.' }, 500);
  try {
    await ensureSchema(env.DB);
    return await route(request, env, new URL(request.url));
  } catch (e) {
    if (e instanceof Bad) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.' }, 500);
  }
}

class Bad extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

async function route(request, env, url) {
  const path = url.pathname.slice(4); // '/api' 떼기
  const method = request.method;
  const db = env.DB;
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  let m;

  if (path === '/month' && method === 'GET') return json(await monthPayload(env, ymOf(url.searchParams.get('ym'))));
  if (path === '/login' && method === 'POST') return login(db, body, request);

  // 여기부터는 모두 쓰기: 토큰이 있어야 한다
  const who = await whoIs(db, request);
  if (!who) return json({ error: '다시 들어와 주세요.', login: true }, 401);
  const admin = () => { if (who.role !== 'admin') throw new Bad('관리자만 할 수 있어요.', 403); };

  if (path === '/rows' && method === 'POST') return json(await postRow(db, who, ymOf(body.ym), body.row));
  if ((m = path.match(/^\/rows\/([^/]+)$/))) {
    const id = idOf(decodeURIComponent(m[1]));
    if (method === 'PUT') return json(await putRow(db, who, { ...body.row, id }));
    if (method === 'DELETE') return json(await deleteRow(db, who, id));
  }
  if (path === '/ops' && method === 'POST') return json(await postOp(db, who, ymOf(body.ym), body.op));
  if ((m = path.match(/^\/ops\/([^/]+)$/))) {
    const id = idOf(decodeURIComponent(m[1]));
    if (method === 'PUT') return json(await putOp(db, who, { ...body.op, id }));
    if (method === 'DELETE') return json(await deleteOp(db, who, id));
  }

  if (path === '/approve' && method === 'POST') { admin(); return json(await approve(env, body)); }
  if (path === '/month/confirm' && method === 'POST') {
    admin();
    const ym = ymOf(body.ym);
    await db.prepare('UPDATE months SET confirmed = ? WHERE room = ? AND ym = ?').bind(body.confirmed ? 1 : 0, ROOM, ym).run();
    return json(await monthPayload(env, ym));
  }
  if (path === '/month/clear' && method === 'POST') {
    admin();
    const ym = ymOf(body.ym);
    await db.batch([
      db.prepare('DELETE FROM rows WHERE room = ? AND ym = ?').bind(ROOM, ym),
      db.prepare('DELETE FROM ops WHERE room = ? AND ym = ?').bind(ROOM, ym),
      db.prepare('UPDATE months SET confirmed = 0, imported_from = NULL, imported_n = NULL WHERE room = ? AND ym = ?').bind(ROOM, ym),
    ]);
    return json(await monthPayload(env, ym));
  }
  if (path === '/month/period' && method === 'POST') {
    admin();
    // 신청 기간 (모든 부서 같은 기간). 둘 다 비우면 기간 없음
    const ym = ymOf(body.ym), from = dayOf(body.from), to = dayOf(body.to);
    if (from && to && from > to) throw new Bad('시작일이 마감일보다 늦어요.');
    await monthMustExist(db, ym);
    await db.prepare('UPDATE months SET open_from = ?, open_to = ? WHERE room = ? AND ym = ?').bind(from, to, ROOM, ym).run();
    return json({ ok: true });
  }
  if (path === '/month/notice' && method === 'POST') {
    admin();
    await db.prepare('UPDATE months SET imported_from = NULL, imported_n = NULL WHERE room = ? AND ym = ?').bind(ROOM, ymOf(body.ym)).run();
    return json({ ok: true });
  }
  if (path === '/depts' && method === 'PUT') { admin(); return json(await changeDept(db, body)); }
  if (path === '/settings' && method === 'PUT') { admin(); return json(await changeSettings(db, body)); }

  return json({ error: '없는 주소예요.' }, 404);
}

/* ===== 한 달 불러오기 ===== */
async function monthPayload(env, ym) {
  const db = env.DB;
  await ensureMonth(db, ym);
  const [mo, rows, ops, depts, settings, times, holidays] = await Promise.all([
    db.prepare('SELECT confirmed, imported_from, imported_n, open_from, open_to FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first(),
    db.prepare('SELECT * FROM rows WHERE room = ? AND ym = ? ORDER BY rowid').bind(ROOM, ym).all(),
    db.prepare('SELECT * FROM ops WHERE room = ? AND ym = ? ORDER BY rowid').bind(ROOM, ym).all(),
    db.prepare('SELECT name, color_idx, pin_hash FROM depts WHERE room = ? ORDER BY sort, id').bind(ROOM).all(),
    db.prepare("SELECT key, value FROM settings WHERE room = ? AND key IN ('rules', 'admin_pin_hash')").bind(ROOM).all(),
    // 이용시간 빠른 선택에 쓰는, 다른 달에 부서마다 쓴 시간
    db.prepare('SELECT dept, time, COUNT(*) AS n FROM rows WHERE room = ? AND ym <> ? AND time <> \'\' GROUP BY dept, time').bind(ROOM, ym).all(),
    getHolidays(env, ym),
  ]);
  const set = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
  return {
    ym,
    confirmed: !!mo.confirmed,
    imported: mo.imported_from ? { from: mo.imported_from, n: mo.imported_n } : null,
    period: mo.open_from || mo.open_to ? { from: mo.open_from || '', to: mo.open_to || '' } : null,
    rows: rows.results.map(rowOut),
    ops: ops.results.map(opOut),
    depts: depts.results.map((d) => ({ name: d.name, ci: d.color_idx, hasPin: !!d.pin_hash })),
    rules: set.rules || '',
    adminSet: !!set.admin_pin_hash,
    times: times.results,
    holidays, // {'2026-10-09': '한글날'} 또는 null (못 받았고 저장된 것도 없음 → 화면의 기본 목록)
    today: kstToday(),
  };
}

// 처음 여는 달이면 바로 전 달 신청서에서 요일(매주)로 고른 줄만 가져온다.
// 콕 찍은 날·뺀 날, 승인 대기 중인 새 줄은 안 가져옴. 가져온 줄 id 는 정해져 있어서 두 번 들어가지 않는다.
async function ensureMonth(db, ym) {
  if (await db.prepare('SELECT 1 FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first()) return;
  const prevYm = shiftMonth(ym, -1);
  const prevMonth = await db.prepare('SELECT 1 FROM months WHERE room = ? AND ym = ?').bind(ROOM, prevYm).first();
  const copy = [];
  if (prevMonth) {
    const { results } = await db.prepare('SELECT * FROM rows WHERE room = ? AND ym = ? ORDER BY rowid').bind(ROOM, prevYm).all();
    for (const raw of results) {
      const r = rowOut(raw);
      if (r.pend && r.pend.kind === 'new') continue;
      const f = r.pend ? r.pend.prev : r;
      if (!f.sel || !f.sel.wd || !f.sel.wd.length) continue;
      copy.push({ ...f, id: (ym.replace('-', '') + '_' + r.id).slice(0, 64), sel: { wd: f.sel.wd.slice(), add: [], off: [] }, pend: null });
    }
  }
  const now = Date.now();
  const from = copy.length ? Number(prevYm.split('-')[1]) + '월' : null;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO months (room, ym, confirmed, imported_from, imported_n) VALUES (?, ?, 0, ?, ?)')
      .bind(ROOM, ym, from, copy.length || null),
    ...copy.map((r) => rowInsert(db, ym, r, now, true)),
  ]);
}

async function monthMustExist(db, ym) {
  if (!(await db.prepare('SELECT 1 FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first())) await ensureMonth(db, ym);
}

// 부서가 고치면 승인 대기가 되는 달인가: 확정됐거나, 신청 기간이 정해져 있고 오늘(한국 날짜)이 그 밖
async function needsApproval(db, ym) {
  const mo = await db.prepare('SELECT confirmed, open_from, open_to FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first();
  if (!mo) return false;
  if (mo.confirmed) return true;
  const t = kstToday();
  return !!((mo.open_from && t < mo.open_from) || (mo.open_to && t > mo.open_to));
}
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

/* ===== 신청서 줄 ===== */
function rowOut(r) {
  return {
    id: r.id, dept: r.dept, person: r.person || '', prog: r.prog || '', sel: parse(r.sel) || { wd: [], add: [], off: [] },
    time: r.time || '', note: r.note || '', yieldOk: !!r.yield,
    pend: r.pend_kind ? { kind: r.pend_kind, prev: parse(r.pend_prev) } : null,
  };
}
function opOut(o) {
  const out = { id: o.id, type: o.type, d: o.d, pend: o.pend_kind ? { kind: o.pend_kind, prev: parse(o.pend_prev) } : null };
  if (o.type === 'remove') out.rowId = o.row_id; else out.blk = parse(o.blk);
  return out;
}

function cleanRow(r) {
  if (!r || typeof r !== 'object') throw new Bad('보낸 줄이 비어 있어요.');
  return {
    id: idOf(r.id), dept: str(r.dept), person: str(r.person), prog: str(r.prog), sel: cleanSel(r.sel),
    time: str(r.time), note: str(r.note), yieldOk: !!r.yieldOk, pend: cleanPend(r.pend, cleanRowPrev),
  };
}
const ROW_FIELDS = ['dept', 'person', 'prog', 'sel', 'time', 'note', 'yieldOk'];
function cleanRowPrev(p) {
  return { dept: str(p.dept), person: str(p.person), prog: str(p.prog), sel: cleanSel(p.sel), time: str(p.time), note: str(p.note), yieldOk: !!p.yieldOk };
}
function cleanBlk(b) {
  if (!b || typeof b !== 'object') throw new Bad('보낸 칸이 비어 있어요.');
  const out = { dept: str(b.dept), prog: str(b.prog), time: str(b.time), half: b.half === 'pm' ? 'pm' : 'am' };
  if (b.note) out.note = str(b.note); // 기타 (현황표에 *로 나옴)
  return out;
}
function cleanSel(s) {
  const days = (a, max) => (Array.isArray(a) ? a : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max);
  s = s && typeof s === 'object' ? s : {};
  return { wd: days(s.wd, 5), add: days(s.add, 31), off: days(s.off, 31) };
}
function cleanPend(p, cleanPrev) {
  if (!p) return null;
  if (!['new', 'edit', 'del'].includes(p.kind)) throw new Bad('승인 대기 표시가 이상해요.');
  return { kind: p.kind, prev: p.prev ? cleanPrev(p.prev) : null };
}
const samePend = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const fieldsOf = (r) => cleanRowPrev(r);

function rowInsert(db, ym, r, now, ignore) {
  return db.prepare(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO rows
      (id, room, ym, dept, person, prog, sel, time, note, yield, pend_kind, pend_prev, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(r.id, ROOM, ym, r.dept, r.person, r.prog, JSON.stringify(r.sel), r.time, r.note, r.yieldOk ? 1 : 0,
      r.pend ? r.pend.kind : null, r.pend && r.pend.prev ? JSON.stringify(r.pend.prev) : null, now);
}
function rowUpdate(db, r, now) {
  return db.prepare(`UPDATE rows SET dept = ?, person = ?, prog = ?, sel = ?, time = ?, note = ?, yield = ?,
      pend_kind = ?, pend_prev = ?, updated_at = ? WHERE room = ? AND id = ?`)
    .bind(r.dept, r.person, r.prog, JSON.stringify(r.sel), r.time, r.note, r.yieldOk ? 1 : 0,
      r.pend ? r.pend.kind : null, r.pend && r.pend.prev ? JSON.stringify(r.pend.prev) : null, now, ROOM, r.id);
}
const ownDept = (who, dept) => {
  if (who.role === 'admin') return;
  if (dept !== who.dept) throw new Bad('다른 부서 일정은 고칠 수 없어요.', 403);
};

// 결과에 fixed:true 가 있으면 서버가 보낸 것과 다르게 저장했다는 뜻 → 화면이 그 달을 다시 불러온다
async function postRow(db, who, ym, raw) {
  const r = cleanRow(raw);
  ownDept(who, r.dept);
  await monthMustExist(db, ym);
  const asked = r.pend;
  if (who.role !== 'admin') r.pend = (await needsApproval(db, ym)) ? { kind: 'new', prev: null } : null;
  await rowInsert(db, ym, r, Date.now(), false).run().catch((e) => { throw dup(e); });
  return { ok: true, fixed: !samePend(asked, r.pend) };
}

async function putRow(db, who, raw) {
  const r = cleanRow(raw);
  const cur = await db.prepare('SELECT * FROM rows WHERE room = ? AND id = ?').bind(ROOM, r.id).first();
  if (!cur) throw new Bad('그 줄은 이미 지워졌어요.', 404);
  const old = rowOut(cur);
  ownDept(who, old.dept);
  ownDept(who, r.dept);
  const asked = r.pend;
  if (who.role !== 'admin') {
    if (await needsApproval(db, cur.ym)) {
      const base = old.pend && old.pend.prev ? old.pend.prev : fieldsOf(old);
      if (old.pend && old.pend.kind === 'new') r.pend = { kind: 'new', prev: null };
      else if (asked && asked.kind === 'del') { Object.assign(r, base); r.pend = { kind: 'del', prev: base }; }
      else r.pend = { kind: 'edit', prev: base };
    } else r.pend = old.pend; // 부서는 승인 대기 표시를 스스로 풀 수 없다
  }
  await rowUpdate(db, r, Date.now()).run();
  return { ok: true, fixed: !samePend(asked, r.pend) };
}

async function deleteRow(db, who, id) {
  const cur = await db.prepare('SELECT * FROM rows WHERE room = ? AND id = ?').bind(ROOM, id).first();
  if (!cur) return { ok: true };
  const old = rowOut(cur);
  ownDept(who, old.dept);
  if (who.role !== 'admin' && !(old.pend && old.pend.kind === 'new') && (await needsApproval(db, cur.ym))) {
    // 확정된 달·신청 기간 밖: 바로 지우지 않고 삭제 승인 대기
    const base = old.pend && old.pend.prev ? old.pend.prev : fieldsOf(old);
    await rowUpdate(db, { ...old, ...base, pend: { kind: 'del', prev: base } }, Date.now()).run();
    return { ok: true, fixed: true };
  }
  await db.batch([
    db.prepare('DELETE FROM rows WHERE room = ? AND id = ?').bind(ROOM, id),
    db.prepare('DELETE FROM ops WHERE room = ? AND row_id = ?').bind(ROOM, id),
  ]);
  return { ok: true };
}

/* ===== 현황표에서 그날만 바꾼 칸 ===== */
async function opDept(db, o) {
  if (o.type === 'add') return (parse(o.blk) || {}).dept;
  const row = await db.prepare('SELECT dept FROM rows WHERE room = ? AND id = ?').bind(ROOM, o.row_id).first();
  return row ? row.dept : null;
}

async function postOp(db, who, ym, raw) {
  if (!raw || typeof raw !== 'object') throw new Bad('보낸 칸이 비어 있어요.');
  const id = idOf(raw.id);
  const type = raw.type === 'remove' ? 'remove' : 'add';
  const d = Number(raw.d);
  if (!Number.isInteger(d) || d < 1 || d > 31) throw new Bad('날짜가 이상해요.');
  const blk = type === 'add' ? cleanBlk(raw.blk) : null;
  const rowId = type === 'remove' ? idOf(raw.rowId) : null;
  ownDept(who, type === 'add' ? blk.dept : await opDept(db, { type, row_id: rowId }));
  await monthMustExist(db, ym);
  const asked = cleanPend(raw.pend, cleanBlk);
  let pend = asked;
  if (who.role !== 'admin') pend = (await needsApproval(db, ym)) ? { kind: 'new', prev: null } : null;
  await db.prepare(`INSERT INTO ops (id, room, ym, d, type, row_id, blk, pend_kind, pend_prev, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ROOM, ym, d, type, rowId, blk ? JSON.stringify(blk) : null,
      pend ? pend.kind : null, pend && pend.prev ? JSON.stringify(pend.prev) : null, Date.now())
    .run().catch((e) => { throw dup(e); });
  return { ok: true, fixed: !samePend(asked, pend) };
}

// 고칠 수 있는 것: 칸 내용(add 만)과 승인 대기 표시
async function putOp(db, who, raw) {
  if (!raw || typeof raw !== 'object') throw new Bad('보낸 칸이 비어 있어요.');
  const id = idOf(raw.id);
  const cur = await db.prepare('SELECT * FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).first();
  if (!cur) throw new Bad('그 칸은 이미 지워졌어요.', 404);
  const old = opOut(cur);
  ownDept(who, await opDept(db, cur));
  let blk = cur.type === 'add' ? cleanBlk(raw.blk) : null;
  if (blk) ownDept(who, blk.dept);
  const asked = cleanPend(raw.pend, cleanBlk);
  let pend = asked;
  if (who.role !== 'admin') {
    if (await needsApproval(db, cur.ym)) {
      const base = old.pend && old.pend.prev ? old.pend.prev : old.blk;
      if (old.pend && old.pend.kind === 'new') pend = { kind: 'new', prev: null };
      else if (asked && asked.kind === 'del') { blk = base; pend = { kind: 'del', prev: base }; }
      else pend = { kind: 'edit', prev: base };
    } else pend = old.pend;
  }
  await db.prepare('UPDATE ops SET blk = ?, pend_kind = ?, pend_prev = ?, updated_at = ? WHERE room = ? AND id = ?')
    .bind(blk ? JSON.stringify(blk) : null, pend ? pend.kind : null, pend && pend.prev ? JSON.stringify(pend.prev) : null, Date.now(), ROOM, id).run();
  return { ok: true, fixed: !samePend(asked, pend) };
}

async function deleteOp(db, who, id) {
  const cur = await db.prepare('SELECT * FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).first();
  if (!cur) return { ok: true };
  const old = opOut(cur);
  ownDept(who, await opDept(db, cur));
  if (who.role !== 'admin' && !(old.pend && old.pend.kind === 'new') && (await needsApproval(db, cur.ym))) {
    if (cur.type === 'remove') throw new Bad('확정된 일정이라 관리자에게 부탁해 주세요.', 403);
    const base = old.pend && old.pend.prev ? old.pend.prev : old.blk;
    await db.prepare("UPDATE ops SET blk = ?, pend_kind = 'del', pend_prev = ?, updated_at = ? WHERE room = ? AND id = ?")
      .bind(JSON.stringify(base), JSON.stringify(base), Date.now(), ROOM, id).run();
    return { ok: true, fixed: true };
  }
  await db.prepare('DELETE FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).run();
  return { ok: true };
}

/* ===== 승인 / 반려 (시안의 decide 와 같은 규칙) ===== */
// 승인: new/edit → 확정, del → 삭제.  반려: new → 삭제, edit → 이전 값 복구, del → 그대로 둠
async function approve(env, { kind, id, ok }) {
  const db = env.DB;
  id = idOf(id);
  const now = Date.now();
  let ym;
  if (kind === 'row') {
    const raw = await db.prepare('SELECT * FROM rows WHERE room = ? AND id = ?').bind(ROOM, id).first();
    if (!raw) throw new Bad('그 줄은 이미 없어요.', 404);
    ym = raw.ym;
    const r = rowOut(raw), k = r.pend && r.pend.kind;
    const del = () => db.batch([
      db.prepare('DELETE FROM rows WHERE room = ? AND id = ?').bind(ROOM, id),
      db.prepare('DELETE FROM ops WHERE room = ? AND row_id = ?').bind(ROOM, id),
    ]);
    const clear = () => db.prepare('UPDATE rows SET pend_kind = NULL, pend_prev = NULL, updated_at = ? WHERE room = ? AND id = ?').bind(now, ROOM, id).run();
    if (ok) { if (k === 'del') await del(); else await clear(); }
    else if (k === 'new') await del();
    else if (k === 'edit' && r.pend.prev) await rowUpdate(db, { ...r, ...r.pend.prev, pend: null }, now).run();
    else await clear();
  } else if (kind === 'op') {
    const raw = await db.prepare('SELECT * FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).first();
    if (!raw) throw new Bad('그 칸은 이미 없어요.', 404);
    ym = raw.ym;
    const o = opOut(raw), k = o.pend && o.pend.kind;
    const del = () => db.prepare('DELETE FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).run();
    const clear = () => db.prepare('UPDATE ops SET pend_kind = NULL, pend_prev = NULL, updated_at = ? WHERE room = ? AND id = ?').bind(now, ROOM, id).run();
    if (o.type === 'remove') await (ok ? clear() : del());
    else if (ok) await (k === 'del' ? del() : clear());
    else if (k === 'new') await del();
    else if (k === 'edit' && o.pend.prev) {
      await db.prepare('UPDATE ops SET blk = ?, pend_kind = NULL, pend_prev = NULL, updated_at = ? WHERE room = ? AND id = ?')
        .bind(JSON.stringify(o.pend.prev), now, ROOM, id).run();
    } else await clear();
  } else throw new Bad('무엇을 승인할지 몰라요.');
  return monthPayload(env, ym);
}

/* ===== 부서 / 비밀번호 / 규칙 ===== */
async function changeDept(db, { action, name, to, pin }) {
  name = str(name).trim();
  if (action === 'add') {
    if (!name) throw new Bad('부서 이름을 적어 주세요.');
    const { results } = await db.prepare('SELECT color_idx, sort FROM depts WHERE room = ?').bind(ROOM).all();
    const used = results.map((d) => d.color_idx);
    let ci = 0; while (used.includes(ci)) ci++;
    const sort = results.reduce((a, d) => Math.max(a, d.sort + 1), 0);
    await db.prepare('INSERT OR IGNORE INTO depts (room, name, color_idx, pin_hash, sort) VALUES (?, ?, ?, NULL, ?)').bind(ROOM, name, ci, sort).run();
  } else if (action === 'remove') {
    await db.prepare('DELETE FROM depts WHERE room = ? AND name = ?').bind(ROOM, name).run();
  } else if (action === 'rename') {
    to = str(to).trim();
    if (!to) throw new Bad('새 이름을 적어 주세요.');
    if (await db.prepare('SELECT 1 FROM depts WHERE room = ? AND name = ?').bind(ROOM, to).first()) throw new Bad('이미 있는 부서 이름이에요.', 409);
    // 모든 달의 일정 부서명도 같이 바꾼다 (승인 전 값, 그날만 바꾼 칸 포함)
    await db.batch([
      db.prepare('UPDATE depts SET name = ?2 WHERE room = ?3 AND name = ?1').bind(name, to, ROOM),
      db.prepare('UPDATE rows SET dept = ?2 WHERE room = ?3 AND dept = ?1').bind(name, to, ROOM),
      db.prepare("UPDATE rows SET pend_prev = json_set(pend_prev, '$.dept', ?2) WHERE room = ?3 AND json_extract(pend_prev, '$.dept') = ?1").bind(name, to, ROOM),
      db.prepare("UPDATE ops SET blk = json_set(blk, '$.dept', ?2) WHERE room = ?3 AND json_extract(blk, '$.dept') = ?1").bind(name, to, ROOM),
      db.prepare("UPDATE ops SET pend_prev = json_set(pend_prev, '$.dept', ?2) WHERE room = ?3 AND json_extract(pend_prev, '$.dept') = ?1").bind(name, to, ROOM),
    ]);
  } else if (action === 'pin') {
    // 비밀번호를 바꾸거나 없애면 그 부서로 들어가 있던 기기는 다시 들어와야 한다 (토큰에 비밀번호 표시가 들어 있음)
    pin = str(pin).trim();
    await db.prepare('UPDATE depts SET pin_hash = ? WHERE room = ? AND name = ?').bind(pin ? await hashPin(pin) : null, ROOM, name).run();
  } else throw new Bad('무엇을 바꿀지 몰라요.');
  return { ok: true };
}

async function changeSettings(db, body) {
  if (typeof body.rules === 'string') {
    await db.prepare("INSERT INTO settings (room, key, value) VALUES (?, 'rules', ?) ON CONFLICT(room, key) DO UPDATE SET value = excluded.value")
      .bind(ROOM, body.rules.slice(0, 5000)).run();
  }
  let token;
  if (typeof body.adminPin === 'string') {
    if (body.adminPin.trim().length < 4) throw new Bad('4자리 이상으로 정해 주세요.');
    const h = await setAdminPin(db, body.adminPin.trim());
    token = await makeToken(db, { role: 'admin', pv: pinMark(h) }, ADMIN_HOURS * 3600000); // 바꾼 사람은 계속 관리자
  }
  return { ok: true, token };
}

/* ===== 들어가기 · 토큰 ===== */
// 토큰 = base64url(JSON {role, dept?, pv, exp}) + '.' + HMAC 서명
// pv = 그때 비밀번호 해시의 앞부분 → 비밀번호를 바꾸면 예전 토큰은 저절로 못 쓰게 된다
async function login(db, { dept, admin, pin }, request) {
  pin = str(pin).trim();
  const target = admin ? 'admin' : 'dept:' + str(dept);
  const key = target + '|' + (request.headers.get('CF-Connecting-IP') || '');
  await checkLock(db, key);
  if (admin) {
    const row = await db.prepare("SELECT value FROM settings WHERE room = ? AND key = 'admin_pin_hash'").bind(ROOM).first();
    let h = row && row.value;
    if (!h) { // 처음 들어온 사람이 관리자 비밀번호를 정한다
      if (pin.length < 4) throw new Bad('4자리 이상으로 정해 주세요.');
      h = await setAdminPin(db, pin);
    } else if (!(await checkPin(pin, h))) return slow(await failed(db, key, '비밀번호가 달라요.'));
    await clearFails(db, key);
    return json({ ok: true, role: 'admin', token: await makeToken(db, { role: 'admin', pv: pinMark(h) }, ADMIN_HOURS * 3600000) });
  }
  const d = await db.prepare('SELECT id, name, pin_hash FROM depts WHERE room = ? AND name = ?').bind(ROOM, str(dept)).first();
  if (!d) throw new Bad('없는 부서예요.', 404);
  if (d.pin_hash && !(await checkPin(pin, d.pin_hash))) return slow(await failed(db, key, '비밀번호가 달라요. 모르면 관리자에게 물어보세요.'));
  await clearFails(db, key);
  return json({ ok: true, role: 'dept', dept: d.name, token: await makeToken(db, { role: 'dept', id: d.id, pv: pinMark(d.pin_hash) }, DEPT_DAYS * 86400000) });
}

async function whoIs(db, request) {
  const h = request.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const p = await readToken(db, t);
  if (!p) return null;
  if (p.role === 'admin') {
    const row = await db.prepare("SELECT value FROM settings WHERE room = ? AND key = 'admin_pin_hash'").bind(ROOM).first();
    return row && pinMark(row.value) === p.pv ? { role: 'admin' } : null;
  }
  if (p.role === 'dept') {
    // 이름은 토큰이 아니라 지금 부서 목록에서 (이름을 바꿔도 그대로 쓸 수 있게)
    const d = await db.prepare('SELECT name, pin_hash FROM depts WHERE room = ? AND id = ?').bind(ROOM, p.id).first();
    return d && pinMark(d.pin_hash) === p.pv ? { role: 'dept', dept: d.name } : null;
  }
  return null;
}

const pinMark = (hash) => (hash ? String(hash).slice(-12) : '-');
async function secret(db) {
  let row = await db.prepare("SELECT value FROM settings WHERE room = ? AND key = 'token_secret'").bind(ROOM).first();
  if (!row) {
    await db.prepare("INSERT OR IGNORE INTO settings (room, key, value) VALUES (?, 'token_secret', ?)").bind(ROOM, hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    row = await db.prepare("SELECT value FROM settings WHERE room = ? AND key = 'token_secret'").bind(ROOM).first();
  }
  return row.value;
}
async function hmac(db, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await secret(db)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
async function makeToken(db, payload, ms) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Date.now() + ms })));
  return body + '.' + (await hmac(db, body));
}
async function readToken(db, t) {
  const [body, sig] = String(t || '').split('.');
  if (!body || !sig || !sameText(sig, await hmac(db, body))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// 비밀번호를 연속으로 틀리면 잠깐 막기 (부서·관리자마다, 접속한 곳마다)
async function checkLock(db, key) {
  const r = await db.prepare('SELECT n, until FROM login_fails WHERE key = ?').bind(key).first();
  if (r && r.until > Date.now()) {
    const min = Math.ceil((r.until - Date.now()) / 60000);
    throw new Bad(`비밀번호를 여러 번 틀려서 잠깐 막았어요. ${min}분 뒤에 다시 해 주세요.`, 429);
  }
}
async function failed(db, key, msg) {
  const r = await db.prepare('SELECT n, until FROM login_fails WHERE key = ?').bind(key).first();
  const n = (r && r.until && r.until <= Date.now() ? 0 : r ? r.n : 0) + 1;
  const until = n >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
  await db.prepare('INSERT INTO login_fails (key, n, until) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET n = excluded.n, until = excluded.until')
    .bind(key, until ? 0 : n, until).run();
  return json({ error: until ? '비밀번호를 여러 번 틀려서 5분 동안 막았어요.' : msg }, until ? 429 : 401);
}
async function clearFails(db, key) { await db.prepare('DELETE FROM login_fails WHERE key = ?').bind(key).run(); }

async function setAdminPin(db, pin) {
  const h = await hashPin(pin);
  await db.prepare("INSERT INTO settings (room, key, value) VALUES (?, 'admin_pin_hash', ?) ON CONFLICT(room, key) DO UPDATE SET value = excluded.value")
    .bind(ROOM, h).run();
  return h;
}

// 비밀번호는 salt + SHA-256 으로만 저장 ("salt$hash")
export async function hashPin(pin, salt) {
  salt = salt || hex(crypto.getRandomValues(new Uint8Array(16)));
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return salt + '$' + hex(new Uint8Array(h));
}
async function checkPin(pin, stored) {
  return sameText(await hashPin(pin, String(stored).split('$')[0]), String(stored));
}
const slow = (res) => new Promise((r) => setTimeout(() => r(res), 500)); // 마구 넣어보기 늦추기

/* ===== 공휴일 ===== */
// 특일 정보 API 를 달마다 받아 D1 에 저장해 두고 쓴다. 일주일마다 다시 확인 (임시공휴일 대비)
// 실패하면 저장된 값, 그것도 없으면 null → 화면의 기본 목록(2026~2027)
async function getHolidays(env, ym) {
  const db = env.DB;
  const fetched = await db.prepare('SELECT fetched_at FROM holiday_fetches WHERE ym = ?').bind(ym).first();
  if (env.HOLIDAY_API_KEY && (!fetched || Date.now() - fetched.fetched_at > HOLIDAY_REFRESH_MS)) {
    try { await refreshHolidays(env, ym); } catch (e) { console.warn('공휴일', ym, explainHolidayError(e)); }
  }
  const got = fetched || (await db.prepare('SELECT fetched_at FROM holiday_fetches WHERE ym = ?').bind(ym).first());
  if (!got) return null;
  const { results } = await db.prepare('SELECT date, name FROM holidays WHERE date LIKE ? ORDER BY date').bind(ym + '-%').all();
  return Object.fromEntries(results.map((r) => [r.date, r.name]));
}
async function refreshHolidays(env, ym) {
  // 지난달 공휴일도 받아야 달을 넘어가는 대체공휴일(예: 31일 토요일 → 다음 달 2일)을 알 수 있다
  const prev = shiftMonth(ym, -1);
  const [before, rows] = await Promise.all([fetchHolidayApi(env.HOLIDAY_API_KEY, prev), fetchHolidayApi(env.HOLIDAY_API_KEY, ym)]);
  const all = [...rows, ...substituteHolidays([...before, ...rows])].filter((r) => r.date.startsWith(ym));
  const byDate = new Map(); // 같은 날 겹친 공휴일은 이름을 합침 (예: 어린이날 · 부처님오신날)
  for (const r of all) {
    const names = byDate.get(r.date) || [];
    if (!names.includes(r.name)) names.push(r.name);
    byDate.set(r.date, names);
  }
  const db = env.DB;
  await db.batch([
    db.prepare('DELETE FROM holidays WHERE date LIKE ?').bind(ym + '-%'),
    ...[...byDate].map(([date, names]) => db.prepare('INSERT OR REPLACE INTO holidays (date, name) VALUES (?, ?)').bind(date, names.join(' · '))),
    db.prepare('INSERT OR REPLACE INTO holiday_fetches (ym, fetched_at) VALUES (?, ?)').bind(ym, Date.now()),
  ]);
}

/* ===== 도우미 ===== */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function ymOf(v) { if (!YM.test(String(v || ''))) throw new Bad('달이 이상해요.'); return v; }
function dayOf(v) {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(Date.parse(v))) throw new Bad('날짜가 이상해요.');
  return String(v);
}
function idOf(v) { if (!ID.test(String(v || ''))) throw new Bad('번호가 이상해요.'); return String(v); }
function str(v) { return v == null ? '' : String(v).slice(0, 500); }
function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function hex(a) { return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function b64u(a) { return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); }
function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function dup(e) { return /UNIQUE|constraint/i.test(String(e && e.message)) ? new Bad('이미 있는 번호예요.', 409) : e; }
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
}
