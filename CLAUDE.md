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

## 리스닝 오답 다시 풀기 (소站 TPO独家, `#/listen`)
- 코드 `app/listen.js` (순수 로직 `ListenCore`, `tests/listen.test.js`), 기록 키 `toefl-listen-v1`.
- 자료는 원본 저작물이라 **공개 저장소에 올리지 않는다**: `private/zhan/` (gitignore) = 비공개 저장소 `ytb1124/toefl-coach-private`의 작업 사본.
  앱은 로컬 서버면 `private/zhan/listen.js`, 아니면 기기마다 넣은 읽기 전용 GitHub 토큰(`toefl-gh-token`, 동기화 안 함)으로 그 저장소의 `listen.json`·`audio/`를 읽는다.
- 새 회차 추가: 사용자의 크롬(Claude in Chrome)에서 `https://top.zhan.com/toefl/simulate/listentpo.html` → TPO独家 N '查看报告' 리포트를 열고 Vue 컴포넌트 props(`scoreData`·`tasks`)에서 오답 세트를 `private/zhan/Mock_Test_<N>_<workflowId>.json`으로 내보낸다 (형식은 기존 파일과 같게). 음원은 `audio/`에 받는다.
  각 오답은 앱의 같은 리스닝 원본(`content/originals.json` 등)과 질문 문장으로 자동 연결된다(`orig`). 리스닝 탭 풀이는 그 원본의 `tier: 'original'` 시도로 기록되고, 오늘 훈련의 원본 문제는 원본 음원으로 재생된다.
  → `python3 tools/zhan.py --todo`로 해설 없는 오답을 뽑아 한국어 해설을 `ko.json`에 추가 → `python3 tools/zhan.py` → `private/zhan`에서 커밋·푸시.

## 리딩 오답 다시 풀기 (소站 TPO独家, `#/read`)
- 코드 `app/read.js` (판정·순서는 `ListenCore` 재사용, 자료 로딩은 `app/listen.js`의 `ZhanData` 공용), 기록 키 `toefl-read-v1`.
- 자료: `private/zhan/reading/Mock_Test_<N>_<workflowId>.json` + `reading/ko.json` → `python3 tools/zhan_read.py` → `private/zhan/reading.js`·`reading.json` (비공개 저장소에 커밋·푸시).
- 리딩 리포트 workflowId는 리스닝과 다르다: toefl-mokao.zhan.com 페이지에서 `POST /mokaoapi/api/singleSubject/query_completed_practice_records` `{userId: sessionStorage.userId, platform:'BK', practiceType:1}`(1=리딩, 2=리스닝)로 목록을 받는다. 리포트 URL `newMock/report?paperId=&workflowId=&subject=read`.
- 지문 표기: C-Test 빈칸 `【n】`(앞 글자는 지문에 있음), 문장 삽입 위치 `[[iA]]`, 문장 고르기 표시 `[[sA]]`. 오답은 앱 리딩 원본과 질문 문장 / C-Test 단어로 연결된다.

## Build a Sentence 오답 (독점 TPO 라이팅 Task 1, `#/sw/bsz`)
- 말하기·쓰기 탭의 Build a Sentence 드릴을 `source: 'zhan'`으로 연다 (`app/sw.js` viewBs). 기록은 같은 `toefl-sw-v1`의 `bs`에 `Z<N>-BS<n>` 키로.
- 자료: 라이팅 리포트(`subject=write`, 목록은 practiceType 4)의 WritingTab props `tasks[0].questions` → `private/zhan/writing/Mock_Test_<N>_<wf>.json` (+ `writing/ko.json`) → `python3 tools/zhan_write.py` → `private/zhan/writing.js`·`writing.json`.
- 말풍선 A가 데이터에 없으면 해설 첫 줄/题干에서 영어 문장을 찾고, 정답 문장 자체면 버린다 (없으면 '기록 없음' 표시).

## 한국어로 풀어 보기 (`#/ko`, 오답 원인 가르기)
- 시험에서 틀린 독점 TPO 리딩·리스닝 세트를 한국어 번역으로 푼다. 한국어로 맞히면 '영어 이해 문제', 또 틀리면 '판단 문제' (어휘 문제는 진단 제외). 코드 `app/kotrial.js` (`tests/kotrial.test.js`), 기록 키 `toefl-ko-v1` (오늘 훈련 원본 기록과 섞지 않음).
- 자료: `private/zhan/kotrial/ko.json` (세트 id → 번역; 스크립트 줄·문항·보기 순서는 영어와 같게) → `python3 tools/zhan_ko.py` → `private/zhan/kotrial.js`·`kotrial.json`. 번역도 비공개 저장소에만.
- 번역 규칙: 정답 보기와 지문/스크립트의 표면 어휘가 영어보다 더 겹치지 않게 (정답이 드러나지 않게), 영어의 단서는 빠뜨리지 않게. 번역 후 독립 검토를 한 번 받는다.

## 단어 킵 (`#/keep`)
- 어느 화면에서든 영어 단어(1~4단어)를 선택하면 "+ 단어 킵" 버튼이 뜨고, 그 문장과 함께 저장한다. 단어장(`content/vocab`)에 있으면 뜻을 자동으로 채운다 (`VocabApp.lookup`, `content/vocab/patch.js`).
- 코드 `app/keep.js` (`tests/keep.test.js`), 기록 키 `toefl-keep-v1` (Sync로 동기화). '단어' 탭 위 카드에서 목록으로 간다.
- `app/vocab.js`는 빌드 생성 파일이다: 단어 화면 문구는 `content/vocab/source.html`·`patch.js`에서 고친다.

## 배포
- `main`에 푸시하면 GitHub Pages(https://taebin.link/toefl-coach/)가 자동 갱신된다. 저장소는 공개 — 키·토큰 등 비밀 값을 커밋하지 않는다 (jsonbin 키는 각 기기 브라우저에만 저장).
- claude.ai 버전은 `artifact.html` + app/* + audio/*를 Artifact로 다시 게시해야 갱신된다 (capabilities: db, user).
- 동기화 시험: `python3 tests/jsonbin_mock.py 8899` 후 `tests/sync-harness.html`을 localhost와 127.0.0.1 두 주소로 열어 두 기기처럼 확인.

## 원칙
- 확인된 사실 / AI 추정 / 기록 없음을 섞지 않는다. 기록에 없는 정보를 만들지 않는다.
- 학습 기록(브라우저 localStorage)은 건드리지 않는다. 데이터 변경은 `content/`로만.
- 콘텐츠를 바꾸면 항상 `tools/build.py`를 다시 돌린다 (QA + 음원 + 번들 + 캐시 갱신).
