# TOEFL 5.0 오답 교정 코치 — 설계서

> 대상: TPO 2·3·4에서 확인된 오답 63개 (Reading 31 / Listening 32)
> 원칙: **실제 오답 분석 → 부족한 능력 정의 → 교정 행동 → 학습 경험 → UX → 구현**
> 표기: **[확인]** 보고서·채점·사용자 발언으로 확인 / **[추정]** 답안 패턴에서 추론 / **[가정]** 설계를 위해 세운 가정 / **UNKNOWN** 기록 없음

이전 웹사이트(v5 zip, 이전 학습기록 JSON)는 참고하지 않았고 코드·데이터 구조·흐름을 재사용하지 않았다.
(이전 JSON에는 시도 5건뿐이라 가져오지 않았다. 다만 그 안의 한 기록 — TPO2 fascinating 빈칸을 다시 풀 때 명사 `fascination`을 입력해 또 틀린 것 — 은 아래 FORM 진단과 일치한다는 점만 기록해 둔다.)

---

## PART 1. 실제 학습자 진단

### 1-1. 확인된 성적 (공식 점수 환산 금지)

| 회차 | Reading | C-Test | Listening | 오답 |
|---|---|---|---|---|
| TPO2 (10-02) | 24/37 (64.9%) | 13/20 | 16/24 (66.7%) | 21 |
| TPO3 (10-08) | 23/33 (69.7%) | 14/20 | 전체 분모 UNKNOWN | 20 |
| TPO4 (10-12) | 20/28 (71.4%) | 16/20 | 23/37 (62.2%) | 22 |

유형별로 분모가 확인되는 부분만 합산:

| 유형 | 정답/전체 | 메모 |
|---|---|---|
| C-Test | 43/60 (71.7%) | 65 → 70 → 80%. 오답의 성격이 TPO2·3은 **형태(문법)**, TPO4는 **어휘 복원** |
| Listen & Reply | 24/28 (TPO2+TPO4+TPO3 한 세트) | TPO3에는 분모 미상의 추가 오답 7개 → 이 유형의 실제 정답률은 **산출 불가** |
| Academic Talk | 17/32 (53%) | TPO3 Q4는 내용 UNKNOWN |
| Conversation | 5/10 | TPO2 1/2 + TPO4 4/8 |
| Insert Text | 오답 3 (분모 확인분 0/2) | TPO3 0/2, TPO4 오답 1(분모 UNKNOWN), TPO2 자료 없음 |

### 1-2. 오답 63개 → 8개 능력(Skill)으로 재분류

문제 *유형*(Vocabulary, Detail…)이 아니라 **틀리게 만든 판단 단계**로 분류했다. 한 오답이 여러 능력에 걸칠 수 있어 주(primary)·부(secondary)를 구분한다.

| Skill | 정의 | 주 | 부 | 대표 근거 (회차-번호) |
|---|---|---|---|---|
| **FORM** 자리→형태 | C-Test에서 빈칸의 문법 자리(본동사/분사/부사/명사)를 먼저 정하고 형태를 만든다 | 7 | 1 | 2-R1 fascinating, 2-R10 contributing, 2-R11 richness, 3-R1 involves, 3-R2 comprehending, 3-R3 encompassing, 3-R6 continuously |
| **WORD** 의미 검증 | 완성/선택한 단어가 *구 전체*의 의미·강도·결합에 맞는지 검증 | 13 | 1 | 4-R1 resident↔residue, 3-R7 vents↔veins, 3-R8 catch↔carry, 2-R3 dawns↔dates back, 4-R6 mitigate↔eliminate, 2-R12 distinction↔recognition, 3-R4 query↔complaint |
| **TARGET** 질문 표적 고정 | 본문에 있는 *사실*이 아니라 질문이 *묻는 것*에 답하는 선택지를 고른다 | 6 | 2 | 2-R4 library, 2-R5 food security, 2-L6 distinguishes, 3-L7 change(instead of), 4-L12 main idea, 4-L9 innovations |
| **AUDIT** 선택지 끝까지 검증 | 선택지의 모든 요소(주어·관계·수식어·방향)가 근거로 뒷받침되는지 확인 | 4 | **8** | 2-R6 인과 역전, 2-R7 controversial, 2-R13 stability, 2-L3 salinity, 3-R9 과잉결론, 4-R5 구매자, 4-L2 첫 모임, 4-L7 두 의사 |
| **ROLE** 문장·예시의 역할 | 예시/삽입문이 글에서 하는 기능(예시·요약·해결책·지시)을 먼저 판정 | 7 | 0 | 3-R5·3-R10·4-R8 Insert, 2-R7·3-R9·4-R7 Purpose, 2-L5 Rushdie |
| **BIND** 대상↔특징 결합 | 여러 인물/개념이 나올 때 각 특징이 *누구 것인지* 묶어서 유지 | 8 | 2 | 4-L5·L6 리더십 3유형, 4-L13 green roof↔asphalt, 2-L7·L8 사회화 기관, 2-L4 고양이(행동 주체), 2-R13 REM↔slow-wave, 4-L14 1760 |
| **ACT** 발화 기능→응답 | 짧은 발화를 요청/제안/초대/사실확인/소식으로 분류하고 기능·시간축이 맞는 응답 선택 | 9 | 0 | 3-L1~L6, 3-L9, 4-L1, 4-L10 |
| **CATCH** 결정 신호 포착 | 정답을 결정하는 신호 문장(I'll…, I'm looking for…, primary, describes, instead of, 날짜)을 실시간으로 잡아 유지 | 8 | 3 | 4-L3 Lakeside Park, 4-L4 learn more, 4-L11 look online, 4-L7 accidentally, 2-L3 acidic, 2-L7 primary, 3-L8 definition |
| UNKNOWN | 3-L10 (문항 내용 없음) | 1 | – | 분석에서 제외 |

