# 핸드오프

**갱신:** 2026-08-31 · **브랜치:** `feat/curriculum` · **PR:** #6

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**1주차 Task 1~4 완료.** 뼈대 + 비밀 검사 + DB 스키마 + 시간 헬퍼 + 커리큘럼 로더가 서 있다.

- Next 16.3.3 / React 19.2.8 / Tailwind 4 / Vitest 4.1.11
- Drizzle 0.45.2 / PGlite 0.5.8 (테스트) / @neondatabase/serverless 1.1.0
- 테이블 7개, 마이그레이션 `drizzle/0000_wonderful_silver_centurion.sql`
- 테스트 **49개 통과** — check-secrets 7 + constraints 12 + time 14 + curriculum 16
- 커리큘럼 3과목 × Day 1~7 (초안. 사용자가 고쳐 쓸 것)
- `check:secrets` · `tsc --noEmit` · `build` 전부 통과

**아직 Neon 계정이 없어도 된다.** 테스트는 PGlite 인메모리 Postgres에서 돈다.
`DATABASE_URL`은 실제로 앱을 띄울 때(Task 10) 필요해진다.

아직 없는 것: 세션, 인증, 예산, LLM. Task 5~10이다.

## 바로 다음에 할 일

계획의 **Task 5 (`feat/session-store`)** — `SessionStore` 인터페이스 + `PostgresSessionStore`
+ 만료 4경로(없음/유휴/절대/revoke) 테스트. 여기부터 보안 계층이다.

```bash
git checkout main && git pull && git checkout -b feat/session-store
```

계획: `docs/plans/2026-08-31-week1-foundation.md` (Task 1~4는 완료 표시됨)

## 알아둘 것

- **날짜를 `new Date()`로 만들지 않는다.** `kstToday(clock.now())` 만 쓴다.
  시각(instant)이 필요하면 `Clock` 을 주입받는다 — 테스트가 sleep 없이 시간을 민다.
- **`lib/db/client.ts`는 import 시점에 `DATABASE_URL`이 없으면 던진다.** 의도한 동작이다 —
  런타임에 조용히 실패하는 것보다 빌드에서 큰 소리로 깨지는 게 낫다.
  테스트는 이 파일을 import 하지 않고 `tests/helpers/testDb.ts`를 쓴다.
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
- 스키마를 고쳤으면 반드시 `npm run db:generate`를 돌려 마이그레이션을 함께 커밋할 것.

## 명령어

```bash
npm run dev
npm test
npm run check:secrets
npm run build
npm run db:generate
npx tsc --noEmit
```
