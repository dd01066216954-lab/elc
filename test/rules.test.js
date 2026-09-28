// node --test 로 실행
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/rules.js');

const THU = '출근(9시~12시)\n[탁구] *체육(탁구)\n[탁구] →장애인체육회강사\n[배드민턴] *체육(배드민턴)\n[배드민턴] →장애인형국민체육센터';
const FRI = '출근(9시~11시)\n*자립아카데미\n[남] *남자: 4층 프로그램실(의사소통기술)\n[여] *여자: 3층 프로그램실(이미지메이킹)';

test('꼬리표 없는 줄은 모두에게, 꼬리표 줄은 그 사람에게만', () => {
  assert.strictEqual(R.textFor(THU, { tags: ['탁구'] }), '출근(9시~12시)\n*체육(탁구)\n→장애인체육회강사');
  assert.strictEqual(R.textFor(THU, { tags: ['배드민턴', '2부'] }), '출근(9시~12시)\n*체육(배드민턴)\n→장애인형국민체육센터');
});

test('묶음에 하나도 없는 사람은 그 묶음 줄을 모두 받음', () => {
  assert.strictEqual(R.textFor(FRI, { tags: ['탁구'] }).split('\n').length, 4);
  assert.strictEqual(R.textFor(FRI, { tags: [] }).split('\n').length, 4);
  assert.strictEqual(R.textFor(FRI, { tags: ['여'] }), '출근(9시~11시)\n*자립아카데미\n*여자: 3층 프로그램실(이미지메이킹)');
});

test('같은 묶음 여러 꼬리표는 하나만 맞아도, 다른 묶음끼리는 모두 맞아야', () => {
  const t = '[1부][2부] 상담 10시\n[3부][4부] 상담 11시\n[탁구][남] 남자 탁구';
  assert.strictEqual(R.textFor(t, { tags: ['2부'] }), '상담 10시\n남자 탁구');
  assert.strictEqual(R.textFor(t, { tags: ['3부', '탁구', '여'] }), '상담 11시');
  assert.strictEqual(R.textFor(t, { tags: ['3부', '탁구', '남'] }), '상담 11시\n남자 탁구');
});

test('묶음에 없는 꼬리표는 가진 사람에게만', () => {
  assert.strictEqual(R.textFor('[바리스타] 실습', { tags: [] }), '');
  assert.strictEqual(R.textFor('[바리스타] 실습', { tags: ['바리스타'] }), '실습');
});

test('글자색과 ! 지우기', () => {
  assert.strictEqual(R.parseLine('*체육').color, 'blue');
  assert.strictEqual(R.parseLine('→강사').color, 'blue');
  assert.strictEqual(R.parseLine('[탁구] !탁구채').color, 'red');
  assert.strictEqual(R.printedText(R.parseLine('[탁구] !탁구채 가져오기')), '탁구채 가져오기');
  assert.strictEqual(R.parseLine('출근').color, '');
});

test('꼬리표 입력 나누기', () => {
  assert.deepStrictEqual(R.splitTags('탁구, 2부'), ['탁구', '2부']);
  assert.deepStrictEqual(R.splitTags('탁구 2부/여'), ['탁구', '2부', '여']);
  assert.deepStrictEqual(R.splitTags('[탁구]'), ['탁구']);
  assert.deepStrictEqual(R.splitTags(''), []);
});

test('새 달: 10월은 9월 패턴, 공휴일 평일은 비움', () => {
  const H = { '2026-09-24': 1, '2026-09-25': 1, '2026-09-26': 1, '2026-10-03': 1, '2026-10-05': 1, '2026-10-09': 1 };
  const isH = (y, m, d) => !!H[`${y}-${R.pad(m)}-${R.pad(d)}`];
  const days = {};
  for (let d = 1; d <= 30; d++) {
    const w = R.weekday(2026, 9, d);
    if (w >= 1 && w <= 5 && !isH(2026, 9, d)) days[d] = `9월${d}일`;
  }
  const prev = { title: '9월 일자리 근무 일정표 및 수업계획표', guide: 'g', headers: ['일', '월', '화', '수', '목', '금', '토'], notes: 'n', days };
  const oct = R.makeMonth(2026, 10, prev, isH);
  assert.strictEqual(oct.title, '10월 일자리 근무 일정표 및 수업계획표');
  assert.strictEqual(oct.days[5], undefined, '대체공휴일');
  assert.strictEqual(oct.days[9], undefined, '한글날');
  assert.strictEqual(oct.days[3], undefined, '개천절(토)');
  assert.strictEqual(oct.days[1], '9월3일', '첫째 목');
  assert.strictEqual(oct.days[12], '9월14일', '둘째 월(9/14 = 9월 둘째 월)');
  assert.strictEqual(oct.days[22], '9월17일', '넷째 목 → 9/24 추석이라 직전 주');
  assert.strictEqual(oct.days[26], '9월28일', '넷째 월 (추석이 토요일과 겹쳐도 설·추석은 대체공휴일 없음)');
  assert.strictEqual(oct.days[29], '9월17일', '다섯째 목 → 9월엔 넷째까지(24 공휴일) → 17일');
});

