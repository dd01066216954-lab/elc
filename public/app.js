'use strict';
/* global TAG_GROUPS, DEFAULT_TAG_GROUPS, DEFAULT_SNIPPETS, guessSnippetName, isWorkLine, applyWork, hasBlock, toggleActivity, splitSnippets, recolorLine, lineColorName, cellLines, coloredSnippet, setTagGroups, parsePeopleText, clearHolidayDays, workSummary, formatHours, dayHoursRange, lineIndex, suggestLines, countMatches, pad, ymKey, daysIn, weekday, shiftMonth, parseLine, printedText, lineFor,
   textFor, splitTags, usedTags, makeMonth, normalizeMonth */

// 편집 화면에서 꼬리표 줄 배경색 (인쇄에는 안 나옴) — 반 나누기에 적힌 순서대로
const TAG_PALETTE = ['#e3f4e1', '#fff1c7', '#e0ebfb', '#fbe3ec', '#efe6fa', '#dff2f4', '#fbecdc', '#e9f0d8', '#f6e3f7', '#e2eef0'];
const TAG_COLOR_OTHER = '#eeeeee';
function tagColor(tag) {
  const i = TAG_GROUPS.flat().indexOf(tag);
  return i < 0 ? TAG_COLOR_OTHER : TAG_PALETTE[i % TAG_PALETTE.length];
}

const BASE_FONT = 11;   // 칸 기본 글자 크기(px)
const MIN_FONT = 6.5;   // 넘칠 때 줄일 수 있는 최소 크기
const SAVE_DELAY = 1000;
const POLL_MS = 30000;

/* ===== 상태 ===== */
const today = new Date();
const state = {
  view: 'calendar',      // 'login' | 'calendar' | 'people'
  booted: false,
  y: today.getFullYear(),
  m: today.getMonth() + 1,
  months: {},            // 'YYYY-MM' → { data, updatedAt, pending, saving, again, error, timer }
  holidays: {},          // 'YYYY-MM-DD' → 이름
  holidayLoaded: {},     // 'YYYY-MM' → true
  holidayWarn: '',
  people: [],            // [{ name, tags[] }]
  peopleRows: [],        // 참여자 표 입력칸 [{ name, tags(글자) }]
  peopleSync: { updatedAt: null, pending: false, saving: false, again: false, error: false, timer: 0 },
  preview: '',           // 미리보기 대상 번호 ('' = 고치기)
  pick: null,            // { mode:'move'|'swap', from:d }
  editing: null,
  conflict: null,        // { kind:'month'|'people', ym?, server }
  noticeShown: {},
  savedMonths: new Set(), // 서버에 저장된 달
  tagGroups: DEFAULT_TAG_GROUPS.map((g) => ({ name: g.name, tags: [...g.tags] })),
  settingsSync: { pending: false, saving: false, again: false, error: false, timer: 0 },
  tab: 'people',
  pendingImport: null,
  groupRows: [],        // 반 나누기 입력칸 [{ name, tags(글자) }]
  pickerYear: 0,
  snippets: DEFAULT_SNIPPETS.map((x) => ({ ...x })), // 자주 쓰는 일정
  stamp: null,          // 버튼부터 눌렀을 때 { i, before, days[] }
  loadToken: 0,
  lastSaved: null,
};

const $ = (id) => document.getElementById(id);
const curKey = () => ymKey(state.y, state.m);
const cur = () => state.months[curKey()] && state.months[curKey()].data;
const activePeople = () => state.people.filter((p) => !p.paused);
const previewPerson = () => (state.preview === '' ? null : state.people[+state.preview] || null);
const holidayName = (y, m, d) => state.holidays[`${y}-${pad(m)}-${pad(d)}`] || '';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ===== 서버 ===== */
class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw new ApiError('인터넷 연결을 확인해 주세요.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new ApiError('다시 들어와 주세요.', 401, data);
  }
  if (!res.ok && res.status !== 409) throw new ApiError((data && data.error) || '서버와 연결이 잘 안 돼요.', res.status, data);
  return { status: res.status, data };
}

/* ===== 여러 줄 텍스트 → HTML =====
   edit   : 고치는 화면. 꼬리표는 작은 딱지로 짧게, 배경색
   raw    : 칸을 고치는 중. 원문 그대로 — 입력칸과 글자 위치가 정확히 겹쳐야 함
   person : 그 사람에게 들어가는 줄만, 꼬리표·'!' 제거
   full   : 모든 줄, 꼬리표는 글자로 남기고 '!'만 제거 (담당자용 전체 버전) */
function linesHTML(text, mode, person) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    const p = parseLine(raw);
    if (mode === 'raw' || mode === 'edit') {
      const bg = p.tags.length ? ` tagged" style="background:${tagColor(p.tags[0])}` : '';
      let body;
      if (!p.head) body = mode === 'raw' ? esc(p.rest) : esc(printedText(p));
      else if (mode === 'raw') body = `<span class="tg">${esc(p.head)}</span>${esc(p.rest)}`; // 입력칸과 글자 위치가 겹쳐야 함
      else body = p.tags.map((t) => `<span class="tgc">${esc(t)}</span>`).join('') + esc(printedText(p)); // 짧게, 색 표시(! ^) 숨김
      out.push(`<div class="ln ${p.color}${bg}">${body || '<br>'}</div>`);
    } else if (mode === 'full') {
      const t = printedText(p);
      const head = p.head ? `<span class="tg">${esc(p.head.trim())} </span>` : '';
      out.push(`<div class="ln ${p.color}">${head}${t ? esc(t) : (head ? '' : '<br>')}</div>`);
    } else if (lineFor(p, person)) {
      const t = printedText(p);
      out.push(`<div class="ln ${p.color}">${t ? esc(t) : '<br>'}</div>`);
    }
  }
  return out.join('');
}
// 시간 안내 줄은 한 줄짜리 글상자라 색 표시를 못 넣음 → 예전처럼 * 나 → 로 시작하면 파랑
const lineColor = (text) => (/^\s*[*→]/.test(text || '') ? 'blue' : '');

/* ===== 종이 한 장 그리기 ===== */
function sheetHTML(ym, mo, mode, person) {
  const [y, m] = ym.split('-').map(Number);
  const edit = mode === 'edit';
  const ce = edit ? contentEditableValue() : 'false';
  const ed = edit ? ' editable' : '';
  const first = weekday(y, m, 1);
  const total = daysIn(y, m);
  const weeks = Math.ceil((first + total) / 7);

  let name;
  if (mode === 'person') name = `<b>${esc(person.name)}</b>`;
  else if (mode === 'full') name = '<b>전체</b>';
  else name = '<span class="blank">사람마다 자동</span>';

  let html = `<div class="s-top">
      <div class="s-title${ed}" data-field="title" contenteditable="${ce}" spellcheck="false">${esc(mo.title)}</div>
      <div class="s-name">성명: ${name}</div>
    </div>
    <div class="s-guide ln ${lineColor(mo.guide)}${ed}" data-field="guide" contenteditable="${ce}" spellcheck="false">${esc(mo.guide)}</div>`;

  html += `<div class="cal" style="grid-template-rows: 7mm repeat(${weeks}, minmax(0, 1fr))">`;
  mo.headers.forEach((h, i) => {
    html += `<div class="hd ${i === 0 ? 'c-sun' : i === 6 ? 'c-sat' : ''}${ed}" data-field="header" data-i="${i}" contenteditable="${ce}" spellcheck="false">${esc(h)}</div>`;
  });
  for (let i = 0; i < weeks * 7; i++) {
    const d = i - first + 1;
    const w = i % 7;
    const cls = ['cell', w === 0 ? 'c-sun' : w === 6 ? 'c-sat' : ''];
    if (i >= (weeks - 1) * 7) cls.push('lastrow');
    if (d < 1 || d > total) {
      cls.push('out');
      html += `<div class="${cls.join(' ')}"></div>`;
      continue;
    }
    const hn = holidayName(y, m, d);
    cls.push('in');
    // 토·일요일에 (그 사람에게) 들어갈 일정이 없으면 빗금
    const shown = mode === 'person' ? textFor(mo.days[d], person) : (mo.days[d] || '');
    if ((w === 0 || w === 6) && !shown.trim()) cls.push('hatch');
    if (hn) cls.push('holiday');
    if (edit) cls.push('editable');
    const drag = edit && (mo.days[d] || '').trim() ? ' draggable="true"' : '';
    html += `<div class="${cls.join(' ')}" data-day="${d}"${drag}>
        <div class="cell-head"><span class="dnum">${d}</span>${hn ? `<span class="hname">${esc(hn)}</span>` : ''}${edit ? `<span class="wh">${dayHoursLabel(mo.days[d])}</span>` : ''}</div>
        <div class="cell-body"><div class="lines">${linesHTML(mo.days[d], mode, person)}</div></div>
      </div>`;
  }
  html += '</div>';

  let mine = '';
  let roster = '';
  if (mode === 'full') {
    const text = usedTags(activePeople()).map((t) => {
      const names = activePeople().filter((p) => p.tags.includes(t)).map((p) => p.name);
      return `*${t}: ${names.join(', ')} (${names.length}명)`;
    }).join('\n');
    if (text) roster = `<div class="s-roster"><div class="lines">${linesHTML(text, 'person', null)}</div></div>`;
  }
  html += `<div class="s-foot">
      <div class="s-notes${ed}" data-field="notes"><div class="lines">${linesHTML(mo.notes, mode === 'edit' ? 'edit' : 'person', person)}</div></div>
      ${roster}${mine}
    </div>`;
  return html;
}

// 칸 오른쪽 위 작은 근무시간 (인쇄에는 안 나옴)
function dayHoursLabel(text) {
  const r = dayHoursRange(text || '', activePeople());
  if (!r) return '';
  return r.min === r.max ? formatHours(r.max) : `${formatHours(r.min).replace('시간', '')}~${formatHours(r.max)}`;
}

// 위쪽 「근무시간」 버튼에 이번 달 합계 (고칠 때마다 바로 바뀜)
function updateHoursChip() {
  const btn = $('hoursBtn');
  const mo = cur();
  const people = activePeople();
  if (!mo || !people.length) { btn.textContent = '근무시간'; return; }
  const sums = people.map((p) => workSummary(mo, p).hours);
  const min = Math.min(...sums), max = Math.max(...sums);
  btn.textContent = `근무시간 · ${min === max ? formatHours(max) : `${formatHours(min).replace('시간', '')}~${formatHours(max)}`}`;
  btn.title = '사람마다 받는 줄이 달라 시간이 다를 수 있어요. 눌러서 사람별로 보기';
  if (!$('hoursPanel').hidden) renderHours();
}

