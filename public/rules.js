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
    DEFAULT_TAG_GROUPS, setTagGroups, getTagGroups: () => TAG_GROUPS, pad, ymKey, daysIn, weekday, shiftMonth,
    parseLine, printedText, lineFor, textFor, splitTags, usedTags, makeMonth, normalizeMonth, parsePeopleText, clearHolidayDays,
  };
}
