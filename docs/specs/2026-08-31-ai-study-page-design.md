# AI 학습 페이지 — 설계 스펙

**작성:** 2026-08-31 · **상태:** 승인됨 · **구현 시작 전**

---

## 1. 목적과 범위

영어 · 수학 · CS를 Day 단위 고정 커리큘럼으로 공부하는 **1인용** 학습 플랫폼.
하루 흐름은 `지문 읽기 → 서술형 문제 3개 풀이 → AI 채점 → 최종 정리본 작성 → 말투 다듬기 → Velog 발행`.

### 범위 밖 (명시적으로 안 만드는 것)

- 다중 사용자, 회원가입, 권한 관리 — 사용자는 1명이며 `users` 테이블이 없다
- 커리큘럼 자동 생성 — 커리큘럼은 사람이 쓴 파일이다
- 진도 테이블 — 진도는 `study_days`에서 파생한다
- 하트비트 ping — §3.4 참조
- 외부 Humanizer 서비스 — 같은 모델의 프롬프트 한 번으로 대체 (§5.6)

### 성공 기준

1. 로그인부터 Velog 발행까지 끊김 없이 완주된다
2. 월 LLM 비용이 3만 원을 넘지 않는다 — 그것도 **코드 버그가 있는 상태에서조차**
3. 3개월 뒤 돌아와서 `docs/HANDOFF.md` 하나로 작업을 이어갈 수 있다

---

## 2. 기술 스택과 그 근거

| 영역 | 선택 | 근거 |
|---|---|---|
| 프레임워크 | Next.js (App Router) | 프론트/백엔드 단일 배포. Route Handler가 백엔드 역할 전부 수행 |
| 배포 | Vercel | Next.js 네이티브, PR별 Preview 자동 |
| DB | Neon Postgres | 서버리스, DB 브랜칭으로 Preview 환경 분리 |
| ORM | Drizzle | 타입 안전, 콜드 스타트 가벼움, 생 SQL 병용 가능 |
| 스타일 | Tailwind | — |
| 모델 | OpenAI `gpt-4o-mini` | 가성비. Structured Outputs 지원 |

### 별도 백엔드(Express / FastAPI)를 두지 않는 이유

버셀 배포가 전제인 상황에서 백엔드를 분리하면 배포 대상 2개, CORS, 쿠키 도메인,
환경변수 2벌, 로컬 프로세스 2개가 따라붙는다. 1인용 앱에서 이는 순수 비용이다.
Route Handler로도 API 키는 서버에만 남으므로 보안 목표는 동일하게 달성된다.

### Redis를 쓰지 않는 이유

Redis가 주는 것은 (1) TTL 자동 만료 (2) 원자적 카운터 (3) 저지연이다.
Postgres에서 (1)은 `expires_at` 컬럼 + 조회 시 비교로, (2)는 `UPDATE ... SET n = n + 1 RETURNING n`으로
동등하게 원자적으로 구현된다. (3)은 사용자 1명에게 의미가 없다.

전환 경로는 열어둔다 — 세션 접근을 `SessionStore` 인터페이스로 좁혀
`RedisSessionStore` 구현체 추가만으로 교체 가능하게 한다.

```ts
// lib/session/store.ts
export interface SessionStore {
  create(ttlSeconds: number): Promise<{ token: string }>
  verifyAndTouch(token: string): Promise<Session | null>
  revoke(token: string): Promise<void>
}
```

---

## 3. 보안 · 세션 · 비용 차단

### 3.1 전제: 세션은 지갑을 지키지 못한다

세션이 살아있는 동안은 호출이 무제한이다. 프론트의 `useEffect` 의존성 실수 하나로
인증된 세션이 초당 수십 번 호출을 낸다. **세션은 "누가"를 막지 "얼마나"를 막지 않는다.**

따라서 방어를 4겹으로 쌓되 각 겹의 책임을 분리한다.

| 겹 | 막는 것 | 구현 위치 |
|---|---|---|
| ① 세션 게이트 | 인증 안 된 호출 | `lib/session/guard.ts` |
| ② 멱등성 제약 | 같은 콘텐츠 재생성 | DB UNIQUE 제약 |
| ③ 예산 카운터 | 폭주 루프 | `lib/budget/reserve.ts` |
| ④ OpenAI 하드 리밋 | 내 코드의 모든 버그 | OpenAI 대시보드 (월 $5) |