function render() {
  const mo = cur();
  $('monthLabel').textContent = `${state.y}년 ${state.m}월 ▾`;
  if (!mo) return;
  const person = previewPerson();
  const sheet = $('sheet');
  sheet.innerHTML = sheetHTML(curKey(), mo, person ? 'person' : 'edit', person);
  sheet.classList.toggle('picking', !!state.pick);
  fitAll(sheet);
  renderBanner();
  updateHoursChip();
}

function fit(box) {
  const lines = box.querySelector('.lines');
  if (!lines) return;
  let fs = BASE_FONT;
  box.style.fontSize = fs + 'px';
  while (fs > MIN_FONT && lines.scrollHeight > box.clientHeight + 0.5) {
    fs -= 0.5;
    box.style.fontSize = fs + 'px';
  }
  const cell = box.closest('.cell');
  if (cell) cell.classList.toggle('overflow', lines.scrollHeight > box.clientHeight + 0.5);
}
function fitAll(root) {
  root.querySelectorAll('.cell-body, .s-notes, .s-roster').forEach(fit);
}

function fitZoom() {
  const paperPx = 297 * 96 / 25.4;
  const avail = document.documentElement.clientWidth - 32;
  $('sheetWrap').style.zoom = Math.max(0.3, Math.min(1.3, avail / paperPx));
  document.documentElement.style.setProperty('--bar-h', document.querySelector('.bar').offsetHeight + 'px');
  positionTools();
}

let _ce;
function contentEditableValue() {
  if (_ce) return _ce;
  const d = document.createElement('div');
  try { d.contentEditable = 'plaintext-only'; } catch (e) { /* 지원 안 함 */ }
  _ce = d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  return _ce;
}

/* ===== 달 불러오기 · 새 달 만들기 ===== */
async function loadHolidays(y, m) {
  const ym = ymKey(y, m);
  if (state.holidayLoaded[ym]) return;
  try {
    const { data } = await api('/holidays/' + ym);
    for (const k of Object.keys(state.holidays)) if (k.startsWith(ym)) delete state.holidays[k];
    Object.assign(state.holidays, data.holidays || {});
    if (!data.warning) state.holidayLoaded[ym] = true; // 실패했으면 다음에 다시 시도
    setHolidayWarn(data.warning || '');
  } catch (e) {
    if (e.status === 401) throw e;
    setHolidayWarn('공휴일 정보를 불러오지 못했어요. 공휴일이 빠져 있을 수 있어요.');
  }
}
function setHolidayWarn(text) {
  state.holidayWarn = text;
  const el = $('holidayWarn');
  el.hidden = !text;
  el.title = text;
}

async function fetchMonth(ym) {
  const { data } = await api('/months/' + ym);
  return data; // { data, updatedAt }
}

// 새 달을 채울 때 쓸 달: 지난달, 없으면 저장된 달 중 가장 가까운 이전 달
async function findSourceMonth(y, m) {
  const [py, pm] = shiftMonth(y, m, -1);
  const pym = ymKey(py, pm);
  if (state.months[pym]) return [py, pm];
  await loadSavedMonths();
  const earlier = [...state.savedMonths].filter((k) => k < ymKey(y, m)).sort().pop();
  if (!earlier) return null;
  const [ey, em] = earlier.split('-').map(Number);
  if (!state.months[earlier]) {
    const r = await fetchMonth(earlier);
    if (!r.data) return null;
    state.months[earlier] = { data: normalizeMonth(r.data, em), updatedAt: r.updatedAt };
  }
  return [ey, em];
}

async function loadSavedMonths() {
  try {
    const { data } = await api('/months');
    state.savedMonths = new Set(data.months);
  } catch (e) { if (e.status === 401) throw e; }
}

// 새로 공휴일이 된 날(예: 나중에 넣은 기관 휴무일, 늦게 발표된 대체공휴일)의 일정 비우기
function applyHolidays(ym) {
  const e = state.months[ym];
  if (!e) return;
  const days = Object.keys(state.holidays).filter((k) => k.startsWith(ym + '-')).map((k) => +k.slice(8));
  const { changed, cleared } = clearHolidayDays(e.data, days);
  if (!changed) return;
  const gone = Object.keys(cleared);
  // 아직 저장 안 한 새 달이고 지운 것도 없으면 저장할 필요 없음
  if (e.updatedAt !== null || gone.length) markDirty(ym);
  if (!gone.length) return;
  const m = +ym.slice(5);
  const list = gone.sort((a, b) => a - b).map((d) => `${m}월 ${d}일(${state.holidays[`${ym}-${pad(d)}`]})`).join(', ');
  showNotice(`공휴일이 된 ${list} 일정을 지웠어요.`, [
    { label: '확인', fn: hideNotice },
    { label: '되돌리기', fn: () => { Object.assign(e.data.days, cleared); markDirty(ym); hideNotice(); if (ym === curKey()) render(); } },
  ]);
}

async function openMonth(y, m) {
  const token = ++state.loadToken;
  stopEdit();
  cancelPick();
  if (state.stamp) endStamp();
  state.y = y;
  state.m = m;
  try { localStorage.setItem('lastMonth', ymKey(y, m)); } catch (e) { /* 무시 */ }
  $('monthLabel').textContent = `${y}년 ${m}월 ▾`;
  const ym = ymKey(y, m);
  let copied = false;
  document.body.classList.add('loading');
  try {
    await loadHolidays(y, m);
    if (!state.months[ym]) {
      const r = await fetchMonth(ym);
      if (token !== state.loadToken) return;
      if (r.data) {
        state.months[ym] = { data: normalizeMonth(r.data, m), updatedAt: r.updatedAt };
      } else {
        const src = await findSourceMonth(y, m);
        if (token !== state.loadToken) return;
        if (src) await loadHolidays(src[0], src[1]);
        if (token !== state.loadToken) return;
        const prev = src && state.months[ymKey(src[0], src[1])].data;
        // 아직 저장하지 않음 — 처음 고칠 때 저장된다
        state.months[ym] = { data: makeMonth(y, m, prev, holidayName, src), updatedAt: null };
        copied = src;
      }
    }
  } catch (e) {
    if (token !== state.loadToken || e.status === 401) return;
    document.body.classList.remove('loading');
    showNotice(`${m}월 일정표를 불러오지 못했어요. ${e.message}`, [{ label: '다시 시도', fn: () => { hideNotice(); openMonth(y, m); } }]);
    return;
  }
  if (token !== state.loadToken) return;
  document.body.classList.remove('loading');
  if (!state.conflict) hideNotice();
  applyHolidays(ym);
  render();
  if (copied && !state.noticeShown[ym]) {
    state.noticeShown[ym] = true;
    const [py, pm] = shiftMonth(y, m, -1);
    const base = copied[0] === py && copied[1] === pm ? '지난달' : `${copied[0] !== y ? copied[0] + '년 ' : ''}${copied[1]}월`;
    showNotice(`${base} 기준으로 채웠어요. 바뀐 날만 고치세요.`, [{ label: '확인', fn: hideNotice }]);
  }
}

/* ===== 자동 저장 ===== */
function markDirty(ym = curKey()) {
  const e = state.months[ym];
  if (!e) return;
  e.pending = true;
  clearTimeout(e.timer);
  e.timer = setTimeout(() => saveMonth(ym), SAVE_DELAY);
  updateSaveState();
}

async function saveMonth(ym, force = false) {
  const e = state.months[ym];
  if (!e) return;
  if (state.conflict && !force) return;
  if (e.saving) { e.again = true; return; }
  clearTimeout(e.timer);
  e.saving = true;
  e.pending = false;
  updateSaveState();
  try {
    const r = await api('/months/' + ym, { method: 'PUT', body: { data: e.data, baseUpdatedAt: e.updatedAt, force } });
    if (r.status === 409) {
      e.pending = true;
      state.conflict = { kind: 'month', ym, server: r.data };
      showConflict();
    } else {
      e.updatedAt = r.data.updatedAt;
      e.error = false;
      state.lastSaved = new Date();
      state.savedMonths.add(ym);
    }
  } catch (err) {
    e.pending = true;
    e.error = true;
    if (err.status !== 401) e.timer = setTimeout(() => saveMonth(ym), 5000);
  } finally {
    e.saving = false;
    if (e.again) {
      e.again = false;
      if (!state.conflict) saveMonth(ym);
    }
    updateSaveState();
  }
}

function markPeopleDirty() {
  const s = state.peopleSync;
  s.pending = true;
  clearTimeout(s.timer);
  s.timer = setTimeout(savePeople, SAVE_DELAY);
  updateSaveState();
}

async function savePeople(force = false) {
  const s = state.peopleSync;
  if (state.conflict && !force) return;
  if (s.saving) { s.again = true; return; }
  clearTimeout(s.timer);
  s.saving = true;
  s.pending = false;
  updateSaveState();
  try {
    const r = await api('/people', { method: 'PUT', body: { people: state.people, baseUpdatedAt: s.updatedAt, force } });
    if (r.status === 409) {
      s.pending = true;
      state.conflict = { kind: 'people', server: r.data };
      showConflict();
    } else {
      s.updatedAt = r.data.updatedAt;
      s.error = false;
      state.lastSaved = new Date();
    }
  } catch (err) {
    s.pending = true;
    s.error = true;
    if (err.status !== 401) s.timer = setTimeout(savePeople, 5000);
  } finally {
    s.saving = false;
    if (s.again) {
      s.again = false;
      if (!state.conflict) savePeople();
    }
    updateSaveState();
  }
}

function syncs() { return [...Object.values(state.months), state.peopleSync, state.settingsSync]; }
function hasUnsaved() { return syncs().some((e) => e.pending || e.saving); }

function updateSaveState() {
  const el = $('saveState');
  const all = syncs();
  let text, kind;
  if (state.conflict) { text = '저장 멈춤 · 위 안내를 봐 주세요'; kind = 'bad'; }
  else if (all.some((e) => e.error)) { text = '저장 안 됨 · 다시 시도하는 중'; kind = 'bad'; }
  else if (all.some((e) => e.saving)) { text = '저장 중…'; kind = 'busy'; }
  else if (all.some((e) => e.pending)) { text = '저장 안 됨'; kind = 'busy'; }
  else {
    const t = state.lastSaved;
    text = t ? `저장됨 ${t.getHours() < 12 ? '오전' : '오후'} ${(t.getHours() % 12) || 12}:${pad(t.getMinutes())}` : '저장됨';
    kind = 'ok';
  }
  el.textContent = text;
  el.dataset.kind = kind;
}