합계: 7+13+6+4+7+8+9+8+1 = **63** (데이터: `content/originals.json`, 모든 항목에 출처와 UNKNOWN 표시)

### 1-3. 핵심 진단

**[확인] 가장 비싼 오류는 "이해 실패"가 아니라 "선택 단계"의 실패다.**
TARGET + AUDIT를 합치면 주·부 포함 20건이 R/L 양쪽, 세 회차 모두에서 나온다. 고른 오답 대부분이 *본문에 실제로 있는 말* (located, carbon emissions, group grade, correcting mistakes, store heat at night) 이거나 *그럴듯한 한 요소가 덧붙은 말* (controversial, stability, formation, two doctors)이다.

**[확인] Listening 손실은 짧은 응답보다 다중 정보 유지 쪽이 크다.**
Academic Talk 17/32, Conversation 5/10 vs Listen & Reply 확인 세트 24/28. 그리고 BIND 오답은 모두 *강의에 실제로 나온 다른 대상의 특징*을 고른 것이다. 사용자 발언("스크립트를 보면 대부분 이해된다", "길어지면 앞부분을 잊는다")과 일치한다 — 그러나 각 문제의 원인이 기억이었다는 것은 **[추정]**이다.

**[확인] ACT는 TPO3에 집중**(9개 중 7개). TPO4에서는 11/13으로 회복세 — 이미 개선 중일 수 있으므로 *새 문제로 먼저 검증*하고 통과하면 비중을 줄인다.

**[확인] C-Test는 개선 추세(65→70→80%)이지만 오류 성격이 바뀌었다.** TPO2·3 형태 오류 7개 → TPO4 어휘 복원 4개(그중 3개는 입력값 UNKNOWN). FORM은 새 문제 검증으로 빠르게 확인, WORD는 장기 과제.

### 1-4. 추가 검증이 필요한 영역 (약점으로 단정 금지)

| 영역 | 이유 |
|---|---|
| 인과 방향 역전 | 1건(2-R6). AUDIT 안의 하위 체크로만 훈련 |
| Main Idea | 1건(4-L12). Reading Main Idea 자료 없음 |
| 난이도↔정답률 인과 | 유형·문항 수가 달라 비교 불가 |
| 시간 압박 | 기록 전무 → 시간 제한 훈련을 우선하지 않음. 앱이 응답시간을 기록해 검증 |
| 전반적 어휘량 부족 | 직접 "몰랐다"고 한 단어 0개. 확정 불가 |
| Speaker's Purpose (L) | 1건(2-L5) |
| 3-L10, 2-L1 원인 | 원문·스크립트 없음 |

---

## PART 2. 학습과학 전략

선택한 원리 7개와 버린 것. "연구 근거"와 "이 앱의 설계 가정"을 구분한다.

| 원리 | 근거 수준 | 겨냥 약점 | 앱에서의 행동 | 측정 | 주의점 |
|---|---|---|---|---|---|
| **Retrieval practice** (먼저 꺼내기) | 강함 (testing effect, 다수 메타분석) | 전부 | 해설 전에 *항상* 먼저 답하게 함. 원본 오답도 다시 판단부터 | 첫 시도 정답률 | 이미 본 원본 문제는 답을 *기억*해서 맞힐 수 있음 → 원본 재정답은 숙달 지표에서 제외 |
| **Error-based learning + 대조 피드백** | 중~강 (hypercorrection, errorful generation) | TARGET, AUDIT, WORD | "내 답 vs 정답" 나란히 놓고 *결정적 차이 1줄* 제시 | 같은 함정 유형 재발률 | 원인 단정 금지 → 사용자가 원인 확인 |
| **Deliberate practice + 단계형 스캐폴딩 후 제거** | 중 (worked-example → fading) | FORM, ROLE, ACT, BIND | Guided 문제에서 절차를 단계로 쪼갬(자리 먼저 → 철자), Transfer에서 제거 | Guided→Transfer 정답률 격차 | 스캐폴딩이 길면 시험 실전 속도와 괴리 |
| **Transfer (새 문제)** | 강함: 전이는 *원리를 새 맥락에 적용해 본 경우에만* 잘 일어남 | 전부 | 모든 숙달 판정은 새 지문·새 음원으로만 | Transfer 정답률 | 생성 문제 품질이 곧 측정 품질 → QA 필수 |
| **Spacing** | 강함 | 개선된 Skill | 개선 판정 후 지연 확인. 간격은 시험까지 남은 날에 비례 | Delayed 정답률 | 시험이 가까워 긴 간격 불가 → 1~4일 압축 |
| **Interleaving** | 중 (유형 *구분*이 필요한 과제에서 효과) | TARGET vs AUDIT vs ROLE, ACT 기능 분류 | 세션 마지막 "섞어 풀기" 블록 | 섞인 상태 정답률 | 초기 학습에는 부담 → 블록 학습 후에만 |
| **Metacognition (확신도)** | 중 | "확신하고 틀림" | 매 Transfer 문항에 확신도 1–3 입력 | 고확신 오답률 | 확신도 자체를 점수로 보지 않음 |
| Cognitive load 관리 | 원칙 | Listening | 한 화면 한 행동, 텍스트 최소, 해설은 접기 | 세션 완료율 | — |