test('저장된 데이터 모양 맞추기', () => {
  const n = R.normalizeMonth({ headers: ['일'] }, 11);
  assert.strictEqual(n.headers.length, 7);
  assert.strictEqual(n.title, '11월 일자리 근무 일정표 및 수업계획표');
  assert.deepStrictEqual(n.days, {});
});

test('참여자 파일 읽기: 탭·쉼표·띄어쓰기, 제목 줄, BOM', () => {
  const list = R.parsePeopleText('﻿이름\t꼬리표\r\n홍길동\t탁구, 2부\r\n김철수,배드민턴,여\r\n이영희,"탁구, 남"\r\n박민수 남 1부\r\n\r\n최지우\r\n');
  assert.deepStrictEqual(list, [
    { name: '홍길동', tags: ['탁구', '2부'] },
    { name: '김철수', tags: ['배드민턴', '여'] },
    { name: '이영희', tags: ['탁구', '남'] },
    { name: '박민수', tags: ['남', '1부'] },
    { name: '최지우', tags: [] },
  ]);
});

test('반 나누기를 바꾸면 거르기도 바뀜', () => {
  const t = '[오전조] 조리실습 9시\n[오후조] 조리실습 1시';
  // 처음 값에는 오전조/오후조 묶음이 없음 → 가진 사람만
  assert.strictEqual(R.textFor(t, { tags: [] }), '');
  R.setTagGroups([...R.DEFAULT_TAG_GROUPS, { name: '조리', tags: ['오전조', '오후조'] }]);
  assert.strictEqual(R.textFor(t, { tags: [] }), '조리실습 9시\n조리실습 1시');
  assert.strictEqual(R.textFor(t, { tags: ['오후조'] }), '조리실습 1시');
  R.setTagGroups(R.DEFAULT_TAG_GROUPS);
});

test('새 달: 지난달이 없으면 더 이전 달에서 복사', () => {
  const noH = () => false;
  const aug = { title: '8월 일정표', guide: 'g', headers: ['일', '월', '화', '수', '목', '금', '토'], notes: '', days: { 3: '8월 첫째 월', 10: '8월 둘째 월' } };
  const oct = R.makeMonth(2026, 10, aug, noH, [2026, 8]);
  assert.strictEqual(oct.title, '10월 일정표');
  assert.strictEqual(oct.days[5], '8월 첫째 월'); // 10/5 첫째 월 ← 8/3 첫째 월
  assert.strictEqual(oct.days[12], '8월 둘째 월');
});

test('새로 공휴일이 된 날은 한 번만 비움', () => {
  const mo = R.normalizeMonth({ days: { 5: '출근\n*영화', 6: '출근' } }, 10);
  let r = R.clearHolidayDays(mo, [3, 5, 9]);
  assert.deepStrictEqual(r.cleared, { 5: '출근\n*영화' });
  assert.strictEqual(mo.days[5], undefined);
  assert.strictEqual(mo.days[6], '출근');
  // 공휴일에 일부러 다시 적은 건 지우지 않음
  mo.days[5] = '*센터 체육대회';
  r = R.clearHolidayDays(mo, [3, 5, 9]);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(mo.days[5], '*센터 체육대회');
});

test('새 달: 주말 공휴일도 비우고, 공휴일은 이미 비운 날로 기억', () => {
  const isH = (y, m, d) => y === 2026 && m === 10 && [3, 5, 9].includes(d);
  const prev = { title: '9월', guide: '', headers: ['일', '월', '화', '수', '목', '금', '토'], notes: '', days: { 5: '9월 첫째 토' } };
  const oct = R.makeMonth(2026, 10, prev, isH);
  assert.strictEqual(oct.days[3], undefined);
  assert.strictEqual(oct.days[10], '9월 첫째 토');
  assert.deepStrictEqual(oct.holidaysApplied, ['3', '5', '9']);
});

