# 적응형 커리큘럼 설계

**작성:** 2026-09-01
**전제:** `docs/specs/2026-08-31-ai-study-page-design.md` 의 보안·비용 설계를 그대로 계승한다.
**범위:** 고정된 일렬 커리큘럼을 **Topic 그래프 + 매일 생성되는 학습 계획**으로 바꾼다.

---

## 0. 이 설계가 기존 시스템과 부딪히는 곳

먼저 이것부터 정리하지 않으면 나머지가 전부 어긋난다.

### 0.1 `day_no` 는 두 가지 뜻을 겸하고 있다

지금 `study_days.day_no` 는 동시에 두 가지다:

1. **커리큘럼의 위치** — `curriculum/cs.yaml` 의 몇 번째 항목인가
2. **진행 정도** — 얼마나 왔는가 (`MAX(day_no) + 1` 이 다음 진도)

커리큘럼이 고정된 일렬 배열이고 **하루에 정확히 한 칸씩** 나아가기 때문에 성립했다.

적응형에서는 넷 다 깨진다:

| 깨지는 전제 | 적응형에서 실제로 일어나는 일 |
|---|---|
| 하루 = 한 주제 | 하루에 세 과목 × 여러 주제 |
| 항상 전진 | 어떤 날은 복습만 한다 |
| 본선만 존재 | 보충 주제가 본선 밖에서 끼어든다 |
| 일렬 | 주제들이 선수 관계로 **그래프**를 이룬다 |

**그래서 `day_no` 를 둘로 쪼갠다:**

```
Topic          커리큘럼의 노드. 그래프의 정점. 순서가 아니라 관계를 갖는다.
DailyPlan      몇 번째 학습일인가. 달력. Topic 여러 개를 담는다.
```

### 0.2 멱등성의 키가 Day 에서 Topic 으로 옮겨간다

1주차의 ②겹은 `study_days UNIQUE(subject, day_no)` 였다 —
**"Day 5 의 콘텐츠는 평생 한 번만 만든다."**

Day 가 가변이 되면 그 키는 무의미해진다. 대신:

```
topic_contents  UNIQUE(topic_id)     ← 콘텐츠는 Topic 당 평생 1회
review_items    UNIQUE(topic_id, round)  ← 복습은 회차당 1회 (최대 4회차)
```

**멱등성의 강도는 그대로다.** 키만 옮긴다. Day 5 가 복습일이 되든 신규일이
되든, 어떤 Topic 의 본 콘텐츠는 여전히 평생 한 번만 생성된다.

복습은 "매번 다른 내용"이어야 하므로(요구사항 §8) 회차를 키에 넣는다.
1·3·7·14일 후 = 최대 4회차. **무한 생성이 원리적으로 불가능하다.**

### 0.3 ③겹(예산)의 계산 근거가 무너진다

일일 캡 20 은 "3과목 × Day 당 최대 5호출" 위에서 나온 숫자다.
적응형에서는 하루에 영어 2주제 + 수학 복습 1 + CS 신규 1 + 보충 1 처럼
호출 수가 계획에 따라 달라진다.

**해법: 하루 계획 생성이 곧 예산 계획이다.**

```
plan(user, date) →  { topics: [...], estimatedCalls: 7 }
```

계획을 세우는 단계는 **LLM 을 한 번도 부르지 않는다.** 순수 함수다.
계획이 오늘 남은 예산을 넘으면 **캡을 올리지 않고 계획을 줄인다** —
우선순위가 낮은 Topic 을 내일로 민다.

이렇게 하면:

- ③겹이 여전히 의미를 갖는다 (계획 자체가 캡 안에서 만들어진다)
- 계획 생성 로직을 **호출 0회로 테스트할 수 있다**
- 사용자는 "오늘 7번 부른다"를 학습 시작 **전에** 본다

### 0.4 기존 데이터

`study_days` 에 CS Day 1 한 행이 있다 (2주차 검증용). 새 구조는 테이블이
다르므로 **깨끗한 마이그레이션으로 간다.** 한 행을 옮기려고 변환 로직을
쓰지 않는다 — 그 코드가 남으면 다음 사람이 그것을 진짜 경로로 오해한다.

---

