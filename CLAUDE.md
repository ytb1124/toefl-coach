# TOEFL 교정 코치 — 작업 규칙

사용자(2026 TOEFL 목표 5.0)의 개인 오답 교정 앱. 정적 웹앱 + 콘텐츠 빌드 파이프라인.
설계 근거: `DESIGN.md`. 앱 구조: `app/engine.js`(순수 로직), `app/ui.js`, `app/store.js`. 콘텐츠: `content/`.
`app/content.js`는 빌드 산출물이므로 직접 고치지 않는다.

## 새 모의고사 오답 추가 (가장 자주 하는 작업)

사용자가 "TPO5 오답 분석해서 추가해줘"처럼 요청하면 아래 순서를 따른다.

### 0. 입력 확인
- 캡처 위치: `../tpo오답/<YYYY-MM-DD>_<회차ID>/` (예: `../tpo오답/2026-10-20_TPO5/`). 회차 ID는 대문자·숫자만 (TPO5, MOCK1).
- 폴더나 날짜가 불분명하면 추측하지 말고 묻는다. 회차별 정답/오답 수(분모)도 화면에서 확인되는 것만 쓴다.
- 처음이면 `python3 tools/intake.py new <ID> <YYYY-MM-DD>` 로 `content/tests/<ID>.json`과 캡처 폴더를 만든다.

### 1. 캡처 전부 읽기 → 전사본 저장
- 모든 이미지를 직접 본다. 세트별 문항 번호 색(초록=정답, 빨강=오답)으로 성적을 센다.
- 각 오답마다 지문/스크립트 전문, 질문, 선택지 전부, 내가 고른 답(빨강), 정답(초록), 정답 키 설명(중국어면 번역)을 옮긴다.
- 원문 그대로 `content/tests/<ID>.screens.md` 에 저장한다 (출처 보존). 보이지 않는 글자는 `[unreadable]`.

### 2. 오답을 8개 능력으로 분류 (`content/skills.json`)
주 능력 1개 + 부 능력 0~2개. 문제 *유형*이 아니라 **틀리게 만든 판단 단계**로 고른다.

| 상황 | 주 능력 |
|---|---|
| C-Test에서 품사·시제·수·분사·병렬 자리 오류 | FORM |
| C-Test 어휘 복원·철자·collocation, Vocabulary 문제의 의미 강도·범주 | WORD |
| 본문/음성에 *있는* 사실이지만 질문의 대상·관계가 아님 (옛 정보, 다른 인과사슬, 세부를 주제로) | TARGET |
| 선택지에 근거 없는 요소가 덧붙음, 인과 방향 뒤집힘, 과잉 추론 | AUDIT |
| Insert Text, Author's/Speaker's Purpose (예시·문장의 기능) | ROLE |
| 다른 인물·개념·연도의 진짜 특징을 연결 (A의 특징을 B에) | BIND |
| Listen & Reply: 요청/제안/초대/사실확인/소식 기능 또는 시간축 불일치 | ACT |
| 대화·강의에서 정답 신호(I'll…, I'm looking for…, primary, describes, instead of, 장소·연도)를 놓침 | CATCH |
| 질문·답·선택지가 기록에 없어 판단 불가 | UNKNOWN |

### 3. `content/tests/<ID>.json` 작성
형식은 `content/originals.json`의 항목과 같다 (`_help` 참조). 규칙:
- `id`: `<ID>-R1`, `<ID>-L1` … 순서대로. `test`: 회차 ID. `sec`: R / L.
- 객관식: `options`(전부), `my`(내 답 인덱스), `correct`. C-Test: `ctest: {text: "…{{}}…", prefix, answer}`, `my`는 입력한 문자열.
- **모르는 값은 null + `gaps[]`에 이유.** 사용자의 생각을 단정하지 않는다.
- `evidence`: 지문/스크립트의 **원문 그대로** (빌드가 실제로 있는지 검사한다).
- `diff`(결정적 차이 한 줄) · `rule`(다음엔 무엇을 할지) · `trap`(왜 그럴듯했나 — AI 추정) · `causeAI`(추정 원인).
- 리스닝 오답: 스크린샷의 스크립트로 `audioSets`에 세트를 만들고 `audio`로 연결 (화자 N/W/M/W2/M2, 문장 단위로 나뉘어 녹음됨). `note`에 "스크린샷 스크립트로 재구성, 원본 음원 아님".
- `test`: `reading`/`listening`/`ctest` = `[정답, 전체]` 또는 null, `errors` = originals 개수.

