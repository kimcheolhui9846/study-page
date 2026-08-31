# 핸드오프

**갱신:** 2026-08-31 · **브랜치:** `docs/design-spec` · **PR:** 열기 직전

> 이 파일은 **현재 상태**만 담는다. 매번 통째로 덮어쓴다.
> 과거 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 지금 상태

브레인스토밍 완료. 설계 스펙 4개 섹션(보안·데이터·프롬프트·로드맵) 전부 사용자 승인.
저장소 생성 + 초기 커밋 완료. **코드는 아직 한 줄도 없다.**

- 저장소: `kimcheolhui9846/study-page` (private)
- 스펙: `docs/specs/2026-08-31-ai-study-page-design.md`

## 바로 다음에 할 일

1. 이 브랜치로 PR을 열어 머지한다 (설계 문서 4종).
2. 스펙 §10 **1주차** 항목을 구현 계획으로 쪼갠다.
3. 1주차 첫 작업은 `feat/scaffold` — Next.js + TS + Tailwind + Drizzle 뼈대.

**순서를 지킬 것:** 1주차는 LLM 호출 0회다. 보안·예산 계층을 먼저 완성하고
그 자리에는 가짜 LLM 클라이언트를 둔다. 반대로 하면 개발 중에 돈이 샌다.

## 아직 안 정한 것 / 확인 필요

- [ ] Neon 프로젝트 생성 + Preview용 DB 브랜치 (무료 플랜에서 브랜치 자동 생성이 되는지 미확인)
- [ ] Vercel 프로젝트 연결 + 환경변수 3벌 분리 (Production / Preview / Local)
- [ ] OpenAI 프로젝트 하드 리밋 월 $5 설정 — **코드 짜기 전에 먼저 해둘 것**
- [ ] `AUTH_PASSWORD_HASH` 생성 (argon2id)
- [ ] 커리큘럼 Day 1~7 실제 내용 작성 (3과목) — 사용자가 최종 수정
- [ ] Velog access token 확보 방법 (4주차 전까지)

## 하지 말 것

- `lib/llm/client.ts`를 1주차에 만들지 말 것. 실제 키는 보안 계층이 끝난 뒤에 꽂는다.
- 커리큘럼을 DB에 넣지 말 것. 레포의 YAML 파일이다.
- `progress` 테이블을 만들지 말 것. 진도는 `study_days`에서 파생한다.

## 명령어

```bash
gh pr create --fill          # PR 열기
git checkout -b feat/이름     # 새 작업 시작
npm test                     # (아직 없음)
npm run check:secrets        # (아직 없음)
```
