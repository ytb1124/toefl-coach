#!/usr/bin/env python3
"""소站 TPO独家 전 문항(맞힌 것 포함) → 연습 문제 풀.

입력 (비공개, private/zhan/raw/): 리포트 페이지 Vue props(scoreData) 덤프 <S>_<paperId>_<workflowId>.json
  S = R 리딩 · L 리스닝 · S 말하기 · W 쓰기. 목록은 raw/records.json (query_completed_practice_records).
출력:
  private/zhan/pool.json · pool.js (window.ZHAN_POOL)  원문 포함 — 비공개 저장소에만
  content/pool.json                                     공개 메타데이터만 (id·영역·유형·회차·능력·보류 여부). 원문 문자열 없음.
능력(skill)은 규칙 기반 자동 분류 (skillSrc 'AI 분류'): 소站 문항 유형 라벨 → 없으면 질문 문장 패턴.
근거(evidence)는 소站 해설에서 인용한 영어 구절 중 지문/스크립트에 실제로 있는 것만 (원문 그대로).
  python3 tools/zhan_pool.py
"""
import html, json, re, subprocess, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
RAW = Z / "raw"
LETTERS = "ABCDEFGHI"
SEC_KEY = {"R": "readingModuleDetail", "L": "listeningModuleDetail", "S": "speakingModuleDetail", "W": "writingModuleDetail"}
# 모의 모듈(11/7·11/12) 전용으로 일상 훈련에서 빼 둔 회차 (docs/exam-rules.md에 이유 기록)
HELD = {2: "2026-11-07", 3: "2026-11-12"}

sys.path.insert(0, str(ROOT / "tools"))
from zhan import script_lines  # noqa: E402


def norm(s):
    s = (s or "").lower().replace("’", "'").replace("—", " ").replace("–", " ")
    return re.sub(r"[^a-z0-9' ]+", " ", s).split()


def contains(hay, needle):
    w = norm(needle)
    return bool(w) and (" " + " ".join(w) + " ") in (" " + " ".join(norm(hay)) + " ")


def text(h):
    """소站 HTML(<m_p><m_s>, <p>, 엔티티) → 줄바꿈 있는 평문. [[span]] 표시는 남긴다."""
    t = re.sub(r"</m_p>|</p>|<br\s*/?>", "\n", h or "")
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    return "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in t.split("\n")).strip()


SPAN_INSERT_EMPTY = re.compile(r"""\[\[span id=["']insert_([A-Z])["'][^\]]*\]\]\s*\[\[/span\]\]""")
SPAN_INSERT = re.compile(r"""\[\[span id=["']insert_([A-Z])["'][^\]]*\]\]""")
SPAN_ANY = re.compile(r"\[\[/?span[^\]]*\]\]")


def clean_passage(t):
    t = SPAN_INSERT_EMPTY.sub(lambda m: f"[[i{m.group(1)}]]", t or "")
    t = SPAN_INSERT.sub(lambda m: f"[[s{m.group(1)}]]", t)
    return re.sub(r"[ \t]+", " ", SPAN_ANY.sub("", t)).strip()


def clean_stem(t):
    return re.sub(r"\s+", " ", re.sub(r"\[\[span[^\]]*\]\]\s*\[\[/span\]\]", "■", text(t))).strip()


def audio_file(url):
    if not url:
        return None
    name = url.rstrip("/").split("/")[-1]
    return f"private/zhan/audio/{name}" if (Z / "audio" / name).exists() else None


def why_zh(q):
    w = (q.get("analysis") or q.get("quesGeneralization") or "").strip()
    w = w.strip('"').strip()
    return None if w in ("", "None", "null") else re.sub(r'""', '"', w)


# ---------------------------------------------------------------- 능력 분류 (AI 분류 = 규칙 기반 자동)
LABEL_SKILL = {
    "R": {"词汇题": "WORD", "句子插入题": "ROLE", "修辞目的题": "ROLE", "组织结构题": "ROLE", "推理题": "AUDIT",
          "否定事实信息题": "AUDIT", "事实信息题": "TARGET"},
    "L": {"细节题": "CATCH", "内容主旨题": "TARGET", "目的主旨题": "TARGET", "推理题": "AUDIT", "态度题": "AUDIT",
          "功能题": "ROLE", "信息连结题": "BIND"},
}
SUFFIX = re.compile(r"(ed|ing|s|es|ly|er|est|ies|ied)$")


