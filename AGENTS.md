<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!--
  ★ 아래는 이 프로젝트의 규칙이다. 위 블록은 `next dev` 가 다시 쓰므로
  건드리지 말고, 규칙은 반드시 END 마커 **뒤에** 둔다.

  이 파일이 정본이다. `CLAUDE.md` 는 여기를 가리키기만 한다 —
  에이전트마다 읽는 파일이 다른데 규칙을 두 곳에 두면 어긋난다.
-->

# study-page 작업 규칙

## 세션 시작 시

1. **`git pull --ff-only`** — 다른 에이전트가 그 사이에 머지했을 수 있다.
2. **`docs/HANDOFF.md`를 먼저 읽는다.** 코드를 보기 전에.
3. 설계 근거가 필요하면 `docs/DECISIONS.md`와 `docs/specs/`를 본다.

## ★ 에이전트를 번갈아 쓴다

이 저장소는 Claude Code 와 Codex 가 번갈아 작업한다. 둘이 같은 순간에
같은 파일을 보지 않도록 **작업 단위를 닫고 넘긴다.**

- **한 번에 PR 하나.** 열어둔 채로 다른 작업을 시작하지 않는다.
- **커밋하지 않은 변경을 남긴 채 넘기지 않는다.** 다음 에이전트가 그 위에서
  시작하면 누가 무엇을 바꿨는지 알 수 없게 된다.
- **넘기기 전에 `docs/HANDOFF.md`를 갱신한다.** 그게 유일한 인수인계다 —
  대화 기록은 다음 에이전트에게 닿지 않는다.
- `npm run dev` 를 돌리면 이 파일 위쪽 블록이 다시 쓰여 커밋 안 된 변경이
  생길 수 있다. 작업과 함께 커밋하면 트리가 깨끗해진다.

## Next.js 16

이 프로젝트는 Next 16이다. 학습 데이터의 Next와 다르므로 **추측하지 말고
`node_modules/next/dist/docs/`의 해당 문서를 읽는다.** 이미 확인한 차이:

- `export const runtime = 'nodejs'`는 **기본값이고 문서가 제거를 권한다.** Edge 런타임은 deprecated다.
- 라우트 핸들러의 `params`는 **Promise**이며 두 번째 인자(context)로 온다. `await` 해야 한다.
- `cookies()`는 async다.

## 작업 종료 시 (PR 올리기 전 필수)

1. `docs/HANDOFF.md`를 현재 상태로 통째로 덮어쓴다.
2. 설계 결정을 새로 내렸으면 `docs/DECISIONS.md`에 **추가**한다. 기존 항목은 지우지 않는다.
3. 이 두 갱신을 같은 PR에 포함시킨다. 별도 커밋으로 미루지 않는다.

## 이 프로젝트에서 절대 하지 않는 것

- **`NEXT_PUBLIC_` 접두사가 붙은 비밀을 만들지 않는다.** 붙는 순간 클라이언트 번들에 공개된다.
- **`lib/llm/client.ts` 밖에서 `OPENAI_API_KEY`를 읽지 않는다.** 이 파일이 유일한 소비처다.
  (`tests/api-key-boundary.test.ts`가 강제한다.)
- **테스트에서 실제 LLM을 호출하지 않는다.** 가짜 클라이언트를 주입한다.
- **`new Date()`로 날짜를 만들지 않는다.** 날짜는 KST 기준이며 `lib/time.ts`의 `kstToday()`만 쓴다.
- **`main`에 직접 커밋하지 않는다.** 작업 단위마다 브랜치를 따고 PR을 연다.
- **하트비트 ping을 넣지 않는다.** 유휴 타임아웃을 무력화한다 (`docs/DECISIONS.md` 참조).
- **API 키나 DB 접속 문자열을 채팅에 붙여넣지 않는다.** `.env.local`과 Vercel 환경변수로만 간다.

## 비용 게이트를 건드릴 때

`lib/budget/reserve.ts`, `lib/session/guard.ts`, `topic_contents`·`review_items`의
UNIQUE 제약, `plan_items`의 CHECK 제약 — 이 넷이 비용 방어선이다.
자유학습에서는 여기에 `lib/study/call.ts`(유일한 유료 호출 지점·실패 정산),
`ai_requests` PK(멱등성), `study_submissions`의 시도 CHECK 가 더해진다.
고치기 전에 아래를 읽고, 고친 뒤에는 반드시 테스트를 돌린다.

- [`2026-08-31-ai-study-page-design.md`](docs/specs/2026-08-31-ai-study-page-design.md)
  **§3** 보안·세션·비용 차단 · **§4.5** 예산 예약(레이스 없는 원자적 차감)
