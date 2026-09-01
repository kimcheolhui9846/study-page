# 핸드오프

**갱신:** 2026-09-01 · **브랜치:** `feat/ui-session` · **PR:** 열기 직전

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**1주차 코드는 다 썼다.** 로그인 · 세션 만료 4경로 · 예산 캡 · 멱등성이
전부 자동 테스트로 증명된다. **LLM 은 한 번도 호출하지 않았다** —
`FakeLlmClient` 만 존재하고 `tests/no-real-llm.test.ts` 가 그걸 강제한다.

- Next 16.3.3 / React 19.2.8 / Tailwind 4 / Vitest 4.1.11
- Drizzle 0.45.2 / PGlite 0.5.8 (테스트) / @neondatabase/serverless 1.1.0
- 테스트 **181개 통과** (16파일, 25초)
- `npm run build` 통과 — 라우트 7개

```
ƒ /                              대시보드 (진도 · 사용량)
ƒ /login                         로그인
ƒ /api/session                   POST 로그인
ƒ /api/session/end               POST [종료] 버튼 → 즉시 파기 (가드 없음)
ƒ /api/session/leaving           POST pagehide beacon → 유휴 만료를 30초로 당김
ƒ /api/session/status            GET 만료 시각 두 개
ƒ /api/study/[subject]/content   POST 콘텐츠 (가짜 LLM)
```

**디자인이 코드가 됐다.** `app/globals.css` 의 `@theme` 이 캔버스의 토큰이다.
캔버스: https://claude.ai/code/artifact/54e9838d-e75b-47cd-85a2-1e22ff749963
원본: `design/canvas/*.dc.html`

## ★ 남은 일 — 사용자가 직접 (1주차를 닫으려면 필요)

**Step 8(손으로 확인) 완료.** 여섯 가지 전부 실제 Neon 상대로 봤다 —
리다이렉트 / 오답 / 5회 잠금 / 로그인 / 2분·30초 경고와 자동 이탈 /
[종료] 후 재접근 차단, 그리고 새로고침이 세션을 죽이지 않는 것까지.

**그 과정에서 버그 셋이 나왔다. 테스트 156개가 전부 통과하는 상태에서
앱은 로그인조차 되지 않았다.** 셋 다 자동 테스트로는 나올 수 없는
종류였다 (dotenv 의 `$` 확장 / 렌더 타이밍 / `pagehide` 의미).
1주차의 마지막 관문이 "손으로 한 번 돌려본다"인 이유가 이것이다.

`.env.local` 은 이미 채워져 있고 Neon 에 마이그레이션도 적용됐다.
새 기계에서 처음 띄운다면:

```bash
cp .env.example .env.local     # DATABASE_URL 을 Neon 것으로 채운다
npm run db:migrate             # drizzle/ 의 마이그레이션을 적용한다
npm run hash:password          # 출력값을 .env.local 의 AUTH_PASSWORD_HASH 에
npm run dev
```

Neon 연결 문자열은 **pooled(`-pooler` 가 붙은 것)** 를 쓴다. 버셀 서버리스는
요청마다 새 연결을 열기 때문에 direct 를 쓰면 연결 수가 금방 바닥난다.
`drizzle-kit` 은 Next 가 아니라서 `.env.local` 을 자동으로 읽지 않는다 —
`drizzle.config.ts` 가 `process.loadEnvFile()` 로 직접 읽는다.

**키를 채팅에 붙여넣지 않는다.** `.env.local` 과 버셀 환경변수에 직접 넣는다.

그 외 (2주차 전까지):

- [x] **OpenAI 하드 리밋** — 2026-09-01 완료. 아래 「④겹」 참조
- [ ] Vercel 프로젝트를 이 레포에 연결
- [ ] 버셀 환경변수 `APP_ENV`: Production=`production`, Preview=`preview`

## ④겹 — 코드 밖의 방어선 (2026-09-01 완료)

앞의 세 겹은 전부 내 코드가 지킨다. **내 버그로 무너질 수 있다** —
실제로 1주차 마지막 날에만 버그 셋이 나왔다. 그래서 코드가 손댈 수 없는
곳에 한 겹이 필요하다.