## 1. 전체 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  커리큘럼 (고정)                     레포의 YAML             │
│  ─────────────────────────────────────────────────────────  │
│  Subject → Domain → Module → Topic                          │
│  Topic 은 선수 관계로 그래프를 이룬다 (DAG)                  │
│  ★ 여기에 학습 "내용"은 없다. 메타데이터뿐이다.              │
└──────────────────────────┬──────────────────────────────────┘
                           │ 읽기 전용
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  계획 엔진 (순수 함수 · LLM 호출 0회)                        │
│  ─────────────────────────────────────────────────────────  │
│  lib/plan/  ← 진도 · 복습 큐 · 선수 지식 · 시간 배분 ·       │
│               우선순위 · 예산 한도를 받아 오늘의 계획을 낸다 │
│  ★ 전부 테스트 가능. 여기서 돈이 나가지 않는다.              │
└──────────────────────────┬──────────────────────────────────┘
                           │ DailyPlan
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  4겹 방어선 (1주차에 세운 것 그대로)                         │
│  ① 세션 게이트  ② 멱등성(Topic 키)  ③ 예산  ④ 대시보드 한도 │
└──────────────────────────┬──────────────────────────────────┘
                           │ 통과한 것만
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  콘텐츠 생성 (GPT)                                          │
│  lib/llm/  ← content · grade · review · polish              │
│  ★ 커리큘럼을 모른다. 넘겨받은 컨텍스트만 본다.              │
└──────────────────────────┬──────────────────────────────────┘
                           │ 채점 결과
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  숙련도 갱신 (순수 함수 · LLM 호출 0회)                      │
│  lib/mastery/ ← 점수 계산 · 상태 전이 · 복습 예약 ·          │
│                 보충 삽입 · 취약점 기록                      │
└─────────────────────────────────────────────────────────────┘
```

**핵심 분리 세 가지:**

1. **커리큘럼은 내용을 갖지 않는다.** 메타데이터(주제·목표·선수 관계·난이도)만
   갖는다. 내용은 GPT 가 만들고 DB 에 쌓인다. 그래서 커리큘럼을 늘려도
   저장소가 커지지 않고, Topic 을 추가하는 비용이 YAML 몇 줄이다.
2. **계획 엔진은 LLM 을 모른다.** 순수 함수라 전부 테스트된다. 오늘 몇 번
   부를지가 호출 전에 정해진다.
3. **숙련도 갱신도 LLM 을 모른다.** GPT 는 채점 근거만 주고, 점수·상태 전이·
   복습 일정은 우리가 계산한다 (2주차의 교훈 — `docs/DECISIONS.md`).

---

## 2. 폴더 구조

```
curriculum/
├─ english/
│  ├─ _domains.yaml          영역 정의 (A~E)
│  ├─ a-vocabulary.yaml      Topic 목록
│  ├─ b-grammar.yaml
│  ├─ c-reading.yaml
│  ├─ d-speaking.yaml
│  └─ e-writing.yaml
├─ math/
│  ├─ _domains.yaml
│  ├─ a-foundation.yaml      기초 보충 (필요할 때만)
│  ├─ b-linear-algebra.yaml
│  ├─ c-calculus.yaml
│  ├─ d-probability.yaml
│  └─ e-ai-math.yaml
├─ cs/
│  ├─ _domains.yaml
│  ├─ a-programming.yaml
│  ├─ b-data-structures.yaml
│  ├─ c-algorithms.yaml
│  ├─ d-operating-systems.yaml
│  ├─ e-languages-architecture.yaml
│  ├─ f-software-engineering.yaml
│  ├─ g-machine-learning.yaml
│  └─ h-deep-learning.yaml
└─ _links.yaml               과목 간 연결 (영어↔수학↔CS)

lib/
├─ curriculum/
│  ├─ schema.ts              zod: Topic · Domain · Link
│  ├─ load.ts                YAML → 메모리 그래프 (캐시)
│  └─ graph.ts               선수 관계 순회 · 사이클 검사 · 위상 정렬
├─ plan/
│  ├─ candidates.ts          오늘 후보 Topic 모으기 (복습·보충·신규)
│  ├─ priority.ts            우선순위 점수 계산
│  ├─ allocate.ts            시간·과목 비율 배분
│  ├─ budget.ts              예상 호출 수 계산 · 캡에 맞춰 자르기
│  └─ build.ts               위를 조립해 DailyPlan 을 만든다
├─ mastery/
│  ├─ score.ts               채점 근거 → 숙련도 점수
│  ├─ transition.ts          점수 → 상태 전이 · 다음 행동
│  └─ schedule.ts            간격 반복 복습 예약
└─ llm/                      (기존) content · grade · review 프롬프트 추가