**②가 비용의 대부분을 잡는다.** "당일 추가 생성 없음"을 프론트 규칙이 아니라
DB의 UNIQUE 제약으로 구현하면 새로고침을 100번 해도 LLM 호출은 정확히 1회다.

### 3.2 데이터 흐름

```
브라우저
  │ ① POST /api/session { password }
  ▼
Route Handler (서버 전용)
  argon2.verify(password, AUTH_PASSWORD_HASH)
    ✗ → 401 + login_attempts 기록 (15분 내 5회 실패 시 잠금)
    ✓ → token = randomBytes(32)
        INSERT sessions (sha256(token), ...)
        Set-Cookie: sid=token; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200
  │
  │ ② POST /api/study/[subject]/content   (쿠키 자동 첨부)
  ▼
withSession(handler)  ← 모든 보호 라우트의 단일 입구
  1. 쿠키 없음                     → 401
  2. sha256 조회 실패 / revoked    → 401
  3. now > expires_at (절대 2h)    → 401
  4. now > idle_expires_at (15m)   → 401
  5. 통과 → idle_expires_at = now + 15m 갱신
  │
  ▼
② 멱등성 체크
  SELECT * FROM study_days WHERE subject = $1 AND day_no = $2
    ● 있음 → 그대로 반환. LLM 호출 0회.  ← 대부분의 요청
    ● 없음 → 아래로
  │
  ▼
③ 예산 예약 (원자적)
  UPDATE budget_counters SET calls = calls + 1
   WHERE period_key = $1 AND calls < cap_calls AND cost_micros < cap_micros
  RETURNING calls
    ● 0 rows → 429 CAP_EXCEEDED. LLM 호출하지 않음.
    ● 1 row  → 아래로
  │
  ▼
lib/llm/client.ts   ← OPENAI_API_KEY를 import하는 유일한 파일
  · model: gpt-4o-mini
  · max_tokens 상한 필수
  · AbortSignal.timeout(30_000)
  · response_format: json_schema (strict)
  · 완료 후 usage_ledger 기록 + cost_micros 갱신
  · 실패 시 예약 롤백
  │
  ▼
INSERT INTO study_days ... ON CONFLICT DO NOTHING
  (동시 요청 2개가 뚫고 와도 DB가 한 쪽만 살린다)
```

### 3.3 세션 종료 — 신뢰도 구분

**"브라우저를 닫으면 즉시 만료"는 서버가 보장할 수 없다.**
탭 강제 종료, 노트북 덮기, 네트워크 단절은 서버에 아무 신호도 남기지 않는다.
따라서 경로별 신뢰도를 명시하고, 확실한 것 하나를 안전망으로 둔다.

| 경로 | 트리거 | 신뢰도 | 구현 |
|---|---|---|---|
| 명시적 종료 | [종료] 버튼 | 확실 | `POST /api/session/end` → `revoked_at = now()`, 쿠키 삭제 |
| 탭 닫힘 | `pagehide` | 최선 노력 | `navigator.sendBeacon('/api/session/end')` |
| 유휴 타임아웃 | 15분 무활동 | **확실 (안전망)** | 요청 시점에 `idle_expires_at` 비교 |
| 절대 상한 | 생성 후 2시간 | 확실 | `expires_at` |

종료가 최선 노력이어도 손해가 없는 이유는 ②③겹이다. 세션이 좀비로 남아도
그 세션으로 가능한 것은 이미 생성된 콘텐츠 재조회(0원)뿐이며, 그마저 일일 캡에 걸린다.

### 3.4 하트비트를 넣지 않는다

주기적 ping으로 세션 생존을 알리는 흔한 패턴은 여기서 **기능을 정확히 무력화한다** —
탭이 열려 있는 한 유휴 타임아웃이 영원히 갱신되어 "자리 비움 차단"이 사라진다.

`idle_expires_at`은 **실제 학습 행동(콘텐츠 요청, 답안 제출, 정리본 저장)에만** 밀린다.
대신 클라이언트에 남은 시간 카운트다운을 표시하고 만료 2분 전 배너를 띄운다.

### 3.5 인증

- 사용자 1명이므로 `users` 테이블 없음
- 비밀번호는 **argon2id 해시를 환경변수** `AUTH_PASSWORD_HASH`에 둔다. 평문은 어디에도 없다
- 비밀번호 변경 = 버셀 환경변수 교체
- 로그인 실패 제한: `login_attempts` 기준 15분 내 5회 실패 시 잠금

### 3.6 비밀 관리 불변식

