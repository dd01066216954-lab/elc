// 대체공휴일 계산 (「관공서의 공휴일에 관한 규정」 제3조, 2023년 개정 기준)
// 특일 정보 API가 대체공휴일을 늦게 올리거나 빠뜨리는 경우가 있어 직접 계산해 채운다.
//
// - 설날·추석 연휴(3일)가 일요일 또는 다른 공휴일과 겹치면 → 연휴 다음 첫 번째 쉬지 않는 날
// - 3·1절, 어린이날, 부처님오신날, 광복절, 개천절, 한글날, 기독탄신일이
//   토요일·일요일 또는 다른 공휴일과 겹치면 → 그날 다음 첫 번째 쉬지 않는 날
// - 신정, 현충일, 선거일, 임시공휴일은 대체공휴일이 없다
// 같은 날에 겹친 경우(예: 어린이날 = 부처님오신날)는 하루만 준다.

const LUNAR = /설날|추석/;
const WEEKEND_RULE = /삼일절|3[·.]1절|어린이날|부처님\s*오신\s*날|석가탄신일|광복절|개천절|한글날|기독탄신일|성탄절/;

const dayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const nextDate = (date) => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

// rows: [{ date: 'YYYY-MM-DD', name }] — 같은 날짜가 여러 번 있을 수 있음(겹친 공휴일)
// 반환: 계산한 대체공휴일 [{ date, name: '대체공휴일' }] (API에 이미 있는 날은 빼고)
export function substituteHolidays(rows) {
  const given = rows.filter((r) => /대체/.test(r.name)).map((r) => r.date);
  const base = rows.filter((r) => !/대체/.test(r.name));
  const count = new Map();
  for (const r of base) count.set(r.date, (count.get(r.date) || 0) + 1);

  // 대체공휴일을 불러오는 날 → 그 뒤로 찾기 시작할 날
  const triggers = new Map(); // date → searchFrom

  // 설날·추석: 붙어 있는 같은 이름 날짜를 한 연휴로 묶음
  const lunar = base.filter((r) => LUNAR.test(r.name)).sort((a, b) => a.date.localeCompare(b.date));
  const blocks = [];
  for (const r of lunar) {
    const kind = r.name.match(LUNAR)[0];
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && (last.dates.at(-1) === r.date || nextDate(last.dates.at(-1)) === r.date)) {
      if (last.dates.at(-1) !== r.date) last.dates.push(r.date);
    } else {
      blocks.push({ kind, dates: [r.date] });
    }
  }
  for (const b of blocks) {
    const end = b.dates.at(-1);
    for (const d of b.dates) if (dayOf(d) === 0 || count.get(d) > 1) triggers.set(d, end);
  }

  for (const r of base) {
    if (!WEEKEND_RULE.test(r.name)) continue;
    const w = dayOf(r.date);
    if ((w === 0 || w === 6 || count.get(r.date) > 1) && !triggers.has(r.date)) triggers.set(r.date, r.date);
  }

  const taken = new Set(count.keys());
  const out = [];
  const order = [...triggers.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  for (const [, from] of order) {
    let d = nextDate(from);
    while (taken.has(d) || dayOf(d) === 0 || dayOf(d) === 6) d = nextDate(d);
    taken.add(d);
    if (!given.includes(d)) out.push({ date: d, name: '대체공휴일' });
  }
  return out;
}
