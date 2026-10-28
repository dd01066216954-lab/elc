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

/* ===== 특일 정보 API (월간 일정표와 같은 코드) ===== */
export const HOLIDAY_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

export async function fetchHolidayApi(key, ym) {
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

// 공휴일 API 실패 이유를 알아듣기 쉬운 말로 (Cloudflare 로그에 남김)
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
