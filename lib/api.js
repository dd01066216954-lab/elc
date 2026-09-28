// 월간 일정표 API — Cloudflare Pages Functions(functions/api/[[path]].js)에서 부른다.
// 화면 파일(public/)은 Pages가 그대로 내보내고, /api/* 만 여기서 처리한다.
//
// Cloudflare 화면에서 넣는 설정 (README 참고)
//   D1 바인딩   DB   (표는 lib/schema.js 가 처음에 저절로 만든다)
//   비밀 변수   APP_PASSWORD      동료들이 들어올 때 쓰는 비밀번호
//              HOLIDAY_API_KEY   공공데이터포털 특일 정보 서비스키 (없으면 공휴일 없이 동작)

import { ensureSchema } from './schema.js';
import { substituteHolidays } from './holidays.js';

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const HOLIDAY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 임시공휴일 대비 일주일마다 다시 확인
// 이 시각 전에 받아 둔 공휴일은 다시 받는다 (대체공휴일 계산을 넣기 전 캐시)
const HOLIDAY_LOGIC_SINCE = Date.parse('2026-09-28T06:55:00Z');
const HOLIDAY_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

export async function handleApi(request, env) {
  if (!env.DB) return json({ error: '데이터베이스(DB)가 연결되지 않았어요. 설정을 확인해 주세요.' }, 500);
  try {
    await ensureSchema(env.DB);
    return await route(request, env, new URL(request.url));
  } catch (e) {
    console.error(e);
    return json({ error: '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.' }, 500);
  }
}

async function route(request, env, url) {
  const path = url.pathname.slice(4); // '/api' 떼기
  const method = request.method;

  if (path === '/login' && method === 'POST') return login(request, env);
  if (path === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }
  if (!(await authed(request, env))) return json({ error: 'login' }, 401);

  let m;
  if (path === '/months' && method === 'GET') {
    // 저장된 달 목록 (월 선택판에 표시)
    const { results } = await env.DB.prepare('SELECT ym FROM months ORDER BY ym').all();
    return json({ months: results.map((r) => r.ym) });
  }
  if (path === '/settings') {
    if (method === 'GET') return getSettings(env);
    if (method === 'PUT') return putSettings(request, env);
  }
  if ((m = path.match(/^\/months\/(\d{4}-\d{2})\/versions$/)) && method === 'GET') return listVersions(env, m[1]);
  if ((m = path.match(/^\/months\/(\d{4}-\d{2})\/versions\/(\d+)\/restore$/)) && method === 'POST') {
    return restoreVersion(env, m[1], Number(m[2]));
  }
  if ((m = path.match(/^\/months\/(\d{4}-\d{2})$/))) {
    if (method === 'GET') return getMonth(env, m[1]);
    if (method === 'PUT') return putMonth(request, env, m[1]);
  }
  if (path === '/people') {
    if (method === 'GET') return getPeople(env);
    if (method === 'PUT') return putPeople(request, env);
  }
  if ((m = path.match(/^\/holidays\/(\d{4}-\d{2})$/)) && method === 'GET') return getHolidays(env, m[1]);
  if (path === '/custom-holidays') {
    if (method === 'GET') return getCustomHolidays(env);
    if (method === 'POST') return addCustomHoliday(request, env);
  }
  if ((m = path.match(/^\/custom-holidays\/(\d{4}-\d{2}-\d{2})$/)) && method === 'DELETE') {
    await env.DB.prepare("DELETE FROM holidays WHERE date = ? AND source = 'custom'").bind(m[1]).run();
    return json({ ok: true });
  }
  return json({ error: '없는 주소예요.' }, 404);
}

/* ===== 로그인 (비밀번호 하나) ===== */
async function login(request, env) {
  if (!env.APP_PASSWORD) return json({ error: '관리자가 아직 비밀번호를 정하지 않았어요.' }, 500);
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== 'string' || !(await sameText(password, env.APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 600)); // 마구 넣어보기 늦추기
    return json({ error: '비밀번호가 맞지 않아요.' }, 401);
  }
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const token = `${exp}.${await sign(env, String(exp))}`;
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function authed(request, env) {
  if (!env.APP_PASSWORD) return false;
  const c = (request.headers.get('Cookie') || '').split(/;\s*/).find((x) => x.startsWith(COOKIE + '='));
  if (!c) return false;
  const [exp, sig] = c.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameText(sig, await sign(env, exp));
}

