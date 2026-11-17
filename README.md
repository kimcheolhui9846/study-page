# study-page

영어 · 수학 · CS · 코딩테스트를 **지금 공부하고 싶은 주제로 바로** 공부하는 1인용 학습 플랫폼.
과목을 고르고 원하는 것을 적으면 자료와 문제가 나오고, 같은 자리에서 묻고 제출하고 피드백을 받는다.

**→ [study-page-six.vercel.app](https://study-page-six.vercel.app)**
(비밀번호 필요)

- **자유학습 설계:** [`docs/specs/2026-11-16-free-study-modes-design.md`](docs/specs/2026-11-16-free-study-modes-design.md)
- **커리큘럼 설계 (보조 경로):** [`docs/specs/2026-09-01-adaptive-curriculum-design.md`](docs/specs/2026-09-01-adaptive-curriculum-design.md)
- **현재 상태:** [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **결정 로그:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

## 네 모드

| 모드 | 무엇을 하나 | 기본 정책 |
|---|---|---|
| 영어 | 문법·어휘·독해·작문. 영어 지문과 첨삭 | 문장별 오류와 이유, 「이해 가능」과 「더 자연스러움」 구분 |
| 수학 | 정의·직관·예제·계산·증명 (KaTeX) | 답과 과정을 나눠 검토. 도구로 검산했다고 말하지 않는다 |
| CS | 개념·비교·동작 과정·코드 예시 | 직접 설명. 환경·버전 전제를 명시 |
| 코테 | 학습용 문제·붙여 넣은 문제와 코드 검토·복잡도 | **정답 코드를 먼저 주지 않는다.** 결과는 「AI 코드 검토」 — 실행기는 없다 |

모드마다 지도 방식·자료 형식·피드백 기준·공개 정책이 다르다 (`lib/study/modes/`).

## 자유학습 흐름

```
/  모드 선택 + 「무엇을 공부하고 싶은가」     ← DB 읽기만
   ↓ 학습 시작                                   AI 1회 (자료 or 짧은 확인 질문)
/study/[id]  자료(왼쪽) · 대화(오른쪽), 모바일은 탭
   ├ 질문·「2번 문제 설명해 줘」                  AI 1회 (자료를 원하면 +1)
   ├ 추가 문제 · 더 쉽게 · 문제 위주로             AI 1회, 새 버전 (이전 것 보존)
   ├ 답안·코드 제출 → 피드백 (오류만 / 고친 답까지) AI 1회
   └ 힌트 3단계 · 해설 보기                       0원 (저장된 것을 연다)
```

새로고침·재접속하면 대화·자료·제출이 그대로 돌아온다. 정답·해설·채점 기준은
학습자가 열기 전에는 API 응답·초기 HTML 에 들어가지 않는다.

기존 **적응형 커리큘럼**(`/dashboard` · `/today` · `/curriculum`)은 그대로 남아
보조 메뉴로 쓴다. 두 경로는 테이블을 공유하지 않는다.

## 돈이 이 프로젝트의 설계 제약이다

월 3만원 이하를 지키는 것이 요구사항이라 비용 방어를 4겹으로 깔았다.

| 겹 | 어디에 |
|---|---|
| ① 세션 게이트 | 돈 쓰는 라우트가 전부 `withSession` 뒤 |
| ② 멱등성 | 커리큘럼: `topic_contents(topic_id)` · `review_items(topic_id, round)` UNIQUE / 자유학습: `ai_requests(request_id)` PK |
| ③ 원자적 예약 | `lib/budget/reserve.ts` — 못 잡으면 **호출하지 않는다** |
| ④ 하드 리밋 | OpenAI 대시보드 (코드 밖) |

`review_items` 의 `CHECK (round BETWEEN 1 AND 4)` 가 Topic 당 복습 생성을
4회로 묶어 **무한 생성을 원리적으로 불가능**하게 만든다.

**하루 호출 수 = 생성이 필요한 항목 수 + 1.**
`tests/integration/day.test.ts` 가 이 등식을 지킨다.

실측(2026-09-02): 항목 2개짜리 하루가 **$0.0018**. `/admin/usage` 가
경로별·날짜별로 보여준다.

자유학습은 질문마다 호출이 나가므로 캡을 올렸다 (2026-11-16) — 운영 하루 100회 ·
월 $20. 월 비용 캡이 진짜 상한이다. 타임아웃처럼 비용을 모르는 실패는 상한 비용으로
보수 기록한다 (`lib/study/call.ts`).

## 스택

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Drizzle ORM ·
Neon Postgres · Vercel · OpenAI Structured Outputs —
자유학습 `gpt-6-luna`(대화) · `gpt-6.1-terra`(자료·피드백), 커리큘럼 `gpt-4o-mini`

## 개발

```bash
cp .env.example .env.local   # 값을 채운다
npm install
npm run db:migrate
npm run dev
```

```bash
npm test            # 개수는 docs/HANDOFF.md
npm run lint
npm run check:secrets   # NEXT_PUBLIC_ 비밀이 없는지
node scripts/peek.mjs   # DB 실측을 본다 (읽기만)
```

테스트는 PGlite 위에서 돌고 **실제 LLM 을 부르지 않는다.**
