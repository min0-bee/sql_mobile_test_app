# GitHub Pages 배포 메모

이 저장소에는 SQL 코테 연습장이 포함되어 있다.

## 배포 구조

- 루트 `index.html`은 `sql-practice-app/`로 리다이렉트한다.
- 실제 앱은 `sql-practice-app/` 아래에 있다.
- 문제 데이터는 `materials/sql-cote-practice-daangn-supercent.md`를 상대 경로로 불러온다.

## GitHub Pages 설정

1. 저장소를 GitHub에 푸시한다.
2. GitHub 저장소 설정에서 Pages를 연다.
3. Source를 `Deploy from a branch`로 선택한다.
4. Branch를 `main` 또는 `master`, folder를 `/root`로 둔다.
5. 저장 후 잠시 기다린다.

## 주의

- `sql-practice-app/app.js`는 `../materials/sql-cote-practice-daangn-supercent.md`를 읽는다.
- 저장소 구조를 그대로 올려야 한다.
- GitHub Pages는 정적 파일만 서빙하므로 서버가 따로 필요 없다.