function showConflict() {
  const c = state.conflict;
  const what = c.kind === 'people' ? '참여자 표를' : `${+c.ym.slice(5)}월 일정표를`;
  showNotice(`다른 컴퓨터에서 방금 ${what} 고쳤어요. 어느 쪽을 남길까요?`, [
    { label: '다른 분 것 불러오기', fn: () => resolveConflict(false) },
    { label: '내 것으로 덮어쓰기', fn: () => resolveConflict(true) },
  ]);
  updateSaveState();
}

function resolveConflict(keepMine) {
  const c = state.conflict;
  if (!c) return;
  state.conflict = null;
  hideNotice();
  if (c.kind === 'month') {
    const e = state.months[c.ym];
    if (keepMine) {
      e.updatedAt = c.server.updatedAt;
      saveMonth(c.ym, true);
    } else {
      e.data = normalizeMonth(c.server.data, +c.ym.slice(5));
      e.updatedAt = c.server.updatedAt;
      e.pending = false;
      e.error = false;
      if (c.ym === curKey()) { stopEdit(); render(); }
    }
  } else {
    const s = state.peopleSync;
    if (keepMine) {
      s.updatedAt = c.server.updatedAt;
      savePeople(true);
    } else {
      setPeople(c.server.people, c.server.updatedAt);
      s.pending = false;
      s.error = false;
    }
  }
  updateSaveState();
}

// 다른 사람이 고친 내용 가져오기 (내가 고치는 중이 아닐 때만)
async function poll() {
  if (document.hidden || state.view !== 'calendar' || state.editing || state.pick || state.conflict) return;
  if (document.activeElement && document.activeElement.isContentEditable) return;
  const ym = curKey();
  const e = state.months[ym];
  if (!e || e.pending || e.saving) return;
  try {
    const r = await fetchMonth(ym);
    if (!r.data || r.updatedAt === e.updatedAt) return;
    if (e.pending || e.saving || state.editing || ym !== curKey()) return;
    e.data = normalizeMonth(r.data, state.m);
    e.updatedAt = r.updatedAt;
    render();
    toast('다른 분이 고친 내용을 불러왔어요.');
  } catch (err) { /* 다음에 다시 */ }
}

/* ===== 칸 안에서 바로 편집 ===== */
function startEdit(box, day) {
  if (state.editing && state.editing.box === box) return;
  stopEdit();
  const mo = cur();
  const ta = document.createElement('textarea');
  ta.className = 'ed';
  ta.spellcheck = false;
  ta.value = day ? (mo.days[day] || '') : (mo.notes || '');
  box.appendChild(ta);
  box.querySelector('.lines').innerHTML = linesHTML(ta.value, 'raw');
  fit(box);
  const host = day ? box.closest('.cell') : box;
  host.classList.add('editing');
  host.draggable = false;
  state.editing = { box, ta, day, host };

  ta.addEventListener('input', () => {
    if (day) {
      if (ta.value) mo.days[day] = ta.value; else delete mo.days[day];
    } else {
      mo.notes = ta.value;
    }
    box.querySelector('.lines').innerHTML = linesHTML(ta.value, 'raw');
    if (day && (host.classList.contains('c-sun') || host.classList.contains('c-sat'))) {
      host.classList.toggle('hatch', !ta.value.trim());
    }
    fit(box);
    if (day) { const wh = host.querySelector('.wh'); if (wh) wh.textContent = dayHoursLabel(ta.value); }
    markDirty();
    updateHoursChip();
    updateSuggest();
    renderSnipbar();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (suggestKey(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('click', updateSuggest);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) renderSnipbar(); });
  ta.addEventListener('blur', () => stopEdit());
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  if (day) showTools(host);
  renderSnipbar();
}

function stopEdit() {
  const ed = state.editing;
  if (!ed) return;
  state.editing = null;
  ed.box.querySelector('.lines').innerHTML = linesHTML(ed.ta.value, 'edit');
  fit(ed.box);
  ed.ta.remove();
  ed.host.classList.remove('editing');
  if (ed.day) ed.host.draggable = !!ed.ta.value.trim();
  hideTools();
  hideSuggest();
  renderSnipbar();
}

/* ===== 자동 완성 ===== */
const sug = { items: [], active: -1 };
let lineIdxCache = null;
function allLineIndex() {
  // 불러온 모든 달의 칸 글자 (지금 고치는 칸은 빼야 쓰는 중인 글자가 다시 제안되지 않음)
  if (!lineIdxCache) {
    const texts = [];
    const skip = state.editing && state.editing.day ? state.editing : null;
    for (const [ym, e] of Object.entries(state.months)) {
      for (const [d, t] of Object.entries(e.data.days || {})) {
        if (skip && ym === curKey() && +d === skip.day) continue;
        texts.push(t);
      }
    }
    lineIdxCache = lineIndex(texts);
  }
  return lineIdxCache;
}
function currentLine(ta) {
  const pos = ta.selectionStart;
  const start = ta.value.lastIndexOf('\n', pos - 1) + 1;
  let end = ta.value.indexOf('\n', pos);
  if (end < 0) end = ta.value.length;
  return { start, end, prefix: ta.value.slice(start, pos), atEnd: pos === end };
}
function updateSuggest() {
  const ed = state.editing;
  if (!ed || !ed.day) return hideSuggest();
  const { prefix, atEnd } = currentLine(ed.ta);
  sug.items = atEnd ? suggestLines(prefix, allLineIndex(), TAG_GROUPS.flat()) : [];
  sug.active = -1;
  const box = $('suggest');
  if (!sug.items.length) return hideSuggest();
  box.innerHTML = sug.items.map((it, i) => `<li data-i="${i}" class="${it.tag ? 'tag' : ''}">${linesHTML(it.label, 'edit')}</li>`).join('') +
    '<li class="hint">Tab: 넣기 · ↑↓: 고르기 · Esc: 닫기</li>';
  box.hidden = false;
  const r = ed.host.getBoundingClientRect();
  const w = Math.max(r.width, 260);
  box.style.left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8)) + 'px';
  box.style.width = w + 'px';
  const below = r.bottom + 4;
  box.style.top = (below + box.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - box.offsetHeight - 50) : below) + 'px';
}
function hideSuggest() {
  sug.items = [];
  sug.active = -1;
  $('suggest').hidden = true;
  lineIdxCache = null;
}
function paintSuggest() {
  $('suggest').querySelectorAll('li[data-i]').forEach((li) => li.classList.toggle('on', +li.dataset.i === sug.active));
}
function acceptSuggest(i) {
  const ed = state.editing;
  const it = sug.items[i];
  if (!ed || !it) return;
  const ta = ed.ta;
  const { start, end } = currentLine(ta);
  ta.value = ta.value.slice(0, start) + it.text + ta.value.slice(end);
  const caret = start + it.text.length;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input'));
  if (!it.tag) hideSuggest();
}
// 자동 완성 목록이 떠 있을 때 키 처리. 처리했으면 true
function suggestKey(e) {
  if (!sug.items.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sug.items.length;
    sug.active = e.key === 'ArrowDown' ? (sug.active + 1) % n : (sug.active - 1 + n) % n;
    paintSuggest();
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && sug.active >= 0)) {
    e.preventDefault();
    acceptSuggest(Math.max(0, sug.active));
    return true;
  }
  if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); return true; }
  return false;
}

/* ===== 같은 요일에 모두 ===== */
function fillSameWeekday(from) {
  stopEdit();
  const mo = cur();
  const { y, m } = state;
  const w = weekday(y, m, from);
  const text = mo.days[from] || '';
  const before = { ...mo.days };
  const targets = [];
  for (let d = 1; d <= daysIn(y, m); d++) {
    if (d === from || weekday(y, m, d) !== w || holidayName(y, m, d)) continue;
    if (text) mo.days[d] = text; else delete mo.days[d];
    targets.push(d);
  }
  if (!targets.length) { toast('같은 요일인 다른 날이 없어요.'); return; }
  render();
  markDirty();
  targets.forEach((d) => { const c = document.querySelector(`#sheet .cell[data-day="${d}"]`); if (c) c.classList.add('flash'); });
  const wn = '일월화수목금토'[w];
  toast(`${m}월 ${wn}요일 ${targets.length}칸(${targets.join('·')}일)에 똑같이 넣었어요. 공휴일은 뺐어요.`, {
    label: '되돌리기', fn: () => { mo.days = before; render(); markDirty(); },
  });
}

/* ===== 찾아 바꾸기 ===== */
function openReplace() {
  if (!togglePanel('replacePanel')) { markMatches(''); return; }
  stopEdit();
  updateReplace();
  $('findText').focus();
}
function updateReplace() {
  const word = $('findText').value;
  const mo = cur();
  const { cells, hits } = countMatches(Object.values(mo ? mo.days : {}), word);
  $('replaceInfo').textContent = word ? (hits ? `${cells}칸에서 ${hits}곳을 찾았어요. 달력에 노랗게 표시했어요.` : '이 달에는 없어요.') : '바꿀 말을 적으면 이 달 칸에서 찾아요.';
  $('doReplace').disabled = !hits;
  markMatches(word);
}
function markMatches(word) {
  const mo = cur();
  document.querySelectorAll('#sheet .cell.in').forEach((c) => {
    c.classList.toggle('match', !!word && (mo.days[c.dataset.day] || '').includes(word));
  });
}
function doReplace() {
  const word = $('findText').value;
  const to = $('replaceText').value;
  if (!word) return;
  const mo = cur();
  const before = { ...mo.days };
  let n = 0;
  for (const [d, t] of Object.entries(mo.days)) {
    if (!t.includes(word)) continue;
    const next = t.split(word).join(to);
    if (next.trim()) mo.days[d] = next; else delete mo.days[d];
    n++;
  }
  render();
  markDirty();
  updateReplace();
  toast(`${n}칸에서 「${word}」를 「${to || '(지움)'}」로 바꿨어요.`, {
    label: '되돌리기', fn: () => { mo.days = before; render(); markDirty(); updateReplace(); },
  });
}

// 제목·시간 안내·요일 머리글 (한 줄짜리)
function onFieldInput(el) {
  const mo = cur();
  const v = el.textContent.replace(/\n/g, ' ');
  const f = el.dataset.field;
  if (f === 'title') mo.title = v;
  else if (f === 'guide') {
    mo.guide = v;
    el.classList.remove('blue', 'red');
    const c = lineColor(v);
    if (c) el.classList.add(c);
  } else if (f === 'header') mo.headers[+el.dataset.i] = v;
  markDirty();
}

