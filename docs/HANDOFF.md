# 핸드오프

**갱신:** 2026-09-02 · **브랜치:** `feat/topic-detail` · PR #24~#27 머지됨

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**적응형 커리큘럼 1·2·3단계 완료.** Day 기반 고정 커리큘럼을 버리고
Topic 그래프로 갈아탔다. 설계는
[`docs/specs/2026-09-01-adaptive-curriculum-design.md`](specs/2026-09-01-adaptive-curriculum-design.md).

- 테스트 **527개 통과** (32파일, ~45초)
- `npm run build` 통과 — 라우트 14개
- ✅ **실제 GPT 로 Day 2 를 완주했다** (2026-09-02) — 자료 생성 2회 + 채점 1회,
  누적 **$0.0018**. 진도·복습 예약·취약 개념까지 실제로 기록됐다.

```
ƒ /                       대시보드 (진도 · 연속 · 복습 부담 · 예상 완료 · 최근 채점)
ƒ /curriculum             Topic 목록 · 과목 필터 · 과목 간 선수 관계
ƒ /today                  오늘 계획 · 진행 상황 · 전체 채점 버튼
ƒ /today/[topicId]        Topic 학습 (자료 만들기 / 지문+답안 / 채점 결과)
ƒ /topic/[topicId]        Topic 상세 (진도 · 선수 관계 · 회복 단계 · 기록)
ƒ /settings               설정 (목표 기간 · 하루 시간 · 과목 비중)
ƒ /login                  로그인
ƒ /api/settings           POST 설정 저장         ← 0원
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

### 1. 실호출에서 확인된 것과 남은 것

**확인됨 (2026-09-02, Day 2 완주):**

- `forbidden` 이 실제로 먹혔다 — 「변수와 자료형」 지문에 연속 메모리·인덱스·
  포인터·해시함수·빅오가 하나도 안 나왔다
- 멱등성 ②겹이 날짜를 넘어 동작한다 — 어제 만든 자료가 **호출 0회로 재사용**됐다
- 채점 1회로 2개 Topic 을 처리했고, 심어둔 오답(동사를 `quickly` 라고 씀)을
  잡아 `weak_concepts` 에 「동사의 정의」로 남겼다

**실측 비용:** 콘텐츠 $0.00056~0.00060 · 채점 $0.00061 (2개 묶음).
항목 2개짜리 하루가 약 **$0.0017**. 월 30일이면 **$0.05** 수준이다.

**로컬 캡은 하루 3회다** (`lib/budget/caps.ts`) — 항목 2개짜리 하루가 딱 3회다.
자료가 이미 있으면 그만큼 덜 쓴다.

**남은 것:** 복습 경로(`review_content`)는 실호출로 아직 안 봤다.
2026-09-03 에 두 Topic 의 1회차 복습이 예약돼 있으므로 그날 확인된다.

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

### 4. 프롬프트 결함 — 표본 3개 기준

| 결함 | 재현 | 판단 |
|---|---|---|
| **어투가 앱과 어긋난다** ("~습니다" vs 앱의 "~다") | **3 / 3** | ✅ 고쳤다 (`VOICE_RULE`). 실호출 확인은 09-03 복습 때 |
| **적용 문제가 적용을 시험하지 않는다** | **2 / 3** | 지켜볼 것. CS·2주차 표본은 지문을 그대로 되물었고, 영어 표본은 지문에 없는 새 문장으로 물어 제대로였다 |
| **루브릭에 주관이 섞인다** ("정확하게 …") | 1 / 3 | 3단계 프롬프트("검증 가능한 한 문장")로 안 나왔다. 보류 |

어투는 세 표본 모두에서 어긋났으므로 다음 작업에서 고친다.
**이미 만들어진 자료는 UNIQUE 때문에 다시 안 만들어지므로 효과는 다음 Topic 부터다.**

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
| **지금** | 복습 경로 실호출 확인 (09-03 예약됨) — 고친 문체도 여기서 같이 본다 |
| 다음 | 커리큘럼 Topic 채우기 · 모바일 레이아웃 · `/admin/usage` |
| 열린 결정 | 취약 Topic 독점 (위 2번) |

## 사용자 쪽 남은 일

- Vercel 프로젝트 연결 + 환경변수
  (`DATABASE_URL`, `AUTH_PASSWORD_HASH`, `OPENAI_API_KEY`, `APP_ENV=production`)