| 설정 | 값 | 성격 |
|---|---|---|
| 선불 크레딧 | **$5** | **진짜 하드 스톱.** 0 이 되면 API 가 에러를 반환한다 |
| **자동 충전(auto-recharge)** | **OFF** | ★ 켜져 있으면 잔액이 줄 때마다 카드에서 자동 구매해 상한이 사라진다 |
| Organization spend limit | $5 | 최선 노력 |
| 지출 알림 | $3.50 / $4 / $5 | 조기 경보 |

**$3.50 알림이 울리면 코드 캡이 실패한 것이다** — `monthlyCostCapMicros()`
가 production 에서 $3 이므로, 거기까지 갔다는 뜻이다.

**Tier 1 의 내장 월 한도 $100 은 방어가 아니다.** 등급은 누적 결제액으로
자동으로 올라가고, 그 한도는 우리 예산의 5배다. 직접 건 $5 가 실제 상한이다.

**자동 충전을 다시 켜지 말 것.** 이 표에서 유일하게 되돌릴 수 없는 실수다.

---

## 바로 다음에 할 일 (Step 8 이 끝난 뒤)

2주차 계획을 작성한다. 첫 작업은 `lib/llm/client.ts` — OpenAI Structured Outputs.
**여기서부터 돈이 나간다.** `tests/no-real-llm.test.ts` 가 빨갛게 뜨는 것이
그 신호이고, 지울 때 대시보드 하드 리밋을 함께 확인한다.

2주차가 이어받을 두 가지:

- **`SessionBar` 의 `expiringNote` prop.** 학습 화면이 답안 로컬 초안 보관을
  구현하면서 "쓰던 답은 브라우저에 남는다"를 넘긴다. **동작과 문구가 같은
  커밋에 들어가야 한다.** 지금 대시보드는 안 넘긴다 — 쓸 답이 없으니까.
- **대시보드의 비활성 버튼 3개.** 학습 화면이 생기면 링크로 바꾸고,
  그때 "학습 화면은 2주차에 붙는다" 줄을 지운다.

## 알아둘 것

- **`/api/session/status` 를 폴링하지 말 것.** 가드가 통과할 때마다 유휴 만료를
  민다 — 주기적으로 부르면 하트비트가 된다. 세션 바는 마운트 때 한 번 부르고,
  그 뒤로는 사용자가 실제로 움직였을 때만(1분 스로틀) 다시 묻는다.
- **카운트다운의 기준은 서버가 준 시각이다.** 클라이언트 자체 타이머는 탭이
  백그라운드로 가거나 노트북이 잠들면 어긋난다.
- **next/font 는 구글에 `subset` 파라미터를 보내지 않는다.** 한글 @font-face 까지
  전부 내려받아 자체 호스팅하므로 `subsets: ['latin']` 이어도 한글이 렌더된다.
  그 값은 preload 대상만 고르는 것이다 (`get-google-fonts-url.js` 에서 확인).
- **★ `pagehide` 는 창 닫기 전용 신호가 아니다.** 새로고침과 전체 페이지 이동에서도
  발생한다. 그래서 beacon 은 세션을 파기하지 않고 `POST /api/session/leaving` 으로
  **유휴 만료를 30초로 당기기만** 한다. 즉시 파기하면 새로고침이 로그아웃이 된다
  (실제로 그랬다). `[종료]` 버튼만 `POST /api/session/end` 로 즉시 파기한다.
- **★ 환경변수 값에 `$` 를 넣지 말 것.** Next 의 dotenv 로더가 변수 확장을 해서
  `$16384` 같은 조각을 빈 문자열로 치환한다. 비밀번호 해시가 이것 때문에 통째로
  망가졌다 (`docs/DECISIONS.md`). 해시 형식은 이제 `scrypt.N.r.p.salt.hash` 다.
  **버셀 대시보드에도 따옴표 없이 그대로** 넣는다 — 거기선 따옴표가 값이 된다.
- **`.env` 값을 검증할 때는 `@next/env` 로 읽을 것.** `process.loadEnvFile()` 는
  변수 확장을 하지 않아서 앱이 실제로 보는 값과 다르다. 그 차이 때문에
  "형식 정상"이라는 잘못된 확인을 했다.
- **HTTP 헤더는 ByteString 이다.** 테스트에서 쿠키 값에 한글을 넣으면 던진다.
- **테스트가 느려지고 있다.** DB 테스트마다 PGlite 인스턴스를 새로 만든다.
  현재 156개에 23초. 40초를 넘기면 파일당 인스턴스 하나를 재사용하고
  테스트 사이에 TRUNCATE 하는 쪽으로 바꾼다. 지금은 격리가 더 중요하다.
