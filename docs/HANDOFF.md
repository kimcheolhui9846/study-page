# 핸드오프

**갱신:** 2026-09-01 · **브랜치:** `design/canvas` · **PR:** (열기 전)

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**1주차 Task 1~9 완료.** 4겹 중 코드로 할 수 있는 셋이 전부 섰고 통합 테스트로 증명된다.

- Next 16.3.3 / React 19.2.8 / Tailwind 4 / Vitest 4.1.11
- Drizzle 0.45.2 / PGlite 0.5.8 (테스트) / @neondatabase/serverless 1.1.0
- 테이블 7개, 마이그레이션 `drizzle/0000_wonderful_silver_centurion.sql`
- 테스트 **138개 통과** (12파일, 24초)
- `POST /api/session` 동작 — scrypt 검증 + 실패 잠금 + httpOnly 쿠키 발급
- `npm run hash:password` 로 `AUTH_PASSWORD_HASH` 생성 가능
- `withSession()` 가드 + `POST /api/session/end` 동작
- 원자적 예산 예약 — 동시 요청 10개가 캡 3에서 정확히 3번만 통과 (racy 구현으로 역검증함)
- 멱등성 — 같은 Day 를 10번 요청해도 LLM 호출 1회 (FakeLlmClient 가 실제로 셈)
- `tests/no-real-llm.test.ts` 가 "1주차 LLM 호출 0회"를 구조적으로 강제한다
- 세션 만료 4경로(없음/유휴/절대/revoke) 전부 테스트로 증명됨
- 커리큘럼 3과목 × Day 1~7 (초안. 사용자가 고쳐 쓸 것)
- `check:secrets` · `tsc --noEmit` · `build` 전부 통과

**아직 Neon 계정이 없어도 된다.** 테스트는 PGlite 인메모리 Postgres에서 돈다.
`DATABASE_URL`은 실제로 앱을 띄울 때(Task 10) 필요해진다.

**Task 9.5 (디자인 캔버스) 완료.** 아트보드 8장.

캔버스: https://claude.ai/code/artifact/54e9838d-e75b-47cd-85a2-1e22ff749963
원본: `design/canvas/*.dc.html` + `canvas.json`

계획의 7장(로그인 / 대시보드 / 학습 / 채점 / 정리본 / 다듬기 / 발행)에
`States` 를 더했다 — 세션 바 4상태 + 막힌 화면 4장(429 / 401 / 409 / 423).

색·글꼴·간격 토큰은 계획의 **Task 9.5 결과 절**에 표로 있다.
Task 10 은 그 표를 그대로 쓴다. 방향의 이유는 `docs/DECISIONS.md`.

아직 없는 것: UI(Task 10).

## 바로 다음에 할 일

**Task 10 (`feat/ui-session`)** — 디자인을 코드로 옮긴다. 10 스텝 남아 있다.
`app/login/page.tsx`, `app/page.tsx`(대시보드), `components/SessionBar.tsx`,
`app/api/session/status/route.ts` + `lib/session/status.ts`.

**여기서 `DATABASE_URL` 이 실제로 필요해진다.** Neon 프로젝트를 먼저 만든다.

계획: `docs/plans/2026-08-31-week1-foundation.md` (Task 1~9.5는 완료 표시됨)

## 알아둘 것

- **HTTP 헤더는 ByteString 이다.** 테스트에서 쿠키 값에 한글을 넣으면 던진다. ASCII 만 쓴다.
- **테스트가 느려지고 있다.** DB 테스트마다 PGlite 인스턴스를 새로 만든다(~750ms).
  현재 66개에 14초. 40초를 넘기면 파일당 인스턴스 하나를 재사용하고
  테스트 사이에 TRUNCATE 하는 쪽으로 바꾼다. 지금은 격리가 더 중요하다.
