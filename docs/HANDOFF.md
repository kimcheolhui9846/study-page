# 핸드오프

**갱신:** 2026-08-31 · **브랜치:** `feat/scaffold` · **PR:** #3

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**1주차 Task 1 완료.** 앱 뼈대 + 테스트 러너 + 비밀 검사가 돌아간다.

- Next **16.3.3** / React 19.2.8 / Tailwind 4 / Vitest 4.1.11
- 테스트 7개 통과 (`tests/check-secrets.test.ts`)
- `npm run check:secrets` → `OK — NEXT_PUBLIC_ 없음`
- `npx tsc --noEmit` 에러 0개
- `npm run build` 통과

아직 없는 것: DB, 세션, 인증, 예산, 커리큘럼 로더, LLM. 전부 Task 2~10이다.

## 바로 다음에 할 일

계획의 **Task 2 (`feat/db-schema`)** — Drizzle 스키마 + 마이그레이션 + PGlite 제약 테스트.

```bash
git checkout main && git pull && git checkout -b feat/db-schema
```

계획: `docs/plans/2026-08-31-week1-foundation.md` (Task 1은 완료 표시됨)

## Next 16 관련 (계획과 다른 부분 — 이미 계획에 반영됨)

- `export const runtime = 'nodejs'` 를 쓰지 않는다. 기본값이고 문서가 제거를 권한다.
- 동적 라우트 `params` 는 **Promise** 이며 context 로 온다. `withSession` 이 context 를 넘긴다.
- `cookies()` 는 async 다.
- 추측하지 말고 `node_modules/next/dist/docs/` 를 읽을 것. `AGENTS.md` 가 이걸 지시한다.

## 먼저 해둘 것 (사용자 직접)

- [ ] **OpenAI 대시보드에서 프로젝트 하드 리밋 월 $5 설정** — 2주차 전까지. 코드 밖의 마지막 안전망
- [ ] Neon 프로젝트 생성 → `DATABASE_URL` (Task 2에서 필요. 단, 테스트는 PGlite라 없어도 돈다)
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

## 명령어

```bash
npm run dev
npm test
npm run check:secrets
npm run build
npx tsc --noEmit
```