`OPENAI_API_KEY`, `DATABASE_URL`, `AUTH_PASSWORD_HASH`, `VELOG_TOKEN` 전부 서버 전용.

> **`NEXT_PUBLIC_` 접두사가 붙은 비밀은 하나도 없다.**
> 붙는 순간 클라이언트 번들에 박혀 공개된다.

`npm run check:secrets` 스크립트로 CI에서 grep 검사하며, PR 체크리스트 항목이다.

---

## 4. 데이터 설계

### 4.1 커리큘럼은 DB가 아니라 레포의 파일

PR로 고치고, 리뷰가 남고, 롤백되고, 프로덕션 DB를 건드릴 일이 없다.

```
curriculum/english.yaml  math.yaml  cs.yaml
```

```yaml
subject: cs
label: 컴퓨터 과학
days:
  - day: 1
    topic: 프로세스와 스레드
    goal: 컨텍스트 스위칭 비용이 왜 발생하는지 설명할 수 있다
    keywords: [PCB, 컨텍스트 스위칭, TCB, 주소공간]
    difficulty: 2
```

- **`goal`이 채점 기준이 된다.** "잘 이해했나 봐줘"는 채점이 매번 흔들리지만
  "이 사람이 goal에 도달했는지 판정해"는 기준이 파일에 고정되어 일관된다.
- `total_days` 같은 고정 필드를 두지 않는다. **배열 길이가 곧 총 Day 수**이며,
  Day 추가는 YAML에 항목을 append하는 PR 하나다.
- 이미 진행한 Day의 콘텐츠는 `study_days.content`에 박제되므로
  나중에 커리큘럼을 고쳐도 과거 기록이 흔들리지 않는다.
- 파싱은 **YAML + zod**. 형식 위반은 CI 테스트에서 잡혀 배포가 막힌다.

### 4.2 진도 모델 — 날짜가 아니라 Day가 진도다

3일 쉬었다 돌아오면 **Day 8이 아니라 Day 5부터** 이어서 한다.
달력이 아니라 진도가 기준이며, "빠진 날" 개념 자체가 없다.

별도로 "하루에 한 과목당 한 Day만"을 강제한다.
이 두 규칙은 DB 제약 두 개로 그대로 내려간다.

**중단한 Day를 다음 날 이어서 할 때:** 행이 이미 있으므로 콘텐츠는 재생성되지 않는다(0원).
`study_date`만 오늘로 갱신하는데, 그날 같은 과목의 다른 Day를 이미 시작했다면
`one_day_per_date` 제약에 걸려 거부된다 — 이것이 의도한 동작이다.
재개도 "오늘 그 과목 1회"에 포함된다.

### 4.3 스키마

```sql
-- ── 세션 ────────────────────────────────────────
CREATE TABLE sessions (
  token_hash      TEXT PRIMARY KEY,        -- sha256(원본토큰). 원본은 DB에 없음
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,    -- 활동 시마다 now() + 15m
  expires_at      TIMESTAMPTZ NOT NULL,    -- 생성 후 2h. 갱신되지 않음
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  succeeded    BOOLEAN NOT NULL
);
CREATE INDEX ON login_attempts (attempted_at DESC);

-- ── 학습 ────────────────────────────────────────
CREATE TABLE study_days (
  id           BIGSERIAL PRIMARY KEY,
  subject      TEXT NOT NULL,              -- 'english' | 'math' | 'cs'
  day_no       INT  NOT NULL,
  study_date   DATE NOT NULL,              -- KST 기준 진행일
  status       TEXT NOT NULL DEFAULT 'in_progress',
  content      JSONB NOT NULL,             -- LLM 생성 지문 + 문제 + 루브릭
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT status_valid CHECK (status IN ('in_progress','completed','abandoned')),

  -- 제약 ①: Day 5 콘텐츠는 평생 딱 한 번만 생성된다 (멱등성)
  CONSTRAINT one_row_per_day  UNIQUE (subject, day_no),
  -- 제약 ②: 한 과목은 하루에 한 Day만 (당일 추가 생성 없음)
  CONSTRAINT one_day_per_date UNIQUE (subject, study_date)
);

CREATE TABLE attempts (
  id           BIGSERIAL PRIMARY KEY,
  study_day_id BIGINT NOT NULL REFERENCES study_days(id) ON DELETE CASCADE,
  attempt_no   INT NOT NULL,
  answers      JSONB NOT NULL,             -- 사용자 답안
  feedback     JSONB,                      -- LLM 채점 결과
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 제약 ③: 채점 재시도 상한 2회 (채점도 LLM 호출이므로 비용 게이트)
  CONSTRAINT attempt_cap CHECK (attempt_no BETWEEN 1 AND 2),
  UNIQUE (study_day_id, attempt_no)
);

CREATE TABLE summaries (
  study_day_id  BIGINT PRIMARY KEY REFERENCES study_days(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,             -- 사용자가 쓴 최종 정리본
  polished_text TEXT,                      -- 말투 다듬기 통과본
  polished_at   TIMESTAMPTZ,
  polish_count  INT NOT NULL DEFAULT 0,    -- 다듬기 호출 횟수
  velog_url     TEXT,                      -- 채워져 있으면 발행됨
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 제약 ④: 다듬기 재시도 상한 2회 (다듬기도 LLM 호출이므로 비용 게이트)
  CONSTRAINT polish_cap CHECK (polish_count BETWEEN 0 AND 2)
);

-- ── 비용 ────────────────────────────────────────
CREATE TABLE budget_counters (
  period_key  TEXT PRIMARY KEY,            -- 'day:2026-08-31' | 'month:2026-08'
  calls       INT    NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,   -- USD × 1,000,000 (정수. 부동소수 미사용)
  cap_calls   INT    NOT NULL,
  cap_micros  BIGINT NOT NULL
);

CREATE TABLE usage_ledger (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  route             TEXT NOT NULL,         -- 'content' | 'grade' | 'polish'
  subject           TEXT,
  model             TEXT NOT NULL,
  prompt_tokens     INT,
  completion_tokens INT,
  cost_micros       BIGINT,
  ok                BOOLEAN NOT NULL
);
```