app/
├─ page.tsx                  대시보드
├─ today/page.tsx            오늘의 학습
├─ curriculum/page.tsx       Day 1~N 목록 · 필터 · 진도 시각화
├─ topic/[topicId]/page.tsx  Topic 상세
├─ result/[dayNumber]/page.tsx  학습 결과
└─ settings/page.tsx         사용자 설정
```

---

## 3. 데이터 모델

### 3.1 커리큘럼 (YAML · 읽기 전용)

```yaml
# curriculum/math/b-linear-algebra.yaml
subject: math
domain: linear-algebra
label: 선형대수
modules:
  - id: vectors
    label: 벡터와 행렬의 기초
    topics:
      - id: math.la.scalar-vector-matrix
        title: 스칼라·벡터·행렬
        summary: 세 가지가 각각 무엇을 담는 그릇인지 구분한다
        goal: 스칼라·벡터·행렬을 차원으로 구분하고 각각의 표기를 읽는다
        difficulty: 1
        estimated_minutes: 20
        required: core            # core | recommended | optional
        prerequisites: []
        next: [math.la.vector-ops]
        review_intervals: [1, 3, 7, 14]
        pass_threshold: 75
        remediation: []           # 부족할 때 갈 보충 Topic
        question_types: [concept, notation]
        keywords: [스칼라, 벡터, 행렬, 차원]

      - id: math.la.vector-ops
        title: 벡터의 연산
        goal: 덧셈·스칼라배가 기하적으로 무엇을 하는지 설명한다
        difficulty: 2
        estimated_minutes: 25
        required: core
        prerequisites: [math.la.scalar-vector-matrix]
        remediation: [math.foundation.coordinates]   # 좌표를 모르면 여기로
        # …
```

`curriculum/_links.yaml` — 과목 간 연결:

```yaml
links:
  - from: math.calc.chain-rule
    to: cs.dl.backpropagation
    kind: enables            # enables | related | applied-in
    note: 연쇄법칙이 역전파의 수학적 골격이다
  - from: english.c.abstract
    to: cs.ml.overview
    kind: related
```

### 3.2 DB (Drizzle · Neon)

기존 `sessions` · `login_attempts` · `budget_counters` · `usage_ledger` 는 **그대로 둔다.**
`study_days` · `attempts` · `summaries` 는 아래로 대체한다.

```ts
// 사용자 설정 — 단일 사용자지만 설정을 코드에 박지 않는다
users {
  id, target_day_count, daily_study_minutes,
  subject_priority: jsonb,        // { english: 0.3, math: 0.3, cs: 0.4 }
  goals: jsonb,                   // { paper_reading: true, research: false, ... }
  created_at
}

// ★ 멱등성 ②겹의 새 자리. Topic 당 평생 1회.
topic_contents {
  topic_id (PK),                  // 'math.la.vector-ops'
  content: jsonb,                 // 지문 + 문제 + 루브릭 (루브릭은 서버에만)
  model, prompt_tokens, completion_tokens, cost_micros,
  created_at
}

// 복습 콘텐츠. 회차가 키에 들어가 무한 생성이 불가능하다.
review_items {
  topic_id, round,                // UNIQUE(topic_id, round), CHECK round BETWEEN 1 AND 4
  content: jsonb,
  created_at
}

// 숙련도. 요구사항 §10 의 TopicProgress.
topic_progress {
  topic_id (PK),
  status,                         // not_started|learning|weak|reviewing|mastered
  mastery_score,                  // 0-100
  attempt_count, correct_count, wrong_count,
  weak_concepts: jsonb,           // 반복해서 틀린 개념
  last_studied_at,
  next_review_at,                 // NULL 이면 복습 예정 없음
  review_round,                   // 0-4
  prerequisite_status             // ok | missing
}

// 하루 계획. 생성 시점에 확정되고 그날 안에서는 바뀌지 않는다.
daily_plans {
  id, day_number,                 // UNIQUE(day_number)
  study_date,                     // UNIQUE — KST 하루 한 계획
  items: jsonb,                   // [{ topicId, kind, minutes, priority }]
  estimated_calls,                // ★ 계획 시점에 확정된 호출 수
  estimated_minutes,
  status,                         // planned | in_progress | completed
  created_at, completed_at
}

