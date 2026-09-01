# 핸드오프

**갱신:** 2026-09-01 · **브랜치:** `docs/week2-close` · **PR:** 열기 직전

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

**2주차 완료. CS Day 1 을 화면에서 완주했다** — 시작 → 지문 → 답안 → 채점 → 마치기.

- 테스트 **271개 통과** (25파일, ~25초)
- `npm run build` 통과 — 라우트 12개
- **총 사용액 $0.0011** (content $0.000641 + grade $0.000430)

```
ƒ /                                대시보드 (진도 · 사용량)
ƒ /login                           로그인
ƒ /study/[subject]                 학습 (시작 / 지문+답안 / 채점 결과)
ƒ /api/session                     POST 로그인
ƒ /api/session/end                 POST [종료] → 즉시 파기
ƒ /api/session/leaving             POST pagehide → 유휴 30초로 당김
ƒ /api/session/status              GET 만료 시각 두 개
ƒ /api/study/[subject]/content     POST 지문 생성      ← 돈
ƒ /api/study/[subject]/grade       POST 채점          ← 돈
ƒ /api/study/[subject]/hint        GET 힌트           ← 0원
ƒ /api/study/[subject]/complete    POST Day 마치기     ← 0원
```

## 실측 비용 — 캡은 $3 그대로 둔다

| | 월 비용 |
|---|---|
| 현실적 (Day 당 채점 1회) | **$0.10** |
| 최악 (Day 당 채점 2회) | **$0.14** |
| 코드 캡 | $3.00 (최악의 21배) |

**$5 선불이 이 속도면 약 3년 간다.** 캡을 내리지 않는 이유는
`docs/DECISIONS.md` 참조 — 요약하면 **캡의 목적은 예산이 아니라 폭주 차단**이고,
빡빡한 캡은 멀쩡한 하루를 429 로 막는다.

## ★ 3주차가 먼저 읽어야 할 것

### 모델이 준 숫자를 믿지 않는다

채점 응답의 `score` 필드는 **프롬프트의 계산식을 지키지 않는다.**
포인트 3개를 전부 놓친 답에 50점이 나왔다(0 이어야 한다).

`GradeResult` 는 `score` 를 읽지 않고 `correct_points.length` 를 직접 센다.
**3주차에서도 모델이 준 숫자를 화면에 그대로 쓰지 않는다.**
근거는 모델이 주고, 숫자는 우리가 만든다.

### 프롬프트 결함 셋이 미해결이다

표본이 하나뿐이라 고치지 않았다. **여러 Day 를 만들어보고 반복되는 것만 고친다.**

1. **지문이 문제의 답을 그대로 담았다.** 프롬프트가 금지했는데도 지문의
   예시를 application 문제가 그대로 물었다 — 적용을 시험하지 못한다
2. **어투가 앱과 어긋난다.** 지문과 피드백은 "~습니다", 나머지는 "~다"
3. **루브릭에 주관이 섞였다.** "정확하게 ... 정의했음"의 "정확하게"

### `summary_seed` 는 이미 DB 에 있다

3주차의 정리본 화면이 쓸 체크리스트다. `attempts.feedback.summary_seed` 에
있고 채점 결과 화면이 이미 미리 보여준다. **새로 LLM 을 부를 필요가 없다.**

## 바로 다음에 할 일

3주차 계획을 쓴다. 스펙 §10 의 3주차:

- 정리본 작성 화면 (`summary_seed` 체크리스트)
- `polish` 라우트 + 원문/다듬은글 diff 승인 UI (`summaries.polish_count` CHECK 2회)
- `/admin/usage` 비용 화면
- 지난 Day 열람 (LLM 호출 0회)
- 커리큘럼 Day 8~30 확장
- 에러 처리, 모바일 레이아웃

**계획을 쓰기 전에 `docs/DECISIONS.md` 의 2026-09-01 항목들을 읽는다.**
프롬프트 결함 셋과 점수 필드 문제가 3주차 설계에 그대로 영향을 준다.

## 알아둘 것

- **★ 모델에게 숫자 계산을 맡기지 않는다.** 위 참조.
- **★ drizzle 은 드라이버 오류를 `DrizzleQueryError` 로 감싼다.** `code` 가
  최상위에 없고 `cause` 사슬에 있다. 이걸 모르면 CHECK 위반이 500 이 된다
  (`lib/study/grade.ts` 의 `pgCode`).
- **★ 제약 역검증은 `drizzle/0000_*.sql` 에서 한다.** PGlite 하네스는
  `lib/db/schema.ts` 가 아니라 마이그레이션 SQL 을 실행한다. 스키마 파일을
  고치고 "역검증했다"고 믿으면 아무것도 검증하지 않은 것이다.
