'use strict';
// 미리보기(시연)용: 서버 없이 /api/* 를 브라우저 메모리로 흉내 낸다.
// 배포되는 앱에는 들어가지 않는다 (public/ 밖에 있음). 이름은 모두 가짜 예시.
(function () {
  const HOLIDAYS = {
    '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '대체공휴일',
    '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날',
    '2026-12-25': '성탄절',
  };
  const people = [];
  for (let i = 1; i <= 21; i++) {
    const cls = i <= 11 ? '탁구' : '배드민턴';
    const sex = i % 5 === 0 ? '' : (i % 2 ? '남' : '여');
    people.push({ name: `예시${String(i).padStart(2, '0')}`, tags: [cls, sex, `${(i % 4) + 1}부`].filter(Boolean) });
  }
  const byWeekday = {
    1: '출근(9시~12시)\n*영화 감상\n→감상문 쓰기',
    2: '출근(9시~12시)\n*노래+댄스\n→3층 강당',
    3: '출근(9시~12시)\n*글쓰기',
    4: '출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터',
    5: '출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)',
  };
  const days = {};
  for (let d = 1; d <= 30; d++) {
    const w = new Date(2026, 8, d).getDay();
    if (byWeekday[w] && !HOLIDAYS[`2026-09-${String(d).padStart(2, '0')}`]) days[d] = byWeekday[w];
  }
  days[10] += '\n!우천 시 실내 체육관으로 모임';
  days[16] = '출근(9시~12시)\n*글쓰기\n[1부][2부] →개별상담 10시\n[3부][4부] →개별상담 11시';
  const db = {
    months: {
      '2026-09': {
        data: {
          title: '9월 일자리 근무 일정표 및 수업계획표',
          guide: '*9시~9시30분: 명상 *9시30분~11시30분: 본 수업 *11시30분~11시50분: 마무리(일지작성)',
          headers: ['일', '월(영화)', '화(노래+댄스)', '수(글쓰기)', '목(관리자 휴무)', '금(자립아카데미)', '토'],
          notes: '*결근·지각할 때는 꼭 담당 선생님께 미리 연락해 주세요.',
          days,
        },
        updatedAt: 1,
      },
    },
    people: { list: people, updatedAt: 1 },
    custom: [],
  };

  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const path = url.slice(4);
    let m;
    if ((m = path.match(/^\/months\/(\d{4}-\d{2})$/))) {
      if (method === 'GET') return reply(db.months[m[1]] ? db.months[m[1]] : { data: null, updatedAt: null });
      db.months[m[1]] = { data: JSON.parse(JSON.stringify(body.data)), updatedAt: Date.now() };
      return reply({ ok: true, updatedAt: db.months[m[1]].updatedAt });
    }
    if (path === '/people') {
      if (method === 'GET') return reply({ people: db.people.list, updatedAt: db.people.updatedAt });
      db.people = { list: body.people, updatedAt: Date.now() };
      return reply({ ok: true, updatedAt: db.people.updatedAt });
    }
    if ((m = path.match(/^\/holidays\/(\d{4}-\d{2})$/))) {
      const holidays = {};
      for (const [d, n] of Object.entries(HOLIDAYS)) if (d.startsWith(m[1])) holidays[d] = n;
      for (const h of db.custom) if (h.date.startsWith(m[1])) holidays[h.date] = holidays[h.date] ? `${holidays[h.date]} · ${h.name}` : h.name;
      return reply({ holidays, warning: null });
    }
    if (path === '/custom-holidays') {
      if (method === 'GET') return reply({ holidays: [...db.custom].sort((a, b) => a.date.localeCompare(b.date)) });
      db.custom = db.custom.filter((h) => h.date !== body.date).concat({ date: body.date, name: body.name });
      return reply({ ok: true });
    }
    if ((m = path.match(/^\/custom-holidays\/(.+)$/))) {
      db.custom = db.custom.filter((h) => h.date !== m[1]);
      return reply({ ok: true });
    }
    return reply({ ok: true });
  };
  try { localStorage.setItem('lastMonth', '2026-09'); } catch (e) { /* 무시 */ }
}());
