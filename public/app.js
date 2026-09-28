'use strict';

/* =========================================================
   설정 — 꼬리표 묶음
   같은 묶음 안에서 하나도 없는 사람은 그 묶음의 줄을 모두 봅니다.
   (예: 성별을 아직 안 적은 사람은 [남], [여] 줄을 둘 다 받음)
   ========================================================= */
const TAG_GROUPS = [
  ['탁구', '배드민턴'],
  ['남', '여'],
  ['1부', '2부', '3부', '4부'],
];

// 편집 화면에서 꼬리표 줄 배경색 (인쇄에는 안 나옴)
const TAG_COLORS = {
  '탁구': '#e3f4e1', '배드민턴': '#fff1c7',
  '남': '#e0ebfb', '여': '#fbe3ec',
  '1부': '#efe6fa', '2부': '#dff2f4', '3부': '#fbecdc', '4부': '#eceff3',
};
const TAG_COLOR_OTHER = '#eeeeee';

const BASE_FONT = 11;   // 칸 기본 글자 크기(px)
const MIN_FONT = 6.5;   // 넘칠 때 줄일 수 있는 최소 크기
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/* ---------------------------------------------------------
   임시 데이터 (1단계 미리보기용)
   - 공휴일: 3단계에서 공공데이터포털 API + D1 캐시로 바뀜
   - 참여자: 2단계에서 참여자 화면(엑셀 붙여넣기)으로 바뀜. 아래는 가짜 예시 이름.
   --------------------------------------------------------- */
const DEMO_HOLIDAYS = {
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '대체공휴일',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날',
  '2026-12-25': '성탄절', '2027-01-01': '신정',
};
const DEMO_PEOPLE = [
  { name: '김예시', tags: ['탁구', '남', '1부'] },
  { name: '이예시', tags: ['배드민턴', '여', '2부'] },
  { name: '박예시', tags: ['탁구', '여', '3부'] },
  { name: '최예시', tags: [] },
];

function sampleSeptember() {
  const byWeekday = {
    1: '출근(9시~12시)\n*영화 감상\n→감상문 쓰기',
    2: '출근(9시~12시)\n*노래+댄스\n→3층 강당',
    3: '출근(9시~12시)\n*글쓰기\n→주제: 나의 하루',
    4: '출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터',
    5: '출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)',
  };
  const days = {};
  const n = daysIn(2026, 9);
  for (let d = 1; d <= n; d++) {
    const w = weekday(2026, 9, d);
    if (holidayName(2026, 9, d)) continue;
    if (byWeekday[w]) days[d] = byWeekday[w];
  }
  days[10] += '\n!우천 시 실내 체육관으로 모임';
  days[16] = '출근(9시~12시)\n*글쓰기\n[1부][2부] →개별상담 10시\n[3부][4부] →개별상담 11시';
  days[23] = '출근(9시~12시)\n*추석맞이 송편 만들기\n→준비물: 앞치마';
  days[30] = '출근(9시~12시)\n*글쓰기\n→9월 활동 돌아보기';
  return {
    title: '9월 일자리 근무 일정표 및 수업계획표',
    guide: '*9시~9시30분: 명상 *9시30분~11시30분: 본 수업 *11시30분~11시50분: 마무리(일지작성)',
    headers: ['일', '월(영화)', '화(노래+댄스)', '수(글쓰기)', '목(관리자 휴무)', '금(자립아카데미)', '토'],
    notes: '*결근·지각할 때는 꼭 담당 선생님께 미리 연락해 주세요.\n*센터 사정에 따라 일정이 바뀔 수 있어요. 바뀌면 다시 알려 드려요.',
    days,
  };
}

