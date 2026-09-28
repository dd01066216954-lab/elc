// DB 표 만들기 — 앱이 처음 요청을 받을 때 저절로 한 번 실행된다.
// (Cloudflare 화면에서 SQL을 따로 붙여넣을 필요 없음. 여러 번 실행돼도 안전)

const TABLES = [
  // 달마다 한 줄: 날짜별 칸 내용, 제목, 시간 안내, 요일 머리글, 하단 안내문 (JSON). updated_at은 밀리초
  'CREATE TABLE IF NOT EXISTS months (ym TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  // 참여자: 이름과 꼬리표(쉼표로 구분한 글자)
  "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0)",
  // 공휴일: api(특일 정보 API 캐시) 또는 custom(기관 자체 휴무일)
  "CREATE TABLE IF NOT EXISTS holidays (date TEXT NOT NULL, name TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('api', 'custom')), PRIMARY KEY (date, source))",
  // 공휴일 API를 어느 달까지 받아 왔는지 (공휴일이 없는 달도 기록)
  'CREATE TABLE IF NOT EXISTS holiday_fetches (ym TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL)',
  // 참여자 표가 바뀐 시각 등 (다른 사람이 더 최근에 저장했는지 알리기 위함)
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

// 처음 쓸 때 ▶ 한 번으로 10월을 만들 수 있게 넣어 두는 9월 예시 (참여자 이름 없음, 이미 있으면 건드리지 않음)
const SAMPLE_SEPTEMBER = {
  "title": "9월 일자리 근무 일정표 및 수업계획표",
  "guide": "*9시~9시30분: 명상 *9시30분~11시30분: 본 수업 *11시30분~11시50분: 마무리(일지작성)",
  "headers": [
    "일",
    "월(영화)",
    "화(노래+댄스)",
    "수(글쓰기)",
    "목(관리자 휴무)",
    "금(자립아카데미)",
    "토"
  ],
  "notes": "*결근·지각할 때는 꼭 담당 선생님께 미리 연락해 주세요.",
  "days": {
    "1": "출근(9시~12시)\n*노래+댄스\n→3층 강당",
    "2": "출근(9시~12시)\n*글쓰기",
    "3": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터",
    "4": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)",
    "7": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기",
    "8": "출근(9시~12시)\n*노래+댄스\n→3층 강당",
    "9": "출근(9시~12시)\n*글쓰기",
    "10": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터",
    "11": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)",
    "14": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기",
    "15": "출근(9시~12시)\n*노래+댄스\n→3층 강당",
    "16": "출근(9시~12시)\n*글쓰기",
    "17": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터",
    "18": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)",
    "21": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기",
    "22": "출근(9시~12시)\n*노래+댄스\n→3층 강당",
    "23": "출근(9시~12시)\n*글쓰기",
    "28": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기",
    "29": "출근(9시~12시)\n*노래+댄스\n→3층 강당",
    "30": "출근(9시~12시)\n*글쓰기"
  }
};

let ready = null; // 같은 서버 인스턴스에서는 한 번만

export function ensureSchema(db) {
  if (!ready) {
    ready = db.batch([
      ...TABLES.map((s) => db.prepare(s)),
      db.prepare("INSERT OR IGNORE INTO months (ym, data, updated_at) VALUES ('2026-09', ?, 0)").bind(JSON.stringify(SAMPLE_SEPTEMBER)),
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}