/* ===== 다른 날로 옮기기 / 바꾸기 ===== */
function showTools(cell) {
  const t = $('cellTools');
  t.hidden = false;
  t.dataset.day = cell.dataset.day;
  positionTools();
}
function positionTools() {
  const t = $('cellTools');
  if (t.hidden) return;
  const cell = document.querySelector(`#sheet .cell[data-day="${t.dataset.day}"]`);
  if (!cell) return;
  const r = cell.getBoundingClientRect();
  const h = t.offsetHeight || 36;
  let top = r.top - h - 6; // 칸 위 (아래는 자동 완성 목록 자리)
  if (top < 8) top = r.bottom + 6;
  const left = Math.min(r.left, document.documentElement.clientWidth - t.offsetWidth - 8);
  t.style.top = Math.max(8, top) + 'px';
  t.style.left = Math.max(8, left) + 'px';
}
function hideTools() { $('cellTools').hidden = true; }

function beginPick(mode, from) {
  stopEdit();
  state.pick = { mode, from };
  $('sheet').classList.add('picking');
  const c = document.querySelector(`#sheet .cell[data-day="${from}"]`);
  if (c) c.classList.add('picked');
  const verb = mode === 'move' ? '옮길' : '바꿀';
  showNotice(`${state.m}월 ${from}일 내용을 ${verb} 날짜 칸을 누르세요.`, [{ label: '취소', fn: cancelPick }]);
}
function cancelPick() {
  if (!state.pick) return;
  state.pick = null;
  $('sheet').classList.remove('picking');
  document.querySelectorAll('#sheet .cell.picked').forEach((c) => c.classList.remove('picked'));
  hideNotice();
}
function finishPick(to) {
  const { mode, from } = state.pick;
  cancelPick();
  if (to === from) return;
  const mo = cur();
  const before = { ...mo.days };
  const a = mo.days[from];
  const b = mo.days[to];
  if (mode === 'move') {
    if (a) mo.days[to] = a; else delete mo.days[to];
    delete mo.days[from];
  } else {
    if (b) mo.days[from] = b; else delete mo.days[from];
    if (a) mo.days[to] = a; else delete mo.days[to];
  }
  render();
  markDirty();
  document.querySelectorAll(`#sheet .cell[data-day="${to}"], #sheet .cell[data-day="${from}"]`)
    .forEach((c) => c.classList.add('flash'));
  const msg = mode === 'move' ? `${from}일 내용을 ${to}일로 옮겼어요.` : `${from}일과 ${to}일 내용을 바꿨어요.`;
  toast(msg, { label: '되돌리기', fn: () => { mo.days = before; render(); markDirty(); } });
}

/* ===== 알림 · 토스트 ===== */
function showNotice(text, actions) {
  const n = $('notice');
  n.innerHTML = `<p>${esc(text)}</p><div class="acts"></div>`;
  const acts = n.querySelector('.acts');
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = a.label;
    b.addEventListener('click', a.fn);
    acts.appendChild(b);
  }
  n.hidden = false;
  n.dataset.kind = 'notice';
}
function hideNotice() {
  if (state.conflict) { showConflict(); return; }
  const n = $('notice');
  n.hidden = true;
  n.dataset.kind = '';
  renderBanner();
}
function renderBanner() {
  const n = $('notice');
  if (n.dataset.kind === 'notice' && !n.hidden) return;
  const person = previewPerson();
  if (!person || state.view !== 'calendar') { n.hidden = true; n.dataset.kind = ''; return; }
  const w = workSummary(cur() || { days: {} }, person);
  n.innerHTML = `<p><b>${esc(person.name)}</b> 님이 받을 종이를 보는 중이에요.${w.days ? ` 이번 달 근무 <b>${w.days}일 · ${formatHours(w.hours)}</b>.` : ''} 고치려면 오른쪽 버튼을 누르세요.</p><div class="acts"><button type="button" class="btn">다시 고치기</button></div>`;
  n.querySelector('button').addEventListener('click', () => setPreview(''));
  n.hidden = false;
  n.dataset.kind = 'preview';
}

let toastTimer;
function toast(text, action) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); t.hidden = true; });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : Math.max(3500, text.length * 90));
}

function setPreview(value) {
  stopEdit();
  cancelPick();
  state.preview = value;
  $('previewSelect').value = value;
  const n = $('notice');
  if (n.dataset.kind === 'preview') { n.hidden = true; n.dataset.kind = ''; }
  render();
}

/* ===== 참여자 ===== */
const personToRow = (p) => ({ name: p.name, tags: p.tags.join(', '), paused: !!p.paused });

function setPeople(list, updatedAt) {
  state.people = list.map((p) => ({ name: p.name, tags: [...p.tags], paused: !!p.paused }));
  state.peopleSync.updatedAt = updatedAt;
  state.peopleRows = state.people.map(personToRow);
  fillPreviewSelect();
  if (state.view === 'people') renderPeople();
}

function fillPreviewSelect() {
  const sel = $('previewSelect');
  if (state.preview !== '' && !state.people[+state.preview]) state.preview = '';
  sel.innerHTML = '<option value="">전체</option>' +
    state.people.map((p, i) => `<option value="${i}">${esc(p.name)}${p.paused ? ' (쉼)' : ''}</option>`).join(''); // 꼬리표는 설정 화면에서만
  sel.value = state.preview;
}

// 표 입력칸 → 저장할 명단
function rowsChanged() {
  state.people = state.peopleRows
    .map((r) => ({ name: r.name.trim(), tags: splitTags(r.tags), paused: !!r.paused }))
    .filter((p) => p.name);
  fillPreviewSelect();
  renderTagSummary();
  markPeopleDirty();
  updateHoursChip();
  if (state.tab === 'groups') renderGroupNotes();
}

function renderPeople() {
  const rows = state.peopleRows;
  if (!rows.length || rows[rows.length - 1].name || rows[rows.length - 1].tags) rows.push({ name: '', tags: '' });
  $('peopleRows').innerHTML = rows.map((r, i) => `<tr${r.paused ? ' class="paused"' : ''}>
      <td class="num">${i + 1}</td>
      <td><input id="p-name-${i}" data-r="${i}" data-c="name" value="${esc(r.name)}" placeholder="${i === 0 ? '예: 홍길동' : ''}" autocomplete="off" aria-label="${i + 1}번 이름"></td>
      <td><input id="p-tags-${i}" data-r="${i}" data-c="tags" value="${esc(r.tags)}" placeholder="${i === 0 ? '예: 탁구, 남, 2부' : ''}" autocomplete="off" aria-label="${i + 1}번 꼬리표"></td>
      <td class="pause">${r.name ? `<label title="잠시 빼기: 인쇄·근무시간·반별 인원에서 빠져요"><input type="checkbox" id="p-paused-${i}" data-r="${i}" data-c="paused"${r.paused ? ' checked' : ''}> 쉼</label>` : ''}</td>
      <td>${r.name || r.tags ? `<button type="button" class="iconbtn small" data-del="${i}" aria-label="${i + 1}번 줄 지우기">✕</button>` : ''}</td>
    </tr>`).join('');
  renderTagSummary();
}

function renderTagSummary() {
  const people = activePeople();
  const parts = usedTags(people).map((t) => `<span class="sum"><b>${esc(t)}</b> ${people.filter((p) => p.tags.includes(t)).length}명</span>`);
  const none = people.filter((p) => !p.tags.length).length;
  if (none) parts.push(`<span class="sum muted">꼬리표 없음 ${none}명</span>`);
  const paused = state.people.length - people.length;
  $('peopleCount').textContent = `모두 ${state.people.length}명${paused ? ` (쉼 ${paused}명)` : ''}`;
  $('tagSummary').innerHTML = parts.join('');
}

// 엑셀에서 복사한 여러 줄·여러 칸 붙여넣기
function pasteRows(startRow, startCol, text) {
  let lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (startRow === 0 && lines.length && /^이름$/.test(lines[0].split('\t')[0].trim())) lines = lines.slice(1);
  lines.forEach((line, i) => {
    const cells = line.split('\t').map((c) => c.trim());
    const r = startRow + i;
    while (state.peopleRows.length <= r) state.peopleRows.push({ name: '', tags: '' });
    const row = state.peopleRows[r];
    if (startCol === 'name') {
      row.name = cells[0] || '';
      if (cells.length > 1) row.tags = cells.slice(1).filter(Boolean).join(', ');
    } else {
      row.tags = cells.filter(Boolean).join(', ');
    }
  });
  renderPeople();
  rowsChanged();
  toast(`${lines.length}줄을 붙여넣었어요.`);
}

async function loadCustomHolidays() {
  try {
    const { data } = await api('/custom-holidays');
    $('customHolidays').innerHTML = data.holidays.length
      ? data.holidays.map((h) => `<li><span class="date">${esc(h.date)}</span> <span>${esc(h.name)}</span>
          <button type="button" class="iconbtn small" data-del-holiday="${esc(h.date)}" aria-label="${esc(h.date)} 지우기">✕</button></li>`).join('')
      : '<li class="muted">아직 없어요.</li>';
  } catch (e) {
    if (e.status !== 401) $('customHolidays').innerHTML = `<li class="muted">${esc(e.message)}</li>`;
  }
}

function forgetHolidayMonth(date) {
  delete state.holidayLoaded[date.slice(0, 7)];
}


/* ===== 달 한 번에 옮기기 (월 선택판) ===== */
function openPicker() {
  const p = $('monthPicker');
  if (!p.hidden) { p.hidden = true; return; }
  state.pickerYear = state.y;
  renderPicker();
  p.hidden = false;
  loadSavedMonths().then(renderPicker, () => {});
}
function renderPicker() {
  const y = state.pickerYear;
  const now = new Date();
  let grid = '';
  for (let m = 1; m <= 12; m++) {
    const cls = ['mp-m'];
    if (y === state.y && m === state.m) cls.push('cur');
    if (y === now.getFullYear() && m === now.getMonth() + 1) cls.push('today');
    if (state.savedMonths.has(ymKey(y, m))) cls.push('saved');
    grid += `<button type="button" class="${cls.join(' ')}" data-m="${m}">${m}월</button>`;
  }
  $('monthPicker').innerHTML = `
    <div class="mp-head">
      <button type="button" class="iconbtn" data-y="-1" aria-label="이전 해">◀</button>
      <b>${y}년</b>
      <button type="button" class="iconbtn" data-y="1" aria-label="다음 해">▶</button>
    </div>
    <div class="mp-grid">${grid}</div>
    <div class="mp-foot"><span class="mp-legend"><i></i> 만들어 둔 달</span><button type="button" class="btn" data-thismonth>이번 달로</button></div>`;
}


