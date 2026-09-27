# study-page

영어 · 수학 · CS를 **적응형 커리큘럼**으로 공부하는 1인용 학습 플랫폼.
어제 무엇을 틀렸는지가 오늘 무엇을 배울지를 바꾼다.

**→ [study-page-kimcheolhui9846s-projects.vercel.app](https://study-page-kimcheolhui9846s-projects.vercel.app)**
(비밀번호 필요)

- **설계 스펙:** [`docs/specs/2026-09-01-adaptive-curriculum-design.md`](docs/specs/2026-09-01-adaptive-curriculum-design.md)
- **현재 상태:** [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **결정 로그:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

## 무엇이 다른가

커리큘럼이 Day 목록이 아니라 **Topic 그래프**다. 정해진 목차대로 간다면
책을 사는 것과 다를 게 없다. 그래서 하루의 계획은 매일 아침 진도·복습
기한·못 넘긴 개념에서 다시 계산된다.

- **선수 관계가 진도를 막는다** — 커리큘럼 파일(`curriculum/**/*.yaml`)의
  그래프가 부팅에서 검증된다. 과목을 넘는 선수도 있다
- **못 넘기면 하위 개념으로 내려간다** — 복습 1회 → 실패 시 보충 →
  다시 복습 → 결과와 무관하게 다음 진도. 3번 하고도 안 되면 14일 접어둔다
- **모델은 그래프를 모른다** — `lib/llm/context.ts` 가 고른 것만 본다.
  아직 안 배운 후속 Topic 의 키워드를 `forbidden` 으로 넘겨, Day 3 에서
  트랜스포머가 튀어나오는 일을 막는다

## 돈이 이 프로젝트의 설계 제약이다

월 3만원 이하를 지키는 것이 요구사항이라 비용 방어를 4겹으로 깔았다.

| 겹 | 어디에 |
|---|---|
| ① 세션 게이트 | 돈 쓰는 라우트가 전부 `withSession` 뒤 |
| ② 멱등성 | `topic_contents(topic_id)` · `review_items(topic_id, round)` UNIQUE |
| ③ 원자적 예약 | `lib/budget/reserve.ts` — 못 잡으면 **호출하지 않는다** |
| ④ 하드 리밋 | OpenAI 대시보드 (코드 밖) |

`review_items` 의 `CHECK (round BETWEEN 1 AND 4)` 가 Topic 당 복습 생성을
4회로 묶어 **무한 생성을 원리적으로 불가능**하게 만든다.

**하루 호출 수 = 생성이 필요한 항목 수 + 1.**
`tests/integration/day.test.ts` 가 이 등식을 지킨다.

실측(2026-09-02): 항목 2개짜리 하루가 **$0.0018**. `/admin/usage` 가
경로별·날짜별로 보여준다.

## 스택

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Drizzle ORM ·
Neon Postgres · Vercel · OpenAI `gpt-4o-mini` (Structured Outputs)

## 개발

```bash
cp .env.example .env.local   # 값을 채운다
npm install
npm run db:migrate
npm run dev
```

```bash
npm test            # 632개
npm run lint
npm run check:secrets   # NEXT_PUBLIC_ 비밀이 없는지
node scripts/peek.mjs   # DB 실측을 본다 (읽기만)
```

테스트는 PGlite 위에서 돌고 **실제 LLM 을 부르지 않는다.**