// 계획의 각 항목. 진행 상태를 개별로 추적한다.
plan_items {
  id, plan_id, topic_id,
  kind,                           // new | review | remediation
  status,                         // pending | studying | graded | done | skipped
  attempt_no,                     // CHECK 1..2  ← 채점 상한 유지
  answers: jsonb,
  feedback: jsonb,
  score,
  UNIQUE(plan_id, topic_id, attempt_no)
}
```

**요구사항의 `SubjectProgress` 는 테이블로 만들지 않는다.** `topic_progress` 와
커리큘럼 그래프에서 파생한다 — 1주차의 결정("`progress` 테이블을 만들지 않는다")을
그대로 따른다. 두 곳에 같은 사실을 두면 어긋났을 때 진실을 정할 수 없다.

---

## 4. 영어 커리큘럼 구조

요구사항 §4 의 5개 영역을 그대로 Domain 으로 삼는다.

| Domain | Topic 수(초안) | 성격 |
|---|---|---|
| A 어휘 | 15 모듈 × 3~5 | AI 문맥에서 배우는 어휘 |
| B 논문 문법 | 20 | 논문 해석에 필요한 문법만 |
| C 논문 독해 | 20 + 난이도 10단계 | 짧은 글 → 전체 논문 → 비판적 읽기 |
| D 회화 | 15 | 상황 중심 |
| E 작성 | 18 | 초록 → 방법론 → 결론 |

**어휘 Topic 은 다른 과목과 모양이 다르다.** 단어 목록을 갖고, 문제 유형이
`vocab-context`(문맥 속 의미) · `vocab-paper`(논문 예문) 이다.
`lib/curriculum/schema.ts` 에서 `topic.kind: 'concept' | 'vocabulary' | 'reading'`
로 구분하고, GPT 프롬프트가 kind 에 따라 달라진다.

**진행 축이 둘이다:** B~E 는 선수 관계로 한 줄로 나아가지만, A(어휘)와
C(독해 난이도)는 **레벨이 올라가는 축**이다. C 는 `difficulty_tier` 를 갖고
독해 Topic 은 티어를 넘을 때마다 지문 길이와 밀도가 올라간다.

---

## 5. 수학 커리큘럼 구조

| Domain | 성격 |
|---|---|
| A 기초 보충 | **본선이 아니다.** `required: optional`, 오직 `remediation` 대상으로만 등장 |
| B 선형대수 | 18 |
| C 미적분 | 19 |
| D 확률·통계 | 24 |
| E AI 수학 통합 | 17 — B·C·D 를 **선수로 갖는다** |

**A 가 본선에 없는 것이 핵심 설계다.** 요구사항 §5 의 "필요한 경우에만 보충"을
구조로 강제한다. 계획 엔진이 A 의 Topic 을 고르는 경로는 단 하나 —
다른 Topic 의 `remediation` 목록에서 끌려 나오는 것뿐이다.

**E 는 다리다.** 예: `math.ai.backprop-math` 의 선수는
`[math.calc.chain-rule, math.calc.partial, math.la.matrix-ops]` 이고,
`_links.yaml` 에서 `cs.dl.backpropagation` 과 연결된다.

**스펙 §5.8 의 수학 한계를 계승한다.** 모든 수학 Topic 의 `goal` 은 계산이
아니라 개념·서술로 쓴다. `question_types` 에 `calculation` 을 넣지 않는다.

---

## 6. CS 커리큘럼 구조

| Domain | 성격 |
|---|---|
| A 프로그래밍 기초 | 14 |
| B 자료구조 | 18 |
| C 알고리즘 | 20 |
| D 운영체제 | 18 |
| E 언어·컴퓨터 구조 | 16 |
| F 소프트웨어 공학 | 19 |
| G 머신러닝 | 22 — A·B·수학 D 를 선수로 |
| H 딥러닝 | 25 — G·수학 C·E 를 선수로 |

**G·H 가 과목을 넘는 선수 관계를 갖는다.** 이것이 §7 "과목 간 연결"의
실제 구현이다. `cs.ml.linear-regression` 의 선수에
`math.la.matrix-ops` 와 `math.prob.expectation` 이 들어간다.

계획 엔진은 선수 관계를 볼 때 **과목을 가리지 않는다.** CS 의 머신러닝
Topic 을 열려는데 수학 선수가 `weak` 이면, 그 수학 Topic 이 오늘의
보충으로 끌려 나온다. 과목별 진도는 독립이지만 **선수 관계는 독립이 아니다.**

---

## 7. Day 생성 알고리즘

```
buildDailyPlan(user, date, state) → DailyPlan        ★ LLM 호출 0회
```

### 7.1 후보 모으기

```
1. 기한이 지난 복습        next_review_at <= today, status != mastered
2. 취약 Topic              status = weak  또는  mastery_score < 60
3. 선수 부족 보충          오늘 열려는 신규 Topic 의 선수 중 미달인 것
4. 진행 중                 status = learning
5. 신규                    선수를 모두 만족(>= pass_threshold)한 미시작 Topic
```

### 7.2 우선순위 점수

```
priority =
    120 × (기한 초과 일수, 최대 7)          ← 밀린 복습이 가장 급하다
  +  80 × (반복 오답 횟수, 최대 5)
  +  60 × (다음 진도를 막고 있는 선수인가)
  +  40 × (진행 중인가)
  +  30 × (그 과목을 며칠 안 했나, 최대 7)   ← 장기 미학습 방어
  +  10 × (6 - difficulty)                  ← 같은 조건이면 쉬운 것 먼저