**버린 것**: 게임화·레벨·포인트(학습 효과 근거 약하고 활동량을 실력으로 착각하게 함), 대형 대시보드, 단어장(직접 "모른다"고 확인된 단어가 0개 — 단어는 WORD Skill 안의 *대조쌍*으로만 다룸), 일괄 1-3-7일 복습(시험 D-8 상황에 맞지 않음).

**[가정]** 8일~14일 안에 측정 가능하게 바뀔 수 있는 것은 *판단 절차*(TARGET/AUDIT/FORM/ACT/ROLE)이고, 어휘량·청취 처리속도(WORD/CATCH 일부)는 느리게 바뀐다. 그래서 우선순위에 "단기 개선 가능성" 계수를 둔다. 이 계수는 연구값이 아니라 설계 가정이며 데이터가 쌓이면 실제 Transfer 개선 속도로 대체된다.

---

## PART 3. 핵심 학습 경험 (Q1–Q10 답 + 루프)

| 질문 | 결정 |
|---|---|
| Q1 원본 오답부터? | **예, 단 한 번, 짧게.** 원본은 *오류를 확인·명명*하는 용도. 반복 대상 아님 |
| Q2 해설 즉시? | **아니오.** 먼저 다시 판단(retrieval) → 그다음 대조 피드백. 단, 원본 재판단 후에는 *즉시* 피드백 (지연 피드백은 이 기간엔 이득보다 혼란이 큼) |
| Q3 원인은 AI vs 사용자? | **AI가 후보를 제시, 사용자가 확정.** 화면에 "AI 추정"과 "내가 확인" 라벨 분리. 사용자가 "모르겠음"도 선택 가능 |
| Q4 문법 오류와 추론 오류 같은 방식? | **아니오.** FORM/WORD = 생성(직접 입력)·자리 예측 / TARGET·AUDIT = 선택지 감사(각 선택지에 판정 태그) / ROLE = 기능 태깅→위치 / BIND = 대상-특징 매칭 / ACT = 기능 분류→응답 / CATCH = 1회 청취 후 신호 회상 |
| Q5 원본 반복 횟수? | **1회 재판단 + 지연 1회(선택)**. 원본 정답은 기억 가능하므로 숙달 판정에 넣지 않음 |
| Q6 새 문제는 언제? | **같은 세션 안에서 즉시.** 원본 확인 → 규칙 → Guided 2~3 → Transfer 3 |
| Q7 해결 판단 기준? | 최근 Transfer 5개 중 4개 이상 정답 + 힌트 미사용 + 2개 이상 세션에 걸쳐 + 그중 고확신 오답 0 → **개선됨**. 이후 지연 확인 통과 → **유지됨** |
| Q8 다시 악화되면? | 상태 **재발**로 전환, 우선순위 ×1.5, 원본 대조 카드 재노출 없이 *Guided 1개 → Transfer*로 바로 복귀 (원리 재학습보다 재적용) |
| Q9 세션당 능력 수? | **집중 2개 + 유지 확인 0~3개.** (40분 기준. 60분 이상이면 집중 3개) |
| Q10 남은 기간 짧을 때? | D-4 이후: 새 Skill 도입 금지(우선순위 상위 제외), 섞어 풀기 비중 ↑, 이미 개선된 Skill은 지연 확인만. D-1: 섞어 풀기 + 시험 직전 경고 카드만 |

### 하루 세션 루프 (기본 40분)

```
[0] 오늘 화면: "왜 이 2개인가" 한 줄 근거 → 시작 버튼 하나
[1] 유지 확인 (≈5분)    : 개선/유지 상태 Skill의 지연 문제. 힌트 없음. 틀리면 재발 처리
[2] 집중 Skill A (≈15분)
     2a 원본 재판단   : 처음 1회만. 원본 문제를 다시 결정 → 대조 카드 → 원인 확정
     2b 움직임(Move)  : 이 Skill의 3단계 절차 1장 (읽고 끝이 아니라 바로 적용)
     2c Guided ×2~3   : 절차가 단계로 쪼개진 새 문제. 힌트 가능
     2d Transfer ×3   : 새 문제, 스캐폴딩 없음, 확신도 입력 → 숙달 판정 근거
[3] 집중 Skill B (≈15분) : 동일
[4] 섞어 풀기 (≈5분)     : A·B + 과거 Skill에서 1문제씩 섞어서
[5] 마무리              : 오늘 바뀐 상태만 (예: "AUDIT: 훈련 중 → 검증 대기"), 내일 예고
```
언제든 나가도 현재 단계가 저장되고, 다시 들어오면 그 문제부터 이어진다.

---

## PART 4. Skill별 훈련 시스템

각 Skill: ① 실제 오답 ② 교정할 능력 ③ 훈련 방식 ④ 화면 ⑤ 학습자 행동 ⑥ 피드백 ⑦ 새 문제 검증 ⑧ 완료 기준

### FORM — 빈칸 자리 → 형태 먼저
1. `Cognition involv__ the mental…` → involved (정답 involves), `acquiring and compre___` → compremention (comprehending), `…, encompa___ perception` → encompasses (encompassing), `works contin___` → continueous (continuously), `One fasci___ fossil` → fascilicate, `…, contribution to` → contributing, `the rich___ of` → richment
2. 단어를 떠올리기 *전에* 자리를 판정: 본동사가 이미 있는가? and 앞뒤 병렬? 동사를 꾸미는가? 관사+___+of?
3. **자리 예측 → 생성(타이핑)**. 객관식이 아닌 직접 입력 (C-Test 실전과 동일한 생성 과제)
4. 화면: 문장 1~2개, 빈칸에 접두 철자 표시. Guided는 위에 `자리: [명사][본동사-s/ed][V-ing/분사][부사][형용사]` 칩
5. 칩 선택 → 철자 입력 → 확인
6. 자리가 틀렸으면 *자리 근거*부터 ("앞에 본동사 involves가 이미 있음 → 두 번째 동사 불가 → 분사"). 자리는 맞고 철자만 틀리면 "자리 OK, 철자"로 구분해 기록
7. 새 지문 C-Test 문장에서 칩 없이 입력
8. Transfer 5개 중 4개 + 자리 오류 0