### 4.4 `progress` 테이블이 없는 이유

현재 진도는 파생값이다.

```sql
SELECT COALESCE(MAX(day_no), 0) + 1
  FROM study_days
 WHERE subject = 'english' AND status = 'completed';
```

중복 상태를 들지 않으면 "진도 테이블과 실제 기록이 어긋나는" 버그 부류가 통째로 사라진다.
사용자 1명 규모에서 성능 문제는 없다.

### 4.5 예산 예약 — 레이스 없는 원자적 차감

```sql
-- 없으면 만들고
INSERT INTO budget_counters (period_key, cap_calls, cap_micros)
VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- 예약한다 (읽고-판단하고-쓰기가 아니라 한 문장이므로 레이스가 없다)
UPDATE budget_counters
   SET calls = calls + 1
 WHERE period_key = $1 AND calls < cap_calls AND cost_micros < cap_micros
RETURNING calls;
```

- 0 rows → 한도 초과. **LLM을 호출하지 않고** 429 반환
- 일일 키와 월간 키를 동시에 예약하고, LLM 호출이 실패하면 둘 다 롤백
- 호출 성공 후 `usage_ledger`에 실제 토큰을 적고 `cost_micros`를 갱신

### 4.6 시간대

버셀 서버는 UTC로 동작한다. `CURRENT_DATE`를 쓰면 **KST 오전 9시 이전에 날짜가 하루 밀린다.**
날짜는 항상 아래로 계산하며, `lib/time.ts`의 `kstToday()` 하나로 좁힌다.

```sql
(now() AT TIME ZONE 'Asia/Seoul')::date
```

코드에서 `new Date()`로 날짜를 만드는 것을 금지한다.

---

## 5. LLM 호출 계약

### 5.1 원칙 ① — JSON을 부탁하지 않는다

프롬프트로 JSON을 요구하면 언젠가 깨진다 (코드 펜스, 서두 인사말, 필드 누락).
**Structured Outputs** (`response_format: { type: "json_schema", strict: true }`)를 사용해
디코딩 단계에서 스키마를 강제한다. 포맷 위반이 원리적으로 불가능하며,
파싱 실패 재시도 로직이 필요 없어진다 — 그 재시도가 곧 비용이었으므로 비용 방어이기도 하다.

### 5.2 원칙 ② — 채점 기준을 콘텐츠 생성 시점에 확정한다

문제를 낼 때 `expected_points`(채점 루브릭)를 함께 생성해 DB에 저장하되
**클라이언트로 보내지 않는다.** 채점 호출은 이 루브릭을 받아 대조만 한다.