// 비밀번호를 키로 서명 → 비밀번호를 바꾸면 기존 로그인이 모두 풀린다
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.APP_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sameText(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ===== 달 ===== */
async function getMonth(env, ym) {
  const row = await env.DB.prepare('SELECT data, updated_at FROM months WHERE ym = ?').bind(ym).first();
  if (!row) return json({ data: null, updatedAt: null });
  return json({ data: JSON.parse(row.data), updatedAt: row.updated_at });
}

// 마지막 저장 우선. 단, 내가 불러온 뒤 다른 사람이 저장했으면 409로 알리고
// 화면에서 '덮어쓰기'를 고르면 force로 다시 보낸다.
async function putMonth(request, env, ym) {
  const body = await request.json();
  if (!body || typeof body.data !== 'object') return json({ error: '보낸 내용이 비어 있어요.' }, 400);
  const row = await env.DB.prepare('SELECT data, updated_at FROM months WHERE ym = ?').bind(ym).first();
  if (row && !body.force && row.updated_at !== (body.baseUpdatedAt ?? null)) {
    return json({ conflict: true, data: JSON.parse(row.data), updatedAt: row.updated_at }, 409);
  }
  const now = Math.max(Date.now(), (row?.updated_at || 0) + 1);
  // 덮어쓰기 전 상태를 기록에 남김: 마지막 기록이 10분보다 오래됐거나, 다른 사람 것을 덮어쓸 때
  if (row) await keepVersion(env, ym, row.data, body.force ? 0 : VERSION_GAP_MS);
  await env.DB.prepare(
    'INSERT INTO months (ym, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(ym) DO UPDATE SET data = ?2, updated_at = ?3',
  ).bind(ym, JSON.stringify(body.data), now).run();
  return json({ ok: true, updatedAt: now });
}

/* ===== 기록 (예전 저장본) ===== */
const VERSION_GAP_MS = 10 * 60 * 1000;
const VERSION_KEEP = 40;

async function keepVersion(env, ym, data, gapMs) {
  if (gapMs > 0) {
    const last = await env.DB.prepare('SELECT saved_at FROM month_versions WHERE ym = ? ORDER BY saved_at DESC LIMIT 1').bind(ym).first();
    if (last && Date.now() - last.saved_at < gapMs) return;
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO month_versions (ym, data, saved_at) VALUES (?, ?, ?)').bind(ym, data, Date.now()),
    env.DB.prepare(`DELETE FROM month_versions WHERE ym = ?1 AND id NOT IN
      (SELECT id FROM month_versions WHERE ym = ?1 ORDER BY saved_at DESC, id DESC LIMIT ${VERSION_KEEP})`).bind(ym),
  ]);
}

async function listVersions(env, ym) {
  const { results } = await env.DB.prepare('SELECT id, data, saved_at FROM month_versions WHERE ym = ? ORDER BY saved_at DESC, id DESC').bind(ym).all();
  return json({
    versions: results.map((r) => {
      let filled = 0;
      try { filled = Object.values(JSON.parse(r.data).days || {}).filter((t) => String(t).trim()).length; } catch { /* 무시 */ }
      return { id: r.id, savedAt: r.saved_at, filledDays: filled };
    }),
  });
}

// 되돌리기: 지금 상태도 기록에 남긴 뒤 바꾸므로 되돌리기를 다시 되돌릴 수 있다
async function restoreVersion(env, ym, id) {
  const v = await env.DB.prepare('SELECT data FROM month_versions WHERE ym = ? AND id = ?').bind(ym, id).first();
  if (!v) return json({ error: '그 기록을 찾지 못했어요.' }, 404);
  const row = await env.DB.prepare('SELECT data, updated_at FROM months WHERE ym = ?').bind(ym).first();
  if (row) await keepVersion(env, ym, row.data, 0);
  const now = Math.max(Date.now(), (row?.updated_at || 0) + 1);
  await env.DB.prepare(
    'INSERT INTO months (ym, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(ym) DO UPDATE SET data = ?2, updated_at = ?3',
  ).bind(ym, v.data, now).run();
  return json({ ok: true, data: JSON.parse(v.data), updatedAt: now });
}

/* ===== 설정 (반 나누기) ===== */
async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('tag_groups', 'snippets', 'snippets_version')").all();
  const get = (k) => { const r = results.find((x) => x.key === k); return r ? JSON.parse(r.value) : null; };
  // null이면 화면의 처음 값 사용
  return json({ tagGroups: get('tag_groups'), snippets: get('snippets'), snippetsVersion: get('snippets_version') || 1 });
}