### WORD — 의미 검증 (C-Test 어휘 + 의미 정밀도)
1. resident/residue, vents/veins, catch/carry blood, dawns/dates back, la(s)/late, shap(e), mitigate→eliminate, distinction→recognition, urgent queries→complaints
2. 철자에 맞는 *아무 단어*가 아니라 **구 전체**(plant ___, ___ blood, ___ the impact)에 맞는지 검증. 동의어는 *강도·범주* 차이로 구분
3. **대조쌍 판단 + 생성**: 같은 접두에서 갈라지는 두 단어를 두 문장에 배치 / 동의어 선택지의 "강도 축" 판정
4. 화면: 문장 + 빈칸 또는 밑줄 단어 + 선택지
5. Guided: 먼저 "이 구가 말하는 것"(예: 고고학 유물의 종류)을 고르고 → 단어 결정
6. "내 단어를 넣으면 문장이 무슨 뜻이 되는가"를 한 줄로 보여줌 (plant resident = 식물 거주자?!)
7. 처음 보는 대조쌍·처음 보는 문장
8. Transfer 5개 중 4개. (장기 과제: 개선 판정 기준 동일하지만 우선순위 계수 낮음)

### TARGET — 질문이 묻는 것만
1. library (located는 이미 알려진 사실), food security (carbon emissions = 다른 인과사슬), distinguishes from fantasy (social issues), change (instead of A → B), main topic (energy = 결과 중 하나), innovations → popularity
2. 질문의 **표적(대상+관계)**을 먼저 고정하고, "참이지만 표적 밖" 선택지를 제거
3. **선택지 감사(Option audit)**: 각 선택지에 `✓ 표적에 답함 / ↗ 사실이지만 표적 밖 / ✗ 근거 없음` 태그
4. 화면: 지문(또는 음원) → 질문 → "이 질문의 표적은?" 1단계 → 선택지 태깅 → 최종 선택
5. 표적 고르기 → 각 선택지 태깅 → 답
6. 태그별로 피드백: "B는 본문에 있다(↗) — 하지만 질문은 X를 물었다"
7. Transfer는 태깅 없이 바로 답 (실전 조건)
8. Transfer 4/5, ↗ 함정 선택 0

### AUDIT — 선택지 끝까지 검증
1. controversial(근거 없음), emotional *stability*, salinity, glacier *formation*, recently *purchased*, *first* meeting, *two doctors*, 인과 역전(nutrients), 과잉 결론(hazardous roads)
2. 선택지를 요소로 쪼개 **각 요소의 근거** 확인. 특히 마지막 수식어와 관계 방향
3. **오류 찾기**: 선택지에서 근거 없는 단어를 *탭*해서 지목
4. 화면: 지문 + 선택지 1개 → "이 선택지에서 근거 없는 부분을 탭"
5. 단어 탭 → 결과 확인 → 이어서 실제 4지선다
6. "stability — 본문은 emotional *memory*였다"처럼 *그 단어*만 지적
7. Transfer 4지선다 (태깅 없이)
8. Transfer 4/5

### ROLE — 문장·예시의 역할
1. Insert ×3 (solution 문장, In short 요약, This dynamic process 지시), Purpose ×3 (genetic engineering, calm/stressed driver, fish habitats), Rushdie/Kundera
2. 문장의 **기능**을 먼저 판정 → 앞 문장과의 관계로 위치·목적 결정
3. **기능 태깅 → 지시 대상 찾기 → 위치/목적 선택** (단계형)
4. 화면: 짧은 지문(■ 위치 표시) + 삽입문
5. 기능 칩 선택(요약/예시/해결책/결과/대조/지시) → "This X가 가리키는 것" → ■ 선택
6. "In short = 요약 → 요약할 내용(single driver → ripple)이 바로 앞에 있어야 함"
7. 새 지문 Insert/Purpose, 단계 없이
8. Transfer 4/5

### BIND — 누구의/무엇의 특징인가 (Listening 중심)
1. Transformational↔Transactional↔Servant, green roofs↔asphalt, Family/School/Peers/Religion, 남자↔여자 다음 행동, REM↔slow-wave, East India Company↔tea bags, 1760↔1769
2. 들으면서 **대상 → 특징** 쌍으로 묶어 유지
3. **새 강의 1회 청취 → 매칭표 채우기 → TOEFL형 질문**. 노트는 허용(실전과 동일)
4. 화면: 재생 버튼(1회 제한, 연습 모드에서만 다시 듣기), 노트 칸 → 청취 후 표: 특징마다 대상 선택
5. 듣기(노트) → 매칭 → 질문
6. 틀린 매칭은 스크립트의 해당 문장을 하이라이트해서 보여줌 ("Servant leadership **prioritizes the needs of employees**")
7. 새 강의, 매칭 단계 없이 질문만
8. Transfer 질문 4/5 (강의 2개 이상에 걸쳐)

