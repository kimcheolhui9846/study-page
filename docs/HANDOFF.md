# 핸드오프

**갱신:** 2026-11-16 · **`main` 에 머지됨** (PR #41 「모드별 자유학습」, squash)

**배포됨 → https://study-page-kimcheolhui9846s-projects.vercel.app**
(`main` 에 머지하면 자동 배포된다. 자유학습이 배포된 상태다)

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.
> 작업 규칙은 [`AGENTS.md`](../AGENTS.md)에 있다 — 에이전트를 가리지 않는다.

**이 저장소는 Claude Code 와 Codex 가 번갈아 작업한다.** 대화 기록은 다음
에이전트에게 닿지 않으므로 **이 파일이 유일한 인수인계다.**

## ⚠ 다음 에이전트가 먼저 알아야 할 것

- **운영 DB 에 `drizzle/0001` 적용 완료** (2026-11-16, 마이그레이션 3건 · 새 테이블 6개 확인).
  Neon 테스트 브랜치에서 먼저 적용하고 화면 흐름(로그인·시작·질문·제출·새로고침)을 사용자가 손으로 확인했다.
- **운영 DB 비밀번호를 2026-11-16 에 교체했다** (`neondb_owner`). 확인 스크립트의 오류 메시지가
  접속 문자열을 출력에 찍었기 때문이다. `.env.local` 과 Vercel `DATABASE_URL`(Production) 둘 다 새 값이다.
  **DB 를 스크립트로 들여다볼 때는 오류 메시지에서 `postgres://…` 를 가린다** — `@neondatabase/serverless`
  는 URL 파싱 실패 시 문자열 전체를 메시지에 넣는다.
- 배포된 사이트에는 Vercel 배포 보호(SSO)가 켜져 있어 curl 로는 앱까지 닿지 않는다. 확인은 브라우저로 한다.

## 지금 상태

**기본 진입이 「모드별 자유학습」으로 바뀌었다.** 설계는
[`docs/specs/2026-11-16-free-study-modes-design.md`](specs/2026-11-16-free-study-modes-design.md),
구현 계획은 [`docs/plans/2026-11-16-free-study-modes.md`](plans/2026-11-16-free-study-modes.md).

영어·수학·CS·코테 중 하나를 고르고 공부하고 싶은 것을 쓰면 바로 자료·문제가 나오고,
같은 화면에서 질문·제출·힌트·해설이 이어진다. 커리큘럼·오늘 계획은 진입 조건이 아니다.
**기존 커리큘럼 경로는 그대로 남았다** (`/dashboard` 로 옮긴 대시보드, `/today`, `/curriculum`).

### 검증 (2026-11-16 실제 실행)

| 명령 | 결과 |
|---|---|
| `npm test` | **779개 통과** (45파일) — 그중 자유학습 `tests/study/` 11파일 |
| `npm run lint` | 0 |
| `npx tsc --noEmit` | 0 |
| `npm run check:secrets` | 통과 |
| `npm run build` | 통과 — 라우트 26개 |
| 화면 | 데스크톱(1360)·모바일(390) 가짜 데이터 확인 + **Neon 테스트 브랜치에서 사용자가 실제 로그인·학습 흐름을 확인** (2026-11-16) |
| **실제 모델 호출** | 13회, 전부 성공 (로컬 PGlite DB, 엔진 직접 호출 — 화면·라우트는 안 거침). 추론 파라미터 수락 확인. 결함 2개 발견해 고침. 자세히: [`docs/evals/free-study.md`](evals/free-study.md) |

```
ƒ /                                   모드 선택 + 최근 학습       ← 0원 (읽기만)
ƒ /study/[id]                         학습 공간 (자료 | 대화)     ← 0원 (읽기만)
ƒ /dashboard                          기존 대시보드 (옮김)
ƒ /api/study/sessions                 POST 시작                  ← 돈 terra 1
ƒ /api/study/sessions/[id]/messages   POST 대화                  ← 돈 luna 1 (+terra 1)
ƒ /api/study/sessions/[id]/more       POST 추가 문제·더 쉽게      ← 돈 terra 1
ƒ /api/study/sessions/[id]/submit     POST 답안·코드 피드백        ← 돈 terra 1
ƒ /api/study/problems/[id]/hint       POST 저장된 힌트 한 단계     ← 0원
ƒ /api/study/problems/[id]/reveal     POST 저장된 해설            ← 0원
(기존 커리큘럼 라우트 17개는 그대로)
```

## 구조 (자유학습)

```
lib/study/modes/     하네스 = 데이터 (지도 방식·자료 형식·피드백 기준·주장 금지·공개 정책)
lib/study/schemas.ts 생성(…Gen, 필수) / 저장(Stored…, 선택) / 공개 투영 publicProblem·publicFeedback
lib/study/store.ts   DB 함수. ★ 세션 경계를 여기서 강제
lib/study/requests.ts ai_requests 멱등성 (claim / finish / fail)
lib/study/call.ts    ★ 유일한 유료 호출 지점. reserve → generate → 실패 정산 3갈래
lib/study/context.ts 모델별 문맥. ★ luna 에는 미공개 해설을 넘기지 않는다
lib/study/prompts.ts 학습자 입력은 <<<…>>> 데이터 블록, 표식 무력화
lib/study/engine.ts  행동 6개 (start·message·more·submit·hint·reveal)
lib/study/http.ts    엔진 결과 → HTTP
components/study/    ModePicker · StudyRoom · ProblemCard · ChatPanel · Md · modeStyle
```

**화면:** 과목마다 색 하나와 글자 하나(`Aa` `∑` `01` `{ }`)가 있다 — `app/globals.css` 의
`--color-english`…`--color-coding`, `components/study/modeStyle.ts`. 선택 카드·버튼·대화 말풍선·
포커스 테두리가 그 색을 따른다. 상태색(맞음·일부·틀림)은 그대로다.

**DB:** 마이그레이션 `drizzle/0001_dry_shatterstar.sql` — 새 테이블 6개
(`study_sessions` · `study_messages` · `study_materials` · `study_problems` ·
`study_submissions` · `ai_requests`) + `usage_ledger` 에 nullable 컬럼 2개.
**DROP·타입 변경 없음** (`tests/study/schema.test.ts` 가 단언).

## 비용 (이번에 바뀐 것)

| | 전 | 후 |
|---|---|---|
| 운영 하루 / 월 | 20회 / $3 | **100회 / $20** |
| 로컬·프리뷰 하루 / 월 | 3회 / $0.50 | **10회** / $0.50 |

모델: 자유학습 대화 `gpt-6-luna`($0.10/$0.50), 자료·피드백 `gpt-6.1-terra`($1/$5),
커리큘럼 경로 `gpt-4o-mini` 그대로. 단가는 2026-11-16 공식 가격표 조회값.
출력 상한 terra 12,000 · luna 4,000 (추론 토큰 포함), effort low, 타임아웃 60초, 재시도 0.

실측 1회: terra $0.004~0.010 (12~22초), luna ≈ $0.0003 (3~4초).

실패 정산: HTTP 오류 → 롤백·0원 / 타임아웃 → 예약 유지·**상한 비용** / 잘림·형식 오류 →
예약 유지·실사용량. `tests/study/call.test.ts`.

## 운영 반영 (완료, 2026-11-16)

1. Neon 테스트 브랜치에 마이그레이션 → `npm run dev` 로 화면 확인 ✔
2. 실호출 평가 (로컬 PGlite, 13회) ✔ — 남은 평가 입력은 `docs/evals/free-study.md` 「아직 안 본 것」
3. 운영 DB 에 `drizzle/0001` 적용 ✔ → PR #41 머지
4. OpenAI 월 하드 리밋(④겹) $60 으로 올림 ✔ — 코드 캡($20/월)이 먼저 막는다

## 남은 일

| | |
|---|---|
| Neon 브랜치 정리 | 오늘 만든 테스트용 브랜치는 옛 비밀번호가 살아 있다. 사용자가 지우기로 했다 — 남아 있으면 지운다 |
| **실호출 평가** | 4모드 대표 입력은 했다. 남은 5개 입력은 `docs/evals/free-study.md` |
| 자유학습 진도 | `topic_progress` 와 연결하지 않았다 (범위 밖). 기록은 세션별로만 남는다 |
| 코드 실행기 | 없다. `lib/study/runner.ts` 에 경계만. 격리 샌드박스로만 붙인다 |
| 오래된 pending | 서버가 처리 중에 죽으면 그 `ai_requests` 행이 pending 으로 남는다. 같은 ID 만 막히고 「다시 시도」는 새 ID 라 학습은 막히지 않는다. 정리 작업은 없다 |
| 세션 보관 | `status='archived'` 칸만 있고 화면은 없다 |

## 커리큘럼 경로 (보조, 이전 상태 그대로)

적응형 커리큘럼 1·2·3단계와 그 화면은 바뀌지 않았다. 69 Topic, 회복 정책,
`forbidden` 문맥, 하루 통째 채점. 이전 핸드오프의 미검증 항목(복습 경로 실호출,
어휘·독해 레시피 실호출, 해설 실호출)은 **여전히 미검증**이다 — 자세한 내용은
`docs/DECISIONS.md` 와 `docs/specs/2026-09-01-adaptive-curriculum-design.md`.

이번에 커리큘럼 쪽에서 바뀐 것은 셋뿐이다.
- 「대시보드로」 링크가 `/` 대신 `/dashboard` 를 가리킨다
- 예산 테스트 몇 개가 캡 숫자(3·5·20)를 박지 않고 `dailyCallCap()` 을 쓴다
- `LlmClient` 가 실패를 세 클래스로 던진다 — 전부 Error 를 상속해 기존 `catch {}` 동작은 같다

## 배포

환경변수 4개가 **Production 환경에만** 있다 — `DATABASE_URL` · `AUTH_PASSWORD_HASH` ·
`OPENAI_API_KEY` · `APP_ENV=production`. Preview 에는 없다 → 프리뷰는 낮은 캡.
함수 리전이 Neon 리전과 같은지는 여전히 미확인.
