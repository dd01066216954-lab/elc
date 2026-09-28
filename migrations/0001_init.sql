-- 달마다 한 줄: 날짜별 칸 내용, 제목, 시간 안내, 요일 머리글, 하단 안내문 (JSON)
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