루브릭 없이 채점시키면 같은 답에 어제는 80점, 오늘은 55점이 나온다 —
모델이 매번 기준을 새로 지어내기 때문이다. 루브릭을 고정하면 채점이 재현 가능해지고,
채점 프롬프트가 짧아져 비용도 준다. 사용자가 개발자도구로 정답을 미리 볼 수도 없다.

### 5.3 호출 3종

| # | 라우트 | 시점 | 상한 |
|---|---|---|---|
| 1 | `content` | Day 시작 | 평생 1회 (`study_days` UNIQUE) |
| 2 | `grade` | 답안 제출 | Day당 2회 (`attempts` CHECK) |
| 3 | `polish` | 정리본 확정 | Day당 2회 (`summaries` CHECK) |

**세 상한 모두 DB 제약으로 강제한다.** 애플리케이션 코드의 조건문에 의존하지 않는다.
`polish`는 예산 예약과 같은 원자적 패턴을 쓴다:

```sql
UPDATE summaries
   SET polish_count = polish_count + 1
 WHERE study_day_id = $1 AND polish_count < 2
RETURNING polish_count;   -- 0 rows → 429, LLM 호출하지 않음
```

**Day 하나 완주 = 최대 5호출** (content 1 + grade 2 + polish 2).
3과목이면 하루 최대 15호출. 일일 캡 20의 근거다.

### 5.4 ① 콘텐츠 생성

**System prompt**

```
당신은 한국인 학습자 1명을 위한 개인 교재 저자다.
주어진 커리큘럼 항목 하나로 오늘치 학습 자료를 만든다.

원칙:
- 대상은 성인 학습자 1명이다. 격려나 인사말을 쓰지 마라. 교재 본문만 쓴다.
- goal에 도달시키는 것이 유일한 목표다. goal과 무관한 곁가지 지식은 넣지 마라.
- 지문은 700~1000자. 정의 → 왜 그런가 → 구체 예시 순으로 전개한다.
  "~는 중요합니다" 같은 공허한 문장을 쓰지 마라. 매 문장이 정보를 옮겨야 한다.
- 예시는 반드시 하나 이상 넣는다. 추상적 설명만으로 끝내지 마라.
- 문제는 정확히 3개. recall 1개, concept 1개, application 1개.
  전부 서술형이며, 객관식이나 O/X를 내지 마라.
- expected_points는 채점 루브릭이다. 학습자에게 보이지 않는다.
  각 문제마다 2~4개의 채점 포인트를 쓴다. 각 포인트는 검증 가능한 한 문장이어야 한다.
  ("잘 이해함" 같은 판정 불가능한 표현 금지)
- 지문 안에 문제의 답을 그대로 노출하지 마라. 지문을 읽고 추론해야 풀리게 한다.
- 수학/CS의 수식은 KaTeX 인라인 문법으로 쓴다.
```

**User message** (프로그램이 커리큘럼 항목으로 조립)

```
과목: 컴퓨터 과학
Day: 5
주제: 뮤텍스와 세마포어
목표(goal): 두 동기화 도구의 소유권 개념 차이를 구분한다
키워드: 상호배제, 카운팅 세마포어, 데드락
난이도: 3 / 5
```

**JSON Schema (strict)**

```jsonc
{
  "passage": {
    "title": "string",
    "body_md": "string",              // 마크다운. KaTeX 허용
    "key_terms": [ { "term": "string", "definition": "string" } ]
  },
  "questions": [                       // 정확히 3개
    {
      "id": "q1" | "q2" | "q3",
      "type": "recall" | "concept" | "application",
      "prompt": "string",
      "expected_points": ["string"],   // ← 서버에만 남는다
      "hint": "string"                 // ← 요청 시에만 DB에서 꺼낸다 (LLM 호출 없음)
    }
  ]
}
```

응답 직전에 `expected_points`와 `hint`를 제거한다.
"힌트 보기"는 별도 라우트에서 DB의 값을 꺼내주므로 비용이 0이다.

### 5.5 ② 채점

**System prompt**

