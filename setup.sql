-- 월간 일정표 DB 준비 — Cloudflare D1 화면의 Console(콘솔)에 이 파일 내용을 통째로 붙여넣고 실행하세요.
-- 여러 번 실행해도 괜찮습니다 (이미 있는 표와 데이터는 건드리지 않음).

CREATE TABLE IF NOT EXISTS months (
  ym TEXT PRIMARY KEY,             -- '2026-10'
  data TEXT NOT NULL,              -- JSON
  updated_at INTEGER NOT NULL      -- 밀리초
);

-- 참여자: 이름과 꼬리표(쉼표로 구분한 글자)
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

-- 공휴일: api(특일 정보 API 캐시) 또는 custom(기관 자체 휴무일)
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT NOT NULL,              -- '2026-10-03'
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('api', 'custom')),
  PRIMARY KEY (date, source)
);

-- 공휴일 API를 어느 달까지 받아 왔는지 (공휴일이 없는 달도 기록)
CREATE TABLE IF NOT EXISTS holiday_fetches (
  ym TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- 목록이 바뀐 시각 (다른 사람이 더 최근에 저장했는지 알리기 위함)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 처음 쓸 때 10월을 만들 수 있도록 넣어 두는 9월 예시 (이미 있으면 건드리지 않음)
INSERT OR IGNORE INTO months (ym, data, updated_at) VALUES ('2026-09', '{"title": "9월 일자리 근무 일정표 및 수업계획표", "guide": "*9시~9시30분: 명상 *9시30분~11시30분: 본 수업 *11시30분~11시50분: 마무리(일지작성)", "headers": ["일", "월(영화)", "화(노래+댄스)", "수(글쓰기)", "목(관리자 휴무)", "금(자립아카데미)", "토"], "notes": "*결근·지각할 때는 꼭 담당 선생님께 미리 연락해 주세요.", "days": {"1": "출근(9시~12시)\n*노래+댄스\n→3층 강당", "2": "출근(9시~12시)\n*글쓰기", "3": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터", "4": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)", "7": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기", "8": "출근(9시~12시)\n*노래+댄스\n→3층 강당", "9": "출근(9시~12시)\n*글쓰기", "10": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터", "11": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)", "14": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기", "15": "출근(9시~12시)\n*노래+댄스\n→3층 강당", "16": "출근(9시~12시)\n*글쓰기", "17": "출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터", "18": "출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)", "21": "출근(9시~12시)\n*영화 감상\n→감상문 쓰기", "22": "출근(9시~12시)\n*노래+댄스\n→3층 강당", "23": "출근(9시~12시)\n*글쓰기", "29": "출근(9시~12시)\n*노래+댄스\n→3층 강당", "30": "출근(9시~12시)\n*글쓰기"}}', 0);