async function putSettings(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || (!Array.isArray(body.tagGroups) && !Array.isArray(body.snippets))) return json({ error: '보낸 내용이 비어 있어요.' }, 400);
  const stmts = [];
  const put = (key, value) => stmts.push(env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, JSON.stringify(value)));
  if (Array.isArray(body.tagGroups)) {
    put('tag_groups', body.tagGroups.slice(0, 30).map((g) => ({
      name: String((g && g.name) || '').trim().slice(0, 20),
      tags: (Array.isArray(g && g.tags) ? g.tags : []).map((t) => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 30),
    })));
  }
  if (Array.isArray(body.snippets)) {
    put('snippets', body.snippets.slice(0, 80).map((x) => ({
      kind: ['work', 'activity', 'place'].includes(x && x.kind) ? x.kind : 'activity',
      color: ['blue', 'red'].includes(x && x.color) ? x.color : '',
      name: String((x && x.name) || '').trim().slice(0, 20),
      text: String((x && x.text) || '').slice(0, 2000),
    })).filter((x) => x.name || x.text.trim()));
    if (Number.isInteger(body.snippetsVersion)) put('snippets_version', body.snippetsVersion);
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

/* ===== 참여자 ===== */
const personRow = (r) => ({ name: r.name, tags: r.tags ? r.tags.split(',') : [], paused: !!r.paused });
async function getPeople(env) {
  const { results } = await env.DB.prepare('SELECT name, tags, paused FROM people ORDER BY sort, id').all();
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'people_updated_at'").first();
  return json({
    people: results.map(personRow),
    updatedAt: meta ? Number(meta.value) : null,
  });
}

// 표 전체를 통째로 저장 (21명 정도라 이게 제일 단순하고 안전)
async function putPeople(request, env) {
  const body = await request.json();
  if (!body || !Array.isArray(body.people)) return json({ error: '보낸 내용이 비어 있어요.' }, 400);
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'people_updated_at'").first();
  const current = meta ? Number(meta.value) : null;
  if (!body.force && current !== (body.baseUpdatedAt ?? null)) {
    const { results } = await env.DB.prepare('SELECT name, tags, paused FROM people ORDER BY sort, id').all();
    return json({
      conflict: true,
      people: results.map(personRow),
      updatedAt: current,
    }, 409);
  }
  const people = body.people
    .map((p) => ({
      name: String(p.name || '').trim().slice(0, 50),
      tags: (Array.isArray(p.tags) ? p.tags : []).map((t) => String(t).trim().replace(/,/g, '')).filter(Boolean).slice(0, 20),
      paused: !!p.paused,
    }))
    .filter((p) => p.name)
    .slice(0, 500);
  const now = Math.max(Date.now(), (current || 0) + 1);
  const stmts = [env.DB.prepare('DELETE FROM people')];
  people.forEach((p, i) => {
    stmts.push(env.DB.prepare('INSERT INTO people (name, tags, sort, paused) VALUES (?, ?, ?, ?)').bind(p.name, p.tags.join(','), i, p.paused ? 1 : 0));
  });
  stmts.push(env.DB.prepare("INSERT INTO meta (key, value) VALUES ('people_updated_at', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(String(now)));
  await env.DB.batch(stmts);
  return json({ ok: true, updatedAt: now });
}

/* ===== 공휴일 ===== */
async function getHolidays(env, ym) {
  let warning = null;
  const fetched = await env.DB.prepare('SELECT fetched_at FROM holiday_fetches WHERE ym = ?').bind(ym).first();
  if (!fetched || fetched.fetched_at < HOLIDAY_LOGIC_SINCE || Date.now() - fetched.fetched_at > HOLIDAY_REFRESH_MS) {
    try {
      await refreshHolidays(env, ym);
    } catch (e) {
      console.warn('holiday api', ym, e && e.message);
      // 예전에 받아 둔 게 있으면 그걸 쓰고 조용히 넘어감
      if (!fetched) warning = `공휴일 정보를 불러오지 못했어요. ${explainHolidayError(e)}`;
    }
  }
  const { results } = await env.DB.prepare(
    "SELECT date, name, source FROM holidays WHERE date LIKE ? ORDER BY date, source DESC",
  ).bind(ym + '-%').all();
  const holidays = {};
  for (const r of results) {
    // 같은 날 둘 다 있으면 이름을 합침 (예: 추석 · 기관 휴무)
    holidays[r.date] = holidays[r.date] && holidays[r.date] !== r.name ? `${holidays[r.date]} · ${r.name}` : r.name;
  }
  return json({ holidays, warning });
}

async function refreshHolidays(env, ym) {
  const key = env.HOLIDAY_API_KEY;
  if (!key) throw new Error('HOLIDAY_API_KEY 없음');
  // 지난달 공휴일도 받아야 달을 넘어가는 대체공휴일(예: 31일 토요일 → 다음 달 2일)을 알 수 있다
  const [y, m] = ym.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const [before, rows] = await Promise.all([fetchHolidayApi(key, prev), fetchHolidayApi(key, ym)]);
  const all = [...rows, ...substituteHolidays([...before, ...rows])].filter((r) => r.date.startsWith(ym));

  // 같은 날 겹친 공휴일은 이름을 합침 (예: 어린이날 · 부처님오신날)
  const byDate = new Map();
  for (const r of all) {
    const names = byDate.get(r.date) || [];
    if (!names.includes(r.name)) names.push(r.name);
    byDate.set(r.date, names);
  }
  const stmts = [env.DB.prepare("DELETE FROM holidays WHERE source = 'api' AND date LIKE ?").bind(ym + '-%')];
  for (const [date, names] of byDate) {
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO holidays (date, name, source) VALUES (?, ?, 'api')").bind(date, names.join(' · ')));
  }
  stmts.push(env.DB.prepare('INSERT OR REPLACE INTO holiday_fetches (ym, fetched_at) VALUES (?, ?)').bind(ym, Date.now()));
  await env.DB.batch(stmts);
}

async function fetchHolidayApi(key, ym) {
  const [y, m] = ym.split('-');
  // 공공데이터포털 키는 '인코딩'/'디코딩' 두 가지가 있다. 이미 %가 들어 있으면 인코딩 키이므로 그대로 붙인다.
  const k = key.includes('%') ? key : encodeURIComponent(key);
  const url = `${HOLIDAY_URL}?ServiceKey=${k}&solYear=${y}&solMonth=${m}&_type=json&numOfRows=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseHolidayResponse(text);
}

// 특일 정보 응답(JSON) → [{ date: 'YYYY-MM-DD', name }]
// 공휴일이 하나면 item 이 배열이 아니라 객체로, 없으면 items 가 빈 문자열로 온다.
// 키가 틀리면 _type=json 이어도 XML 오류가 오므로 JSON이 아니면 실패로 본다.
export function parseHolidayResponse(text) {
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('JSON 아님: ' + String(text).slice(0, 200)); }
  const header = body?.response?.header;
  if (!header || String(header.resultCode) !== '00') throw new Error('결과 코드 ' + (header && header.resultCode));
  let items = body.response.body?.items?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items
    .filter((it) => it && it.isHoliday === 'Y' && it.locdate)
    .map((it) => {
      const s = String(it.locdate);
      return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, name: String(it.dateName || '공휴일').trim() };
    });
}

// 공휴일 API 실패 이유를 알아듣기 쉬운 말로 (화면의 「공휴일 정보 없음」을 누르면 보임)
export function explainHolidayError(e) {
  const msg = String((e && e.message) || e);
  if (msg.includes('HOLIDAY_API_KEY 없음')) return 'Cloudflare 설정에 HOLIDAY_API_KEY가 없어요. 넣은 뒤 다시 배포해 주세요.';
  if (/SERVICE_KEY_IS_NOT_REGISTERED|코드 30\b|<returnReasonCode>30</.test(msg)) {
    return '서비스키가 아직 등록되지 않았어요. 발급 직후라면 1~2시간 뒤 다시 해 보시고, 계속되면 키를 다시 복사해 넣어 주세요.';
  }
  if (/SERVICE_ACCESS_DENIED|코드 20\b|<returnReasonCode>20</.test(msg)) return '이 서비스키로 「특일 정보」를 쓸 권한이 없어요. 공공데이터포털에서 활용신청이 승인됐는지 확인해 주세요.';
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|코드 22\b|<returnReasonCode>22</.test(msg)) return '오늘 쓸 수 있는 호출 횟수를 넘었어요. 내일 다시 됩니다.';
  if (/HTTP 5\d\d|fetch failed|network|timed? ?out/i.test(msg)) return '공공데이터포털 서버에 연결이 안 돼요. 잠시 뒤 다시 해 보세요.';
  return `(자세한 이유: ${msg.slice(0, 160)})`;
}

async function getCustomHolidays(env) {
  const { results } = await env.DB.prepare("SELECT date, name FROM holidays WHERE source = 'custom' ORDER BY date").all();
  return json({ holidays: results });
}

async function addCustomHoliday(request, env) {
  const { date, name } = await request.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !String(name || '').trim()) {
    return json({ error: '날짜와 이름을 모두 넣어 주세요.' }, 400);
  }
  await env.DB.prepare("INSERT OR REPLACE INTO holidays (date, name, source) VALUES (?, ?, 'custom')")
    .bind(date, String(name).trim().slice(0, 30)).run();
  return json({ ok: true });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
