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
- 테스트 **156개 통과** (14파일, 23초)
- `npm run build` 통과 — 라우트 7개

```
ƒ /                              대시보드 (진도 · 사용량)
ƒ /login                         로그인
ƒ /api/session                   POST 로그인
ƒ /api/session/end               POST 종료 (가드 없음 — 만료된 세션도 쿠키를 지워야 한다)
ƒ /api/session/status            GET 만료 시각 두 개
ƒ /api/study/[subject]/content   POST 콘텐츠 (가짜 LLM)
```

**디자인이 코드가 됐다.** `app/globals.css` 의 `@theme` 이 캔버스의 토큰이다.
캔버스: https://claude.ai/code/artifact/54e9838d-e75b-47cd-85a2-1e22ff749963
원본: `design/canvas/*.dc.html`

## ★ 남은 일 — 사용자가 직접 (1주차를 닫으려면 필요)

Neon 연결과 마이그레이션은 **끝났다.** Step 8 중 1~3(리다이렉트 / 오답 /
5회 잠금)은 실제 Neon 상대로 확인했다. 남은 것은 로그인 이후다.

```bash
cp .env.example .env.local     # DATABASE_URL 을 Neon 것으로 채운다
npm run db:migrate             # drizzle/ 의 마이그레이션을 적용한다
npm run hash:password          # 출력값을 .env.local 의 AUTH_PASSWORD_HASH 에
npm run dev
```

그다음 계획 Task 10 **Step 8** 의 6가지를 눈으로 확인한다.

Neon 연결 문자열은 **pooled(`-pooler` 가 붙은 것)** 를 쓴다. 버셀 서버리스는
요청마다 새 연결을 열기 때문에 direct 를 쓰면 연결 수가 금방 바닥난다.
`drizzle-kit` 은 Next 가 아니라서 `.env.local` 을 자동으로 읽지 않는다 —
`drizzle.config.ts` 가 `process.loadEnvFile()` 로 직접 읽는다.

**키를 채팅에 붙여넣지 않는다.** `.env.local` 과 버셀 환경변수에 직접 넣는다.

그 외 (2주차 전까지):

- [ ] **OpenAI 대시보드에서 프로젝트 하드 리밋 월 $5** — 4겹 중 코드 밖의 한 겹이다
- [ ] Vercel 프로젝트를 이 레포에 연결
- [ ] 버셀 환경변수 `APP_ENV`: Production=`production`, Preview=`preview`

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
- [ ] Velog access token 확보 방법 (4주차)

## 하지 말 것

- 1주차에 `OPENAI_API_KEY`를 넣지 말 것. 없는 것이 "실제 호출 0회"의 구조적 보장이다.
- **`/api/session/status` 를 폴링하지 말 것.** 위 「알아둘 것」 참조.
- 하트비트 ping을 넣지 말 것. 유휴 타임아웃을 무력화한다.
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