/* ===== 자주 쓰는 일정 (출근 · 활동) ===== */
function renderSnipbar() {
  const ed = state.editing && state.editing.day ? state.editing : null;
  const chip = (x, i) => {
    const cls = ['snip', x.kind];
    if (x.color) cls.push('c-' + x.color);
    if (state.stamp && state.stamp.i === i) cls.push('on');
    if (ed && hasBlock(ed.ta.value, x)) cls.push('in');
    return `<button type="button" class="${cls.join(' ')}" data-snip="${i}" draggable="true" title="${esc(x.text)}">${esc(x.name || '(이름 없음)')}</button>`;
  };
  const list = (kind) => state.snippets.map((x, i) => (x.kind === kind ? chip(x, i) : '')).join('');
  $('snipWork').innerHTML = list('work') || '<span class="muted small">없음</span>';
  $('snipAct').innerHTML = list('activity') || '<span class="muted small">없음</span>';
  $('snipbar').classList.toggle('editing', !!ed);
}

function snipClick(i) {
  const x0 = state.snippets[i];
  const x = x0 && coloredSnippet(x0); // 버튼에 정한 색을 붙인 글
  if (!x) return;
  const ed = state.editing;
  if (ed && ed.day) {
    // 고치는 중인 칸: 출근은 바꾸기(같은 것 다시 누르면 빼기), 활동은 넣기/빼기
    const ta = ed.ta;
    ta.value = x.kind === 'work' ? applyWork(ta.value, x) : toggleActivity(ta.value, x);
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event('input'));
    hideSuggest();
    return;
  }
  if (state.stamp && state.stamp.i === i) { endStamp(); return; }
  beginStamp(i);
}
function beginStamp(i) {
  stopEdit();
  cancelPick();
  if (state.stamp) endStamp();
  if (previewPerson()) setPreview('');
  state.stamp = { i, before: { ...cur().days }, days: [] };
  $('sheet').classList.add('picking');
  renderSnipbar();
  showStampNotice();
}
function showStampNotice() {
  const st = state.stamp;
  const x = state.snippets[st.i];
  const done = st.days.length ? ` (${st.days.length}칸)` : '';
  const how = x.kind === 'work' ? '넣을' : '넣을(이미 있으면 뺄)';
  showNotice(`「${x.name}」을(를) ${how} 날짜 칸을 누르세요. 여러 칸 눌러도 돼요.${done}`, [{ label: '끝내기', fn: endStamp }]);
}
// 칸을 누르고 버튼을 누른 것과 같음: 출근은 그 줄만 바꾸기, 활동은 넣기/빼기
function stampDay(d) {
  const st = state.stamp;
  const x = coloredSnippet(state.snippets[st.i]);
  const mo = cur();
  const old = mo.days[d] || '';
  const next = x.kind === 'work' ? (hasBlock(old, x) ? old : applyWork(old, x)) : toggleActivity(old, x);
  if (next.trim()) mo.days[d] = next; else delete mo.days[d];
  if (!st.days.includes(d)) st.days.push(d);
  render();
  markDirty();
  const c = document.querySelector(`#sheet .cell[data-day="${d}"]`);
  if (c) c.classList.add('flash');
  showStampNotice();
}
function endStamp() {
  const st = state.stamp;
  if (!st) return;
  state.stamp = null;
  $('sheet').classList.remove('picking');
  renderSnipbar();
  hideNotice();
  if (st.days.length) {
    const mo = cur();
    const x = state.snippets[st.i] || { name: '' };
    toast(`${st.days.length}칸에 「${x.name}」를 넣었어요.`, { label: '되돌리기', fn: () => { mo.days = st.before; render(); markDirty(); } });
  }
}
function saveCellAsSnippet(day) {
  const text = (cur().days[day] || '').trim();
  stopEdit();
  if (!text) { toast('빈 칸은 저장할 수 없어요.'); return; }
  const parts = splitSnippets([{ name: guessSnippetName(text.split('\n').filter((l) => !isWorkLine(l)).join('\n') || text), text }]);
  const added = [];
  for (const x of parts) {
    if (state.snippets.some((y) => y.kind === x.kind && y.text === x.text)) continue;
    const base = x.name;
    const names = new Set(state.snippets.map((y) => y.name));
    for (let n = 2; names.has(x.name); n++) x.name = `${base} ${n}`;
    state.snippets.push(x);
    added.push(`${(x.kind === 'work' ? '출근' : '활동')} 「${x.name}」`);
  }
  renderSnipbar();
  if (!added.length) { toast('이미 같은 버튼이 있어요.'); return; }
  markSettingsDirty();
  toast(`${added.join(', ')} 버튼으로 저장했어요. 이름은 「고치기」에서 바꿀 수 있어요.`);
}

/* ===== 끌어다 놓기: 날짜 칸 옮기기(바꾸기, Ctrl = 복사) · 버튼을 칸에 넣기 ===== */
const DRAG_DAY = 'application/x-day';
const DRAG_SNIP = 'application/x-snip';
function dropSnippet(i, d) {
  const x = state.snippets[i] && coloredSnippet(state.snippets[i]);
  if (!x) return;
  const mo = cur();
  const old = mo.days[d] || '';
  if (hasBlock(old, x)) { toast(`${d}일에는 이미 「${x.name}」가 있어요.`); return; }
  const next = x.kind === 'work' ? applyWork(old, x) : toggleActivity(old, x);
  mo.days[d] = next;
  render();
  markDirty();
  document.querySelector(`#sheet .cell[data-day="${d}"]`)?.classList.add('flash');
  toast(`${d}일에 「${x.name}」를 넣었어요.`, { label: '되돌리기', fn: () => { if (old) mo.days[d] = old; else delete mo.days[d]; render(); markDirty(); } });
}
function dropDay(from, to, copy) {
  if (from === to) return;
  const mo = cur();
  const before = { ...mo.days };
  const a = mo.days[from];
  const b = mo.days[to];
  let msg;
  if (copy) {
    mo.days[to] = a;
    msg = `${from}일 일정을 ${to}일에 복사했어요.`;
  } else if (b && b.trim()) {
    mo.days[to] = a;
    mo.days[from] = b;
    msg = `${from}일과 ${to}일 일정을 서로 바꿨어요.`;
  } else {
    mo.days[to] = a;
    delete mo.days[from];
    msg = `${from}일 일정을 ${to}일로 옮겼어요.`;
  }
  render();
  markDirty();
  [from, to].forEach((d) => document.querySelector(`#sheet .cell[data-day="${d}"]`)?.classList.add('flash'));
  toast(msg, { label: '되돌리기', fn: () => { mo.days = before; render(); markDirty(); } });
}
function clearDropMarks() {
  document.querySelectorAll('#sheet .cell.dropping, #sheet .cell.dragging').forEach((c) => c.classList.remove('dropping', 'dragging'));
}
function bindDragDrop() {
  const sheet = $('sheet');
  sheet.addEventListener('dragstart', (e) => {
    const cell = e.target.closest && e.target.closest('.cell.in[draggable="true"]');
    if (!cell || previewPerson() || state.editing) { if (cell) e.preventDefault(); return; }
    e.dataTransfer.setData(DRAG_DAY, cell.dataset.day);
    e.dataTransfer.setData('text/plain', cur().days[cell.dataset.day] || '');
    e.dataTransfer.effectAllowed = 'copyMove';
    cell.classList.add('dragging');
    hideTools();
  });
  sheet.addEventListener('dragover', (e) => {
    const cell = e.target.closest('.cell.in');
    const types = [...e.dataTransfer.types];
    if (!cell || previewPerson() || !(types.includes(DRAG_DAY) || types.includes(DRAG_SNIP))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DRAG_SNIP) || e.ctrlKey || e.altKey || e.metaKey ? 'copy' : 'move';
    document.querySelectorAll('#sheet .cell.dropping').forEach((c) => { if (c !== cell) c.classList.remove('dropping'); });
    cell.classList.add('dropping');
  });
  sheet.addEventListener('dragleave', (e) => {
    const cell = e.target.closest('.cell.in');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('dropping');
  });
  sheet.addEventListener('drop', (e) => {
    const cell = e.target.closest('.cell.in');
    if (!cell) return;
    e.preventDefault();
    const to = +cell.dataset.day;
    const snip = e.dataTransfer.getData(DRAG_SNIP);
    const day = e.dataTransfer.getData(DRAG_DAY);
    clearDropMarks();
    stopEdit();
    if (snip !== '') dropSnippet(+snip, to);
    else if (day) dropDay(+day, to, e.ctrlKey || e.altKey || e.metaKey);
  });
  sheet.addEventListener('dragend', clearDropMarks);
  sheet.addEventListener('drop', () => { dragSnip = null; });
  const bar = $('snipbar');
  const clearChipMarks = () => bar.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
  bar.addEventListener('dragover', (e) => {
    const t = e.target.closest('[data-snip]');
    if (dragSnip == null || !t || +t.dataset.snip === dragSnip) { clearChipMarks(); return; }
    if (state.snippets[+t.dataset.snip].kind !== state.snippets[dragSnip].kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const after = e.offsetX > t.offsetWidth / 2;
    clearChipMarks();
    t.classList.add(after ? 'drop-after' : 'drop-before');
  });
  bar.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-snip]');
    if (dragSnip == null || !t) return;
    e.preventDefault();
    const after = t.classList.contains('drop-after');
    clearChipMarks();
    moveSnippet(dragSnip, +t.dataset.snip, after);
  });
  bar.addEventListener('dragend', () => { dragSnip = null; clearChipMarks(); });
  bar.addEventListener('dragstart', (e) => {
    const b = e.target.closest && e.target.closest('[data-snip]');
    if (!b) return;
    dragSnip = +b.dataset.snip;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(DRAG_SNIP, b.dataset.snip);
    e.dataTransfer.setData('text/plain', state.snippets[+b.dataset.snip].text);
  });
}

/* ===== 버튼 순서 바꾸기 (같은 묶음 안에서) ===== */
let dragSnip = null; // 끌고 있는 버튼 번호
function moveSnippet(from, target, after) {
  if (from === target) return;
  if (state.stamp) endStamp();
  const list = state.snippets;
  const item = list[from];
  const tItem = list[target];
  list.splice(from, 1);
  let at = list.indexOf(tItem) + (after ? 1 : 0);
  list.splice(at, 0, item);
  renderSnipbar();
  if (state.view === 'people' && state.tab === 'snippets') renderSnippetRows();
  markSettingsDirty();
}
// 같은 종류 안에서 한 칸 위/아래
function nudgeSnippet(i, dir) {
  const kind = state.snippets[i].kind;
  const same = state.snippets.map((x, k) => (x.kind === kind ? k : -1)).filter((k) => k >= 0);
  const pos = same.indexOf(i) + dir;
  if (pos < 0 || pos >= same.length) return;
  moveSnippet(i, same[pos], dir > 0);
}