def classify(sec, kind, q, stem):
    if kind == "reply":
        return "ACT"
    if kind == "ctest":
        full = (q.get("prefix") or "") + (q.get("answer") or "")
        return "FORM" if SUFFIX.search(q.get("answer") or "") and len(full) > 4 and SUFFIX.search(full) else "WORD"
    labs = [l["labelname"] for l in (q.get("_labels") or []) if l.get("type") == "1"]
    for l in labs:
        if l in LABEL_SKILL.get(sec, {}):
            return LABEL_SKILL[sec][l]
    s = stem.lower()
    if q.get("type") == "insert" or "closest in meaning" in s or q.get("type") == "select":
        return "ROLE" if q.get("type") in ("insert", "select") else "WORD"
    if re.search(r"why does .* (mention|say|discuss)|purpose of|in order to|why .* include", s):
        return "ROLE"
    if re.search(r"infer|impl|suggest|probably|most likely|attitude|feel about|not true|except|least likely", s):
        return "AUDIT"
    if re.search(r"main (purpose|topic|idea)|mainly (about|discuss)|primarily|what is the (talk|lecture|announcement|conversation) about", s):
        return "TARGET"
    return "CATCH" if sec == "L" else "TARGET"


def evidence(why, hay):
    """해설에 인용된 영어 구절 중 원문에 그대로 있는 것 (3단어 이상)."""
    out = []
    for frag in re.findall(r'["“]([A-Za-z][^"“”]{8,200}?)["”]', why or ""):
        frag = frag.strip(" ,.")
        if len(norm(frag)) >= 3 and contains(hay, frag) and frag not in out:
            out.append(frag)
    return out[:3]


# ---------------------------------------------------------------- 영역별 변환
L_KIND = {"会话": "reply", "对话": "conversation", "公告": "announcement", "讲座": "lecture"}
R_KIND = {"单词填空题": "ctest", "生活日常": "daily", "学术短文": "academic"}


def reading_set(a, base):
    paras = a.get("paragraphList") or []
    passage = clean_passage("\n\n".join(text(p.get("paragraphDetail")) for p in paras) if paras else text(a.get("articleEn")))
    kind = R_KIND.get(a["articleTypeName"], "academic")
    ins, sel = re.findall(r"\[\[i([A-Z])\]\]", passage), re.findall(r"\[\[s([A-Z])\]\]", passage)
    qs = []
    for i, q in enumerate(sorted(a.get("quesDetailList") or [], key=lambda x: x["seqNo"]), 1):
        stem = clean_stem(q.get("questionContent"))
        item = {"qid": q["questionId"], "stem": stem, "whyZh": why_zh(q), "_labels": q.get("label")}
        if kind == "ctest":
            m = re.search(r"([A-Za-z'’\-]*)【%d】" % i, passage)
            item.update(type="ctest", n=i, prefix=m.group(1) if m else "", answer=(q.get("answer") or "").strip(), choices=[])
        else:
            ch = [text(q.get("choice" + L)) for L in LETTERS[:7]]
            ch = [c for c in ch if c and c != "None"]
            if q.get("quesTypeName") == "插入题" or "■" in stem:
                item.update(type="insert", sentence=ch[0] if ch else None, choices=[f"■{x}" for x in ins])
            elif q.get("quesTypeName") == "阅读选句题":
                item.update(type="select", choices=[f"[{x}]" for x in sel])
            else:
                item.update(type="mc", choices=ch)
            ans = (q.get("answer") or "").strip()
            item["answer"] = LETTERS.index(ans) if ans in LETTERS else None
            hl = (q.get("highlight") or "").strip()
            if hl and contains(passage, hl) and len(norm(hl)) <= 4:
                item["highlight"] = hl
        qs.append(item)
    return dict(base, kind=kind, passage=passage, qs=qs)


