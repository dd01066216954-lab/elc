'use strict';
// 꼬리표·글자색·새 달 채우기 규칙 (화면과 상관없는 부분)
// 브라우저에서는 전역으로, 테스트(node)에서는 module.exports 로 쓴다.

/* =========================================================
   반 나누기 — 꼬리표 묶음 (화면의 「반 나누기」 탭에서 바꿈, 아래는 처음 값)
   같은 묶음 안에서 하나도 없는 사람은 그 묶음의 줄을 모두 봅니다.
   (예: 성별을 아직 안 적은 사람은 [남], [여] 줄을 둘 다 받음)
   ========================================================= */
const DEFAULT_TAG_GROUPS = [
  { name: '체육', tags: ['탁구', '배드민턴'] },
  { name: '성별', tags: ['남', '여'] },
  { name: '시간', tags: ['1부', '2부', '3부', '4부'] },
];
let TAG_GROUPS = DEFAULT_TAG_GROUPS.map((g) => g.tags);

// 저장된 반 나누기를 적용 (같은 꼬리표가 두 곳에 있으면 앞의 것만)
function setTagGroups(groups) {
  const seen = new Set();
  TAG_GROUPS = (groups || [])
    .map((g) => (g.tags || []).map((t) => String(t).trim()).filter((t) => t && !seen.has(t) && seen.add(t)))
    .filter((tags) => tags.length);
}

// 자주 쓰는 일정 (처음 값 — 화면의 「자주 쓰는 일정」 탭에서 바꿈)
// kind: 'work' = 출근·근무 줄 (칸 맨 위, 하나만), 'activity' = 활동 (여러 개 가능)
const DEFAULT_SNIPPETS = [
  { kind: 'work', name: '9시~12시', text: '출근(9시~12시)' },
  { kind: 'work', name: '9시~11시', text: '출근(9시~11시)' },
  { kind: 'activity', name: '영화', text: '*영화 감상\n→감상문 쓰기' },
  { kind: 'activity', name: '노래+댄스', text: '*노래+댄스' },
  { kind: 'activity', name: '글쓰기', text: '*글쓰기' },
  { kind: 'activity', name: '체육', text: '[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터' },
  { kind: 'activity', name: '자립아카데미', text: '*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)' },
  { kind: 'activity', name: '우천 안내', text: '!우천 시 실내 체육관으로 모임' },
];

/* ===== 칸 = 출근 줄 + 활동 줄 ===== */
const isWorkLine = (line) => /출근/.test(line) || (/근무/.test(line) && /\d\s*(시|:)/.test(line));
const cellLines = (text) => String(text || '').split('\n').filter((l) => l.trim());
const snipLines = (snip) => cellLines(snip.text);

// 출근 줄 바꾸기 (칸 맨 위로). 같은 걸 다시 누르면 지움
function applyWork(text, snip) {
  const lines = cellLines(text);
  const work = lines.filter(isWorkLine);
  const rest = lines.filter((l) => !isWorkLine(l));
  const add = snipLines(snip);
  const same = work.length === add.length && add.every((l) => work.some((x) => sameLine(x, l)));
  return (same ? rest : [...add, ...rest]).join('\n');
}
// 글자색 표시(! * →)는 빼고 비교 — 색만 바꾼 활동도 같은 활동으로 봄
const sameLine = (a, b) => recolorLine(a, 'black').trim() === recolorLine(b, 'black').trim();
const hasBlock = (text, snip) => { const lines = cellLines(text); const add = snipLines(snip); return add.length > 0 && add.every((l) => lines.some((x) => sameLine(x, l))); };
function removeBlock(text, snip) {
  const lines = cellLines(text);
  for (const l of snipLines(snip)) { const i = lines.findIndex((x) => sameLine(x, l)); if (i >= 0) lines.splice(i, 1); }
  return lines.join('\n');
}
// 활동 넣기/빼기 (이미 있으면 뺌)
function toggleActivity(text, snip) {
  if (hasBlock(text, snip)) return removeBlock(text, snip);
  return [...cellLines(text), ...snipLines(snip)].join('\n');
}
// 활동을 이것 하나로 (출근 줄은 그대로)
function replaceActivities(text, snip) {
  return [...cellLines(text).filter(isWorkLine), ...snipLines(snip)].join('\n');
}
// 한 줄의 글자색 바꾸기 (꼬리표는 그대로)
//   빨강: 맨 앞에 '!'   파랑: '*'나 '→'로 시작(없으면 '*' 붙임)   검정: 앞의 ! * → 떼기
function recolorLine(line, color) {
  const p = parseLine(line);
  let body = p.rest.trimStart();
  if (body.startsWith('!')) body = body.slice(1).trimStart();
  if (color === 'black') body = body.replace(/^[*→]\s*/, '');
  if (color === 'blue' && !/^[*→]/.test(body)) body = '*' + body;
  if (color === 'red') body = '!' + body;
  return p.head + body;
}
const lineColorName = (line) => parseLine(line).color || 'black';