/* ===== 이 날 지우기 ===== */
function clearDay(d) {
  const mo = cur();
  const old = mo.days[d];
  stopEdit();
  if (!old || !old.trim()) { toast('이미 빈 칸이에요.'); return; }
  delete mo.days[d];
  render();
  markDirty();
  toast(`${state.m}월 ${d}일 일정을 지웠어요.`, { label: '되돌리기', fn: () => { mo.days[d] = old; render(); markDirty(); } });
}

/* ===== 이 달 모두 지우기 ===== */
function clearMonth() {
  stopEdit();
  const mo = cur();
  const n = Object.values(mo.days).filter((t) => t.trim()).length;
  if (!n) { toast('지울 일정이 없어요.'); return; }
  showNotice(`${state.m}월 날짜 칸 ${n}칸의 일정을 모두 지울까요? 제목·요일·안내문은 그대로 둬요.`, [
    { label: '모두 지우기', fn: () => {
      const before = { ...mo.days };
      mo.days = {};
      hideNotice();
      render();
      markDirty();
      toast(`${state.m}월 일정 ${n}칸을 지웠어요.`, { label: '되돌리기', fn: () => { mo.days = before; render(); markDirty(); } });
    } },
    { label: '취소', fn: hideNotice },
  ]);
}

// 설정 탭: 출근 / 활동 목록
function renderSnippetRows() {
  const row = (x, i) => `<li class="sniprow">
      <div class="snipmeta">
        <input id="s-name-${i}" data-s="${i}" data-c="name" value="${esc(x.name)}" placeholder="버튼 이름" aria-label="${i + 1}번 이름" autocomplete="off">
        <select id="s-color-${i}" data-s="${i}" data-c="color" class="colorpick c-${x.color || 'black'}" aria-label="${i + 1}번 글자색">
          <option value=""${!x.color ? ' selected' : ''}>검정</option>
          <option value="blue"${x.color === 'blue' ? ' selected' : ''}>파랑</option>
          <option value="red"${x.color === 'red' ? ' selected' : ''}>빨강</option>
        </select>
      </div>
      <textarea id="s-text-${i}" data-s="${i}" data-c="text" rows="${Math.min(6, Math.max(1, x.text.split('\n').length))}" aria-label="${i + 1}번 내용" spellcheck="false">${esc(x.text)}</textarea>
      <span class="rowacts">
        <button type="button" class="iconbtn small" data-sup="${i}" aria-label="${i + 1}번 위로" title="위로">▲</button>
        <button type="button" class="iconbtn small" data-sdown="${i}" aria-label="${i + 1}번 아래로" title="아래로">▼</button>
        <button type="button" class="iconbtn small" data-sdel="${i}" aria-label="${i + 1}번 지우기" title="지우기">✕</button>
      </span>
    </li>`;
  const list = (kind) => state.snippets.map((x, i) => (x.kind === kind ? row(x, i) : '')).join('') || '<li class="muted">아직 없어요.</li>';
  $('snippetWork').innerHTML = list('work');
  $('snippetAct').innerHTML = list('activity');
}

/* ===== 반 나누기 ===== */
function applyTagGroups(groups) {
  state.tagGroups = groups;
  setTagGroups(groups);
}
function markSettingsDirty() {
  const s = state.settingsSync;
  s.pending = true;
  clearTimeout(s.timer);
  s.timer = setTimeout(saveSettings, SAVE_DELAY);
  updateSaveState();
}
async function saveSettings() {
  const s = state.settingsSync;
  if (s.saving) { s.again = true; return; }
  clearTimeout(s.timer);
  s.saving = true;
  s.pending = false;
  updateSaveState();
  try {
    await api('/settings', { method: 'PUT', body: { tagGroups: state.tagGroups, snippets: state.snippets } });
    s.error = false;
    state.lastSaved = new Date();
  } catch (err) {
    s.pending = true;
    s.error = true;
    if (err.status !== 401) s.timer = setTimeout(saveSettings, 5000);
  } finally {
    s.saving = false;
    if (s.again) { s.again = false; saveSettings(); }
    updateSaveState();
  }
}

function renderGroups() {
  const rows = state.groupRows;
  if (!rows.length || rows[rows.length - 1].name || rows[rows.length - 1].tags) rows.push({ name: '', tags: '' });
  $('groupRows').innerHTML = rows.map((r, i) => `<tr>
      <td><input id="g-name-${i}" data-g="${i}" data-c="name" value="${esc(r.name)}" placeholder="${i === rows.length - 1 ? '예: 조리실습' : ''}" autocomplete="off" aria-label="${i + 1}번 나누기 이름"></td>
      <td><input id="g-tags-${i}" data-g="${i}" data-c="tags" value="${esc(r.tags)}" placeholder="${i === rows.length - 1 ? '예: 오전조, 오후조' : ''}" autocomplete="off" aria-label="${i + 1}번 꼬리표들"></td>
      <td>${r.name || r.tags ? `<button type="button" class="iconbtn small" data-gdel="${i}" aria-label="${i + 1}번 줄 지우기">✕</button>` : ''}</td>
    </tr>`).join('');
  renderGroupNotes();
}

function groupsChanged() {
  applyTagGroups(state.groupRows
    .map((r) => ({ name: r.name.trim(), tags: splitTags(r.tags) }))
    .filter((g) => g.tags.length));
  renderGroupNotes();
  markSettingsDirty();
}

// 반 나누기 화면 아래 안내: 참여자 인원, 겹친 꼬리표, 나누기에 없는 꼬리표
function renderGroupNotes() {
  const notes = [];
  const seen = new Map();
  for (const g of state.tagGroups) {
    for (const t of g.tags) {
      if (seen.has(t)) notes.push(`「${t}」가 「${seen.get(t) || '이름 없음'}」과 「${g.name || '이름 없음'}」 두 곳에 있어요. 앞의 것만 쓰여요.`);
      else seen.set(t, g.name);
    }
  }
  for (const t of usedTags(state.people)) {
    if (!seen.has(t)) notes.push(`참여자 꼬리표 「${t}」는 어느 나누기에도 없어요. [${t}] 줄은 「${t}」인 사람만 받아요.`);
  }
  const active = activePeople();
  const counts = state.tagGroups.map((g) => {
    const parts = g.tags.map((t) => `${esc(t)} ${active.filter((p) => p.tags.includes(t)).length}명`);
    const none = active.filter((p) => !g.tags.some((t) => p.tags.includes(t))).length;
    if (none) parts.push(`<span class="muted">안 정해짐 ${none}명</span>`);
    return `<li><b>${esc(g.name || '이름 없음')}</b> · ${parts.join(' · ')}</li>`;
  });
  $('groupNotes').innerHTML = (counts.length ? `<ul class="groupcounts">${counts.join('')}</ul>` : '') +
    notes.map((n) => `<p class="warn">${esc(n)}</p>`).join('');
}