def listening_set(a, base):
    kind = L_KIND.get(a["articleTypeName"], "other")
    s = dict(base, kind=kind)
    if kind != "reply":
        s["audio"] = audio_file(a.get("audioUrl"))
        s["script"] = script_lines(text(a.get("articleEn")))
    qs = []
    for q in sorted(a.get("quesDetailList") or [], key=lambda x: x["seqNo"]):
        ch = [text(q.get("choice" + L)) for L in LETTERS[:5]]
        ans = (q.get("answer") or "").strip()
        item = {"qid": q["questionId"], "type": "mc", "stem": clean_stem(q.get("questionContent")), "choices": [c for c in ch if c and c != "None"],
                "answer": LETTERS.index(ans) if ans in LETTERS else None, "whyZh": why_zh(q), "_labels": q.get("label")}
        if q.get("questionAudioUrl"):
            item["audio"] = audio_file(q["questionAudioUrl"])
        qs.append(item)
    s["qs"] = qs
    return s


def speaking_set(a, base):
    kind = "lr" if a["articleTypeName"] == "复读题" else "interview"
    s = dict(base, kind=kind, intro=text(a.get("articleEn")), audio=audio_file(a.get("audioUrl")),
             image=a.get("articleImgUrl") or None)
    qs = []
    for q in sorted(a.get("quesDetailList") or [], key=lambda x: x["seqNo"]):
        ans = text(q.get("answer")).replace("####", "").strip()
        item = {"qid": q["questionId"], "type": kind, "text": clean_stem(q.get("questionContent")),
                "limit": q.get("limitTime"), "audio": audio_file(q.get("questionAudioUrl"))}
        if kind == "lr":
            item["tipZh"] = ans or None           # 소站 발음 포인트 (중국어)
        else:
            item["model"] = ans or None            # 소站 제공 답안
        qs.append(item)
    s["qs"] = qs
    return s


BS_ANS = re.compile(r"S(\d+)/T(\d+)")


def writing_set(a, base):
    tn = a["articleTypeName"]
    kind = {"句子填充": "bs", "撰写邮件": "email", "学术写作": "discussion"}.get(tn, "other")
    qs = []
    for q in sorted(a.get("quesDetailList") or [], key=lambda x: x["seqNo"]):
        if kind == "bs":
            content = text(q.get("questionContent"))
            tiles = [t.strip() for t in re.split(r"\s*/\s*", q.get("option") or "")]
            order = sorted(BS_ANS.findall(q.get("answer") or ""), key=lambda x: int(x[1]))
            answer = [tiles[int(s) - 1] for s, _ in order if int(s) - 1 < len(tiles)]
            extra = list(tiles)
            for t in answer:
                if t in extra:
                    extra.remove(t)
            lines = [l for l in content.split("\n") if l.strip()]
            ctx = [re.sub(r"^[AB][：:]\s*", "", l) for l in lines if "【" not in l]
            slot = [l for l in lines if "【" in l]
            tpl = re.sub(r"【\d+】", "_", re.sub(r"^[AB][：:]\s*", "", slot[0])) if slot else ""
            qs.append({"qid": q["questionId"], "type": "bs", "context": " ".join(ctx) or None, "first": bool(slot and lines.index(slot[0]) == 0),
                       "template": tpl, "answer": answer, "extra": extra, "whyZh": why_zh(q)})
        else:
            model = text(q.get("answer"))
            posts = [{"name": p.get("name") or None,
                      "role": "professor" if "/teacher/" in (p.get("headImgUrl") or "") else "student", "text": text(p.get("content"))}
                     for p in q.get("writingProfessorStudent") or []]
            head = text(q.get("writingOutline")) if q.get("writingOutline") not in (None, "None") else ""
            qs.append({"qid": q["questionId"], "type": kind, "prompt": text(q.get("questionContent")), "posts": posts or None, "head": head or None,
                       "limit": q.get("prepareTime"), "model": model if model and model != "None" else None})
    return dict(base, kind=kind, qs=qs)


CONVERT = {"R": reading_set, "L": listening_set, "S": speaking_set, "W": writing_set}


