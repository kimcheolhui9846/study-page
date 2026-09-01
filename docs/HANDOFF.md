# 핸드오프

**갱신:** 2026-09-01 · **브랜치:** `docs/adaptive-curriculum` · **PR:** #24 (열려 있음)

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**적응형 커리큘럼 1·2·3단계 완료.** Day 기반 고정 커리큘럼을 버리고
Topic 그래프로 갈아탔다. 설계는
[`docs/specs/2026-09-01-adaptive-curriculum-design.md`](specs/2026-09-01-adaptive-curriculum-design.md).

- 테스트 **417개 통과** (28파일, ~35초)
- `npm run build` 통과 — 라우트 14개
- **아직 실제 GPT 로 하루를 완주하지 않았다.** 이것이 3단계의 마지막 확인이다.

```
ƒ /                       대시보드 (커리큘럼 개관 · 실현 가능성)
ƒ /curriculum             Topic 목록 · 과목 필터 · 과목 간 선수 관계
ƒ /today                  오늘 계획 · 진행 상황 · 전체 채점 버튼
ƒ /today/[topicId]        Topic 학습 (자료 만들기 / 지문+답안 / 채점 결과)
ƒ /login                  로그인
ƒ /api/session            POST 로그인
ƒ /api/session/end        POST [종료] → 즉시 파기
ƒ /api/session/leaving    POST pagehide → 유휴 30초로 당김
ƒ /api/session/status     GET 만료 시각 두 개
ƒ /api/topic/content      POST 자료 생성        ← 돈 (항목당 1회, 평생 1회)
ƒ /api/topic/answers      POST 답안 저장        ← 0원
ƒ /api/topic/hint         GET 힌트              ← 0원
ƒ /api/plan/grade         POST 하루 통째 채점    ← 돈 (하루 1회)
```

## ★ 이 앱의 하루

```
/today  → 계획이 만들어진다 (LLM 0회, estimated_calls 가 여기서 확정)
   ↓
/today/[topicId] → 「자료 만들기」  ← LLM 1회 · topic_contents 에 영구 저장
   ↓
   지문 읽고 답 쓰기 → 「답 저장하기」  ← LLM 0회
   ↓
   (항목마다 반복)
   ↓
/today → 「오늘 것 채점받기」  ← LLM 1회, 항목 전부를 한 번에
   ↓
   숙련도 갱신 → 복습 예약 → 내일 계획이 달라진다
```

**하루 호출 수 = 생성이 필요한 항목 수 + 1.** 이 등식을
`tests/integration/day.test.ts` 가 지킨다 — 계획이 미리 예고한
`daily_plans.estimated_calls` 와 실제 호출 수가 같은지 단언한다.

## 비용 방어 4겹 (지금 어디 있나)

| 겹 | 위치 |
|---|---|
| ① 세션 게이트 | `lib/session/guard.ts` — 모든 돈 쓰는 라우트가 `withSession` 뒤 |
| ② 멱등성 | `topic_contents(topic_id)` · `review_items(topic_id, round)` UNIQUE |
| ③ 원자적 예약 | `lib/budget/reserve.ts` — 못 잡으면 **호출하지 않는다** |
| ④ 하드 리밋 | OpenAI 대시보드 (코드 밖). 자동 충전 OFF |

**추가로:** `review_items` 의 `CHECK (round BETWEEN 1 AND 4)` 가 Topic 당
복습 생성을 4회로 묶는다. 무한 생성이 원리적으로 불가능하다.

### 실패했을 때 예약을 되돌리는가

| 실패 지점 | 롤백 | 왜 |
|---|---|---|
| 호출이 던짐 (네트워크·HTTP 오류) | **한다** | 돈이 안 나갔다 |
| 응답이 zod 검증 실패 | **안 한다** | 돈은 이미 나갔다. 되돌리면 검증에 계속 실패하는 응답이 캡에 안 걸린 채 돈을 태운다 |

`tests/llm/ensure.test.ts` · `tests/llm/grade.test.ts` 가 둘 다 단언한다.

## ★ 다음 세션이 먼저 읽어야 할 것

### 1. 실제 GPT 로 하루를 완주하지 않았다

3단계의 완료 기준이 이것이다. 전부 `FakeLlmClient` 로만 검증됐다.
`.env.local` 에 `OPENAI_API_KEY` 를 넣고 `npm run dev` 로 하루를 살아봐야 한다.
**로컬 캡은 하루 3회다** (`lib/budget/caps.ts`) — 항목 2개짜리 하루가 딱 3회다.