/* ===== 참여자 파일 불러오기 · 내려받기 ===== */
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) {
    return new TextDecoder('euc-kr').decode(buf); // 한글 윈도우 메모장·엑셀 CSV
  }
}
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    el.onload = resolve;
    el.onerror = () => reject(new Error('엑셀 파일을 읽지 못했어요. 엑셀에서 「다른 이름으로 저장 → CSV」로 저장해 올려 주세요.'));
    document.head.appendChild(el);
  });
}
async function readPeopleFile(file) {
  try {
    let text;
    if (/\.xlsx?$/i.test(file.name)) {
      await loadXlsx();
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      text = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: '\t', blankrows: false });
    } else {
      text = decodeText(await file.arrayBuffer());
    }
    const list = parsePeopleText(text);
    if (!list.length) {
      toast('파일에서 이름을 찾지 못했어요. 한 줄에 한 사람씩, 이름 다음에 꼬리표를 적어 주세요.');
      return;
    }
    showImport(list, file.name);
  } catch (e) {
    toast(e.message);
  }
}
function showImport(list, fileName) {
  state.pendingImport = list;
  const have = state.people.length;
  const sample = list.slice(0, 5).map((p) => `<li>${esc(p.name)}${p.tags.length ? ` <span class="muted">· ${esc(p.tags.join(', '))}</span>` : ''}</li>`).join('');
  const box = $('importBox');
  box.innerHTML = `<p><b>${esc(fileName)}</b>에서 <b>${list.length}명</b>을 읽었어요.</p>
    <ol class="importlist">${sample}${list.length > 5 ? `<li class="muted">… 외 ${list.length - 5}명</li>` : ''}</ol>
    <div class="acts">
      <button type="button" class="btn primary" data-imp="replace">${have ? `지금 명단(${have}명)을 이걸로 바꾸기` : '명단에 넣기'}</button>
      ${have ? '<button type="button" class="btn" data-imp="append">지금 명단 뒤에 붙이기</button>' : ''}
      <button type="button" class="btn" data-imp="cancel">취소</button>
    </div>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
function applyImport(mode) {
  const list = state.pendingImport;
  state.pendingImport = null;
  $('importBox').hidden = true;
  if (!list || mode === 'cancel') return;
  const before = state.peopleRows.map((r) => ({ ...r }));
  const rows = list.map((p) => ({ name: p.name, tags: p.tags.join(', ') }));
  let msg;
  if (mode === 'replace') {
    state.peopleRows = rows;
    msg = `명단을 ${rows.length}명으로 바꿨어요.`;
  } else {
    const names = new Set(state.people.map((p) => p.name));
    const fresh = rows.filter((r) => !names.has(r.name));
    state.peopleRows = state.peopleRows.filter((r) => r.name || r.tags).concat(fresh);
    msg = `${fresh.length}명을 붙였어요.${rows.length - fresh.length ? ` 이미 있는 ${rows.length - fresh.length}명은 그대로 뒀어요.` : ''}`;
  }
  renderPeople();
  rowsChanged();
  toast(msg, { label: '되돌리기', fn: () => { state.peopleRows = before; renderPeople(); rowsChanged(); } });
}
function exportPeople() {
  const text = '이름\t꼬리표\r\n' + state.people.map((p) => `${p.name}\t${p.tags.join(', ')}`).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '참여자명단.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#peopleView [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('#peopleView [data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (tab === 'groups') {
    state.groupRows = state.tagGroups.map((g) => ({ name: g.name, tags: g.tags.join(', ') }));
    renderGroups();
  }
  if (tab === 'holidays') loadCustomHolidays();
  if (tab === 'snippets') renderSnippetRows();
}

/* ===== 화면 전환 ===== */
function setView(view) {
  stopEdit();
  cancelPick();
  if (state.stamp) endStamp();
  state.view = view;
  document.body.dataset.view = view;
  $('loginView').hidden = view !== 'login';
  $('peopleView').hidden = view !== 'people';
  PANELS.forEach((pid) => { $(pid).hidden = true; });
  $('monthPicker').hidden = true;
  if (view === 'people') {
    state.peopleRows = state.people.map(personToRow);
    renderPeople();
    setTab(state.tab);
    $('notice').hidden = true;
    window.scrollTo(0, 0);
  }
  if (view === 'calendar') {
    // 기관 휴무일이 바뀌었을 수 있으니 다시 불러와서 그림
    loadHolidays(state.y, state.m).then(() => { applyHolidays(curKey()); render(); }, () => {});
    render();
  }
  if (view === 'login') {
    setTimeout(() => $('pw').focus(), 0);
  }
}

function showLogin() {
  if (state.view !== 'login') setView('login');
}

/* ===== 개인별 인쇄 ===== */
function openPrintPanel() {
  if (!togglePanel('printPanel')) return;
  stopEdit();
  const active = activePeople();
  const sel = $('printWho');
  const keep = sel.value;
  sel.innerHTML = `<option value="*">전원 (${active.length}명)</option>` +
    usedTags(active).map((t) => `<option value="t:${esc(t)}">${esc(t)}만 (${active.filter((p) => p.tags.includes(t)).length}명)</option>`).join('') +
    '<option value="pick">직접 고르기</option>';
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '*';
  $('printPick').innerHTML = active.length
    ? `<div class="pp-acts"><button type="button" class="linkbtn" data-pick="all">모두 선택</button><button type="button" class="linkbtn" data-pick="none">모두 해제</button></div>` +
      active.map((p, i) => `<label><input type="checkbox" id="pp-${i}" value="${esc(p.name)}" checked> ${esc(p.name)}</label>`).join('')
    : '';
  updatePrintSummary();
}
function printTargets() {
  const active = activePeople();
  const v = $('printWho').value;
  if (v === 'pick') {
    const names = new Set([...$('printPick').querySelectorAll('input:checked')].map((c) => c.value));
    return active.filter((p) => names.has(p.name));
  }
  if (v.startsWith('t:')) return active.filter((p) => p.tags.includes(v.slice(2)));
  return active;
}
function updatePrintSummary() {
  $('printPick').hidden = $('printWho').value !== 'pick';
  const n = printTargets().length;
  const full = $('includeFull').checked;
  $('printSummary').innerHTML = state.people.length
    ? `<b>${n}명</b>${full ? ' + 전체 1장' : ''}, ${state.m}월 계획표를 A4 가로로 인쇄해요.`
    : '참여자가 아직 없어요. <b>참여자·설정</b>에서 먼저 이름을 넣어 주세요.';
  $('doPrint').disabled = !n && !full;
}

function doPrint() {
  const mo = cur();
  if (!mo) return;
  const ym = curKey();
  let html = '';
  if ($('includeFull').checked) html += `<article class="sheet">${sheetHTML(ym, mo, 'full', null)}</article>`;
  for (const p of printTargets()) html += `<article class="sheet">${sheetHTML(ym, mo, 'person', p)}</article>`;
  if (!html) return;
  const area = $('printArea');
  area.innerHTML = html;
  area.hidden = false;
  document.body.classList.add('printing');
  fitAll(area);
  $('printPanel').hidden = true;
  setTimeout(() => window.print(), 50);
}

/* ===== 위쪽 작은 창 (인쇄·기록·근무시간): 하나만 열림 ===== */
const PANELS = ['moreMenu', 'printPanel', 'historyPanel', 'hoursPanel', 'replacePanel'];
function togglePanel(id) {
  const el = $(id);
  const open = el.hidden;
  PANELS.forEach((pid) => { $(pid).hidden = true; });
  $('monthPicker').hidden = true;
  el.hidden = !open;
  $('moreBtn').setAttribute('aria-expanded', String(id === 'moreMenu' && open));
  return open;
}

/* ===== 기록 (예전 저장본으로 되돌리기) ===== */
function fmtWhen(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]}) ${h < 12 ? '오전' : '오후'} ${(h % 12) || 12}:${pad(d.getMinutes())}`;
}
async function openHistory() {
  if (!togglePanel('historyPanel')) return;
  stopEdit();
  const ym = curKey();
  const list = $('historyList');
  list.innerHTML = '<li class="muted">불러오는 중…</li>';
  try {
    const { data } = await api(`/months/${ym}/versions`);
    if (ym !== curKey()) return;
    list.innerHTML = data.versions.length
      ? data.versions.map((v) => `<li><span>${fmtWhen(v.savedAt)}<small class="muted"> · 일정 ${v.filledDays}일</small></span>
          <button type="button" class="btn" data-restore="${v.id}" data-when="${esc(fmtWhen(v.savedAt))}">이 상태로</button></li>`).join('')
      : '<li class="muted">아직 기록이 없어요. 고치기 시작하면 10분마다 한 번씩 그 전 상태가 남아요.</li>';
  } catch (e) {
    list.innerHTML = `<li class="muted">${esc(e.message)}</li>`;
  }
}
async function restoreHistory(id, when) {
  const ym = curKey();
  const e = state.months[ym];
  stopEdit();
  try {
    if (e && (e.pending || e.saving)) await saveMonth(ym); // 지금 고친 것부터 저장 → 기록에 남음
    const { data } = await api(`/months/${ym}/versions/${id}/restore`, { method: 'POST' });
    state.months[ym] = { data: normalizeMonth(data.data, state.m), updatedAt: data.updatedAt };
    $('historyPanel').hidden = true;
    render();
    toast(`${when} 상태로 되돌렸어요. 바로 전 상태도 기록에 남아 있어요.`);
  } catch (err) {
    toast(err.message);
  }
}

/* ===== 근무시간 ===== */
function openHours() {
  if (!togglePanel('hoursPanel')) return;
  stopEdit();
  renderHours();
}
function hoursRows() {
  const mo = cur();
  return activePeople().map((p) => ({ name: p.name, ...workSummary(mo, p) }));
}
function renderHours() {
  const rows = hoursRows();
  $('hoursTitle').textContent = `${state.m}월 근무시간`;
  const noTime = rows.reduce((m, r) => Math.max(m, r.noTime), 0);
  $('hoursBody').innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.days}일</td><td class="n">${formatHours(r.hours)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">참여자가 없어요.</td></tr>';
  $('hoursNote').innerHTML = '「출근」이나 「근무」가 들어간 줄의 시간(예: 출근(9시~12시))을 그 사람이 받는 줄만 더해요.' +
    (noTime ? `<br><span class="warnline">시간이 안 적힌 출근 줄이 있는 날은 빠져 있어요 (많게는 ${noTime}일).</span>` : '');
}
async function copyHours() {
  const text = '이름\t근무일\t근무시간\r\n' + hoursRows().map((r) => `${r.name}\t${r.days}\t${r.hours}`).join('\r\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요. 엑셀에 붙여넣으세요.');
  } catch (e) {
    toast('복사하지 못했어요. 표를 끌어서 선택한 뒤 Ctrl+C로 복사해 주세요.');
  }
}

function afterPrint() {
  document.body.classList.remove('printing');
  $('printArea').innerHTML = '';
  $('printArea').hidden = true;
}

/* ===== 시작 ===== */
async function boot() {
  const [{ data }, settings] = await Promise.all([api('/people'), api('/settings')]);
  if (settings.data.tagGroups) applyTagGroups(settings.data.tagGroups);
  if (settings.data.snippets) state.snippets = splitSnippets(settings.data.snippets); // 예전 장소 버튼은 여기서 빠짐

  renderSnipbar();
  setPeople(data.people, data.updatedAt);
  state.booted = true;
  let y = state.y, m = state.m;
  try {
    const last = localStorage.getItem('lastMonth');
    if (/^\d{4}-\d{2}$/.test(last || '')) [y, m] = last.split('-').map(Number);
  } catch (e) { /* 무시 */ }
  setView('calendar');
  await openMonth(y, m);
}

async function start() {
  try {
    await boot();
  } catch (e) {
    if (e.status === 401) return; // 로그인 화면이 떠 있음
    setView('calendar');
    showNotice(`시작하지 못했어요. ${e.message}`, [{ label: '다시 시도', fn: () => { hideNotice(); start(); } }]);
  }
}