def user_try(sec, q, set_kind):
    ua = q.get("userAnswer")
    if ua in (None, "", "[]", "None"):
        return None
    if sec in ("R", "L"):
        if set_kind == "ctest":
            return {"my": ua, "ok": q.get("userResult") == 1 or (ua or "").strip().lower() == (q.get("answer") or "").strip().lower()}
        return {"my": LETTERS.index(ua) if ua in LETTERS else None, "ok": ua == (q.get("answer") or "").strip()}
    if sec == "W" and set_kind == "bs":
        return {"ok": q.get("userResult") == 1}
    return {"done": True}


def load():
    records = json.loads((RAW / "records.json").read_text())
    dates = {}
    for t, v in records.items():
        for r in v.get("data") or []:
            dates[str(r["workflowId"])] = (r.get("finishTime") or "")[:10]
    sets, papers, tries = {}, {}, defaultdict(list)
    for f in sorted(RAW.glob("[RLSW]_*_*.json")):
        sec, pid, wf = f.stem.split("_")
        sd = json.loads(f.read_text()).get("scoreData") or {}
        md = sd.get(SEC_KEY[sec]) or {}
        mods = [(int(k[-1]), v) for k, v in md.items() if isinstance(v, dict) and "details" in v and k.startswith("module")] or [(1, md)]
        for mod, m in mods:
            for task, a in enumerate(m.get("details") or [], 1):
                n = int(a["paperName"].split()[-1])
                if not a["paperName"].startswith("Mock Test"):
                    continue              # TPO独家(Mock Test N)만
                papers[n] = {"n": n, "paperId": int(pid), "name": f"독점 TPO {n}"}
                sid = f"Z{n}-{sec}-A{a['articleId']}"
                if sid not in sets:
                    base = {"id": sid, "test": f"Z{n}", "paper": n, "sec": sec, "module": mod, "task": task,
                            "title": text(a.get("title")) or a["articleTypeName"], "src": f"소站 독점 TPO {n}"}
                    s = CONVERT[sec](a, base)
                    for i, q in enumerate(s["qs"], 1):
                        q["id"] = f"{sid}-Q{i}"
                    sets[sid] = s
                s = sets[sid]
                byq = {q["qid"]: q for q in s["qs"]}
                for q in a.get("quesDetailList") or []:
                    t = user_try(sec, q, s["kind"])
                    if t and q["questionId"] in byq:
                        tries[byq[q["questionId"]]["id"]].append(dict(t, wf=int(wf), date=dates.get(wf)))
    out = sorted(sets.values(), key=lambda s: (s["paper"], "RLSW".index(s["sec"]), s["module"], s["task"]))
    # Whisper로 맞춘 줄 시각 (tools/zhan_align.py): 소站 시각이 없거나 Whisper와 1.5초 넘게 어긋나는 줄을 고친다 (atSrc 'whisper').
    # 받아쓰기·'근거 구간만 다시 듣기'가 실제로 그 문장을 재생하도록 (2026-11-02 전수 검사에서 어긋난 세트가 나옴).
    al = json.loads((Z / "align.json").read_text()) if (Z / "align.json").exists() else {}
    for s in out:
        ats = al.get(s["id"])
        if ats and len(ats) == len(s.get("script") or []):
            for l, a in zip(s["script"], ats):
                if a is not None and (l.get("at") is None or abs(l["at"] - a) > 1.5):
                    l["at"], l["atSrc"] = a, "whisper"
    # Kokoro로 만든 질문 음성 (tools/zhan_kokoro.py): 소站 음원이 없는 Interview 질문만.
    for s in out:
        for q in s["qs"]:
            k = Z / "kokoro" / f"{q.get('id', '')}.mp3"
            if s["kind"] == "interview" and not q.get("audio") and k.exists():
                q["audio"], q["audioSrc"] = f"private/zhan/kokoro/{k.name}", "Kokoro 생성 (원본 음원 아님)"
    for s in out:
        hay = s.get("passage") or " ".join(l["t"] for l in s.get("script") or [])
        for q in s["qs"]:
            if s["sec"] in ("R", "L"):
                q["skill"] = classify(s["sec"], s["kind"], q, q.get("stem") or "")
                q["skillSrc"] = "AI 분류"
                ev = evidence(q.get("whyZh"), hay) if hay else []
                if ev:
                    q["evidence"] = ev
            q.pop("_labels", None)
            q["zhanTries"] = sorted(tries.get(q["id"], []), key=lambda t: t["wf"])
    return sorted(papers.values(), key=lambda p: p["n"]), out