### ACT — 말의 기능 → 응답
1. Can you help…? → I appreciate the offer / Exactly (요청인데 제안·동의 응답), Let's… → 장소 질문, Were you able…? → later this afternoon (시간축), starts Saturday → I missed it, Isn't the library hosting…? → Sure, why not?, Would you like to join…? → Is it committee work?
2. 발화를 먼저 **기능**(요청/제안/초대/사실확인/소식·감상/시간질문/결과질문)과 **시간축**(과거/지금/미래)으로 분류
3. **1회 듣기 → 기능 분류 → 응답 선택** (Guided), Transfer는 듣고 바로 응답
4. 화면: 재생 버튼만. 문장 텍스트는 답한 뒤 공개
5. 듣기 → 기능 칩 → 응답
6. "요청에는 수락/거절. 'I appreciate the offer'는 *제안을 받은* 사람의 말"
7. 새 발화 (음원)
8. Transfer 5개 중 4개 (TPO4에서 이미 11/13이므로 빠른 검증 → 통과 시 비중 축소)

### CATCH — 결정 신호 포착 (Conversation/Lecture)
1. Lakeside Park, I'm looking for a place to learn more, I'll look online, accidentally, In more acidic waters, the primary, the most fundamental, It describes the conflict…, Instead of…, started around 1760
2. 정답이 걸리는 **신호 표현**(목적: I'm looking for / 다음 행동: I'll… / 정의: describes·refers to / 강조: primary·most / 변화: instead of / 시점: started)을 실시간으로 잡아 유지
3. **1회 청취 → 질문** + 피드백에서 신호 문장 하이라이트 + "어떤 신호였나" 회상 단계(Guided)
4. 화면: 재생, 노트 → 질문
5. 듣기 → 질문 → (Guided) 신호 문장 고르기
6. 스크립트에서 신호 문장만 강조. 나머지는 접힘
7. 새 대화/강의 음원
8. Transfer 4/5

---

## PART 5. UX / 정보 구조

### 사용자 행동 정의 → 화면
| 사용자의 질문 | 답하는 곳 |
|---|---|
| 오늘 무엇을? 왜? | **오늘** 화면 1장: 집중 Skill 2개 + 각 근거 1줄 |
| 지금 무엇을? | **세션** 화면: 한 화면에 한 행동, 버튼 1개 |
| 개선되고 있는가? | **변화** 화면: Skill별 상태 + Transfer 결과 점(●○) |
| 다음엔? | 세션 마지막 화면 + 오늘 화면 |
| 왜 틀렸나? | Skill 상세 → 원본 오답 카드 |

메뉴는 **오늘 / 변화 / 설정** 3개. 문제은행·단어장·통계·레벨은 없다 (PART 2 근거).

### 와이어프레임

```
┌ 오늘 ─────────────────────────────┐
│ D-8 · 10월 26일 시험               │
│                                    │
│ 오늘의 훈련 · 약 40분              │
│ ① 질문이 묻는 것만  (TARGET)       │
│   3개 회차, R·L 양쪽에서 6회        │
│   새 문제 정답 아직 없음            │
│ ② 누구의 특징인가 (BIND)           │
│   리더십·열섬·사회화 강의 8회       │
│ + 유지 확인 1개 (FORM)              │
│                                    │
│ [        시작하기        ]          │
│                                    │
│ 지금 상태  FORM ●●●●○ 개선됨        │
│           ACT  ●●○   검증 중       │
│           …                        │
└────────────────────────────────────┘

┌ 세션 · Transfer ── 7/18 ──────────┐
│ ━━━━━━━━━━░░░░░░░░                 │
│ 새 문제 · 질문이 묻는 것만          │
│                                    │
│ [지문 4~6문장]                      │
│                                    │
│ Q. According to the passage, how…  │
│ ○ A …                              │
│ ○ B …                              │
│ ○ C …                              │
│ ○ D …                              │
│ 확신도  [찍음] [보통] [확신]         │
│ [ 확인 ]                            │
└────────────────────────────────────┘

┌ 피드백 ───────────────────────────┐
│ ✗  내 답 B · 정답 D                │
│ 결정적 차이: B는 본문에 있지만      │
│ "환경" 얘기. 질문은 "식량 안보".    │
│ 근거: "…a steady supply of fresh…" │
│ ▸ 자세히 (왜 B가 그럴듯했나)        │
│ [ 다음 ]                            │
└────────────────────────────────────┘

┌ 원본 오답 대조 ───────────────────┐
│ TPO2 · Reading · Daily Life        │
│ 내가 고른 답   Whether an item was  │
│               located   [확인]      │
│ 정답          Whether an order was │
│               placed               │
│ 차이  located는 이미 알려준 사실.   │
│       요청은 "If you have already  │
│       ordered…, let us know"       │
│ 왜 그럴듯했나 (AI 추정) …            │
│ 이 원인이 맞나요?                   │
│ [맞음] [다른 이유] [모르겠음]        │
└────────────────────────────────────┘
```

- 모바일 우선 단일 컬럼, 최대 폭 720px. 데스크톱에서도 같은 단일 컬럼 (집중)
- 해설은 기본 1~2줄, "자세히"로 펼침
- 오디오: 연습 모드(Guided)는 다시 듣기 허용, Transfer는 1회 재생(실전 조건). 재생 횟수 기록
- 진행 중 이탈 → 다음 접속 시 "이어하기" 하나만 노출

---

## PART 6. 개인화 커리큘럼

### 우선순위 점수 (매일 재계산)