```

**밀린 복습이 신규를 항상 이긴다.** 요구사항 §11 의 우선순위를 숫자로 옮긴 것이다.

### 7.3 시간 배분

```
총 시간 = user.daily_study_minutes

기본 비율:  영어 30% · 수학 30% · CS 40%
보정:
  - 숙련도가 낮은 과목에 +10%p (최대 +15)
  - 7일 이상 안 한 과목에 +10%p
  - 복습 대기가 5개 넘는 과목에 +10%p
  - 합이 100% 가 되도록 정규화

과목 내 배분:  복습 25% · 보충 25% · 신규 50%
  단, 취약 Topic 이 3개 이상이면 복습·보충 75% / 신규 25% 로 뒤집는다
```

### 7.4 예산에 맞춰 자르기 ★

```
호출 수 = 신규 Topic 수 × 1(콘텐츠)
        + 복습 Topic 수 × 1(복습 문항)
        + 채점 1회 (계획 전체를 한 번에 채점)

남은 예산 = dailyCap - 오늘 이미 쓴 호출

while (호출 수 > 남은 예산) {
  우선순위가 가장 낮은 항목을 계획에서 뺀다
}
```

**캡을 올리지 않는다. 계획을 줄인다.** 밀려난 Topic 은 내일 우선순위가
올라가서 자연히 앞으로 온다.

**채점을 계획 단위로 묶는 것**이 호출을 크게 아낀다. Topic 마다 채점하면
하루 5호출이 되지만, 하루치 답안을 한 번에 채점하면 1호출이다.
루브릭이 Topic 마다 있으므로 프롬프트에 함께 실으면 된다.

### 7.5 Day 수와 확장

`target_day_count` 는 **상한이 아니라 목표**다.

```
예상 완료일 = 남은 core Topic 수 / (최근 7일 평균 신규 Topic 수) + today
```

- 커리큘럼에 Topic 을 추가하면 예상 완료일이 뒤로 밀린다 — **끝이 늘어난다**
- 복습·보충이 쌓이면 신규 속도가 느려져 예상일이 밀린다
- 잘하면 앞당겨진다

대시보드에 이 숫자를 띄운다. **커리큘럼이 살아 있다는 감각이 여기서 나온다.**

`target_day_count` 는 **어떤 Topic 을 담을지**를 정한다:

| 기간 | 담는 것 |
|---|---|
| 30일 | `required: core` 만 |
| 60일 | core + recommended |
| 90일+ | 전부 |

Day 수를 바꿔도 그래프는 그대로다. 선택 범위만 바뀐다 — 요구사항 §14-11 을
구조로 만족한다.

---

## 8. 복습·보충 알고리즘

### 8.1 점수 계산 (순수 함수 · LLM 없음)

**GPT 는 근거만 준다. 숫자는 우리가 만든다.** (2주차의 교훈)

```
raw = 맞은 루브릭 포인트 수 / 전체 포인트 수

보정:
  × 0.9   힌트를 봤으면
  × 0.95  같은 개념을 전에도 틀렸으면
  × (0.9 + 0.04 × difficulty)   어려운 문제를 맞히면 가점