```
당신은 채점자다. 주어진 루브릭에 없는 기준으로 채점하지 마라.

원칙:
- 각 채점 포인트를 학습자 답안이 담고 있는지 하나씩 판정한다.
  담고 있으면 correct_points, 아니면 missed_points에 넣는다.
- 표현이 달라도 의미가 같으면 맞은 것으로 본다. 용어를 그대로 쓰지 않았다는
  이유로 감점하지 마라. 반대로, 용어만 나열하고 관계를 설명하지 못했으면 틀린 것이다.
- 점수는 (맞은 포인트 수 / 전체 포인트 수) × 100 을 반올림한 값이다. 임의로 조정하지 마라.
- feedback_ko는 2~4문장. 무엇이 빠졌는지와 왜 그게 필요한지를 쓴다.
  칭찬으로 문장을 시작하지 마라. 틀린 곳을 먼저 말한다.
- 학습자가 사실과 다른 내용을 썼다면 misconceptions에 명시적으로 적는다.
- summary_seed는 학습자가 최종 정리본을 쓸 때의 뼈대다.
  학습자가 실제로 이해한 것과 놓친 것을 반영해 3~5개 항목으로 만든다.
  정리본을 대신 써주지 마라. 항목만 준다.
```

**JSON Schema**

```jsonc
{
  "per_question": [
    {
      "id": "string",
      "score": 0,                     // 0-100
      "correct_points": ["string"],
      "missed_points": ["string"],
      "misconceptions": ["string"],
      "feedback_ko": "string"
    }
  ],
  "overall": {
    "score": 0,                       // 0-100
    "goal_reached": true,
    "verdict": "pass" | "revise"
  },
  "summary_seed": ["string"]          // 정리본 뼈대 3~5개
}
```

`summary_seed`를 정리본 화면에 체크리스트로 표시한다.
정리본 쓰기가 "빈 화면 앞의 막막함"이 아니라 "항목 채우기"가 된다.

### 5.6 ③ 말투 다듬기 (Humanizer)

외부 서비스를 쓰지 않는다. 같은 모델에 프롬프트 한 번을 더 돌린다.

**System prompt**

```
당신은 이 사람의 글을 대신 쓰지 않는다. 이 사람이 쓴 글을 읽기 좋게 다듬는다.

원칙:
- 원문에 없는 내용을 추가하지 마라. 틀린 내용이 있어도 고치지 말고 그대로 둔다.
  (사실 교정은 채점 단계에서 이미 끝났다)
- 문장을 짧게 끊고, 비문과 중복 표현을 정리하고, 문단을 나눈다.
- 원문의 1인칭 시점과 구어체 톤을 유지한다. 격식체로 바꾸지 마라.
- "~라고 할 수 있다", "~인 것 같다" 같은 얼버무리는 표현을 단정형으로 바꾼다.
- AI가 쓴 티가 나는 표현을 쓰지 마라: 불필요한 불릿 남발, "결론적으로",
  "~에 대해 알아보았습니다", 문단마다 반복되는 병렬 구조, 이모지.
- 원문 길이의 ±20% 안에서 끝낸다. 늘리지 마라.
- 코드 블록과 수식은 한 글자도 건드리지 마라.
```

**JSON Schema**

```jsonc
{
  "title": "string",            // Velog 글 제목
  "body_md": "string",
  "tags": ["string"],           // 3~5개
  "changes": ["string"]         // 무엇을 왜 고쳤는지
}
```

`changes`가 있는 이유: 다듬기 결과를 그냥 믿고 올리지 않는다.
**원문/다듬은글 diff를 사람이 보고 승인한 뒤에만 발행**한다. 발행은 되돌리기 어렵다.

### 5.7 호출 파라미터

```ts
{
  model: "gpt-4o-mini",
  temperature: /* content 0.6 · grade 0.0 · polish 0.4 */,
  max_tokens:  /* 라우트별 상한. 무제한 금지 — 비용 게이트 */,
  response_format: { type: "json_schema", json_schema: { strict: true, /* ... */ } },
  signal: AbortSignal.timeout(30_000),
}
```

채점의 `temperature: 0`은 필수다. 같은 답안에 같은 점수가 나와야 채점을 신뢰할 수 있다.

### 5.8 알려진 한계: 수학

`gpt-4o-mini`는 계산이 틀린 문제를 자신 있게 낼 수 있고, 루브릭까지 틀리면
정답을 쓴 사용자를 오답 처리한다. 프롬프트로 제거할 수 없는 모델 한계다.

완화책 둘:

1. **수학 커리큘럼의 `goal`을 계산이 아니라 개념·서술로 잡는다.**
   "다음 적분을 계산하라"가 아니라 "치환적분이 왜 성립하는지 연쇄법칙으로 설명하라".
   서술형은 모델이 훨씬 잘하고 루브릭 대조 채점도 안정적이다.
2. **채점 화면에 "이 채점이 틀렸다" 버튼**을 둔다. `attempts.feedback`에 플래그만 남기고
   해당 Day를 `completed`로 넘긴다. LLM 재호출 없음(0원).
   나중에 이 기록을 보고 커리큘럼을 수정한다.

