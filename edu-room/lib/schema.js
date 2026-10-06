// DB 표 만들기 — 앱이 처음 요청을 받을 때 저절로 한 번 실행된다.
// (Cloudflare 화면에서 SQL을 따로 붙여넣을 필요 없음. 여러 번 실행돼도 안전)
// 나중에 4층 프로그램실도 붙일 수 있게 모든 표에 room 을 둔다. 지금은 '4f-edu' 하나.

export const ROOM = '4f-edu';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS depts (
    id INTEGER PRIMARY KEY, room TEXT NOT NULL, name TEXT NOT NULL,
    color_idx INTEGER NOT NULL, pin_hash TEXT, sort INTEGER NOT NULL,
    UNIQUE(room, name))`,
  `CREATE TABLE IF NOT EXISTS months (
    room TEXT NOT NULL, ym TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0, imported_from TEXT, imported_n INTEGER,
    PRIMARY KEY(room, ym))`,
  // 신청서 한 줄. sel = {wd,add,off} JSON, pend_prev = 승인 전 값 JSON
  `CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY, room TEXT NOT NULL, ym TEXT NOT NULL,
    dept TEXT NOT NULL, person TEXT, prog TEXT, sel TEXT NOT NULL,
    time TEXT, note TEXT, yield INTEGER NOT NULL DEFAULT 0,
    pend_kind TEXT, pend_prev TEXT, updated_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS rows_month ON rows (room, ym)',
  // 현황표에서 그날만 바꾼 것. type 'add'(blk = {dept,prog,time,half}) | 'remove'(row_id)
  `CREATE TABLE IF NOT EXISTS ops (
    id TEXT PRIMARY KEY, room TEXT NOT NULL, ym TEXT NOT NULL, d INTEGER NOT NULL,
    type TEXT NOT NULL, row_id TEXT, blk TEXT,
    pend_kind TEXT, pend_prev TEXT, updated_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS ops_month ON ops (room, ym)',
  // rules(이용 규칙), admin_pin_hash, token_secret
  'CREATE TABLE IF NOT EXISTS settings (room TEXT, key TEXT, value TEXT, PRIMARY KEY(room, key))',
  'CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL)',
];

const RULES = '1. 이용시간을 지킵니다.\n2. 시설과 물건을 소중히 다루고 깨끗이 사용합니다.\n3. 사용 후에는 전원 스위치를 확인하고 소독 및 정리를 합니다.';

// [부서, 색 번호]  — 시안과 같은 순서·색
const DEPTS = [['자립지원', 3], ['늘사랑주간보호', 1], ['주간활동', 2], ['활동지원', 5], ['방과후활동', 4]];

// 시안의 10월 예시 일정 (처음 한 번만 들어감. 관리자 「10월 전부 지우기」로 지울 수 있음)
// [부서, 프로그램, 요일, 시간, 콕 찍은 날, 겹치면 양보]
const SAMPLE = [
  ['자립지원', '일자리사업(환경미화)', [1, 2, 3, 4], '9:00~12:00', [], true],
  ['자립지원', '일자리사업(환경미화)', [5], '9:00~11:00', [], true],
  ['자립지원', '자립시어터', [], '11:00~15:30', [12]],
  ['자립지원', '싱싱쑹', [5], '9:30~10:30'],
  ['주간활동', '생활체육', [5], '10:30~12:00'],
  ['늘사랑주간보호', '특수체육', [1], '13:00~14:30'],
  ['주간활동', '특수체육', [2], '13:30~14:10'],
  ['늘사랑주간보호', '상담', [3], '13:00~14:30'],
  ['자립지원', '건강수업', [4], '1:30~2:30'],
  ['자립지원', '슬런', [4], '2:30~3:30'],
  ['늘사랑주간보호', '줌바댄스 및 운동', [5], '13:00~14:30'],
  ['방과후활동', '놀이체육', [1, 2, 3, 5], '14:30~17:30'],
  ['방과후활동', '놀이체육', [4], '15:30~17:30'],
  ['활동지원', '보수교육', [], '14:00~16:00', [14]],
];

let ready = null; // 같은 서버 인스턴스에서는 한 번만

export function ensureSchema(db) {
  if (!ready) {
    ready = db.batch(TABLES.map((s) => db.prepare(s)))
      .then(() => seed(db))
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// 아무것도 없는 새 DB일 때만 부서·규칙·10월 예시를 넣는다
async function seed(db) {
  const has = await db.prepare("SELECT 1 FROM settings WHERE room = ? AND key = 'seeded'").bind(ROOM).first();
  if (has) return;
  const now = Date.now();
  await db.batch([
    ...DEPTS.map(([name, ci], i) =>
      db.prepare('INSERT OR IGNORE INTO depts (room, name, color_idx, pin_hash, sort) VALUES (?, ?, ?, NULL, ?)').bind(ROOM, name, ci, i)),
    db.prepare("INSERT OR IGNORE INTO settings (room, key, value) VALUES (?, 'rules', ?)").bind(ROOM, RULES),
    db.prepare("INSERT OR IGNORE INTO months (room, ym, confirmed) VALUES (?, '2026-10', 0)").bind(ROOM),
    ...SAMPLE.map(([dept, prog, wd, time, add, y], i) =>
      db.prepare(`INSERT OR IGNORE INTO rows (id, room, ym, dept, person, prog, sel, time, note, yield, updated_at)
                  VALUES (?, ?, '2026-10', ?, '예시', ?, ?, ?, '', ?, ?)`)
        .bind('seed' + i, ROOM, dept, prog, JSON.stringify({ wd, add: add || [], off: [] }), time, y ? 1 : 0, now)),
    db.prepare("INSERT OR IGNORE INTO settings (room, key, value) VALUES (?, 'seeded', '1')").bind(ROOM),
  ]);
}