/* ===== 날짜 도우미 ===== */
const pad = (n) => String(n).padStart(2, '0');
const ymKey = (y, m) => `${y}-${pad(m)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const weekday = (y, m, d) => new Date(y, m - 1, d).getDay();
const shiftMonth = (y, m, delta) => {
  const t = new Date(y, m - 1 + delta, 1);
  return [t.getFullYear(), t.getMonth() + 1];
};
const holidayName = (y, m, d) => DEMO_HOLIDAYS[`${y}-${pad(m)}-${pad(d)}`] || '';

/* ===== 줄 해석: 꼬리표 · 글자색 ===== */
const TAG_PREFIX = /^\s*((?:\[[^\[\]\n]+\]\s*)+)/;

function parseLine(raw) {
  const m = raw.match(TAG_PREFIX);
  const tags = m ? [...m[1].matchAll(/\[([^\[\]]+)\]/g)].map((x) => x[1].trim()) : [];
  const head = m ? raw.slice(0, m[0].length) : '';
  const rest = m ? raw.slice(m[0].length) : raw;
  const t = rest.trimStart();
  let color = '';
  if (t.startsWith('!')) color = 'red';
  else if (t.startsWith('*') || t.startsWith('→')) color = 'blue';
  return { raw, tags, head, rest, color };
}

// 인쇄용 글자: 꼬리표와 맨 앞 '!' 제거
function printedText(p) {
  let t = p.rest.trimStart();
  if (p.color === 'red') t = t.slice(1).trimStart();
  return t;
}

const groupOf = (tag) => TAG_GROUPS.findIndex((g) => g.includes(tag));

// 한 줄이 이 사람에게 들어가는지
// - 같은 묶음 꼬리표가 여러 개면 그중 하나만 맞아도 됨 ([1부][2부])
// - 사람이 그 묶음 꼬리표를 하나도 안 가졌으면 보여줌
// - 묶음에 없는 꼬리표는 그 꼬리표를 가진 사람에게만
function lineFor(p, person) {
  if (!person || !p.tags.length) return true;
  const mine = person.tags;
  const byGroup = new Map();
  for (const tag of p.tags) {
    const g = groupOf(tag);
    const key = g >= 0 ? `g${g}` : `t:${tag}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(tag);
  }
  for (const [key, tags] of byGroup) {
    if (tags.some((t) => mine.includes(t))) continue;
    if (key.startsWith('g') && !TAG_GROUPS[+key.slice(1)].some((t) => mine.includes(t))) continue;
    return false;
  }
  return true;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 여러 줄 텍스트 → HTML
// 편집 화면: 원문 그대로(꼬리표 보임, 배경색) — 입력칸과 글자 위치가 정확히 겹쳐야 함
// 미리보기/인쇄: 해당 줄만, 꼬리표·'!' 제거
function linesHTML(text, person) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    const p = parseLine(raw);
    if (!person) {
      const bg = p.tags.length ? ` tagged" style="background:${TAG_COLORS[p.tags[0]] || TAG_COLOR_OTHER}` : '';
      const body = p.head ? `<span class="tg">${esc(p.head)}</span>${esc(p.rest)}` : esc(p.rest);
      out.push(`<div class="ln ${p.color}${bg}">${body || '<br>'}</div>`);
    } else if (lineFor(p, person)) {
      const t = printedText(p);
      out.push(`<div class="ln ${p.color}">${t ? esc(t) : '<br>'}</div>`);
    }
  }
  return out.join('');
}

function lineColor(text) {
  return parseLine(text || '').color;
}

/* ===== 상태 ===== */
const state = {
  y: 2026,
  m: 9,
  months: {},          // 'YYYY-MM' → { title, guide, headers[7], notes, days{d:text} }
  people: DEMO_PEOPLE,
  preview: '',         // 미리보기 대상 이름 ('' = 편집)
  pick: null,          // { mode:'move'|'swap', from:d }
  editing: null,       // { box, textarea, day? }
  noticeShown: {},
};
state.months['2026-09'] = sampleSeptember();

const $ = (id) => document.getElementById(id);
const cur = () => state.months[ymKey(state.y, state.m)];
const previewPerson = () => state.people.find((p) => p.name === state.preview) || null;

/* ===== 새 달 만들기: 지난달 같은 요일 패턴 복사 ===== */
function makeMonth(y, m) {
  const [py, pm] = shiftMonth(y, m, -1);
  const prev = state.months[ymKey(py, pm)];
  const base = {
    title: `${m}월 일자리 근무 일정표 및 수업계획표`,
    guide: prev ? prev.guide : '',
    headers: prev ? [...prev.headers] : DAY_NAMES.slice(),
    notes: prev ? prev.notes : '',
    days: {},
  };
  if (!prev) return { month: base, copied: false };
  base.title = prev.title.replace(/^\s*\d{1,2}월/, `${m}월`);
  if (base.title === prev.title) base.title = `${m}월 일자리 근무 일정표 및 수업계획표`;

  // 지난달 요일별 날짜 목록
  const occ = Array.from({ length: 7 }, () => []);
  for (let d = 1; d <= daysIn(py, pm); d++) occ[weekday(py, pm, d)].push(d);
  const usable = (d) => {
    const w = weekday(py, pm, d);
    const skip = holidayName(py, pm, d) && w !== 0 && w !== 6;
    return !skip && (prev.days[d] || '').trim();
  };

  for (let d = 1; d <= daysIn(y, m); d++) {
    const w = weekday(y, m, d);
    if (holidayName(y, m, d) && w !== 0 && w !== 6) continue; // 공휴일 평일은 비움
    const n = Math.ceil(d / 7) - 1;              // 이번 달에서 몇 번째 그 요일인지 (0부터)
    const list = occ[w];
    // N번째 → 없거나 공휴일이면 직전 주들 → 그래도 없으면 이후 주
    const order = [];
    for (let i = Math.min(n, list.length - 1); i >= 0; i--) order.push(i);
    for (let i = n + 1; i < list.length; i++) order.push(i);
    const src = order.map((i) => list[i]).find(usable);
    if (src) base.days[d] = prev.days[src];
  }
  return { month: base, copied: true };
}