test('근무시간: 줄 하나', () => {
  assert.strictEqual(R.workHoursOfLine('출근(9시~12시)'), 3);
  assert.strictEqual(R.workHoursOfLine('출근(9시~11시)'), 2);
  assert.strictEqual(R.workHoursOfLine('출근 9시30분~11시30분'), 2);
  assert.strictEqual(R.workHoursOfLine('근무 9시반~11시'), 1.5);
  assert.strictEqual(R.workHoursOfLine('→근무 13:00~15:30'), 2.5);
  assert.strictEqual(R.workHoursOfLine('출근(11시~1시)'), 2);
  assert.strictEqual(R.workHoursOfLine('출근(9시~12시) 2층'), 3, '뒤 숫자를 분으로 잘못 읽지 않음');
  assert.strictEqual(R.workHoursOfLine('출근(9시~12시), 근무(13시~15시)'), 5);
  assert.strictEqual(R.workHoursOfLine('*9시~9시30분: 명상'), 0, '출근·근무 없는 줄은 안 셈');
  assert.strictEqual(R.workHoursOfLine('출근'), 0);
});

test('근무시간: 사람마다 받는 줄만, 한 달 합계', () => {
  const mo = { days: {
    1: '출근(9시~12시)\n*체육',
    2: '출근(9시~11시)\n*자립아카데미',
    5: '[1부] 근무 9시~10시\n[2부] 근무 10시~12시',
    6: '출근\n*영화',
    9: '',
  } };
  assert.deepStrictEqual(R.workSummary(mo, { tags: ['1부'] }), { days: 3, hours: 6, noTime: 1 });
  assert.deepStrictEqual(R.workSummary(mo, { tags: ['2부'] }), { days: 3, hours: 7, noTime: 1 });
  assert.deepStrictEqual(R.workSummary(mo, { tags: [] }), { days: 3, hours: 8, noTime: 1 }); // 부 안 정해짐 → 둘 다
  assert.strictEqual(R.formatHours(36.5), '36시간 30분');
  assert.strictEqual(R.formatHours(12), '12시간');
});

test('하루 근무시간 범위', () => {
  const people = [{ tags: ['1부'] }, { tags: ['2부'] }];
  assert.deepStrictEqual(R.dayHoursRange('[1부] 근무 9시~10시\n[2부] 근무 10시~12시', people), { min: 1, max: 2 });
  assert.deepStrictEqual(R.dayHoursRange('출근(9시~12시)', people), { min: 3, max: 3 });
  assert.strictEqual(R.dayHoursRange('*영화 감상', people), null);
  assert.deepStrictEqual(R.dayHoursRange('출근(9시~11시)', []), { min: 2, max: 2 });
});

test('자동 완성', () => {
  const idx = R.lineIndex(['출근(9시~12시)\n[탁구] *체육(탁구)\n*영화 감상', '출근(9시~12시)\n*체육 대회', '출근(9시~11시)']);
  assert.deepStrictEqual(R.suggestLines('출근', idx, []).map((x) => x.text), ['출근(9시~12시)', '출근(9시~11시)']);
  // 꼬리표 뗀 부분이 앞에서 맞으면 위로
  assert.deepStrictEqual(R.suggestLines('*체육', idx, []).map((x) => x.text), ['*체육 대회', '[탁구] *체육(탁구)']);
  assert.deepStrictEqual(R.suggestLines('  ', idx, []), []);
  assert.deepStrictEqual(R.suggestLines('[배', idx, ['탁구', '배드민턴']).map((x) => x.text), ['[배드민턴] ']);
  assert.deepStrictEqual(R.suggestLines('[', idx, ['탁구', '배드민턴']).map((x) => x.text), ['[탁구] ', '[배드민턴] ']);
});

test('찾아 바꾸기 개수', () => {
  assert.deepStrictEqual(R.countMatches(['강사A 강사A', '강사B', '강사A'], '강사A'), { cells: 2, hits: 3 });
  assert.deepStrictEqual(R.countMatches(['x'], ''), { cells: 0, hits: 0 });
});

test('자주 쓰는 일정 이름 짐작', () => {
  assert.strictEqual(R.guessSnippetName('출근(9시~12시)\n*영화 감상\n→감상문 쓰기'), '영화 감상');
  assert.strictEqual(R.guessSnippetName('출근(9시~12시)\n[탁구] *체육(탁구)'), '체육');
  assert.strictEqual(R.guessSnippetName('!우천 시 실내로'), '우천 시 실내로');
  assert.strictEqual(R.guessSnippetName(''), '새 일정');
});