- [`2026-09-01-adaptive-curriculum-design.md`](docs/specs/2026-09-01-adaptive-curriculum-design.md)
  **§0.3** ③겹의 계산 근거 · **§7.4** 예산에 맞춰 자르기
- [`2026-11-16-free-study-modes-design.md`](docs/specs/2026-11-16-free-study-modes-design.md)
  **§5** 멱등성 · **§6** 비용·실패 정산

**캡은 환경에서 온다. 카운터 행에 굳어 있지 않다** (`lib/budget/caps.ts`).
스크립트가 돈을 쓸 때도 `reserve()`를 지나야 한다 — 방어선에 뒷문을 내면
그게 방어선이 아니다.

## 저장된 데이터를 읽는 스키마는 따로다

**모델에게 요구하는 것과 디스크에서 견디는 것은 다르다.**

| | 스키마 | 새 필드 |
|---|---|---|
| 모델 응답 검증 | `ContentSchema` · `ReviewSchema` · 자유학습 `…Gen` | **필수** |
| 저장된 행 읽기 | `StoredContentSchema` · `StoredReviewSchema` · 자유학습 `Stored…` | 선택 |

필수 필드를 더했다가 그 전에 저장된 자료가 전부 무효가 되어 학습이 통째로
막힌 적이 있다. **새 필드는 생성에서 필수, 읽기에서 선택으로 둔다.**

## 자유학습을 고칠 때

기본 진입 경로다 (`/` → `/study/[id]`). 설계는
[`2026-11-16-free-study-modes-design.md`](docs/specs/2026-11-16-free-study-modes-design.md).

- **비공개(정답·루브릭·해설·힌트)는 `study_problems.private` 에만.** 밖으로는
  `publicProblem()` · `publicFeedback()` 투영만 나간다. 필드를 더하면
  `tests/study/schemas.test.ts` 의 화이트리스트가 먼저 깨진다 — 그게 의도다.
- **대화 모델(luna)에는 미공개 해설을 넘기지 않는다** (`lib/study/context.ts`).
- 세션 경계는 `lib/study/store.ts` 가 강제한다. 문제를 찾는 함수는 sessionId 를 받는다.
- 하네스는 `lib/study/modes/` 의 데이터다. 모드를 더하면 DB 의 `study_mode` CHECK 도 고친다.
- 코드 실행기는 없다. 「실행·통과·AC」라는 말을 화면과 프롬프트에 쓰지 않는다.

## 커리큘럼을 고칠 때 (보조 경로)

`curriculum/**/*.yaml`이 유일한 출처다. **커리큘럼 경로에서 GPT는 Topic을 만들지 않는다** —
지문과 문제만 만든다. Topic 추가·수정은 PR로만 한다. (자유학습은 Topic 이 아니라
학습 세션을 만든다 — YAML 과 무관하다.)

검증은 레포 안에 있다. `npm test`가 중복 ID · 없는 선수 참조 · 사이클 ·
subject 불일치 · 연습 Topic의 선수 여부를 잡는다.

- **연습(`kind: practice`) Topic은 선수를 갖지 않는다.** 개념을 못 넘겨서
  내려오는 곳인데 선수를 걸면 그 상황에서 잠긴다.
- 문제 유형은 성격마다 다르다. 새 유형을 쓰면 `lib/llm/context.ts`의
  사전에도 넣는다 — 테스트가 커리큘럼의 값을 전부 훑는다.

## Git

- 브랜치: `feat/…`, `fix/…`, `chore/…`, `docs/…`
- 머지는 squash
- **커밋과 푸시는 사용자가 요청할 때만 한다.**
- 커밋 저자는 사용자 단독. AI 공동저자 트레일러를 넣지 않는다.

## 검증

PR 전에 넷을 전부 돌린다.

```bash
npm test              # 개수는 docs/HANDOFF.md 에 있다
npm run lint          # 0 이어야 한다
npx tsc --noEmit
npm run check:secrets
```

**린트 경고도 0 이어야 한다.** 계속 빨간 린트는 진짜 오류를 묻는다 —
끄려면 그 줄에서만 끄고 근거를 주석으로 남긴다.

## 스택 참조

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Drizzle ORM ·
Neon Postgres · Vercel · OpenAI Structured Outputs
(자유학습 `gpt-6-luna`·`gpt-6.1-terra`, 커리큘럼 `gpt-4o-mini` — 단가는 `lib/llm/pricing.ts`)

자유학습 설계는 [`docs/specs/2026-11-16-free-study-modes-design.md`](docs/specs/2026-11-16-free-study-modes-design.md),
커리큘럼 설계는 [`docs/specs/2026-09-01-adaptive-curriculum-design.md`](docs/specs/2026-09-01-adaptive-curriculum-design.md).
