# 핸드오프

**갱신:** 2026-08-31 · **브랜치:** `docs/week1-plan` · **PR:** #2

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

설계 스펙 승인 및 머지 완료 (PR #1). 1주차 구현 계획 작성 완료 (PR #2).
**코드는 아직 한 줄도 없다.**

- 저장소: `kimcheolhui9846/study-page` (private)
- 스펙: `docs/specs/2026-08-31-ai-study-page-design.md`
- 1주차 계획: `docs/plans/2026-08-31-week1-foundation.md` — 태스크 10개 / 단계 72개

## 바로 다음에 할 일

1. PR #2를 머지한다.
2. **코드를 짜기 전에** 아래 외부 설정을 먼저 끝낸다 (아래 "먼저 해둘 것" 참조).
3. 계획의 **Task 1 (`feat/scaffold`)** 부터 시작한다.

**순서를 지킬 것:** 1주차는 LLM 호출 0회다. 보안·예산 계층을 먼저 완성하고
LLM 자리에는 `FakeLlmClient`를 둔다. 반대로 하면 개발 중에 돈이 샌다.

## 먼저 해둘 것 (사용자 직접)

- [ ] **OpenAI 대시보드에서 프로젝트 하드 리밋 월 $5 설정** — 코드 밖의 마지막 안전망.
      코드를 짜기 전에 있어야 의미가 있다.
- [ ] Neon 프로젝트 생성 → `DATABASE_URL` 확보
- [ ] Vercel 프로젝트를 이 레포에 연결
- [ ] 버셀 환경변수 `APP_ENV` 를 Production=`production`, Preview=`preview` 로 설정
      (계획 Task 8의 캡이 이 값을 읽는다)

## 아직 안 정한 것

- [ ] Neon 무료 플랜에서 Preview용 DB 브랜치 자동 생성이 되는지 미확인
- [ ] 커리큘럼 Day 1~7 내용 — 계획 Task 4에 초안이 있고, 사용자가 이후 PR에서 고쳐 쓴다
- [ ] Velog access token 확보 방법 (4주차 전까지)

## 하지 말 것

- 1주차에 `OPENAI_API_KEY`를 `.env`에 넣지 말 것. 실제 LLM 클라이언트는 2주차다.
- 커리큘럼을 DB에 넣지 말 것. 레포의 YAML 파일이다.
- `progress` 테이블을 만들지 말 것. 진도는 `study_days`에서 파생한다.
- 하트비트 ping을 넣지 말 것. 유휴 타임아웃을 무력화한다.

## 명령어

```bash
gh pr create --fill          # PR 열기
git checkout -b feat/이름     # 새 작업 시작
```

계획 Task 1이 끝나면 `npm test`, `npm run check:secrets`가 생긴다.
