# 기상 합의 · 앙상블 날씨 (weather-ensemble)

기상청 하나만 믿기 어려워서 만든, **여러 예보 모델을 그대로 모아 날씨를 하나의 숫자가 아닌
확률 분포로 보여주는** 웹앱.

각 시각마다 세계 5개 기관(ECMWF·NOAA GFS·독일 ICON·캐나다·호주)의 앙상블 예보 멤버
**140여 개**를 받아와, "몇 %는 이럴 것, 몇 %는 저럴 것"을 전부 펼쳐 보여준다. 모델이
갈릴수록 막대가 여러 색으로 쪼개진다 — 그 갈림 자체가 정보다.

- 데이터: [Open-Meteo Ensemble API](https://open-meteo.com/en/docs/ensemble-api) (API키·요금 없음)
- 전국 시·군·구 검색(오프라인 번들) + 즐겨찾기(수원시 권선구·성남시 수정구) + 현재 위치
- 순수 정적 · 클라이언트 사이드 → 서버 불필요

## 실행

ES 모듈은 `file://`에서 안 열리므로 정적 서버로 띄운다:

```bash
python -m http.server 8848      # 또는  npx serve
# → http://localhost:8848
```

## 테스트

```bash
node --test                     # 순수 로직 단위 테스트 (stats·format)
node scripts/dom-verify.mjs     # 실데이터로 렌더 경로 전체 검증 (jsdom, 개발 의존성)
node scripts/itest.mjs          # 앙상블 파이프라인 라이브 점검
node scripts/snapshot.mjs       # preview.html 정적 스냅샷 생성
```

## 구조

| 파일 | 역할 |
|---|---|
| `js/config.js` | 모델 목록·강수 구간 임계값·즐겨찾기 (계량 기준을 한곳에) |
| `js/stats.js` | **순수** 앙상블 통계 (분포·비확률·바람·합의도) — DOM/네트워크 없음 |
| `js/api.js` | Open-Meteo 호출 + 응답을 시각별 멤버 묶음으로 재구성 + 지오로케이션 |
| `js/format.js` | 숫자/시간 포맷 + 평문 판정(verdict) 문장 |
| `js/ui.js` | 계산된 데이터 → DOM 렌더 |
| `js/main.js` | 상태·이벤트·오케스트레이션 |
| `js/regions.js` | 전국 228개 시·군·구 좌표(번들) |

자세한 이어작업 지침은 [CLAUDE.md](CLAUDE.md).
