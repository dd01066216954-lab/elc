# 4층 교육장 현황표

부서마다 교육장 이용 신청서를 적으면 월간 현황표가 저절로 만들어지는 웹앱.
화면은 사용자가 승인한 시안(`교육장현황표.html`)과 같고, 저장만 Cloudflare D1 으로 옮겼다.
요구사항은 `SPEC-교육장현황표.md` 기준.

| 파일·폴더 | 내용 |
|---|---|
| `public/index.html` | 화면 (시안 그대로. 저장 부분만 `/api` 호출로 바꿈) |
| `functions/api/[[path]].js`, `lib/api.js` | 저장 API (Cloudflare Pages Functions) |
| `lib/schema.js` | DB 표 — 처음 접속할 때 저절로 만들어짐. 부서 5개·이용 규칙·10월 예시 일정도 넣음 |
| `test/` | API 테스트 (`npm test`) |

## 배포하기 — Cloudflare 웹사이트에서 (프로그램 설치 필요 없음)

모두 [dash.cloudflare.com](https://dash.cloudflare.com) 화면에서 합니다. 월간 일정표와는 **따로** 만듭니다.

**1. DB 만들기**
1. 왼쪽 메뉴 **Storage & Databases → D1 SQL Database → Create**
2. 이름 `edu-room` → 만들기 (표는 앱이 처음 켜질 때 저절로 만듭니다)

**2. 사이트 만들기 (GitHub 연결)**
1. **Workers & Pages → Create → Pages** 탭 → **Import an existing Git repository**
2. 저장소 `elc` 선택
3. 설정
   - Project name: `edu-room` (주소가 `https://edu-room.pages.dev` 가 됩니다. 이미 쓰는 이름이면 다른 이름)
   - Production branch: `claude/lucid-wozniak-0p1ol8` (main 으로 합치면 `main`)
   - Framework preset: **None**, Build command: **비워 둠**
   - **Root directory (advanced)**: **`edu-room`**  ← 꼭 넣기
   - Build output directory: **`public`**
4. **Save and Deploy**

**3. DB 연결**
프로젝트 → **Settings → Bindings → Add → D1 database** — Variable name `DB`, 데이터베이스 `edu-room`.
그다음 **Deployments** 탭 → 맨 위 배포의 **⋯ → Retry deployment** (설정은 다시 배포해야 적용됩니다).

이후 GitHub 에 코드가 올라가면 Cloudflare 가 저절로 다시 배포합니다.

**배포 직후 관리자가 바로** 주소 끝에 `#admin` 을 붙여 들어가서(`https://edu-room.pages.dev/#admin`) 관리자 비밀번호를 정하세요.
관리자 비밀번호가 없으면 처음 들어온 사람이 정하게 됩니다.

시안의 10월 예시 일정이 들어 있습니다. 실제로 쓰기 전에 관리자 → 신청서 → `10월 전부 지우기`로 지울 수 있습니다.

## 내 컴퓨터에서 해 보기 (개발용, 선택)

```sh
cd edu-room
npm install
npm run dev     # http://localhost:8788
npm test
```

`wrangler.toml` 은 만들지 않습니다. 있으면 Cloudflare 화면에서 DB 설정을 바꿀 수 없게 됩니다.