상위 모델로 올리는 선택지는 열려 있으나 지금은 하지 않는다 (YAGNI).

### 5.9 비용 실측

토큰 수를 추정으로 확정하지 않는다. `usage_ledger`에 실제 값이 쌓이므로
**MVP 첫 주 실사용 후 실측치로 캡을 조정**한다. `/api/admin/usage`에서 일별·월별 누적을 본다.

---

## 6. 발행 (Velog)

### 6.1 위험 고지

**Velog에는 공개된 공식 API가 없다.** 웹 클라이언트가 사용하는 비공식 GraphQL
엔드포인트를 access token으로 호출하는 방식이며, 벨로그 측 사정으로 예고 없이 바뀔 수 있다.

### 6.2 대응: 폴백을 기본 경로로 둔다

```ts
interface Publisher {
  publish(post: { title: string; body: string; tags: string[] }): Promise<Result>
}
```

- **`ManualPublisher`** — 기본값이자 항상 동작. 마크다운을 클립보드에 복사하고
  Velog 글쓰기 페이지를 새 탭으로 연다. 외부 의존성 0.
- **`VelogGraphQLPublisher`** — 되면 좋은 것. 실패 시 자동으로 `ManualPublisher`로
  폴백하고 DB에 실패를 기록한다.

**4주차에 Velog API가 동작하지 않아도 프로젝트는 완성 상태다.**
자동화는 얹는 것이지 떠받치는 것이 아니다.

---

## 7. 저장소 구조

```
study-page/
├─ CLAUDE.md                    # 다음 세션을 위한 규칙 (자동 로드)
├─ docs/
│  ├─ HANDOFF.md                # 현재 상태 (항상 최신, 덮어쓰기)
│  ├─ DECISIONS.md              # 결정 로그 (추가만, 삭제하지 않음)
│  └─ specs/
├─ curriculum/{english,math,cs}.yaml
├─ app/
│  ├─ login/page.tsx
│  ├─ page.tsx                  # 대시보드 (과목 3카드 + 진도)
│  ├─ study/[subject]/page.tsx
│  └─ api/
│     ├─ session/route.ts             # POST 로그인
│     ├─ session/end/route.ts         # POST 종료 (버튼 + sendBeacon 공용)
│     ├─ study/[subject]/content/route.ts
│     ├─ study/[subject]/grade/route.ts
│     ├─ study/[subject]/summary/route.ts
│     ├─ study/[subject]/polish/route.ts
│     ├─ publish/route.ts
│     └─ admin/usage/route.ts
├─ lib/
│  ├─ session/{store.ts,postgres.ts,guard.ts}
│  ├─ budget/reserve.ts
│  ├─ llm/{client.ts,schemas.ts,prompts/}
│  ├─ curriculum/load.ts
│  ├─ publish/{publisher.ts,velog.ts,manual.ts}
│  ├─ db/{schema.ts,client.ts}
│  └─ time.ts
├─ drizzle/
└─ tests/
```

---

## 8. 작업 흐름

### 8.1 핸드오프 문서 두 개

성질이 다른 두 정보이므로 파일을 나눈다.

- **`docs/HANDOFF.md`** — 현재 상태. 매번 통째로 덮어쓴다.
  "내일 이어서 작업할 때 필요한 것"
- **`docs/DECISIONS.md`** — 왜 그렇게 했나. 추가만 하고 삭제하지 않는다.
  "3개월 뒤 이거 왜 이렇게 짰지? 할 때 답을 주는 것"

`CLAUDE.md`가 세션 시작 시 `HANDOFF.md`를 먼저 읽도록 강제하고,
PR 체크리스트가 두 문서의 갱신을 강제한다. 별도 습관에 의존하지 않는다.

### 8.2 Git

- `main`은 항상 배포 가능. 직접 커밋 금지
- 작업 단위마다 브랜치: `feat/session-gate`, `chore/curriculum-cs-day8-30`
- PR 하나 = 리뷰 가능한 크기 하나
- 머지는 **squash** — `main` 이력이 "기능 하나 = 커밋 하나"로 읽힌다
- 커밋 저자는 사용자 단독. AI 공동저자 표기 없음

### 8.3 환경 분리 — Preview가 곧 비용 구멍

버셀은 PR마다 Preview 배포를 자동 생성한다. Preview에 프로덕션 키가 그대로
들어가면 PR을 열 때마다 실제 돈이 나가는 경로가 생긴다.