mastery_score = round(clamp(raw × 100 × 보정, 0, 100))

이전 점수가 있으면:  new = round(이전 × 0.4 + 이번 × 0.6)
                    ← 한 번의 실수로 숙달이 무너지지 않게
```

### 8.2 상태 전이

| 점수 | 상태 | 다음 행동 |
|---|---|---|
| 90~100 | mastered | 다음 Topic. 1·3·7·14일 복습 예약 |
| 75~89 | mastered | 다음 Topic. 3·7일 복습 + 응용 문제 |
| 60~74 | reviewing | 다음 Topic 진행하되 **내일 복습 포함** |
| 40~59 | weak | **다음 진도 보류.** 오답 원인 분석 + 선수 확인 + 내일 재평가 |
| 0~39 | weak | 미완료. **선수 지식 탐색 → 보충 삽입 → 재시험** |

"다음 진도 보류"는 **그 Topic 을 선수로 갖는 Topic 만** 막는다.
다른 갈래와 다른 과목은 계속 진행한다 — 요구사항 §8 의
"특정 과목이 부족해도 다른 과목은 독립적으로"를 그래프로 만족한다.

### 8.3 보충 삽입

```
40점 미만이면:
  1. topic.remediation 목록을 본다
  2. 비어 있으면 prerequisites 를 거슬러 올라가며
     mastery_score < 60 인 가장 가까운 조상을 찾는다
  3. 찾은 Topic 을 kind='remediation' 으로 내일 계획에 최우선 삽입
  4. 조상이 없으면(뿌리인데도 낮으면) 같은 Topic 을 쉬운 난이도로 재생성
```

### 8.4 복습 다양화

같은 내용을 반복하지 않는다 (요구사항 §8). `review_items.round` 별로 형태가 다르다:

| 회차 | 시점 | 형태 |
|---|---|---|
| 1 | +1일 | 개념 요약 + 빈칸 |
| 2 | +3일 | 다른 문맥의 응용 문제 |
| 3 | +7일 | **설명하기** (남에게 가르치듯) |
| 4 | +14일 | 실제 AI 사례·논문 문장에 적용 |

회차가 4로 제한되므로 복습 콘텐츠 생성도 **Topic 당 최대 4회**다.
무한 생성이 원리적으로 불가능하다.

### 8.5 복습 폭주 방지

```
하루 복습 상한 = max(2, floor(daily_study_minutes / 20))

넘치면:
  - 우선순위 상위만 오늘 하고
  - 나머지는 next_review_at 을 하루 미룬다 (기한 초과 점수가 올라 내일 1순위가 된다)
```

---

## 9. GPT API 와의 데이터 전달 방식

### 9.1 컨텍스트 조립 (`lib/llm/context.ts`)

계획 엔진이 만든 항목 하나가 프롬프트 컨텍스트 하나가 된다.

```ts
interface TopicContext {
  subject, domain, module, topicId, title, goal, keywords, difficulty
  dayNumber
  kind: 'new' | 'review' | 'remediation'
  reviewRound?: 1 | 2 | 3 | 4

  prerequisites: Array<{ topicId, title, masteryScore }>  // 어디까지 아는가
  alreadyLearned: string[]     // 최근 학습한 Topic 제목 — 중복 설명 방지
  weakConcepts: string[]       // 이 Topic 에서 반복해 틀린 개념
  forbidden: string[]          // 아직 안 배운 개념 — 미리 쓰지 말 것