```
priority(s) = evidence(s) × need(s) × gain(s) × stateFactor(s)

evidence = Σ_오답 [ (주 1.0 | 부 0.5) × 최근성(TPO4 1.0, TPO3 0.85, TPO2 0.7) × (내 답 UNKNOWN이면 0.5) ]
           + 0.5 × (등장 회차 수 − 1)                     // 재발성
need     = 1 − p,  p = (Transfer·Delayed 최근 8개 정답 + 1) / (개수 + 2)   // 데이터 적을 때 0.5 출발
gain     = 단기 개선 가능성 [가정]: FORM 1.2, ACT 1.1, TARGET 1.2, AUDIT 1.2, ROLE 1.0, BIND 1.0, CATCH 0.9, WORD 0.6
stateFactor = 새로움 1.0 · 훈련 중 1.0 · 검증 중 0.9 · 개선됨 0.3 · 유지됨 0.15 · 재발 1.5
```
- 오답 *개수*만 쓰지 않는 이유: 분모가 다른 유형(ACT는 분모 미상)을 개수로 비교하면 왜곡 → `need`가 새 문제 실적으로 곧바로 교정한다.
- 분모를 모르는 근거는 화면에 "정답률 산출 불가 · 오답 n개"로 표기.

### 세션 구성 규칙
1. 집중 Skill = 처음 보는 Transfer 문제가 남아 있는 Skill 중 우선순위 상위 2개 (분 ≥ 60이면 3개). 새 증거를 만들 수 없는 Skill은 집중 대상에서 뺀다. 상위 두 개가 둘 다 Listening이면 2위 대신 최상위 Reading Skill과 점수 차 15% 이내일 때 교체 (피로 분산 [가정])
2. 유지 확인 = 개선/유지 상태에서 `dueAt ≤ 오늘`인 Skill 각 1문제
3. 시간 예산: 문항별 예상 시간(C-Test 0.5분, 독해 1.5분, 삽입 2분, 짧은 응답 0.5분, 대화 2분, 강의 4분)으로 Guided·Transfer 개수를 조정
4. **D-4 이하**: `새로움` Skill은 우선순위 상위 1개만 허용, 섞어 풀기 2배. **D-1**: 섞어 풀기 + 경고 카드만
5. 문제 고갈: Transfer 풀이 바닥나면 가장 오래전에 푼 Transfer 재출제 → 이 결과는 *Retention*으로만 기록하고 Transfer 지표에서 제외

### 일정 예시 — 실제 알고리즘 출력 (`node tools/simulate.js`)

아래는 손으로 쓴 계획이 아니라, 실제 엔진에 **가상의 학습자 모델**(새 문제 시작 정답률 55~75%, 훈련한 날마다 +6%p — 설계 가정)을 넣어 돌린 결과다. 실제 사용 시에는 사용자의 답에 따라 매일 달라진다.

**시험 D-8 (현재 상황, 하루 40분)**

| 일 | 유지 확인 | 집중 | 섞어 | 새 문제 | 상태 변화 |
|---|---|---|---|---|---|
| 1 (D-8) | – | ACT + AUDIT | 3 | 10/15 | 여러 Skill 검증 중으로 |
| 2 (D-7) | – | CATCH + TARGET | 3 | 11/15 | CATCH 개선됨 |
| 3 (D-6) | – | WORD + TARGET | 3 | 9/13 | TARGET 개선됨 |
| 4 (D-5) | CATCH | AUDIT + FORM | 3 | 14/17 | FORM·WORD·BIND 개선됨, CATCH 재발 |
| 5 (D-4) | FORM, WORD, BIND | CATCH + AUDIT | 6 | 15/20 | ROLE·ACT 개선됨 |
| 6 (D-3) | ROLE, BIND, ACT | CATCH | 6 | 9/15 | FORM·TARGET·BIND 재발 |
| 7 (D-2) | WORD, CATCH | BIND + FORM | 6 | 13/19 | 재발 Skill 재검증 |
| 8 (D-1) | CATCH, WORD, ACT | – | 8 | 9/12 | 섞어 풀기 + 유지 확인만 |

읽는 법: 첫날은 근거가 가장 큰 ACT·AUDIT. 개선되면 집중에서 빠지고 *유지 확인*으로 돌아온다. 유지 확인에서 틀리면 *재발*로 다시 집중 후보가 된다. D-4부터 섞어 풀기 비중이 커지고, D-1에는 새 Skill 훈련 없이 섞어 풀기와 유지 확인만 한다.

**14일로 늘리면**: 현재 문제 풀(Transfer 채점 문항 133개)은 하루 15문항 소비 기준 **약 8~9일분**이다. 그 뒤에는 이미 푼 문제가 "다시 풀기"(전이 지표 제외)로만 나오므로, 14일 계획이라면 `content/items_*.json`에 문제를 추가해야 한다 (오늘 화면이 남은 수를 경고한다).

---|---|---|---|---|
| 1 | – | TARGET | BIND | 원본 대조 각 3~4개 |
| 2 | – | AUDIT | ACT | ACT는 빠른 검증: 통과 시 비중↓ |
| 3 | – | FORM | CATCH | |
| 4 | TARGET | ROLE | BIND | BIND 두 번째 강의 |
| 5 | AUDIT | WORD | TARGET | TARGET 아직 3/5면 계속 |
| 6 | FORM, ACT | BIND | AUDIT | |
| 7 | TARGET | CATCH | ROLE | 주간 점검: 섞어 풀기 10문항 |
| 8 | BIND | 하위 2개 재계산 | | 개선된 Skill은 유지 확인만 |
| 9–10 | 만기 Skill | 재발/미달 Skill | | |
| 11 (D-4) | 만기 전부 | 미달 1개 | – | 새 Skill 금지, 섞어 풀기 ×2 |
| 12–13 | 전부 1문제씩 | 섞어 풀기 15문항 | | 고확신 오답만 재훈련 |
| 14 (D-1) | – | – | – | 섞어 풀기 + 시험 직전 경고 카드 |

