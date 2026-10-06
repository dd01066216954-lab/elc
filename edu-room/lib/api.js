// 4층 교육장 현황표 API — Cloudflare Pages Functions(functions/api/[[path]].js)에서 부른다.
// 화면 파일(public/)은 Pages가 그대로 내보내고, /api/* 만 여기서 처리한다.
//
// Cloudflare 화면에서 넣는 설정 (README 참고)
//   D1 바인딩   DB   (표는 lib/schema.js 가 처음에 저절로 만든다)

import { ensureSchema, ROOM } from './schema.js';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

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

  if (path === '/month' && method === 'GET') return json(await monthPayload(db, ymOf(url.searchParams.get('ym'))));
  if (path === '/login' && method === 'POST') return login(db, body);

  if (path === '/rows' && method === 'POST') { await putRow(db, ymOf(body.ym), body.row, true); return json({ ok: true }); }
  if ((m = path.match(/^\/rows\/([^/]+)$/))) {
    const id = idOf(decodeURIComponent(m[1]));
    if (method === 'PUT') { await putRow(db, null, { ...body.row, id }, false); return json({ ok: true }); }
    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM rows WHERE room = ? AND id = ?').bind(ROOM, id),
        db.prepare('DELETE FROM ops WHERE room = ? AND row_id = ?').bind(ROOM, id),
      ]);
      return json({ ok: true });
    }
  }
  if (path === '/ops' && method === 'POST') { await putOp(db, ymOf(body.ym), body.op, true); return json({ ok: true }); }
  if ((m = path.match(/^\/ops\/([^/]+)$/))) {
    const id = idOf(decodeURIComponent(m[1]));
    if (method === 'PUT') { await putOp(db, null, { ...body.op, id }, false); return json({ ok: true }); }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).run();
      return json({ ok: true });
    }
  }

  if (path === '/approve' && method === 'POST') return json(await approve(db, body));
  if (path === '/month/confirm' && method === 'POST') {
    const ym = ymOf(body.ym);
    await db.prepare('UPDATE months SET confirmed = ? WHERE room = ? AND ym = ?').bind(body.confirmed ? 1 : 0, ROOM, ym).run();
    return json(await monthPayload(db, ym));
  }
  if (path === '/month/clear' && method === 'POST') {
    const ym = ymOf(body.ym);
    await db.batch([
      db.prepare('DELETE FROM rows WHERE room = ? AND ym = ?').bind(ROOM, ym),
      db.prepare('DELETE FROM ops WHERE room = ? AND ym = ?').bind(ROOM, ym),
      db.prepare('UPDATE months SET confirmed = 0, imported_from = NULL, imported_n = NULL WHERE room = ? AND ym = ?').bind(ROOM, ym),
    ]);
    return json(await monthPayload(db, ym));
  }
  if (path === '/month/notice' && method === 'POST') {
    await db.prepare('UPDATE months SET imported_from = NULL, imported_n = NULL WHERE room = ? AND ym = ?').bind(ROOM, ymOf(body.ym)).run();
    return json({ ok: true });
  }
  if (path === '/depts' && method === 'PUT') return json(await changeDept(db, body));
  if (path === '/settings' && method === 'PUT') return json(await changeSettings(db, body));

  return json({ error: '없는 주소예요.' }, 404);
}