def check(sets):
    errs = []
    for s in sets:
        for q in s["qs"]:
            t = q["type"]
            if t == "ctest" and (not q["answer"] or f"【{q['n']}】" not in s["passage"]):
                errs.append(f"{q['id']}: C-Test 빈칸·정답 이상")
            elif t in ("mc", "insert", "select") and (q["answer"] is None or q["answer"] >= len(q["choices"])):
                errs.append(f"{q['id']}: 정답 인덱스 이상 ({t}, 보기 {len(q['choices'])})")
            elif t == "bs" and q["template"].count("_") != len(q["answer"]):
                errs.append(f"{q['id']}: Build a Sentence 빈칸/타일 수 불일치")
            for e in q.get("evidence") or []:
                if not contains(s.get("passage") or " ".join(l["t"] for l in s.get("script") or []), e):
                    errs.append(f"{q['id']}: 근거가 원문에 없음")
        if s["sec"] == "L" and s["kind"] != "reply" and not s.get("audio"):
            errs.append(f"{s['id']}: 음원 없음")
        if s["sec"] == "L" and s["kind"] == "reply" and any(not q.get("audio") for q in s["qs"]):
            errs.append(f"{s['id']}: 응답 문항 음원 없음")
    return errs


def zres(q):
    """소站에서 마지막으로 푼 결과: 1 맞힘 · -1 틀림 · 0 기록 없음 (객관식·C-Test만)."""
    t = [x for x in q.get("zhanTries") or [] if "ok" in x]
    return 0 if not t else (1 if t[-1]["ok"] else -1)


_DUR = {}


def audio_seconds(s):
    """리스닝 세트 음원 길이(초, 정수) — 계획의 예상 시간용. 음원이 없으면 스크립트 마지막 줄 시각 + 10초, 그것도 없으면 None."""
    path = s.get("audio") if isinstance(s.get("audio"), str) else None
    if path and (ROOT / path).exists():
        if path not in _DUR:
            try:
                out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(ROOT / path)], capture_output=True, text=True, timeout=30).stdout.strip()
                _DUR[path] = round(float(out)) if out else None
            except (OSError, ValueError, subprocess.SubprocessError):
                _DUR[path] = None
        if _DUR[path]:
            return _DUR[path]
    ats = [l.get("at") for l in s.get("script") or [] if isinstance(l, dict) and l.get("at") is not None]
    return round(max(ats) + 10) if ats else None


def meta(papers, sets):
    """공개 번들용: 원문 문자열 없이 id·유형·능력만."""
    return {
        "_help": "생성 파일 (tools/zhan_pool.py). 소站 독점 TPO 문항의 메타데이터만 — 원문은 비공개 저장소(private/zhan/pool.json).",
        "papers": [dict(p, held=HELD.get(p["n"])) for p in papers],
        "sets": [{"id": s["id"], "paper": s["paper"], "sec": s["sec"], "kind": s["kind"], "module": s["module"], "task": s["task"],
                  "held": s["paper"] in HELD, "audio": bool(s.get("audio") or any(q.get("audio") for q in s["qs"])),
                  "zdate": max((t.get("date") or "" for q in s["qs"] for t in q.get("zhanTries") or []), default="") or None,
                  **({"dur": audio_seconds(s)} if s["sec"] == "L" and s["kind"] in ("lecture", "conversation", "announcement") else {}),
                  "qs": [dict({k: q[k] for k in ("id", "type", "skill") if k in q}, z=zres(q)) for q in s["qs"]]} for s in sets],
    }


FIB = ROOT.parent / "fill in the blank"
FIB_SLOT = re.compile(r"([A-Za-z'’\-]*)\{([^|}]*)\|([^}]*)\}")


