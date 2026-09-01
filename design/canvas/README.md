# 디자인 캔버스 원본

캔버스: https://claude.ai/code/artifact/54e9838d-e75b-47cd-85a2-1e22ff749963

이 디렉터리의 `*.dc.html` 여덟 개가 **원본**이다. 캔버스에 올라간
`study-page-daily-flow.html` 은 이것들을 씨딩해서 만든 산출물이고
`.gitignore` 에 들어 있다. **그 파일을 직접 고치지 않는다.**

| 파일 | 화면 |
|---|---|
| `Login.dc.html` | 1 · 로그인 |
| `Main.dc.html` | 2 · 대시보드 (캔버스의 진입 아트보드) |
| `Study.dc.html` | 3 · 학습 |
| `Grading.dc.html` | 4 · 채점 결과 |
| `Summary.dc.html` | 5 · 정리본 작성 |
| `Polish.dc.html` | 6 · 다듬기 승인 |
| `Publish.dc.html` | 7 · 발행 |
| `States.dc.html` | 공통 · 세션 바 4상태 + 막힌 화면 4장 |

`canvas.json` 이 배치와 메모를 정한다.

## 고치는 순서

1. `*.dc.html` 을 고친다.
2. `design` 스킬을 불러 다시 씨딩한다 (씨딩 도구는 스킬이 들고 있다).
3. 같은 Artifact URL 로 다시 올린다. 새 URL 을 만들지 않는다.

사용자가 캔버스 위에서 직접 고쳐 저장했다면 **먼저 그 버전을 읽어
여기로 되돌린 다음** 고친다. 안 그러면 사용자의 편집을 덮어쓴다.

## 색·글꼴

토큰 표는 `docs/plans/2026-08-31-week1-foundation.md` 의 Task 9.5 결과 절에 있다.
방향을 그렇게 정한 이유는 `docs/DECISIONS.md` 에 있다.