### 2. 계속 틀리는 Topic 이 일정을 독점한다 (알려진 결함)

`tests/plan/simulation.test.ts` 의 「알려진 한계」 테스트가 이 숫자를 박아뒀다.

- 우선순위의 `80 × min(5, wrongCount)` = 최대 **400점**이 다른 모든 항을 압도한다
- 취약 재학습은 콘텐츠를 새로 안 만들어 **예산에도 안 걸린다** (`fitToBudget` 이 못 자른다)
- 결과: 수학만 계속 틀리는 학습자는 30일 중 **복습 120슬롯 / 신규 9슬롯**,
  건드린 Topic 이 9개뿐이다

고치려면 `lib/plan/candidates.ts` 의 `priorityOf` 균형을 손봐야 하는데,
"몇 번 틀리면 잠시 접어두는가"는 제품 결정이라 사용자와 정해야 한다.

### 3. 모델이 준 숫자를 믿지 않는다

채점 스키마에서 **`score` 필드를 아예 제거했다.** 2주차에 모델이 자기가
명시한 계산식을 어겼다(포인트 0/3 에 50점). 지금은 `correct_points` /
`missed_points` 만 받고 숫자는 `lib/mastery/score.ts` 가 만든다.
안 읽을 필드를 남겨두면 언젠가 누가 읽는다.

### 4. 프롬프트 결함 셋이 미해결이다

표본이 하나뿐이라 고치지 않았다. **여러 Topic 을 만들어보고 반복되는 것만 고친다.**

1. **지문이 문제의 답을 그대로 담았다.** 프롬프트가 금지했는데도 그랬다
2. **어투가 앱과 어긋난다.** 지문과 피드백은 "~습니다", 나머지는 "~다"
3. **루브릭에 주관이 섞였다.** "정확하게 ... 정의했음"의 "정확하게"

3단계에서 프롬프트를 다시 썼으므로(공통 규칙 분리 · 금지어 규칙 추가)
실제 출력으로 다시 확인해야 한다.

## 커리큘럼

`curriculum/**/*.yaml` — **65 Topic**. 30일=51 / 60일=61 / 90일=65.
DB 가 아니라 레포의 파일이다 — PR 로 고치고, 리뷰가 남고, 롤백된다.

- 과목 간 선수 9개 (예: `math.ai.backprop-math → cs.dl.backpropagation`)
- 과목 간 연결 6개 (`_links.yaml`) — 진도를 막지 않고 "왜 배우나"만 말한다
- `math.foundation.*` 은 전부 `optional` 이다. 보충으로만 도달한다

Topic 을 추가할 때 그래프가 부팅에서 검증한다 — 중복 ID · 없는 선수 참조 ·
사이클 · ID 접두사와 파일 subject 불일치.

## 컨텍스트가 프롬프트로 흘러드는 곳

`lib/llm/context.ts` 하나다. 모델은 그래프를 모르고 이 함수가 고른 것만 본다.

- `forbidden` — **아직 안 배운 후속 Topic 의 키워드.** 그래프 거리순으로 최대 12개.
  이게 없으면 Day 3 에서 트랜스포머가 나온다
- `alreadyLearned` — 넘긴 선수 (60점 이상). 다시 설명하지 말라고 넘긴다
- `weakConcepts` — 채점이 지목한 것. `topic_progress` 에 누적된다
- `connections` — `_links.yaml` 의 "왜 이걸 배우나"

## 남은 일

| | |
|---|---|
| **지금** | 실제 GPT 로 하루 완주 · 프롬프트 결함 재확인 |
| 다음 | 대시보드 확장 (진도·연속 학습일·예상 완료일·최근 점수) |
| | Topic 상세 화면 · 사용자 설정 화면 (`users` 테이블은 이미 있다) |
| | 커리큘럼 Topic 채우기 · 모바일 레이아웃 · `/admin/usage` |
| 열린 결정 | 취약 Topic 독점 (위 2번) |

## 사용자 쪽 남은 일

- Vercel 프로젝트 연결 + 환경변수
  (`DATABASE_URL`, `AUTH_PASSWORD_HASH`, `OPENAI_API_KEY`, `APP_ENV=production`)