test('칸 = 출근 줄 + 활동: 출근 바꾸기, 활동 넣고 빼기', () => {
  const w12 = { kind: 'work', text: '출근(9시~12시)' };
  const w11 = { kind: 'work', text: '출근(9시~11시)' };
  const movie = { kind: 'activity', text: '*영화 감상\n→감상문 쓰기' };
  const rain = { kind: 'activity', text: '!우천 시 실내' };
  let t = '';
  t = R.applyWork(t, w12); assert.strictEqual(t, '출근(9시~12시)');
  t = R.toggleActivity(t, movie); assert.strictEqual(t, '출근(9시~12시)\n*영화 감상\n→감상문 쓰기');
  t = R.applyWork(t, w11); assert.strictEqual(t, '출근(9시~11시)\n*영화 감상\n→감상문 쓰기', '출근 줄만 바뀜');
  t = R.toggleActivity(t, rain); assert.strictEqual(t, '출근(9시~11시)\n*영화 감상\n→감상문 쓰기\n!우천 시 실내');
  assert.ok(R.hasBlock(t, movie));
  t = R.toggleActivity(t, movie); assert.strictEqual(t, '출근(9시~11시)\n!우천 시 실내', '다시 누르면 빠짐');
  t = R.applyWork(t, w11); assert.strictEqual(t, '!우천 시 실내', '같은 출근 다시 누르면 빠짐');
  assert.strictEqual(R.replaceActivities('출근(9시~12시)\n*글쓰기', movie), '출근(9시~12시)\n*영화 감상\n→감상문 쓰기');
  assert.ok(R.isWorkLine('[1부] 근무 9시~10시'));
  assert.ok(!R.isWorkLine('*근무일지 쓰기'));
});

test('예전 자주 쓰는 일정 나누기', () => {
  const out = R.splitSnippets([
    { name: '영화', text: '출근(9시~12시)\n*영화 감상' },
    { name: '글쓰기', text: '출근(9시~12시)\n*글쓰기' },
    { name: '우천', text: '!우천' },
  ]);
  assert.deepStrictEqual(out.map((x) => [x.kind, x.text]), [
    ['work', '출근(9시~12시)'], ['activity', '*영화 감상'], ['activity', '*글쓰기'], ['activity', '!우천'],
  ]);
  assert.strictEqual(out[0].name, '9시~12시');
});

test('글자색 바꾸기', () => {
  assert.strictEqual(R.recolorLine('*영화 감상', 'red'), '!*영화 감상');
  assert.strictEqual(R.recolorLine('!*영화 감상', 'blue'), '*영화 감상');
  assert.strictEqual(R.recolorLine('영화 감상', 'blue'), '*영화 감상');
  assert.strictEqual(R.recolorLine('→감상문 쓰기', 'blue'), '→감상문 쓰기');
  assert.strictEqual(R.recolorLine('*영화 감상', 'black'), '영화 감상');
  assert.strictEqual(R.recolorLine('[탁구] *체육', 'red'), '[탁구] !*체육');
  assert.strictEqual(R.recolorLine('[탁구] !*체육', 'black'), '[탁구] 체육');
  assert.strictEqual(R.lineColorName('[탁구] !*체육'), 'red');
  assert.strictEqual(R.lineColorName('출근'), 'black');
});

test('색을 바꾼 활동도 같은 활동으로 봄', () => {
  const movie = { kind: 'activity', text: '*영화 감상\n→감상문 쓰기' };
  const t = '출근(9시~12시)\n!*영화 감상\n!→감상문 쓰기';
  assert.ok(R.hasBlock(t, movie));
  assert.strictEqual(R.toggleActivity(t, movie), '출근(9시~12시)');
});

test('장소: 활동 바로 아래에 넣고, 다시 누르면 뺌', () => {
  const hall = { kind: 'place', text: '→3층 강당' };
  const t = '출근(9시~12시)\n*노래+댄스\n*글쓰기';
  assert.strictEqual(R.togglePlace(t, hall, 1), '출근(9시~12시)\n*노래+댄스\n→3층 강당\n*글쓰기');
  assert.strictEqual(R.togglePlace(t, hall, null), '출근(9시~12시)\n*노래+댄스\n*글쓰기\n→3층 강당');
  assert.strictEqual(R.togglePlace('출근(9시~12시)\n*노래+댄스\n→3층 강당', hall, 1), '출근(9시~12시)\n*노래+댄스');
  assert.strictEqual(R.togglePlace('', hall, null), '→3층 강당');
});