- **★ 한국어는 `word-break: keep-all` 이 필요하다.** 기본값은 음절 중간에서
  끊는다. `globals.css` 의 `body` 에 있다.
- **★ 환경변수 값에 `$` 를 넣지 말 것.** Next 의 dotenv 가 변수 확장을 한다.
  해시 형식이 `scrypt.N.r.p.salt.hash` 인 이유다.
- **★ `pagehide` 는 창 닫기 전용 신호가 아니다.** 새로고침에서도 발생한다.
- **★ `/api/session/status` 를 폴링하지 말 것.** 가드가 유휴 만료를 민다.
- **★ `OPENAI_API_KEY` 는 `lib/llm/client.ts` 에서만 읽는다.**
  `tests/api-key-boundary.test.ts` 가 강제한다.
- **`react-markdown` 에 `rehype-raw` 를 넣지 말 것.** 원시 HTML 렌더가 켜지면
  모델 출력이 그대로 실행된다.
- **`.env` 값을 검증할 때는 `@next/env` 로 읽을 것.** `process.loadEnvFile()` 은
  변수 확장을 하지 않아 앱이 보는 값과 다르다.
- **테스트가 느려지고 있다.** 271개에 25초. 40초를 넘기면 파일당 PGlite
  인스턴스 하나를 재사용하고 테스트 사이에 TRUNCATE 한다.
- **날짜를 `new Date()` 로 만들지 않는다.** `kstToday()` / `kstDateLabel()` 만.
  날짜 라벨은 서버 컴포넌트에서만 만든다.
- **`lib/db/client.ts` 는 지연 연결이다.** import 는 항상 성공하고 첫 쿼리에서 연결한다.
- Next 16: `runtime = 'nodejs'` export 쓰지 않는다 / `params` 는 Promise /
  `cookies()` 는 async. 추측하지 말고 `node_modules/next/dist/docs/` 를 읽을 것.

## 하지 말 것

- **모델의 `score` 를 화면에 쓰지 말 것.** 포인트 개수를 센다.
- **`max_tokens` 를 줄이지 말 것.** 출력이 922 로 2000 의 절반이지만, 긴 Day 에서
  잘리면 그 Day 가 UNIQUE 제약에 묶여 평생 망가진다.
- 하트비트 ping 을 넣지 말 것. 유휴 타임아웃을 무력화한다.
- `pagehide` beacon 을 `/api/session/end` 로 돌리지 말 것. 새로고침이 로그아웃이 된다.
- `expireSoon` 의 `idleExpiresAt > soon` 가드를 지우지 말 것. 종료 신호가 연장이 된다.
- **진도를 하드코딩하지 말 것.** `lib/study/progress.ts` 가 `study_days` 에서 파생한다.
- `progress` 테이블을 만들지 말 것. 두 곳이 어긋나면 진실을 정할 수 없다.
- 커리큘럼을 DB 에 넣지 말 것. 레포의 YAML 이다.
- **`design/canvas/study-page-daily-flow.html` 을 직접 편집하지 말 것.** 씨딩 산출물이다.
- **색을 새로 짓지 말 것.** `app/globals.css` 의 `@theme` 토큰을 쓴다.
  **팔레트를 바꿀 때는 계획서까지 훑는다 — 계획서는 미래의 코드다.**
- `FakeLlmClient` 를 지우지 말 것. 모든 통합 테스트가 이걸 주입해서 돈다.
- `AGENTS.md` 를 지우지 말 것. `next dev` 가 재생성한다.
- 스키마를 고쳤으면 `npm run db:generate` 를 돌려 마이그레이션을 함께 커밋할 것.

## 아직 안 정한 것

- [ ] 프롬프트 결함 셋 (위 참조) — 여러 Day 표본을 모은 뒤 결정
- [ ] Neon 무료 플랜에서 Preview 브랜치 DB 자동 생성 가능 여부
- [ ] 커리큘럼 Day 8~30 확장
- [ ] Velog access token 확보 방법 (4주차)
- [ ] 첫 호출 13.7초 · 채점 14.2초 — 대기 화면을 3주차에 다듬는다

## 사용자가 직접 (배포 전)

- [ ] Vercel 프로젝트를 이 레포에 연결
- [ ] 버셀 환경변수: `DATABASE_URL` · `AUTH_PASSWORD_HASH` · `OPENAI_API_KEY` ·
      `APP_ENV`(Production=`production`, Preview=`preview`)
- [ ] **자동 충전이 꺼져 있는지 다시 확인** — 되돌릴 수 없는 유일한 설정 실수다

## 명령어

```bash
npm run dev
npm test
npm run check:secrets
npm run build
npm run db:generate
npm run db:migrate
npm run hash:password
node scripts/peek.mjs      # 원장·예산·진도를 본다 (읽기 전용)
npx tsc --noEmit
```
