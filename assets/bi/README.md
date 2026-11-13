# DANSANG BI 에셋

브랜드 사용 기준은 [브랜드 아이덴티티](../../docs/wiki/brand-identity.md)를 따릅니다.

- `identity-board.svg` / `.png`: 기본형, 반전형, 앱 아이콘을 모은 보드.
- `lockup-black.svg`, `lockup-white.svg`: 투명 배경 가로 로고.
- `lockup-light.svg`, `lockup-dark.svg`: 배경 포함 가로 로고.
- `symbol-black.svg`, `symbol-white.svg`: D를 형상화한 심볼.
- `wordmark-black.svg`, `wordmark-white.svg`: DANSANG 워드마크.
- `app-icon.svg`: 검은 라운드 타일과 흰 D 심볼.
- 각 SVG에 대응하는 PNG와 크기 정보 `manifest.json`.

SVG는 실제 패스 원본이며 워드마크도 윤곽선으로 변환되어 폰트 설치가 필요 없습니다.
`python3 assets/bi/extract.py`로 PNG를 내보내고 앱·PoC 로고, 파비콘, 홈 화면 아이콘에 동기화합니다.
Pillow 및 `pocs`의 기존 `sharp` 의존성이 필요합니다.

이전 PR·SIM 시안은 `docs/bi/monochrome`, `docs/bi/draft`에 기록으로 남깁니다.

커스텀 글자 조형은 `python3 assets/bi/build-wordmark.py`로 생성하고, 이후 `python3 assets/bi/extract.py`로 배포 에셋을 동기화합니다. 가로 로고는 별도 심볼 없이 D 심볼의 조형을 공유하는 일곱 글자로 구성합니다.