| 환경 | DB | 일일 캡 |
|---|---|---|
| Production (`main`) | Neon `main` 브랜치 | 20 |
| Preview (PR) | Neon 별도 브랜치 | **3** |
| Local | Neon dev 브랜치 | **3** |

추가로 **OpenAI 대시보드에서 프로젝트 하드 리밋을 월 $5**로 설정한다.
코드 밖의 마지막 안전망이며, 코드에 어떤 버그가 있어도 뚫리지 않는다.

---

## 9. 테스트 방침

전부 테스트하지 않는다. **틀리면 돈이나 보안이 걸린 것만** 반드시 테스트한다.

1. 세션 만료 4경로 (유휴 / 절대 / revoke / 없음) — 시간을 주입 가능하게 만들어 `sleep` 없이 테스트
2. 예산 캡 — 동시 요청 N개가 캡 M에서 정확히 M번만 통과
3. 멱등성 — 같은 `(subject, day_no)` 요청 10개에 LLM 호출 1회
4. 재시도 상한 — `grade` 3번째 호출과 `polish` 3번째 호출이 429로 막힘
5. 커리큘럼 YAML zod 검증
6. `expected_points`가 API 응답에 섞여 나가지 않음

**테스트에서 실제 LLM을 호출하지 않는다.** 가짜 클라이언트를 주입한다.

---

## 10. 로드맵

### 1주차 — 뼈대와 방어선 (LLM 호출 0회)

가장 중요한 순서 결정: **돈이 나가는 코드를 마지막에 꽂는다.**
보안·예산 계층을 먼저 완성하고 그때까지 LLM 자리에는 가짜 응답을 둔다.
반대 순서로 하면 개발 중에 새는 것이 정상이 된다.

- [ ] 레포 생성, Next.js + TS + Tailwind, Drizzle + Neon, 버셀 연결
- [ ] `CLAUDE.md`, `docs/HANDOFF.md`, `docs/DECISIONS.md`, PR 템플릿
- [ ] 스키마 마이그레이션 전체 (§4.3)
- [ ] 커리큘럼 YAML 스키마 + zod, 3과목 각 Day 1~7
- [ ] 로그인 (argon2 + 실패 제한) / 세션 발급 / `withSession` 가드
- [ ] 종료 버튼, `pagehide` sendBeacon, 유휴 15분, 절대 2시간, 카운트다운 UI
- [ ] 예산 예약·롤백 + `usage_ledger`, 가짜 LLM 클라이언트
- [ ] `check:secrets` 스크립트

**완료 기준:** 만료 세션 → 401, 캡 초과 → 429가 자동 테스트로 증명된다. LLM 호출 0회.

### 2주차 — 학습 루프 (실제 LLM 연결)

- [ ] `lib/llm/client.ts` — Structured Outputs, 타임아웃, 토큰 기록
- [ ] `content` 라우트 + 멱등성 + `expected_points` 제거
- [ ] `grade` 라우트 + 2회 상한
- [ ] 학습 화면: 지문(마크다운 + KaTeX) → 답안 3개 → 채점 결과 → "채점이 틀렸다" 버튼
- [ ] Day 완료 처리, 진도 계산, 대시보드 3카드
- [ ] **실측 비용 확인 후 캡 재조정**

**완료 기준:** CS Day 1을 실제로 완주. `usage_ledger`에 실제 비용이 기록된다.

### 3주차 — 정리본과 다듬기

- [ ] 정리본 작성 화면 (`summary_seed` 체크리스트)
- [ ] `polish` 라우트 + 원문/다듬은글 diff 승인 UI
- [ ] `/admin/usage` 비용 화면
- [ ] 지난 Day 열람 (LLM 호출 0회)
- [ ] 커리큘럼 Day 8~30 확장
- [ ] 에러 처리, 모바일 레이아웃

**완료 기준:** Velog에 붙여넣기만 하면 되는 마크다운이 완성된다.

### 4주차 — 발행과 마감

- [ ] `ManualPublisher` (클립보드 + 새 탭) — **먼저 만든다**
- [ ] Velog GraphQL 조사 → `VelogGraphQLPublisher`, 실패 시 자동 폴백
- [ ] 발행 기록 (`velog_url`, `published_at`)
- [ ] 주간 DB 덤프 백업
- [ ] README, 최종 핸드오프 정리

**완료 기준:** 로그인부터 발행까지 끊김 없이 동작한다.
