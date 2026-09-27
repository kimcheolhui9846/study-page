# 핸드오프

**갱신:** 2026-09-27 · **브랜치:** `feat/math-drills` · PR #24~#36 머지됨

**배포됨 → https://study-page-kimcheolhui9846s-projects.vercel.app**
(`main` 에 머지하면 자동 배포된다)

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**적응형 커리큘럼 1·2·3단계 완료 + 화면 전부.** Day 기반 고정 커리큘럼을 버리고
Topic 그래프로 갈아탔다. 설계는
[`docs/specs/2026-09-01-adaptive-curriculum-design.md`](specs/2026-09-01-adaptive-curriculum-design.md).

- 테스트 **620개 통과** (35파일, ~53초)
- `npm run build` 통과 — 라우트 **17개** · 린트 0 · `check:secrets` 통과
- ✅ **실제 GPT 로 Day 2 를 완주했다** (2026-09-02) — 자료 생성 2회 + 채점 1회,
  누적 **$0.001767**. 진도·복습 예약·취약 개념까지 실제로 기록됐다.

```
ƒ /                       대시보드 (진도 · 연속 · 복습 부담 · 예상 완료 · 최근 채점 · 이번 달 비용)
ƒ /curriculum             Topic 목록 · 과목 필터 · 과목 간 선수 관계
ƒ /today                  오늘 계획 · 진행 상황 · 전체 채점 버튼
ƒ /today/[topicId]        Topic 학습 (자료 만들기 / 지문+답안 / 채점 결과)
ƒ /topic/[topicId]        Topic 상세 (진도 · 선수 관계 · 회복 단계 · 기록)
ƒ /settings               설정 (목표 기간 · 하루 시간 · 과목 비중)
ƒ /admin/usage            비용 원장 (월 소진 · 경로별 · 날짜별 · 재사용 절감 · 최근 호출)
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

**보이는 곳:** `/admin/usage` 가 ①~③의 결과를 화면에 낸다. ④는 코드 밖이라
화면 아래에 문장으로만 적어뒀다 — 이 화면만 보고 안심하지 않도록.

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

**실측 비용** (`/admin/usage` 가 지금 이 값을 보여준다):

| | |
|---|---|
| 콘텐츠 (cs) | $0.000559 |
| 콘텐츠 (english) | $0.000600 |
| 채점 (2개 묶음) | $0.000608 |
| **누적 3회** | **$0.001767** |

항목 2개짜리 하루가 약 $0.0017. 월 30일이면 **$0.05** 수준이다.

**로컬 캡은 하루 3회다** (`lib/budget/caps.ts`) — 항목 2개짜리 하루가 딱 3회다.
자료가 이미 있으면 그만큼 덜 쓴다.

**남은 것:** 복습 경로(`review_content`)는 실호출로 아직 안 봤다.
초기화로 09-03 예약이 같이 지워졌으므로, **첫 학습을 한 다음날**에 확인된다.
**고친 문체(`VOICE_RULE`)도 그때 같이 확인된다** — 이미 만들어진 자료는
UNIQUE 때문에 다시 안 만들어지므로 효과는 다음에 만드는 자료부터다.

### 2. 계속 틀리는 Topic 이 일정을 독점한다 (완화됨, 열려 있음)

`tests/plan/simulation.test.ts` 의 시뮬레이션이 숫자를 박아뒀다.
회복 정책(`lib/mastery/recovery.ts`)이 들어오면서 30일 시뮬레이션이
복습 120→**71**, 신규 9→**26**, 건드린 Topic 9→**27** 로 바뀌었다.

남은 것은 `priorityOf` 의 `80 × min(5, wrongCount)` = 최대 400점이
다른 항을 여전히 압도한다는 점이다. 실제로 며칠 써보고 판단한다.

### 3. 모델이 준 숫자를 믿지 않는다

채점 스키마에서 **`score` 필드를 아예 제거했다.** 2주차에 모델이 자기가
명시한 계산식을 어겼다(포인트 0/3 에 50점). 지금은 `correct_points` /
`missed_points` 만 받고 숫자는 `lib/mastery/score.ts` 의 `countPoints` 가 만든다.

**루브릭의 소유권도 서버에 있다.** `reconcilePoints` 가 저장된 루브릭을
기준으로 correct/missed 를 다시 세운다 — 실호출에서 모델이 같은 포인트를
양쪽에 넣어 2점짜리 문제를 3점으로 만든 적이 있다.

### 4. 프롬프트 결함 — 표본 3개 기준

| 결함 | 재현 | 판단 |
|---|---|---|
| **어투가 앱과 어긋난다** ("~습니다" vs 앱의 "~다") | **3 / 3** | ✅ 고쳤다 (`VOICE_RULE`). 실호출 확인은 09-03 복습 때 |
| **적용 문제가 적용을 시험하지 않는다** | **2 / 3** | 지켜볼 것. CS·2주차 표본은 지문을 그대로 되물었고, 영어 표본은 지문에 없는 새 문장으로 물어 제대로였다 |
| **루브릭에 주관이 섞인다** ("정확하게 …") | 1 / 3 | 3단계 프롬프트("검증 가능한 한 문장")로 안 나왔다. 보류 |

## 커리큘럼

`curriculum/**/*.yaml` — **69 Topic**. 30일=51 / 60일=61 / 90일=69.
DB 가 아니라 레포의 파일이다 — PR 로 고치고, 리뷰가 남고, 롤백된다.

- 과목 간 선수 9개 (예: `math.ai.backprop-math → cs.dl.backpropagation`)
- 과목 간 연결 6개 (`_links.yaml`) — 진도를 막지 않고 "왜 배우나"만 말한다
- `math.foundation.*` 은 전부 `optional` 이다. 보충으로만 도달한다

Topic 을 추가할 때 그래프가 부팅에서 검증한다 — 중복 ID · 없는 선수 참조 ·
사이클 · ID 접두사와 파일 subject 불일치.

### 연습(practice) Topic

수학 19개가 전부 `kind: concept` 이고 목표가 전부 "설명한다"였는데, 학습자가
실제로 틀린 것은 전부 **계산**이었다(「함수의 값 계산 방법」·「기울기 계산
방법」). 연습 Topic 4개를 넣고 개념의 `remediation` 으로 걸었다.

**★ 연습 Topic 은 선수를 갖지 않는다.** 개념을 못 넘겨서 내려오는 것인데
선수를 걸면 바로 그 상황에서 잠긴다 — 보충이 막다른 길이 된다.
`tests/curriculum/real-curriculum.test.ts` 가 잠근다.

### 남은 구멍 — 분량

```
30일 목표 → 51개 · 1375분 → 하루 60분이면 23일치
90일 목표 → 69개 · 1820분 → 하루 60분이면 30일치
```

**90일 목표인데 30일치다.** 복습이 슬롯을 먹어 실제로는 더 오래 가지만
언젠가 신규가 바닥난다. `goal` 자체는 잘 쓰여 있다 — 문제는 개수다.

## 컨텍스트가 프롬프트로 흘러드는 곳

`lib/llm/context.ts` 하나다. 모델은 그래프를 모르고 이 함수가 고른 것만 본다.

- `forbidden` — **아직 안 배운 후속 Topic 의 키워드.** 그래프 거리순으로 최대 12개.
  이게 없으면 Day 3 에서 트랜스포머가 나온다
- `alreadyLearned` — 넘긴 선수 (60점 이상). 다시 설명하지 말라고 넘긴다
- `weakConcepts` — 채점이 지목한 것. `topic_progress` 에 누적된다
- `connections` — `_links.yaml` 의 "왜 이걸 배우나"
- `kind` — **Topic 의 성격**(개념·어휘·독해·문제풀이). 성격마다 시스템
  프롬프트의 레시피가 다르다 (`contentSystem(kind)`). 어휘·독해는 지문을
  **영어**로 쓰게 한다
- `questionTypes` — 커리큘럼의 슬러그(`vocab-paper`)를 지시문으로 옮겨 넘긴다

## ★ 저장된 자료를 읽는 스키마는 따로다

**모델에게 요구하는 것과 디스크에서 견디는 것은 다르다.**

| | 스키마 | 새 필드 |
|---|---|---|
| 모델 응답 검증 | `ContentSchema` · `ReviewSchema` | **필수** |
| 저장된 행 읽기 | `StoredContentSchema` · `StoredReviewSchema` | 선택 |

`solution` 을 필수로 더했다가 그 전에 저장된 자료 6개가 전부 무효가 되어
학습이 통째로 막힌 적이 있다. 취약 재학습은 `topic_contents` 를 다시 읽는
경로라 자료를 새로 만들지 않고, 그래서 스스로 풀리지 않았다.

**필수 필드를 더할 때는 저장 스키마에서 선택으로 두고, 화면이 없는 것을
안 그리게 한다.** `tests/llm/schemas.test.ts` 가 지킨다.

## 채점 전에 보여도 되는 것 / 아닌 것

문제에는 **학습자에게 보이면 안 되는 필드가 셋**이다 —
`expected_points`(루브릭) · `hint` · `solution`(해설).

| 함수 | 뜻 | 쓰는 곳 |
|---|---|---|
| `publicQuestions` | 채점 **전에** 보여도 되는 것. `id`·`type`·`prompt` 뿐 | 학습 화면 · 답안 폼 |
| `hintFor` | 힌트 하나. 학습자가 눌렀을 때만 | `/api/topic/hint` |
| `solutionsOf` | 해설. **채점을 받은 뒤에만** | 채점 결과 화면 |

`publicQuestions` 를 넓히지 않고 길을 따로 낸다. 그 이름은 「채점 전에
보여도 되는 것」이라는 뜻이고, 흐려지면 다음 사람이 비밀을 하나 더 얹는다.

`tests/llm/schemas.test.ts` 가 **화이트리스트로** 잠근다 — 문제에 무슨
필드를 더하든 그 테스트가 먼저 깨진다.

**`kind` 와 `mode` 는 다른 축이다.** `kind` 는 Topic 의 성격(YAML 필드),
`mode` 는 오늘 이걸 왜 하는가(신규·복습·보충).

## 회복 정책 (사용자가 정한 것)

> 복습 기회는 1번 주고, 복습할 때도 틀리면 그 하위 개념으로 공부하고,
> 하위 개념 통과 시 다시 복습 진행 후 맞든 틀리든 다음 학습 진도로 진행.

`lib/mastery/recovery.ts` 가 이 문장 그대로다. `attempt_count` 하나에서
단계를 파생한다 — 상태 컬럼을 따로 두지 않는다.

`retry` → `remediation`(하위 개념) → `final-retry` → `parked`(14일).
`lib/plan/candidates.ts` 의 `canStudy` 가 접어둔 Topic 이 보충 경로로
새어나오는 것을 막는다.

## 남은 일

| | |
|---|---|
| **첫 학습** | 아직 시작 전이다. 2026-09-02 에 검증용 기록을 지웠다 (`scripts/reset-progress.mjs`) |
| **첫 학습 다음날** | 복습 경로 실호출 확인 — 돈 나가는 마지막 미검증 경로. 고친 문체도 같이 본다. **초기화가 09-03 예약을 같이 지웠으므로 날짜가 아니라 첫 학습에 걸려 있다** |
| **첫 영어 Topic** | 어휘·독해 레시피 실호출 확인 (아래 5번) |
| **다음에 만드는 자료** | 해설(`solution`) 실호출 확인 — 모범답안이 루브릭의 재나열이 아닌지, `steps` 가 「무엇을 먼저 하는가」인지, `evidence` 가 지문 문장 그대로인지 |
| 다음 | 커리큘럼 Topic 채우기 (65개가 뼈대만) |
| 열린 결정 | 취약 Topic 우선순위 균형 (위 2번) — 며칠 써보고 판단 |

**오늘(09-04) 계획을 미리 계산해보면** 「변수와 자료형」·「문장의 구조」·
「일반 학술 어휘」 3개 · 60분 · 호출 4회다. 셋째가 `kind: vocabulary` 라
새 어휘 레시피가 첫 실호출에서 바로 확인된다.

### 5. 어휘·독해 레시피는 아직 실호출로 안 봤다

커리큘럼이 `kind: vocabulary` · `kind: reading` 을 진작 달아뒀는데 코드가
그 필드를 읽지 않아 **65개 Topic 전부가 개념 레시피로 나가고 있었다.**
고쳤다 (`contentSystem(kind)`). 어휘·독해는 이제 지문을 **영어**로 쓴다.

첫 실호출에서 볼 것:

- 어휘 지문이 한국어 설명문이 아니라 **영어 글**인가
- 독해 지문에 한국어 번역이 안 붙었는가
- **`forbidden` 이 영어 지문을 어색하게 만들지 않는가** — 영어 Topic 의
  키워드는 `focus on`, `background` 같은 평범한 단어라, 개념 Topic 에서
  「트랜스포머」를 막는 것과 성격이 다르다

## 배포

**https://study-page-kimcheolhui9846s-projects.vercel.app** · `main` 에 머지하면 자동 배포.

환경변수 4개가 **Production 환경에만** 들어가 있다 —
`DATABASE_URL` · `AUTH_PASSWORD_HASH` · `OPENAI_API_KEY` · `APP_ENV=production`.

**Preview 에는 아무것도 넣지 않았다.** `APP_ENV` 가 없으면 `dailyCallCap()` 이
3을 반환하므로, PR 프리뷰가 돈을 쓸 수 없다. 안 넣는 것이 곧 방어다.

### 남은 것

- **함수 리전** — Settings → Functions → Function Region 이 Neon 리전과
  같은지. 다르면 매 요청이 태평양을 왕복한다
- `OPENAI_API_KEY` 는 아직 실호출로 확인 안 됨. 09-03 복습 때 배포된 앱에서
  하면 한 번에 확인된다