  minutes: number              // 분량 지시
  questionTypes: string[]
  aiConnection?: string        // _links.yaml 에서 온 연결
}
```

**`forbidden` 이 중요하다.** 그래프에서 "아직 도달하지 않은 후속 Topic 의
키워드"를 뽑아 넘긴다. 이게 없으면 GPT 가 Day 3 에서 트랜스포머를 설명한다.

### 9.2 응답 계약

2주차의 Structured Outputs 방식을 그대로 쓴다 (`strict: true`).
스키마 셋을 추가한다:

| 스키마 | 용도 |
|---|---|
| `study_content` | (기존) 지문 + 문제 3개 + 루브릭 |
| `review_content` | 회차별 복습 문항 |
| `grade_result` | (기존, 확장) `missing_prerequisites` · `weak_concepts` 추가 |

**채점 응답에 `score` 는 그대로 두되 읽지 않는다.** 2주차에 모델이 계산식을
어긴 것이 확인됐다. 우리는 `correct_points` / `missed_points` 만 읽고
`lib/mastery/score.ts` 가 숫자를 만든다.

**추가로 읽는 두 필드:**

```
missing_prerequisites: string[]   → 보충 Topic 탐색의 힌트 (그래프가 최종 판단)
weak_concepts: string[]           → topic_progress.weak_concepts 에 누적
```

둘 다 **모델의 제안일 뿐**이다. 실제 보충 Topic 결정은 §8.3 의 그래프 탐색이 한다.

### 9.3 실패 처리

기존 규칙을 계승한다 — 응답 검증(zod) 실패 시 예산 롤백 + 원장에 실패 기록.
새로 추가: **`plan_items.status` 를 `pending` 으로 되돌린다.** 계획은 살아
있고 그 항목만 다시 시도할 수 있다.

---

## 10. 구현 단계별 계획

사용자가 정한 MVP 8가지를 3단계로 나눈다. **각 단계가 끝날 때마다 동작한다.**

### 1단계 — 커리큘럼 그래프 (LLM 호출 0회)

| | |
|---|---|
| 산출물 | Topic 그래프 로더 · 그래프 검증 · Day 1~N 목록 화면 |
| 새 파일 | `lib/curriculum/{schema,load,graph}.ts`, `curriculum/**/*.yaml` |
| 테스트 | 사이클 없음 · 선수 관계가 존재하는 Topic 을 가리킴 · 과목 간 참조 유효 · 위상 정렬 |
| 완료 기준 | `/curriculum` 에서 Day 1~N 과 과목별 필터가 보인다 |

**커리큘럼 YAML 은 뼈대만 먼저 쓴다.** 각 Domain 의 첫 모듈까지.
Topic 을 추가하기 쉬운 구조라는 것을 증명하는 게 목적이지, 200개를 지금 쓰는 게 아니다.

### 2단계 — 계획 엔진과 진도 (LLM 호출 0회)

| | |
|---|---|
| 산출물 | 스키마 마이그레이션 · 계획 생성 · 숙련도 갱신 · 점수 수동 입력 |
| 새 파일 | `lib/plan/*`, `lib/mastery/*`, `app/today/page.tsx` |
| 테스트 | **점수를 넣으면 복습이 예약되는가 · 낮은 점수에 보충이 삽입되는가 · 예산 초과 시 계획이 잘리는가 · 과목이 독립적으로 나아가는가** |
| 완료 기준 | 점수를 손으로 넣어 30일치를 시뮬레이션해도 계획이 무너지지 않는다 |

**여기가 이 설계의 핵심이고, 전부 LLM 없이 테스트된다.**
`tests/plan/simulation.test.ts` 에서 가상의 30일을 돌린다 —
매일 점수를 주고, 복습이 쌓이고, 보충이 끼어들고, 예상 완료일이 움직이는 것을 단언한다.

### 3단계 — GPT 연결

| | |
|---|---|
| 산출물 | 컨텍스트 조립 · 복습 콘텐츠 스키마 · 계획 단위 채점 · 결과 화면 |
| 완료 기준 | 실제로 하루를 완주하고 다음 날 계획이 결과를 반영해 달라진다 |

기존 `content`·`grade` 라우트를 Topic 기반으로 옮기고 `review` 를 추가한다.

### 이후

대시보드 확장 · Topic 상세 화면 · 사용자 설정 화면 · 커리큘럼 Topic 채우기 ·
모바일 레이아웃 · `/admin/usage`.

---

## 11. 승계하는 규칙

이 설계는 다음을 **바꾸지 않는다.**

- 세션 게이트 · 유휴 15분 · `pagehide` 30초 유예
- `OPENAI_API_KEY` 는 `lib/llm/client.ts` 에서만 읽는다
- Structured Outputs · zod 이중 검증
- 예산 예약 → 실패 시 롤백 → 원장 기록
- 모델이 준 숫자를 화면에 쓰지 않는다
- 날짜는 KST · `kstToday()` 만
- 커리큘럼은 DB 가 아니라 레포의 파일
- 색은 `@theme` 토큰 · 한국어는 `word-break: keep-all`

**바뀌는 것은 "무엇을 언제 배우는가"를 정하는 층 하나다.**
그 아래(비용·보안)와 위(화면 언어)는 그대로다.