- **날짜를 `new Date()`로 만들지 않는다.** `kstToday(clock.now())` 만 쓴다.
  시각(instant)이 필요하면 `Clock` 을 주입받는다 — 테스트가 sleep 없이 시간을 민다.
- **`lib/db/client.ts`는 지연 연결이다.** import 는 항상 성공하고 첫 쿼리에서 연결한다.
  Next 빌드가 라우트 모듈을 import 하므로 최상위에서 던지면 빌드가 깨진다(실제로 깨졌다).
  테스트는 이 파일 대신 `tests/helpers/testDb.ts`를 쓴다.
- **YAML 은 따옴표 없는 숫자를 number 로 읽는다.** 커리큘럼 keyword 에 `304` 같은 값을 쓸 때
  반드시 따옴표를 친다. zod 스키마가 잡아주지만 실수 자체를 줄이는 게 낫다.
- 마이그레이션 SQL은 `--> statement-breakpoint`로 나뉜다. 테스트 하네스가 이걸로 쪼개 실행한다.
- Next 16: `runtime = 'nodejs'` export 쓰지 않는다 / `params`는 Promise / `cookies()`는 async.
  추측하지 말고 `node_modules/next/dist/docs/`를 읽을 것.

## 먼저 해둘 것 (사용자 직접)

- [ ] **OpenAI 대시보드에서 프로젝트 하드 리밋 월 $5 설정** — 2주차 전까지
- [ ] Neon 프로젝트 생성 → `DATABASE_URL` (Task 10 전까지)
- [ ] Vercel 프로젝트를 이 레포에 연결
- [ ] 버셀 환경변수 `APP_ENV`: Production=`production`, Preview=`preview`

**API 키와 DB URL을 채팅에 붙여넣지 않는다.** `.env.local`과 버셀 환경변수에 직접 넣는다.

## 아직 안 정한 것

- [ ] Neon 무료 플랜에서 Preview용 DB 브랜치 자동 생성 가능 여부
- [ ] 커리큘럼 Day 1~7 내용 — 계획 Task 4에 초안이 있고 사용자가 이후 PR에서 고쳐 쓴다
- [ ] Velog access token 확보 방법 (4주차)

## 하지 말 것

- 1주차에 `OPENAI_API_KEY`를 넣지 말 것. 없는 것이 "실제 호출 0회"의 구조적 보장이다.
- 커리큘럼을 DB에 넣지 말 것. 레포의 YAML 파일이다.
- `progress` 테이블을 만들지 말 것. 진도는 `study_days`에서 파생한다.
- 하트비트 ping을 넣지 말 것. 유휴 타임아웃을 무력화한다.
- `AGENTS.md`를 지우지 말 것. `next dev`가 재생성한다.
- **`FakeLlmClient` 를 지우지 말 것.** 모든 통합 테스트가 이걸 주입해서 돈다.
- **`tests/no-real-llm.test.ts` 를 함부로 지우지 말 것.** 2주차에 진짜 클라이언트를 붙일 때
  이게 빨갛게 뜨는 것이 "이제 돈이 나가기 시작한다"는 신호다.
  지울 때 OpenAI 대시보드 하드 리밋이 걸려 있는지 함께 확인한다.
- 스키마를 고쳤으면 반드시 `npm run db:generate`를 돌려 마이그레이션을 함께 커밋할 것.
- **`design/canvas/study-page-daily-flow.html` 을 직접 편집하지 말 것.** 씨딩 산출물이다.
  캔버스를 고칠 때는 `design/canvas/*.dc.html` 을 고쳐서 다시 씨딩한다.
- **세션 만료 30초 경고에 "쓰던 답은 브라우저에 남는다"가 있다.**
  Task 10 이 답안 로컬 초안 보관을 실제로 구현하지 않으면 저 문구는 거짓말이 된다.

## 명령어

```bash
npm run dev
npm test
npm run check:secrets
npm run build
npm run db:generate
npx tsc --noEmit
```