---

## PART 7. 복습·숙달

### 상태 (Skill 단위)

| 상태 | 정의 | 다음 상태로 |
|---|---|---|
| 새로움 NEW | 원본 대조 미완 | 원본 오답(분석 가능한 것) 대조 + 원인 확인 완료 → 이해 |
| 이해 UNDERSTOOD | 원인을 확인함 | Guided 1개 이상 시도 → 훈련 중 |
| 훈련 중 PRACTICING | Guided 단계 | Guided 최근 3개 중 2개 정답 → 검증 중 |
| 검증 중 VERIFYING | Transfer 단계 | 최근 Transfer 5개 중 4개, 힌트 0, 2개 세션 이상, 고확신 오답 0 → 개선됨 |
| 개선됨 IMPROVED | 새 문제에서 독립 수행 확인 | 지연 확인(간격 후) 정답 → 유지됨 / 오답 → 재발 |
| 유지됨 RETAINED | 시간이 지나도 수행 | 다음 지연 확인 오답 → 재발 |
| 재발 RELAPSED | 개선 후 다시 틀림 | Transfer 연속 2개 정답 → 검증 중 |

검증 중에 Transfer 최근 5개 중 2개 이하면 → 훈련 중으로 되돌림.

### 간격 (시험 날짜 연동)
```
첫 간격 = clamp(round(남은날 / 4), 1, 3) 일
성공 시 간격 ×2 (단, 시험 전날을 넘지 않게)
재발 시 다음날
```
1-3-7 고정 간격을 쓰지 않는 이유: D-8에서 7일 간격은 시험 후가 된다. 그리고 간격 대상은 *원본 문제*가 아니라 *Skill*(매번 다른 새 문제)이다.

### 원본 오답 상태 (별도)
`미확인 → 대조함 → 원인 확인함(사용자) / 원인 미상`. 원본 재정답은 기록만 하고 숙달 판정에 쓰지 않는다.

### 시도 1건이 반영되는 방식
| 신호 | 사용 |
|---|---|
| 정답 여부 | 상태 전환 |
| 확신도 | 고확신 오답 = 숙달 차단 + 섞어 풀기 재출제 |
| 힌트 사용 | 힌트 쓴 Transfer는 숙달 계산에서 제외 |
| 새 문제 여부 | Transfer/Delayed만 숙달 지표 |
| 응답 시간 | 기록·표시만 (시간 압박 근거가 없으므로 판정에 쓰지 않음, 데이터 확보용) |
| 반복 오류 | 같은 함정 태그(↗ 표적 밖 등) 선택이 2회면 피드백에 "같은 함정 2번째" 표시 |

---

## PART 8. 데이터 구조

```
Test        { id:'TPO2', date:'2026-10-02', scores:{reading:{c,n}, listening:{c,n}|UNKNOWN, ctest:{c,n}} }
Original    { id:'TPO2-R4', test, section:'R'|'L', setTitle, qType, stem, context, my|null, correct,
              evidence, trap(AI 추정), diff, rule, skills:{primary, secondary[]}, gaps[], source,
              audio?:{segments[], note:'발췌 재구성'} }
Skill       { id:'TARGET', name, move[3단계], gain }
Item        { id, skill, tier:'guided'|'transfer', qa:'pass'|'flagged', kind, stim{text|audio|transcript},
              steps[] (스캐폴드), qs[] (채점 문항: options[{t, trap}], answer, evidence, explain) }
Attempt     { id, at, itemId|originalId, qIndex, tier:'original'|'guided'|'transfer'|'delayed'|'mixed'|'repeat',
              skill, answer, correct, confidence, hinted, ms, plays }
SkillState  { skill, state, since, dueAt, interval, sessions[] }
OriginalState { originalId, status, userCause, userNote, edits{} }
Session     { date, plan[], cursor, done }
```
관계: Test 1─N Original N─M Skill(주1·부N) 1─N Item 1─N Attempt. Attempt → SkillState를 재계산(파생값은 저장하지 않고 시도 로그에서 언제든 재계산 가능 → 데이터 손상에 강함).

- 원본 데이터(`originals.json`)는 읽기 전용. 사용자 수정은 `OriginalState.edits`에 덮어쓰기로 저장 → 원본 출처 보존
- 모르는 값은 `null` + `gaps[]`에 이유. 화면에는 "기록 없음"
- 분석은 `my === null`인 원본을 함정 분석에서 제외

---

## PART 9. MVP

| 포함 | 이유 |
|---|---|
| 원본 63개 구조화 + 대조 카드 + 원인 확인 | Q1 "왜 틀렸나" 직접 대응 |
| 8 Skill × (Guided + Transfer) 문제 풀 | Q2·Q4 |
| 리스닝 음원 (원본 발췌 재구성 + 새 강의·대화·발화) | 원본 음원 없음 → 필수 |
| 우선순위 + 하루 세션 생성 + 이어하기 | 매일 사용 |
| Skill 상태 머신 + 지연 확인 | Q3 "개선되나" |
| 변화 화면 | Q3 |
| JSON 내보내기/가져오기, 자동 저장 | 데이터 보존 |

| 제외 | 이유 |
|---|---|
| 로그인/서버 | 개인용. 데이터 손실 위험만 늘림 |
| 실시간 AI 문제 생성 | 검증 안 된 문제가 지표를 오염. 생성은 *오프라인 작성 + QA 스크립트* |
| 단어장·통계·레벨·배지 | PART 2 |
| 시간 제한 모드 | 시간 압박 근거 없음. 응답시간만 기록 |