function goMonth(delta) {
  stopEdit();
  cancelPick();
  [state.y, state.m] = shiftMonth(state.y, state.m, delta);
  const key = ymKey(state.y, state.m);
  let copied = false;
  if (!state.months[key]) {
    const r = makeMonth(state.y, state.m);
    state.months[key] = r.month;
    copied = r.copied;
  }
  render();
  if (copied && !state.noticeShown[key]) {
    state.noticeShown[key] = true;
    showNotice('지난달 기준으로 채웠어요. 바뀐 날만 고치세요.', [{ label: '확인', fn: hideNotice }]);
  } else {
    hideNotice();
  }
}

/* ===== 그리기 ===== */
function render() {
  const mo = cur();
  const person = previewPerson();
  const { y, m } = state;
  $('monthLabel').textContent = `${y}년 ${m}월`;

  const first = weekday(y, m, 1);
  const total = daysIn(y, m);
  const weeks = Math.ceil((first + total) / 7);
  const editable = !person;
  const ce = editable ? contentEditableValue() : 'false';

  let html = '';
  html += `<div class="s-top">
      <div class="s-title${editable ? ' editable' : ''}" data-field="title" contenteditable="${ce}" spellcheck="false">${esc(mo.title)}</div>
      <div class="s-name">성명: ${person ? `<b>${esc(person.name)}</b>` : '<span class="blank">사람마다 자동</span>'}</div>
    </div>
    <div class="s-guide ln ${lineColor(mo.guide)}${editable ? ' editable' : ''}" data-field="guide" contenteditable="${ce}" spellcheck="false">${esc(mo.guide)}</div>`;

  html += `<div class="cal" style="grid-template-rows: 7mm repeat(${weeks}, minmax(0, 1fr))">`;
  mo.headers.forEach((h, i) => {
    html += `<div class="hd ${i === 0 ? 'c-sun' : i === 6 ? 'c-sat' : ''}${editable ? ' editable' : ''}" data-field="header" data-i="${i}" contenteditable="${ce}" spellcheck="false">${esc(h)}</div>`;
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
    if (hn) cls.push('holiday');
    if (editable) cls.push('editable');
    html += `<div class="${cls.join(' ')}" data-day="${d}">
        <div class="cell-head"><span class="dnum">${d}</span>${hn ? `<span class="hname">${esc(hn)}</span>` : ''}</div>
        <div class="cell-body"><div class="lines">${linesHTML(mo.days[d], person)}</div></div>
      </div>`;
  }
  html += '</div>';

  const mine = person
    ? (person.tags.length ? `<div class="s-mine">나의 배정: ${esc(person.tags.join(' / '))}</div>` : '')
    : '<div class="s-mine ghost">나의 배정: (인쇄할 때 사람마다 자동으로 들어가요)</div>';
  html += `<div class="s-foot">
      <div class="s-notes${editable ? ' editable' : ''}" data-field="notes"><div class="lines">${linesHTML(mo.notes, person)}</div></div>
      ${mine}
    </div>`;

  const sheet = $('sheet');
  sheet.innerHTML = html;
  sheet.classList.toggle('picking', !!state.pick);
  fitAll();
  renderPreviewBanner();
}

function fit(box) {
  const lines = box.querySelector('.lines');
  let fs = BASE_FONT;
  box.style.fontSize = fs + 'px';
  while (fs > MIN_FONT && lines.scrollHeight > box.clientHeight + 0.5) {
    fs -= 0.5;
    box.style.fontSize = fs + 'px';
  }
  const cell = box.closest('.cell');
  if (cell) cell.classList.toggle('overflow', lines.scrollHeight > box.clientHeight + 0.5);
}
function fitAll() {
  document.querySelectorAll('#sheet .cell-body, #sheet .s-notes').forEach(fit);
}

function fitZoom() {
  const wrap = $('sheetWrap');
  const paperPx = 297 * 96 / 25.4;
  const avail = document.documentElement.clientWidth - 32;
  const z = Math.max(0.3, Math.min(1.3, avail / paperPx));
  wrap.style.zoom = z;
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

/* ===== 칸 안에서 바로 편집 ===== */
function startEdit(box, day) {
  if (state.editing && state.editing.box === box) return;
  stopEdit();
  const mo = cur();
  const text = day ? (mo.days[day] || '') : (mo.notes || '');
  const ta = document.createElement('textarea');
  ta.className = 'ed';
  ta.spellcheck = false;
  ta.value = text;
  box.appendChild(ta);
  const host = day ? box.closest('.cell') : box;
  host.classList.add('editing');
  state.editing = { box, ta, day, host };

  ta.addEventListener('input', () => {
    if (day) {
      if (ta.value) mo.days[day] = ta.value; else delete mo.days[day];
    } else {
      mo.notes = ta.value;
    }
    box.querySelector('.lines').innerHTML = linesHTML(ta.value, null);
    fit(box);
    markDirty();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('blur', () => stopEdit());
  ta.focus();
  const end = ta.value.length;
  ta.setSelectionRange(end, end);
  if (day) showTools(host);
}

function stopEdit() {
  const ed = state.editing;
  if (!ed) return;
  state.editing = null;
  ed.ta.remove();
  ed.host.classList.remove('editing');
  hideTools();
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
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  let left = Math.min(r.left, document.documentElement.clientWidth - t.offsetWidth - 8);
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
  const msg = mode === 'move'
    ? `${from}일 내용을 ${to}일로 옮겼어요.`
    : `${from}일과 ${to}일 내용을 바꿨어요.`;
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
  const n = $('notice');
  n.hidden = true;
  n.dataset.kind = '';
  renderPreviewBanner();
}
function renderPreviewBanner() {
  const n = $('notice');
  const person = previewPerson();
  if (n.dataset.kind === 'notice' && !n.hidden) return;
  if (!person) { n.hidden = true; return; }
  n.innerHTML = `<p><b>${esc(person.name)}</b> 님 계획표로 보는 중이에요. 이 상태에서는 고칠 수 없어요.</p><div class="acts"><button type="button" class="btn">다시 고치기</button></div>`;
  n.querySelector('button').addEventListener('click', () => { $('previewSelect').value = ''; setPreview(''); });
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
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}

function markDirty() {
  // 2단계(저장)에서 1초 뒤 자동 저장으로 연결
  $('saveState').textContent = '시험판 · 저장 안 됨';
}

function setPreview(name) {
  stopEdit();
  cancelPick();
  state.preview = name;
  const n = $('notice');
  if (n.dataset.kind === 'preview') { n.hidden = true; n.dataset.kind = ''; }
  render();
}

/* ===== 이벤트 ===== */
function bind() {
  $('prevMonth').addEventListener('click', () => goMonth(-1));
  $('nextMonth').addEventListener('click', () => goMonth(1));

  const sel = $('previewSelect');
  sel.innerHTML = '<option value="">전체 (고치기)</option>' +
    state.people.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.tags.length ? ` · ${esc(p.tags.join(', '))}` : ''}</option>`).join('');
  sel.addEventListener('change', () => setPreview(sel.value));

  $('peopleBtn').addEventListener('click', () => toast('참여자 화면은 다음 단계에서 연결돼요.'));
  $('printBtn').addEventListener('click', () => toast('개인별 인쇄는 다음 단계에서 연결돼요.'));

  const sheet = $('sheet');
  sheet.addEventListener('click', (e) => {
    if (previewPerson()) return;
    const cell = e.target.closest('.cell.in');
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
    // 서식 없이 글자만 붙여넣기 (plaintext-only 미지원 브라우저 대비)
    if (!e.target.matches('[contenteditable][data-field]')) return;
    e.preventDefault();
    const t = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, t);
  });

  const tools = $('cellTools');
  tools.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 포커스 유지
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) beginPick(b.dataset.act, +tools.dataset.day);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.pick) cancelPick();
  });

  try {
    if (localStorage.getItem('hintClosed') === '1') $('hint').hidden = true;
  } catch (e) { /* 저장소 없음 */ }
  $('hintClose').addEventListener('click', () => {
    $('hint').hidden = true;
    try { localStorage.setItem('hintClosed', '1'); } catch (e) { /* 무시 */ }
  });

  window.addEventListener('resize', fitZoom);
  window.addEventListener('scroll', positionTools, { passive: true });
}

bind();
render();
fitZoom();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