/* ===== 이벤트 ===== */
function bind() {
  $('prevMonth').addEventListener('click', () => openMonth(...shiftMonth(state.y, state.m, -1)));
  $('nextMonth').addEventListener('click', () => openMonth(...shiftMonth(state.y, state.m, 1)));
  $('previewSelect').addEventListener('change', (e) => setPreview(e.target.value));
  $('peopleBtn').addEventListener('click', () => setView('people'));
  $('monthLabel').addEventListener('click', openPicker);
  $('monthPicker').addEventListener('click', (e) => {
    e.stopPropagation(); // 연도를 바꾸면 버튼이 새로 그려져서 바깥 클릭으로 잘못 알고 닫히는 것 막기
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.y) { state.pickerYear += +b.dataset.y; renderPicker(); return; }
    let y = state.pickerYear, m = +b.dataset.m;
    if (b.hasAttribute('data-thismonth')) { const t = new Date(); y = t.getFullYear(); m = t.getMonth() + 1; }
    if (!m) return;
    $('monthPicker').hidden = true;
    openMonth(y, m);
  });
  document.addEventListener('click', (e) => {
    const p = $('monthPicker');
    if (!p.hidden && !e.target.closest('#monthPicker, #monthLabel')) p.hidden = true;
  });
  document.querySelectorAll('#peopleView [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // 반 나누기 표
  const groupRows = $('groupRows');
  groupRows.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset.g) return;
    const i = +inp.dataset.g;
    state.groupRows[i][inp.dataset.c] = inp.value;
    if (i === state.groupRows.length - 1) {
      const id = inp.id;
      const pos = inp.selectionStart;
      renderGroups();
      $(id).focus();
      $(id).setSelectionRange(pos, pos);
    }
    groupsChanged();
  });
  groupRows.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gdel]');
    if (!b) return;
    const before = state.groupRows.map((r) => ({ ...r }));
    const gone = state.groupRows.splice(+b.dataset.gdel, 1)[0];
    renderGroups();
    groupsChanged();
    toast(`「${gone.name || gone.tags}」 나누기를 지웠어요.`, {
      label: '되돌리기', fn: () => { state.groupRows = before; renderGroups(); groupsChanged(); },
    });
  });
  $('resetGroups').addEventListener('click', () => {
    const before = state.groupRows.map((r) => ({ ...r }));
    state.groupRows = DEFAULT_TAG_GROUPS.map((g) => ({ name: g.name, tags: g.tags.join(', ') }));
    renderGroups();
    groupsChanged();
    toast('처음 값으로 돌렸어요.', { label: '되돌리기', fn: () => { state.groupRows = before; renderGroups(); groupsChanged(); } });
  });

  // 참여자 파일
  $('peopleFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) readPeopleFile(f);
  });
  $('exportPeople').addEventListener('click', exportPeople);
  $('importBox').addEventListener('click', (e) => {
    const b = e.target.closest('[data-imp]');
    if (b) applyImport(b.dataset.imp);
  });
  const pv = $('peopleView');
  pv.addEventListener('dragover', (e) => {
    if (state.tab !== 'people' || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    pv.classList.add('dropping');
  });
  pv.addEventListener('dragleave', (e) => { if (!pv.contains(e.relatedTarget)) pv.classList.remove('dropping'); });
  pv.addEventListener('drop', (e) => {
    pv.classList.remove('dropping');
    if (state.tab !== 'people') return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) readPeopleFile(f);
  });
  $('backBtn').addEventListener('click', () => setView('calendar'));
  $('printBtn').addEventListener('click', openPrintPanel);
  $('holidayWarn').addEventListener('click', () => toast(state.holidayWarn));
  $('closePrint').addEventListener('click', () => { $('printPanel').hidden = true; });
  $('includeFull').addEventListener('change', updatePrintSummary);
  $('printWho').addEventListener('change', updatePrintSummary);
  $('printPick').addEventListener('change', updatePrintSummary);
  $('printPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    $('printPick').querySelectorAll('input').forEach((c) => { c.checked = b.dataset.pick === 'all'; });
    updatePrintSummary();
  });
  $('historyBtn').addEventListener('click', openHistory);
  $('historyList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-restore]');
    if (b) restoreHistory(+b.dataset.restore, b.dataset.when);
  });
  $('hoursBtn').addEventListener('click', openHours);
  $('moreBtn').addEventListener('click', () => togglePanel('moreMenu'));
  $('replaceBtn').addEventListener('click', openReplace);
  const snip = $('snipbar');
  snip.addEventListener('mousedown', (e) => { if (state.editing && e.target.closest('button')) e.preventDefault(); }); // 고치던 칸 포커스 유지 (아닐 땐 끌기 가능)
  snip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-snip]');
    if (b) snipClick(+b.dataset.snip);
    if (e.target.closest('#snipEdit')) { setView('people'); setTab('snippets'); }
  });
  const onSnipInput = (e) => {
    const el = e.target;
    if (!el.dataset.s) return;
    state.snippets[+el.dataset.s][el.dataset.c] = el.value;
    if (el.dataset.c === 'color') el.className = `colorpick c-${el.value || 'black'}`;
    renderSnipbar();
    markSettingsDirty();
  };
  const onSnipDel = (e) => {
    const up = e.target.closest('[data-sup]');
    const down = e.target.closest('[data-sdown]');
    if (up || down) { nudgeSnippet(+(up || down).dataset[up ? 'sup' : 'sdown'], up ? -1 : 1); return; }
    const b = e.target.closest('[data-sdel]');
    if (!b) return;
    const before = state.snippets.map((x) => ({ ...x }));
    const gone = state.snippets.splice(+b.dataset.sdel, 1)[0];
    renderSnippetRows();
    renderSnipbar();
    markSettingsDirty();
    toast(`「${gone.name}」를 지웠어요.`, { label: '되돌리기', fn: () => { state.snippets = before; renderSnippetRows(); renderSnipbar(); markSettingsDirty(); } });
  };
  ['snippetWork', 'snippetAct'].forEach((id) => { $(id).addEventListener('input', onSnipInput); $(id).addEventListener('click', onSnipDel); });
  $('clearMonth').addEventListener('click', clearMonth);
  const addSnip = (kind) => {
    state.snippets.push({ kind, name: '', text: kind === 'work' ? '출근()' : '', color: '' });
    renderSnippetRows();
    $(`s-name-${state.snippets.length - 1}`).focus();
  };
  $('addWork').addEventListener('click', () => addSnip('work'));
  $('addActivity').addEventListener('click', () => addSnip('activity'));
  $('findText').addEventListener('input', updateReplace);
  $('doReplace').addEventListener('click', doReplace);
  const sg = $('suggest');
  sg.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 포커스 유지
  sg.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) acceptSuggest(+li.dataset.i);
  });
  $('copyHours').addEventListener('click', copyHours);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.close).hidden = true; markMatches(''); }));
  document.addEventListener('click', (e) => {
    if (e.target.closest('.popwrap')) return;
    PANELS.forEach((pid) => { $(pid).hidden = true; });
    markMatches('');
  });
  $('doPrint').addEventListener('click', doPrint);
  window.addEventListener('afterprint', afterPrint);

  // 로그인
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginErr');
    err.textContent = '';
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: { password: $('pw').value } });
      $('pw').value = '';
      if (state.booted) {
        setView('calendar');
        // 로그인이 풀려 못 한 저장 다시 하기
        Object.keys(state.months).forEach((ym) => { if (state.months[ym].pending) saveMonth(ym); });
        if (state.peopleSync.pending) savePeople();
      } else {
        await start();
      }
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  // 달력 종이
  const sheet = $('sheet');
  sheet.addEventListener('click', (e) => {
    if (previewPerson()) return;
    const cell = e.target.closest('.cell.in');
    if (state.stamp) {
      if (cell) stampDay(+cell.dataset.day);
      return;
    }
    if (state.pick) {
      if (cell) finishPick(+cell.dataset.day);
      return;
    }
    if (cell) { startEdit(cell.querySelector('.cell-body'), +cell.dataset.day); return; }
    const notes = e.target.closest('.s-notes');
    if (notes) startEdit(notes, 0);
  });
  sheet.addEventListener('input', (e) => {
    if (e.target.matches('[data-field]')) onFieldInput(e.target);
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.target.matches('[contenteditable][data-field]') && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      e.target.blur();
    }
  });
  sheet.addEventListener('paste', (e) => {
    // 서식 없이 글자만 (plaintext-only 미지원 브라우저 대비)
    if (!e.target.matches('[contenteditable][data-field]')) return;
    e.preventDefault();
    const t = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, t);
  });

  const tools = $('cellTools');
  tools.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 포커스 유지
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'weekday') fillSameWeekday(+tools.dataset.day);
    else if (b.dataset.act === 'snippet') saveCellAsSnippet(+tools.dataset.day);
    else if (b.dataset.act === 'clear') clearDay(+tools.dataset.day);
    else beginPick(b.dataset.act, +tools.dataset.day);
  });

  // 참여자 표
  const rows = $('peopleRows');
  rows.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset.r) return;
    const r = +inp.dataset.r;
    state.peopleRows[r][inp.dataset.c] = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (inp.type === 'checkbox') { inp.closest('tr').classList.toggle('paused', inp.checked); rowsChanged(); return; }
    // 마지막 빈 줄에 쓰기 시작하면 줄을 하나 더 만들어 둠
    if (r === state.peopleRows.length - 1) {
      const id = inp.id;
      const pos = inp.selectionStart;
      renderPeople();
      const again = $(id);
      again.focus();
      again.setSelectionRange(pos, pos);
    }
    rowsChanged();
  });
  rows.addEventListener('paste', (e) => {
    const inp = e.target;
    if (!inp.dataset.r) return;
    const text = e.clipboardData.getData('text/plain') || '';
    if (!/[\t\n]/.test(text.trim())) return; // 한 칸짜리는 그냥 붙여넣기
    e.preventDefault();
    pasteRows(+inp.dataset.r, inp.dataset.c, text);
  });
  rows.addEventListener('keydown', (e) => {
    const inp = e.target;
    if (!inp.dataset.r || e.key !== 'Enter') return;
    e.preventDefault();
    const next = $(`p-${inp.dataset.c}-${+inp.dataset.r + 1}`);
    if (next) next.focus();
  });
  rows.addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const i = +b.dataset.del;
    const before = state.peopleRows.map((r) => ({ ...r }));
    const gone = state.peopleRows[i];
    state.peopleRows.splice(i, 1);
    renderPeople();
    rowsChanged();
    toast(`${gone.name || '빈 줄'}을(를) 지웠어요.`, {
      label: '되돌리기',
      fn: () => { state.peopleRows = before; renderPeople(); rowsChanged(); },
    });
  });
  $('addPerson').addEventListener('click', () => {
    state.peopleRows.push({ name: '', tags: '' });
    renderPeople();
    const last = state.peopleRows.length - 1;
    const target = $(`p-name-${state.peopleRows[last - 1] && !state.peopleRows[last - 1].name ? last - 1 : last}`);
    if (target) target.focus();
  });

  // 기관 휴무일
  $('customForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('chDate').value;
    const name = $('chName').value.trim();
    if (!date || !name) { toast('날짜와 이름을 모두 넣어 주세요.'); return; }
    try {
      await api('/custom-holidays', { method: 'POST', body: { date, name } });
      forgetHolidayMonth(date);
      $('chName').value = '';
      loadCustomHolidays();
      toast(`${date} ${name}을(를) 넣었어요.`);
    } catch (ex) { toast(ex.message); }
  });
  $('customHolidays').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-holiday]');
    if (!b) return;
    const date = b.dataset.delHoliday;
    try {
      await api('/custom-holidays/' + date, { method: 'DELETE' });
      forgetHolidayMonth(date);
      loadCustomHolidays();
    } catch (ex) { toast(ex.message); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.pick) cancelPick();
    if (e.key === 'Escape' && state.stamp) endStamp();
    if (e.key === 'Escape') { PANELS.forEach((pid) => { $(pid).hidden = true; }); $('monthPicker').hidden = true; markMatches(''); }
  });

  // 사용법: 닫으면 상단 [사용법] 버튼으로 다시 열 수 있음
  const setGuide = (open) => {
    $('hint').hidden = !open;
    PANELS.forEach((pid) => { $(pid).hidden = true; });
    if (open) window.scrollTo(0, 0);
    try { localStorage.setItem('hintClosed', open ? '0' : '1'); } catch (e) { /* 무시 */ }
  };
  try {
    if (localStorage.getItem('hintClosed') === '1') $('hint').hidden = true;
  } catch (e) { /* 저장소 없음 */ }
  $('hintClose').addEventListener('click', () => setGuide(false));
  $('helpBtn').addEventListener('click', () => setGuide(true));

  window.addEventListener('resize', fitZoom);
  window.addEventListener('scroll', positionTools, { passive: true });
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  setInterval(poll, POLL_MS);
}

bind();
bindDragDrop();
renderSnipbar();
fitZoom();
updateSaveState();
start();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitAll($('sheet')));