### 4. 리포트 작성 (`report`)
- `headline`: 오늘 무엇 때문에 무엇을 틀렸는지 한 문장.
- `findings`: 능력별 발견 2~5개. `recurrence`: `repeat`(이전 회차에도 있음) / `new` / `improved`(그 능력 오답이 눈에 띄게 줄었을 때만).
- `next`: 다음 훈련 초점.
- 확인된 사실과 추정을 구분하고, 분모가 다른 유형끼리 개수로 실력을 단정하지 않는다. 공식 점수로 환산하지 않는다.

### 5. 검사·새 문제·빌드
```bash
python3 tools/intake.py check <ID>
```
- QA 실패를 모두 고친다. 출력의 "새 패턴" 능력은 transfer 문제가 충분한지 본다.
- 새 오류 패턴이 기존 문제로 훈련되지 않거나, 앱의 남은 새 문제가 25개 미만이면 `content/items_<ID>.json`에 새 transfer 문제를 쓴다 (형식: `content/items_extra.json`). 원본 문장·정답을 재사용하지 않는다. 정답 1개, `why[]`는 선택지마다, `evidence`는 지문 원문.
```bash
python3 tools/build.py
```
```bash
node --test tests/engine.test.js
```

### 6. 사용자에게 보고
- `python3 tools/intake.py report <ID>` 출력(Markdown)을 바탕으로 채팅에 리포트를 준다: 성적, 핵심 한 줄, 능력별 발견(재발/새 패턴), 오답 표, 다음 훈련.
- 앱을 새로고침하면 반영된다고 알린다: 새 오답은 원본 확인 단계로 오늘 훈련에 들어가고, **개선됨/유지됨 상태였던 능력에서 실전 오답이 나오면 자동으로 "재발"이 되어 다시 집중 대상**이 된다. 'TPO' 탭에서 회차별 비교를 볼 수 있다.

## 스피킹·라이팅 파트
- 코드 `app/sw.js`(UI)·`app/swcore.js`(순수 로직, `tests/swcore.test.js`), 콘텐츠 `content/sw.json`, 기록 키 `toefl-sw-v1` (오늘 훈련·단어 기록과 분리).
- 튜터 피드백을 새로 받으면 `grammar`에 `src: "튜터 M/D"`로 원문 그대로 추가한다. AI가 만든 문장·문제는 `AI 변형`/`AI 재구성`으로 구분한다.
- `lr`·`interview` 문장은 빌드가 음원(`audio/SW-*.mp3`)으로 만든다.

## 배포
- `main`에 푸시하면 GitHub Pages(https://taebin.link/toefl-coach/)가 자동 갱신된다. 저장소는 공개 — 키·토큰 등 비밀 값을 커밋하지 않는다 (jsonbin 키는 각 기기 브라우저에만 저장).
- claude.ai 버전은 `artifact.html` + app/* + audio/*를 Artifact로 다시 게시해야 갱신된다 (capabilities: db, user).
- 동기화 시험: `python3 tests/jsonbin_mock.py 8899` 후 `tests/sync-harness.html`을 localhost와 127.0.0.1 두 주소로 열어 두 기기처럼 확인.

## 원칙
- 확인된 사실 / AI 추정 / 기록 없음을 섞지 않는다. 기록에 없는 정보를 만들지 않는다.
- 학습 기록(브라우저 localStorage)은 건드리지 않는다. 데이터 변경은 `content/`로만.
- 콘텐츠를 바꾸면 항상 `tools/build.py`를 다시 돌린다 (QA + 음원 + 번들 + 캐시 갱신).