/* ===== 한 달 불러오기 ===== */
async function monthPayload(db, ym) {
  await ensureMonth(db, ym);
  const [mo, rows, ops, depts, settings, times] = await Promise.all([
    db.prepare('SELECT confirmed, imported_from, imported_n FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first(),
    db.prepare('SELECT * FROM rows WHERE room = ? AND ym = ? ORDER BY rowid').bind(ROOM, ym).all(),
    db.prepare('SELECT * FROM ops WHERE room = ? AND ym = ? ORDER BY rowid').bind(ROOM, ym).all(),
    db.prepare('SELECT name, color_idx, pin_hash FROM depts WHERE room = ? ORDER BY sort, id').bind(ROOM).all(),
    db.prepare("SELECT key, value FROM settings WHERE room = ? AND key IN ('rules', 'admin_pin_hash')").bind(ROOM).all(),
    // 이용시간 빠른 선택에 쓰는, 다른 달에 부서마다 쓴 시간
    db.prepare('SELECT dept, time, COUNT(*) AS n FROM rows WHERE room = ? AND ym <> ? AND time <> \'\' GROUP BY dept, time').bind(ROOM, ym).all(),
  ]);
  const set = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
  return {
    ym,
    confirmed: !!mo.confirmed,
    imported: mo.imported_from ? { from: mo.imported_from, n: mo.imported_n } : null,
    rows: rows.results.map(rowOut),
    ops: ops.results.map(opOut),
    depts: depts.results.map((d) => ({ name: d.name, ci: d.color_idx, hasPin: !!d.pin_hash })),
    rules: set.rules || '',
    adminSet: !!set.admin_pin_hash,
    times: times.results,
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

/* ===== 신청서 줄 / 그날만 바꾼 것 ===== */
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
function cleanRowPrev(p) {
  return { dept: str(p.dept), person: str(p.person), prog: str(p.prog), sel: cleanSel(p.sel), time: str(p.time), note: str(p.note), yieldOk: !!p.yieldOk };
}
function cleanBlk(b) {
  if (!b || typeof b !== 'object') throw new Bad('보낸 칸이 비어 있어요.');
  return { dept: str(b.dept), prog: str(b.prog), time: str(b.time), half: b.half === 'pm' ? 'pm' : 'am' };
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

function rowInsert(db, ym, r, now, ignore) {
  return db.prepare(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO rows
      (id, room, ym, dept, person, prog, sel, time, note, yield, pend_kind, pend_prev, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(r.id, ROOM, ym, r.dept, r.person, r.prog, JSON.stringify(r.sel), r.time, r.note, r.yieldOk ? 1 : 0,
      r.pend ? r.pend.kind : null, r.pend && r.pend.prev ? JSON.stringify(r.pend.prev) : null, now);
}

async function putRow(db, ym, raw, isNew) {
  const r = cleanRow(raw), now = Date.now();
  if (isNew) {
    await monthMustExist(db, ym);
    await rowInsert(db, ym, r, now, false).run().catch((e) => { throw dup(e); });
    return;
  }
  const res = await db.prepare(`UPDATE rows SET dept = ?, person = ?, prog = ?, sel = ?, time = ?, note = ?, yield = ?,
      pend_kind = ?, pend_prev = ?, updated_at = ? WHERE room = ? AND id = ?`)
    .bind(r.dept, r.person, r.prog, JSON.stringify(r.sel), r.time, r.note, r.yieldOk ? 1 : 0,
      r.pend ? r.pend.kind : null, r.pend && r.pend.prev ? JSON.stringify(r.pend.prev) : null, now, ROOM, r.id).run();
  if (changes(res) === 0) throw new Bad('그 줄은 이미 지워졌어요.', 404);
}

async function putOp(db, ym, raw, isNew) {
  if (!raw || typeof raw !== 'object') throw new Bad('보낸 칸이 비어 있어요.');
  const id = idOf(raw.id), now = Date.now();
  const pend = cleanPend(raw.pend, cleanBlk);
  if (isNew) {
    await monthMustExist(db, ym);
    const type = raw.type === 'remove' ? 'remove' : 'add';
    const d = Number(raw.d);
    if (!Number.isInteger(d) || d < 1 || d > 31) throw new Bad('날짜가 이상해요.');
    await db.prepare(`INSERT INTO ops (id, room, ym, d, type, row_id, blk, pend_kind, pend_prev, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ROOM, ym, d, type, type === 'remove' ? idOf(raw.rowId) : null, type === 'add' ? JSON.stringify(cleanBlk(raw.blk)) : null,
        pend ? pend.kind : null, pend && pend.prev ? JSON.stringify(pend.prev) : null, now)
      .run().catch((e) => { throw dup(e); });
    return;
  }
  // 고칠 수 있는 것: 칸 내용(add 만)과 승인 대기 표시
  const cur = await db.prepare('SELECT type FROM ops WHERE room = ? AND id = ?').bind(ROOM, id).first();
  if (!cur) throw new Bad('그 칸은 이미 지워졌어요.', 404);
  await db.prepare('UPDATE ops SET blk = ?, pend_kind = ?, pend_prev = ?, updated_at = ? WHERE room = ? AND id = ?')
    .bind(cur.type === 'add' ? JSON.stringify(cleanBlk(raw.blk)) : null,
      pend ? pend.kind : null, pend && pend.prev ? JSON.stringify(pend.prev) : null, now, ROOM, id).run();
}

async function monthMustExist(db, ym) {
  if (!(await db.prepare('SELECT 1 FROM months WHERE room = ? AND ym = ?').bind(ROOM, ym).first())) await ensureMonth(db, ym);
}

/* ===== 승인 / 반려 (시안의 decide 와 같은 규칙) ===== */
// 승인: new/edit → 확정, del → 삭제.  반려: new → 삭제, edit → 이전 값 복구, del → 그대로 둠
async function approve(db, { kind, id, ok }) {
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
    else if (k === 'edit' && r.pend.prev) {
      const p = r.pend.prev;
      await db.prepare(`UPDATE rows SET dept = ?, person = ?, prog = ?, sel = ?, time = ?, note = ?, yield = ?,
          pend_kind = NULL, pend_prev = NULL, updated_at = ? WHERE room = ? AND id = ?`)
        .bind(p.dept, p.person, p.prog, JSON.stringify(p.sel), p.time, p.note, p.yieldOk ? 1 : 0, now, ROOM, id).run();
    } else await clear();
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
  return monthPayload(db, ym);
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
  if (typeof body.adminPin === 'string') {
    if (body.adminPin.trim().length < 4) throw new Bad('4자리 이상으로 정해 주세요.');
    await setAdminPin(db, body.adminPin.trim());
  }
  return { ok: true };
}

/* ===== 들어가기 (비밀번호 확인) ===== */
// 1단계: 비밀번호가 맞는지만 확인. 2단계에서 토큰·권한 확인을 붙인다.
async function login(db, { dept, admin, pin }) {
  pin = str(pin).trim();
  if (admin) {
    const row = await db.prepare("SELECT value FROM settings WHERE room = ? AND key = 'admin_pin_hash'").bind(ROOM).first();
    if (!row) { // 처음 들어온 사람이 관리자 비밀번호를 정한다
      if (pin.length < 4) throw new Bad('4자리 이상으로 정해 주세요.');
      await setAdminPin(db, pin);
      return json({ ok: true, role: 'admin' });
    }
    if (!(await checkPin(pin, row.value))) return slow(json({ error: '비밀번호가 달라요.' }, 401));
    return json({ ok: true, role: 'admin' });
  }
  const d = await db.prepare('SELECT name, pin_hash FROM depts WHERE room = ? AND name = ?').bind(ROOM, str(dept)).first();
  if (!d) throw new Bad('없는 부서예요.', 404);
  if (d.pin_hash && !(await checkPin(pin, d.pin_hash))) return slow(json({ error: '비밀번호가 달라요. 모르면 관리자에게 물어보세요.' }, 401));
  return json({ ok: true, role: 'dept', dept: d.name });
}

async function setAdminPin(db, pin) {
  await db.prepare("INSERT INTO settings (room, key, value) VALUES (?, 'admin_pin_hash', ?) ON CONFLICT(room, key) DO UPDATE SET value = excluded.value")
    .bind(ROOM, await hashPin(pin)).run();
}

// 비밀번호는 salt + SHA-256 으로만 저장 ("salt$hash")
export async function hashPin(pin, salt) {
  salt = salt || hex(crypto.getRandomValues(new Uint8Array(16)));
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return salt + '$' + hex(new Uint8Array(h));
}
async function checkPin(pin, stored) {
  const salt = String(stored).split('$')[0];
  const a = await hashPin(pin, salt);
  let diff = a.length ^ stored.length;
  for (let i = 0; i < a.length && i < stored.length; i++) diff |= a.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
const slow = (res) => new Promise((r) => setTimeout(() => r(res), 500)); // 마구 넣어보기 늦추기

/* ===== 도우미 ===== */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function ymOf(v) { if (!YM.test(String(v || ''))) throw new Bad('달이 이상해요.'); return v; }
function idOf(v) { if (!ID.test(String(v || ''))) throw new Bad('번호가 이상해요.'); return String(v); }
function str(v) { return v == null ? '' : String(v).slice(0, 500); }
function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function hex(a) { return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function changes(res) { return res && res.meta ? res.meta.changes : res && 'changes' in res ? res.changes : 1; }
function dup(e) { return /UNIQUE|constraint/i.test(String(e && e.message)) ? new Bad('이미 있는 번호예요.', 409) : e; }
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
}