- **날짜를 `new Date()`로 만들지 않는다.** `kstToday()` / `kstDateLabel()` 만 쓴다.
  날짜 라벨은 **서버 컴포넌트에서만** 만든다 — 클라이언트에서 만들면 사용자의
  시간대를 따라가 서버가 판정하는 '오늘'과 어긋난다.
- **`lib/db/client.ts`는 지연 연결이다.** import 는 항상 성공하고 첫 쿼리에서 연결한다.
  테스트는 이 파일 대신 `tests/helpers/testDb.ts`를 쓴다.
- **YAML 은 따옴표 없는 숫자를 number 로 읽는다.** 커리큘럼 keyword 의 `304` 같은 값.
- 마이그레이션 SQL은 `--> statement-breakpoint`로 나뉜다.
- Next 16: `runtime = 'nodejs'` export 쓰지 않는다 / `params`는 Promise / `cookies()`는 async.
  추측하지 말고 `node_modules/next/dist/docs/`를 읽을 것.

## 아직 안 정한 것

- [ ] Neon 무료 플랜에서 Preview용 DB 브랜치 자동 생성 가능 여부
- [ ] 커리큘럼 Day 1~7 내용 다듬기 (지금은 초안)
- [ ] **★ 모델 ID 와 단가를 다시 확인할 것.** 스펙과 계획은 `gpt-4o-mini` 로
  못박혀 있는데, 2026-09-01 기준 대시보드의 「Models in use」에는
  `gpt-5.5` / `gpt-5.5-pro` / `gpt-5.4-mini` 가 뜬다. 라인업이 바뀌었다.
  `monthlyCostCapMicros()` 의 $3 캡도 옛 단가 위에서 계산한 값이다.
  **2주차 계획을 쓸 때 실제 목록과 가격을 확인해 확정하고 스펙을 고친다.**
  추측으로 모델명을 적지 말 것 — 그게 이 프로젝트에서 이미 두 번 문제가 됐다.
- [ ] Velog access token 확보 방법 (4주차)

## 하지 말 것

- 1주차에 `OPENAI_API_KEY`를 넣지 말 것. 없는 것이 "실제 호출 0회"의 구조적 보장이다.
- **`/api/session/status` 를 폴링하지 말 것.** 위 「알아둘 것」 참조.
- 하트비트 ping을 넣지 말 것. 유휴 타임아웃을 무력화한다.
- **`pagehide` beacon 을 `/api/session/end` 로 돌리지 말 것.** 새로고침이 로그아웃이 된다.
- **`expireSoon` 의 `idleExpiresAt > soon` 가드를 지우지 말 것.** 없으면 만료 직전에
  도착한 beacon 이 세션을 오히려 연장한다 — 종료 신호가 연장 신호가 된다.
- **진도를 하드코딩하지 말 것.** `lib/study/progress.ts` 가 `study_days` 에서 파생한다.
- `progress` 테이블을 만들지 말 것. 두 곳이 어긋나면 어느 쪽이 진실인지 정할 수 없다.
- 커리큘럼을 DB에 넣지 말 것. 레포의 YAML 파일이다.
- **`design/canvas/study-page-daily-flow.html` 을 직접 편집하지 말 것.** 씨딩 산출물이다.
  캔버스를 고칠 때는 `design/canvas/*.dc.html` 을 고쳐서 다시 씨딩한다.
- **색을 새로 짓지 말 것.** `app/globals.css` 의 `@theme` 토큰을 쓴다.
  새 상태색이 꼭 필요하면 기존 셋과 같은 oklch L·C 를 유지하고 캔버스도 함께 고친다.
- `FakeLlmClient` 를 지우지 말 것. 모든 통합 테스트가 이걸 주입해서 돈다.
- `tests/no-real-llm.test.ts` 를 함부로 지우지 말 것.
- `AGENTS.md`를 지우지 말 것. `next dev`가 재생성한다.
- 스키마를 고쳤으면 반드시 `npm run db:generate`를 돌려 마이그레이션을 함께 커밋할 것.

## 명령어

```bash
npm run dev
npm test
npm run check:secrets
npm run build
npm run db:generate
npm run hash:password
npx tsc --noEmit
```