// 예전(종류 없는) 자주 쓰는 일정을 출근/활동으로 나눔
function splitSnippets(list) {
  const out = [];
  const seen = new Set();
  const push = (x) => { const k = x.kind + '\u0000' + x.text; if (!seen.has(k) && x.text.trim()) { seen.add(k); out.push(x); } };
  for (const x of list || []) {
    if (x.kind === 'work' || x.kind === 'activity') { push(x); continue; }
    const lines = cellLines(x.text);
    const work = lines.filter(isWorkLine);
    const rest = lines.filter((l) => !isWorkLine(l));
    if (work.length) push({ kind: 'work', name: work.join(' ').replace(/^.*?(\d.*\d\s*시?\)?).*$/, '$1').replace(/[()]/g, '').slice(0, 12) || '출근', text: work.join('\n') });
    if (rest.length) push({ kind: 'activity', name: x.name, text: rest.join('\n') });
  }
  return out;
}

// 칸 내용으로 버튼 이름 짐작: '*영화 감상' → '영화 감상'
function guessSnippetName(text) {
  const lines = String(text || '').split('\n').map(parseLine).filter((p) => printedText(p).trim());
  const pick = lines.find((p) => p.color && !/출근|근무/.test(p.rest)) || lines[0];
  if (!pick) return '새 일정';
  return printedText(pick).replace(/^[*→]\s*/, '').replace(/\s*\(.*$/, '').trim().slice(0, 12) || '새 일정';
}

const DEFAULT_MONTH = {
  guide: '*9시~9시30분: 명상 *9시30분~11시30분: 본 수업 *11시30분~11시50분: 마무리(일지작성)',
  headers: ['일', '월', '화', '수', '목', '금', '토'],
  notes: '',
};

/* ===== 날짜 ===== */
const pad = (n) => String(n).padStart(2, '0');
const ymKey = (y, m) => `${y}-${pad(m)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const weekday = (y, m, d) => new Date(y, m - 1, d).getDay();
const shiftMonth = (y, m, delta) => {
  const t = new Date(y, m - 1 + delta, 1);
  return [t.getFullYear(), t.getMonth() + 1];
};

/* ===== 줄 해석 ===== */
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

// 이 사람이 받을 칸 내용 (인쇄 글자 그대로)
function textFor(text, person) {
  return (text || '').split('\n').map(parseLine).filter((p) => lineFor(p, person)).map(printedText).join('\n');
}

// "탁구, 2부" / "탁구 2부" / "탁구/2부" → ['탁구', '2부']
function splitTags(s) {
  return String(s || '').split(/[,，/·\s]+/).map((t) => t.replace(/["\[\]]/g, '').trim()).filter(Boolean);
}

// 참여자 파일/붙여넣기 글자 → [{ name, tags[] }]
// 한 줄에 한 사람. 이름과 꼬리표는 탭(엑셀), 쉼표(csv), 또는 띄어쓰기로 구분.
//   홍길동<탭>탁구, 2부   /   홍길동,탁구,2부   /   홍길동 탁구 2부
// 첫 줄이 '이름'으로 시작하면 제목 줄로 보고 건너뜀
function parsePeopleText(text) {
  const out = [];
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cells;
    if (line.includes('\t')) cells = line.split('\t');
    else if (/[,，]/.test(line)) cells = line.split(/[,，]/);
    else cells = line.split(/\s+/);
    cells = cells.map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    const name = cells[0];
    if (!name || (!out.length && /^(이름|성명)$/.test(name))) continue;
    out.push({ name, tags: splitTags(cells.slice(1).join(',')) });
  }
  return out;
}

// 참여자들에게 실제로 쓰인 꼬리표 (묶음 순서 먼저)
function usedTags(people) {
  const seen = new Set();
  for (const p of people) p.tags.forEach((t) => seen.add(t));
  const ordered = TAG_GROUPS.flat().filter((t) => seen.has(t));
  for (const t of seen) if (!ordered.includes(t)) ordered.push(t);
  return ordered;
}

/* ===== 새 달: 지난달 같은 요일 패턴 복사 =====
   N번째 주 월요일 ← 지난달(또는 가장 가까운 이전 달) N번째 주 월요일
   없거나 그날이 공휴일(평일)이라 비어 있으면 직전 주 → 그래도 없으면 다음 주
   공휴일인 평일은 비운다 */
function makeMonth(y, m, prev, isHoliday, from) {
  const month = {
    title: `${m}월 일자리 근무 일정표 및 수업계획표`,
    guide: prev ? prev.guide : DEFAULT_MONTH.guide,
    headers: prev ? [...prev.headers] : [...DEFAULT_MONTH.headers],
    notes: prev ? prev.notes : DEFAULT_MONTH.notes,
    days: {},
    holidaysApplied: [], // 공휴일이라 일정을 비운 날 (다시 비우지 않도록 기억)
  };
  for (let d = 1; d <= daysIn(y, m); d++) if (isHoliday(y, m, d)) month.holidaysApplied.push(String(d));
  if (!prev) return month;
  const renamed = prev.title.replace(/^\s*\d{1,2}월/, `${m}월`);
  if (renamed !== prev.title) month.title = renamed;

  // from: 복사해 올 달 [년, 월] (없으면 지난달)
  const [py, pm] = from || shiftMonth(y, m, -1);
  const occ = Array.from({ length: 7 }, () => []);
  for (let d = 1; d <= daysIn(py, pm); d++) occ[weekday(py, pm, d)].push(d);
  const usable = (d) => !isHoliday(py, pm, d) && !!(prev.days[d] || '').trim();

  for (let d = 1; d <= daysIn(y, m); d++) {
    const w = weekday(y, m, d);
    if (isHoliday(y, m, d)) continue; // 공휴일은 비움 (주말 공휴일 포함)
    const n = Math.ceil(d / 7) - 1;
    const list = occ[w];
    const order = [];
    for (let i = Math.min(n, list.length - 1); i >= 0; i--) order.push(i);
    for (let i = n + 1; i < list.length; i++) order.push(i);
    const src = order.map((i) => list[i]).find(usable);
    if (src) month.days[d] = prev.days[src];
  }
  return month;
}

/* ===== 근무시간 =====
   '출근'이나 '근무'가 들어간 줄에서 시간 범위를 찾아 더한다.
   9시~12시 · 9시30분~11시30분 · 9시반~11시 · 13:00~15:30 · 11시~1시(=2시간)
   공휴일 등으로 비운 날은 0, 그 사람에게 안 가는 줄([배드민턴] 등)은 빼고 셈 */
const TIME = String.raw`(\d{1,2})\s*(?:시(?:\s*(\d{1,2})\s*분|\s*(반))?|:(\d{2}))`;
const TIME_RANGE = new RegExp(TIME + String.raw`\s*[~∼〜\-–]\s*` + TIME, 'g');
const toHour = (h, m, half, mm) => +h + (m ? +m / 60 : 0) + (half ? 0.5 : 0) + (mm ? +mm / 60 : 0);

function workHoursOfLine(line) {
  if (!/출근|근무/.test(line)) return 0;
  let total = 0;
  for (const g of line.matchAll(TIME_RANGE)) {
    const start = toHour(g[1], g[2], g[3], g[4]);
    let end = toHour(g[5], g[6], g[7], g[8]);
    if (end <= start) end += 12; // 11시~1시 → 오후 1시
    if (end - start <= 12) total += end - start;
  }
  return total;
}

// 한 사람의 한 달 근무: { days, hours, noTime: 시간이 안 적힌 출근 날 수 }
function workSummary(month, person) {
  let days = 0, hours = 0, noTime = 0;
  for (const text of Object.values(month.days || {})) {
    const lines = textFor(text, person).split('\n');
    const h = lines.reduce((sum, l) => sum + workHoursOfLine(l), 0);
    if (h > 0) { days++; hours += h; } else if (lines.some((l) => /출근|근무/.test(l))) noTime++;
  }
  return { days, hours: Math.round(hours * 100) / 100, noTime };
}

// 하루 칸의 근무시간 범위 (사람마다 받는 줄이 달라서 min~max). 근무 줄이 없으면 null
function dayHoursRange(text, people) {
  const calc = (p) => textFor(text, p).split('\n').reduce((sum, l) => sum + workHoursOfLine(l), 0);
  const vals = (people && people.length ? people : [{ tags: [] }]).map(calc);
  const round = (x) => Math.round(x * 100) / 100;
  const max = round(Math.max(...vals));
  if (!max) return null;
  return { min: round(Math.min(...vals)), max };
}

/* ===== 자동 완성 =====
   이미 쓴 줄들을 모아 두고, 칸에서 쓰는 중인 줄과 비슷한 것을 보여 준다.
   '[' 로 시작하면 반 나누기 꼬리표를 보여 준다. */
function lineIndex(texts) {
  const index = new Map();
  for (const t of texts) {
    for (const raw of String(t || '').split('\n')) {
      const line = raw.trim();
      if (line) index.set(line, (index.get(line) || 0) + 1);
    }
  }
  return index;
}

function suggestLines(prefix, index, tags, limit = 6) {
  const q = prefix.trim();
  if (!q) return [];
  const tagOnly = prefix.match(/^\s*\[([^\[\]]*)$/);
  if (tagOnly) {
    const part = tagOnly[1].trim();
    return tags.filter((t) => t.startsWith(part)).slice(0, limit).map((t) => ({ text: `[${t}] `, label: `[${t}]`, tag: true }));
  }
  const lower = q.toLowerCase();
  const found = [];
  for (const [line, count] of index) {
    if (line === q) continue;
    const l = line.toLowerCase();
    const body = parseLine(line).rest.trim().toLowerCase(); // 꼬리표 뗀 부분
    if (!l.includes(lower)) continue;
    const starts = l.startsWith(lower) || body.startsWith(lower);
    found.push({ line, score: (starts ? 1000 : 0) + count });
  }
  found.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  return found.slice(0, limit).map((f) => ({ text: f.line, label: f.line }));
}

// 찾아 바꾸기: 칸들에서 찾은 곳 수
function countMatches(texts, word) {
  if (!word) return { cells: 0, hits: 0 };
  let cells = 0, hits = 0;
  for (const t of texts) {
    const n = String(t || '').split(word).length - 1;
    if (n) { cells++; hits += n; }
  }
  return { cells, hits };
}

// 36.5 → '36시간 30분'
function formatHours(h) {
  const whole = Math.floor(h + 1e-9);
  const min = Math.round((h - whole) * 60);
  return min ? `${whole}시간 ${min}분` : `${whole}시간`;
}

// 새로 공휴일이 된 날의 일정 비우기
// holidays: 이 달의 공휴일 날짜(일) 목록. 이미 비운 적 있는 날(holidaysApplied)은 건드리지 않는다
// → 공휴일에 일부러 다시 적은 일정은 그대로 남음
// 반환: { changed, cleared: { 일: 지운 글자 } }
function clearHolidayDays(month, holidayDays) {
  const applied = new Set(month.holidaysApplied || []);
  const cleared = {};
  let changed = false;
  for (const day of holidayDays.map(String)) {
    if (applied.has(day)) continue;
    applied.add(day);
    changed = true;
    if ((month.days[day] || '').trim()) {
      cleared[day] = month.days[day];
      delete month.days[day];
    }
  }
  month.holidaysApplied = [...applied];
  return { changed, cleared };
}

// 저장된 데이터 모양 맞추기
function normalizeMonth(data, m) {
  const d = data || {};
  const headers = Array.isArray(d.headers) ? d.headers.slice(0, 7) : [];
  while (headers.length < 7) headers.push(DEFAULT_MONTH.headers[headers.length]);
  return {
    title: typeof d.title === 'string' ? d.title : `${m}월 일자리 근무 일정표 및 수업계획표`,
    guide: typeof d.guide === 'string' ? d.guide : DEFAULT_MONTH.guide,
    headers: headers.map(String),
    notes: typeof d.notes === 'string' ? d.notes : '',
    days: d.days && typeof d.days === 'object' ? { ...d.days } : {},
    holidaysApplied: Array.isArray(d.holidaysApplied) ? d.holidaysApplied.map(String) : [],
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULT_TAG_GROUPS, DEFAULT_SNIPPETS, guessSnippetName, isWorkLine, applyWork, hasBlock, toggleActivity, replaceActivities, splitSnippets, recolorLine, lineColorName, setTagGroups, getTagGroups: () => TAG_GROUPS, pad, ymKey, daysIn, weekday, shiftMonth,
    parseLine, printedText, lineFor, textFor, splitTags, usedTags, makeMonth, normalizeMonth, parsePeopleText, clearHolidayDays, workHoursOfLine, workSummary, formatHours, dayHoursRange, lineIndex, suggestLines, countMatches,
  };
}