구현 순서: ① 원본 데이터 → ② 문제 풀 + QA → ③ 시도 기록·상태 엔진(테스트) → ④ 세션 플레이어 → ⑤ 오늘/변화 화면 → ⑥ 음원 → ⑦ 백업

---

## PART 10. 기술 구현

- **스택**: 빌드 없는 정적 웹앱 (HTML + 바닐라 JS + CSS). `index.html` 더블클릭으로 실행(file://), 휴대폰은 같은 폴더를 아무 정적 서버로. 이유: 개인용, 유지보수 최소, 의존성 0, 업데이트로 데이터가 사라질 구조가 없음
- **저장**: `localStorage` (키 `toeflcoach.v1`) — 시도 로그 중심, 파생값 재계산. 매 시도마다 저장. 설정에서 JSON 백업/복원. 7일 이상 백업 없으면 오늘 화면에 한 줄 알림
- **콘텐츠 파이프라인**: `content/*.json` 작성 → `tools/build.py`가 ① 스키마·QA 검사 ② 음원 생성(macOS `say` + ffmpeg, 화자별 목소리, mp3) ③ `app/content.js` 번들 생성
- **음원**: 원본 오답은 스크린샷에 남은 *스크립트*를 TTS로 다시 읽은 것 (원본 음원 아님을 화면에 명시). 새 문제는 전부 새로 쓴 스크립트. 목소리: Karen(AU, 내레이터), Samantha(US), Daniel(UK), Moira(IE), Reed(US) — 실제 시험처럼 여러 억양
- **현재 콘텐츠**: 원본 오답 63 (리스닝 원본 31문항에 음원), 새 문제 135 (Guided 25 / Transfer 110 = 채점 문항 133), 음원 71개
- **폴더**
```
toefl-coach/
  index.html
  app/  styles.css  engine.js(순수 로직)  store.js  ui.js  content.js(빌드 산출물)
  content/  originals.json  skills.json  items_*.json
  audio/   *.mp3 (빌드 산출물)
  tools/   build.py (QA + TTS + 번들)
  tests/   engine.test.js (node), test_content.py
```
- **테스트**: engine(우선순위·상태 전환·간격·세션 구성)을 node 단위 테스트, 콘텐츠 QA(정답 유일·근거 문자열이 지문에 존재·원본 정답 문구 재사용 금지·음원 파일 존재)를 빌드 시 실패 처리

---

## PART 11. 검증 계획

| 질문 | 지표 | 판정 |
|---|---|---|
| 기억인가 실력인가? | 원본 재정답률 vs Transfer 정답률을 **분리 표시**. 원본만 높고 Transfer가 낮으면 "답 기억" | 숙달은 Transfer로만 |
| 개선되었나? | Skill별 Transfer 정답률: 첫 3문항 vs 최근 5문항 | 표본 < 5면 "판단 보류" 표시 |
| 유지되나? | Delayed 정답률 | 개선→유지 전환 비율 |
| 재발하나? | 같은 함정 태그 재선택률 | ↓ 목표 |
| 과신은? | 고확신 오답 비율 | ↓ 목표 |
| 실전 전이 | **다음 TPO(5, 6…)를 풀면** 오답을 같은 8 Skill로 태깅해 `originals.json`에 추가 → Skill별 실전 오답 수 비교 | TPO 1회분 차이는 노이즈가 크므로 2회 이상 누적 비교 |

마지막 행이 진짜 검증이다. 앱 안의 Transfer 문제는 작성자가 같아 난이도·문체가 일정하다는 한계가 있다 → 새 TPO의 오답 태깅 결과가 앱 지표와 같은 방향인지 확인해야 한다. 공식 점수 환산은 하지 않는다.

---

## 부록. 확장 (2026-10-18 추가)

**새 모의고사 유입 파이프라인** — 캡처 → (Claude가 `CLAUDE.md` 절차로) 전사·분류·리포트 → `content/tests/<ID>.json` → `tools/intake.py check` QA → `tools/build.py`. 엔진은 회차 날짜로 최근성 가중치(최신 1.0, 이후 0.85·0.7…)를 계산하고, **개선됨/유지됨 판정 이후 날짜의 실전 오답을 '재발' 사건으로 처리**한다 (앱 안 새 문제 결과와 실전 결과를 연결하는 장치 — PART 11의 최종 검증을 매 회차 자동 반영).

**이전 사이트에서 가져온 두 가지 장점** (코드가 아니라 아이디어만):
1. *내 규칙 + 재발 판정*: 원본 확인 시 사용자가 자기 말로 규칙을 쓰고, 새 문제를 틀릴 때마다 "같은 원인 / 규칙 적용 실패 / 다른 원인 / 모름"을 사용자가 판정. 자동 함정 태그(↗/✗)와 별도로 **사용자 판정**을 저장해 사실과 추정을 계속 구분한다.
2. *리스닝 막힌 지점*: 오답 직후 소리 인식 / 기억 유지 / 선택 판단 / 어휘 중 하나를 고르고, 스크립트를 보기 전에 근거 문장 구간만 다시 듣는다 (음원을 문장 단위로 생성해 구간 시각을 저장). "다시 들어도 안 들림"은 소리 인식, "잊었다"는 노트·기억 유지 훈련이 우선이라는 근거가 된다 — TPO4 보고서가 미확정으로 남긴 A/B/C(소리·기억·판단) 구분을 데이터로 확인하는 장치.
