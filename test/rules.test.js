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
  const H = { '2026-09-24': 1, '2026-09-25': 1, '2026-09-26': 1, '2026-09-28': 1, '2026-10-03': 1, '2026-10-05': 1, '2026-10-09': 1 };
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
  assert.strictEqual(oct.days[26], '9월21일', '넷째 월 → 9/28 대체공휴일이라 직전 주');
  assert.strictEqual(oct.days[29], '9월17일', '다섯째 목 → 9월엔 넷째까지(24 공휴일) → 17일');
});

test('저장된 데이터 모양 맞추기', () => {
  const n = R.normalizeMonth({ headers: ['일'] }, 11);
  assert.strictEqual(n.headers.length, 7);
  assert.strictEqual(n.title, '11월 일자리 근무 일정표 및 수업계획표');
  assert.deepStrictEqual(n.days, {});
});
