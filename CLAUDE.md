# study-page 작업 규칙

## 세션 시작 시

1. **`docs/HANDOFF.md`를 먼저 읽는다.** 코드를 보기 전에.
2. 설계 근거가 필요하면 `docs/DECISIONS.md`와 `docs/specs/`를 본다.

## 작업 종료 시 (PR 올리기 전 필수)

1. `docs/HANDOFF.md`를 현재 상태로 통째로 덮어쓴다.
2. 설계 결정을 새로 내렸으면 `docs/DECISIONS.md`에 **추가**한다. 기존 항목은 지우지 않는다.
3. 이 두 갱신을 같은 PR에 포함시킨다. 별도 커밋으로 미루지 않는다.

## 이 프로젝트에서 절대 하지 않는 것

- **`NEXT_PUBLIC_` 접두사가 붙은 비밀을 만들지 않는다.** 붙는 순간 클라이언트 번들에 공개된다.
- **`lib/llm/client.ts` 밖에서 `OPENAI_API_KEY`를 읽지 않는다.** 이 파일이 유일한 소비처다.
- **테스트에서 실제 LLM을 호출하지 않는다.** 가짜 클라이언트를 주입한다.
- **`new Date()`로 날짜를 만들지 않는다.** 날짜는 KST 기준이며 `lib/time.ts`의 `kstToday()`만 쓴다.
- **`main`에 직접 커밋하지 않는다.** 작업 단위마다 브랜치를 따고 PR을 연다.
- **하트비트 ping을 넣지 않는다.** 유휴 타임아웃을 무력화한다 (`docs/DECISIONS.md` 참조).

## 비용 게이트를 건드릴 때

`lib/budget/reserve.ts`, `lib/session/guard.ts`, `study_days`의 UNIQUE 제약,
`attempts`의 CHECK 제약 — 이 넷은 비용 방어선이다.
고치기 전에 스펙 §3.1을 읽고, 고친 뒤에는 반드시 테스트를 돌린다.

## Git

- 브랜치: `feat/…`, `fix/…`, `chore/…`, `docs/…`
- 머지는 squash
- 커밋 저자는 사용자 단독. AI 공동저자 트레일러를 넣지 않는다.

## 스택 참조

Next.js (App Router) · TypeScript · Tailwind · Drizzle ORM · Neon Postgres · Vercel · OpenAI `gpt-4o-mini`

전체 설계는 [`docs/specs/2026-08-31-ai-study-page-design.md`](docs/specs/2026-08-31-ai-study-page-design.md).