def fib_sets():
    """../fill in the blank/ 49개 C-Test (verified-tasks.json + task-notes.json) → 같은 C-Test 세트 형식. 출처 'Fill in the blank 자료'."""
    vf = FIB / "verified-tasks.json"
    if not vf.exists():
        return []
    tasks = json.loads(vf.read_text())
    notes = json.loads((FIB / "task-notes.json").read_text()) if (FIB / "task-notes.json").exists() else []
    out = []
    for i, t in enumerate(tasks, 1):
        qs, k = [], [0]

        def slot(m):
            k[0] += 1
            qs.append({"type": "ctest", "n": k[0], "prefix": m.group(1), "answer": m.group(2), "glossKo": m.group(3), "choices": [], "stem": ""})
            return f"{m.group(1)}【{k[0]}】"
        passage = FIB_SLOT.sub(slot, t["template"])
        sid = f"FIB-{i}"
        for q in qs:
            q["id"] = f"{sid}-Q{q['n']}"
            q["skill"] = classify("R", "ctest", q, "")
            q["skillSrc"] = "AI 분류"
            q["zhanTries"] = []
        out.append({"id": sid, "test": "FIB", "paper": 0, "sec": "R", "module": 1, "task": i, "title": "Fill in the missing letters",
                    "src": "Fill in the blank 자료", "kind": "ctest", "passage": passage, "qs": qs,
                    "noteKo": notes[i - 1] if i - 1 < len(notes) else None, "capture": t.get("source")})
    return out


def load_ko():
    """private/zhan/ko_pool/in_K.json(key·ids·zh) + out_K.json(key→한국어): 소站 해설의 한국어 번역 (AI 번역)."""
    ko, d = {}, Z / "ko_pool"
    for f in sorted(d.glob("in_*.json")):
        out = d / f.name.replace("in_", "out_")
        if not out.exists():
            continue
        tr = json.loads(out.read_text())
        for it in json.loads(f.read_text()):
            if tr.get(it["key"]):
                for i in it["ids"]:
                    ko[i] = {"zh": it["zh"], "ko": tr[it["key"]]}
    return ko


def main():
    papers, sets = load()
    ko = load_ko()
    for s in sets:
        for q in s["qs"]:
            k = ko.get(q["id"])
            if k and k["zh"] == q.get("whyZh"):      # 해설 원문이 바뀌었으면 옛 번역을 쓰지 않는다
                q["whyKo"] = k["ko"]
    fib = fib_sets()
    (Z / "ctest_fib.json").write_text(json.dumps(fib, ensure_ascii=False) + "\n")
    sets = sets + fib
    errs = check(sets)
    for e in errs:
        print("✗", e)
    data = json.dumps({"papers": papers, "held": HELD, "sets": sets}, ensure_ascii=False)
    (Z / "pool.json").write_text(data + "\n")
    (Z / "pool.js").write_text("/* 생성 파일 (tools/zhan_pool.py). 원본 저작물 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN_POOL = " + data + ";\n")
    m = meta(papers, sets)
    (ROOT / "content" / "pool.json").write_text("{\n" + ",\n".join(f'"{k}": ' + (json.dumps(v, ensure_ascii=False) if k != "sets" else "[\n" + ",\n".join(json.dumps(x, ensure_ascii=False) for x in v) + "\n]") for k, v in m.items()) + "\n}\n")
    by = defaultdict(lambda: defaultdict(int))
    for s in sets:
        by[s["paper"]][s["sec"]] += len(s["qs"])
    print("회차  R    L    S    W")
    for n in sorted(by):
        print(f"Z{n:<3} " + " ".join(f"{by[n][x]:<4}" for x in "RLSW") + ("  (보류: 모의 모듈 " + HELD[n] + ")" if n in HELD else ""))
    tot = {x: sum(by[n][x] for n in by) for x in "RLSW"}
    ev = sum(1 for s in sets for q in s["qs"] if q.get("evidence"))
    nz = sum(1 for s in sets for q in s["qs"] if q.get("whyZh"))
    nk = sum(1 for s in sets for q in s["qs"] if q.get("whyKo"))
    print(f"한국어 해설 {nk}/{nz} (소站 해설 AI 번역)")
    print(f"합계 R {tot['R']} · L {tot['L']} · S {tot['S']} · W {tot['W']} · 세트 {len(sets)} · 근거 인용 있는 문항 {ev}")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
