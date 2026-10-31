#!/usr/bin/env python3
"""소站 TPO独家 리딩 오답 세트 → 앱의 비공개 데이터 (private/zhan/reading.js · reading.json). 리스닝판은 tools/zhan.py.

입력 (gitignore된 private/zhan/reading/, 원본 저작물이라 공개 저장소에 올리지 않는다):
  Mock_Test_<N>_<workflowId>.json  리포트에서 내보낸 오답 세트 (지문·문항·내 답·정답·중국어 해설)
  ko.json                           (선택) 문항 id → {"why", "point"} 한국어 해설
지문 표기: C-Test 빈칸 【n】 (앞 글자는 지문에 있음).
문장 삽입 위치는 [[iA]]…, 문장 고르기 표시는 [[sA]]… (문장 앞).
문항 type: ctest (빠진 글자 입력) · insert (■ 위치 고르기, sentence=넣을 문장) · select (지문 속 [A]~ 문장 고르기) · mc
  python3 tools/zhan_read.py          변환
  python3 tools/zhan_read.py --todo   한국어 해설이 없는 오답 문항 JSON (번역 작업용)
"""
import json, re, sys
from zhan import ROOT, LETTERS, app_originals, norm

Z = ROOT / "private" / "zhan"
R = Z / "reading"
SPAN_INSERT_EMPTY = re.compile(r"""\[\[span id=["']insert_([A-Z])["'][^\]]*\]\]\s*\[\[/span\]\]""")   # 문장 삽입 위치
SPAN_INSERT = re.compile(r"""\[\[span id=["']insert_([A-Z])["'][^\]]*\]\]""")                            # 문장 고르기: 문장을 감쌈
SPAN_ANY = re.compile(r"\[\[/?span[^\]]*\]\]")
BLANK = re.compile(r"【(\d+)】")


def clean_passage(t):
    t = SPAN_INSERT_EMPTY.sub(lambda m: f"[[i{m.group(1)}]]", t or "")
    t = SPAN_INSERT.sub(lambda m: f"[[s{m.group(1)}]]", t)
    return re.sub(r"[ \t]+", " ", SPAN_ANY.sub("", t)).strip()


def clean_stem(t):
    return re.sub(r"\s+", " ", re.sub(r"\[\[span[^\]]*\]\]\s*\[\[/span\]\]", "■", t or "")).strip()


def kind(title, passage, qs):
    if BLANK.search(passage) and all(not q["choices"] for q in qs):
        return "ctest"
    if re.search(r"email|daily life|notice|text message|announcement", title, re.I):
        return "daily"
    return "academic"


def prefix_before(passage, n):
    m = re.search(r"([A-Za-z'’\-]*)【%d】" % n, passage)
    return m.group(1) if m else ""


def match_orig(q, origs, used):
    for o in origs:
        if o["id"] in used:
            continue
        if q["type"] == "ctest":
            c = o.get("ctest")
            ok = c and norm(c["answer"]) == norm(q["prefix"] + q["answer"]) and norm(c["prefix"]) and norm(c["answer"]).startswith(norm(q["prefix"])[:2])
        else:
            ok = not o.get("ctest") and (norm(o["stem"]) == norm(q["stem"]) or
                 (q["type"] == "mc" and o.get("correct") is not None and o.get("options") and norm(o["options"][o["correct"]]) == norm(q["choices"][q["answer"]])))
        if ok:
            used.add(o["id"])
            return o["id"]
    return None


def load():
    ko = json.loads((R / "ko.json").read_text()) if (R / "ko.json").exists() else {}
    origs, used = app_originals("R"), set()
    tests, sets = [], []
    for f in sorted(R.glob("Mock_Test_*.json"), key=lambda p: int(p.stem.split("_")[2])):
        d = json.loads(f.read_text())
        n = int(d["paper"].split()[-1])
        tid = f"Z{n}"
        tests.append({"id": tid, "name": f"독점 TPO {n}", "date": (d.get("date") or "")[:10],
                      "score": d.get("score"), "correct": d.get("correct"), "total": d.get("total")})
        for s in d["sets"]:
            sid = f"{tid}-R-M{s['m']}-T{s['task']}"
            passage = clean_passage(s["passage"])
            k = kind(s["title"], passage, s["qs"])
            ins, sel = re.findall(r"\[\[i([A-Z])\]\]", passage), re.findall(r"\[\[s([A-Z])\]\]", passage)
            qs = []
            for i, q in enumerate(s["qs"], 1):
                qid = f"{sid}-Q{i}"
                tr = ko.get(qid) or {}
                stem = clean_stem(q["stem"])
                item = {"id": qid, "wrong": q["wrong"], "stem": stem,
                        "whyKo": tr.get("why"), "point": tr.get("point"), "whyZh": q.get("why") or None}
                if k == "ctest":
                    item.update(type="ctest", n=i, prefix=prefix_before(passage, i), answer=q["answer"], my=q.get("my"), choices=[])
                else:
                    if "■" in stem or re.search(r"best fit", stem, re.I):
                        item.update(type="insert", sentence=(q["choices"] or [None])[0], choices=[f"■{x}" for x in ins])
                    elif not q["choices"]:
                        item.update(type="select", choices=[f"[{x}]" for x in sel])
                    else:
                        item.update(type="mc", choices=q["choices"])
                    item["answer"] = LETTERS.index(q["answer"]) if q.get("answer") in LETTERS else None
                    item["my"] = LETTERS.index(q["my"]) if q.get("my") in LETTERS else None
                if q["wrong"]:
                    item["orig"] = match_orig(item, origs, used)
                qs.append(item)
            sets.append({"id": sid, "test": tid, "module": s["m"], "task": s["task"], "title": s["title"], "kind": k,
                         "passage": passage, "qs": qs})
    return tests, sets


def check(sets):
    errs = []
    for s in sets:
        for q in s["qs"]:
            if q["type"] == "ctest":
                if not q["answer"] or f"【{q['n']}】" not in s["passage"]:
                    errs.append(f"{q['id']}: C-Test 빈칸·정답 이상")
            elif q["answer"] is None or q["answer"] >= len(q["choices"]):
                errs.append(f"{q['id']}: 정답 인덱스 이상 ({q['type']}, 보기 {len(q['choices'])})")
    return errs


def main():
    tests, sets = load()
    if "--todo" in sys.argv:
        todo = []
        for s in sets:
            for q in s["qs"]:
                if not q["wrong"] or q["whyKo"]:
                    continue
                if q["type"] == "ctest":
                    ans, my = q["prefix"] + q["answer"], (q["prefix"] + q["my"]) if q["my"] else None
                else:
                    ans = LETTERS[q["answer"]] + ". " + q["choices"][q["answer"]]
                    my = LETTERS[q["my"]] + ". " + q["choices"][q["my"]] if q["my"] is not None else None
                todo.append({"id": q["id"], "set": s["title"], "type": q["type"], "passage": s["passage"], "stem": q["stem"],
                             "sentence": q.get("sentence"), "choices": q["choices"], "answer": ans, "my": my, "whyZh": q["whyZh"]})
        print(json.dumps(todo, ensure_ascii=False, indent=1))
        return
    errs = check(sets)
    for e in errs:
        print("✗", e)
    for s in sets:   # 중국어 해설 원문은 앱에 보내지 않는다 (한국어 해설만 표시)
        for q in s["qs"]:
            q.pop("whyZh", None)
    data = json.dumps({"tests": tests, "sets": sets}, ensure_ascii=False)
    (Z / "reading.js").write_text("/* 생성 파일 (tools/zhan_read.py). 원본 저작물 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN_READ = " + data + ";\n")
    (Z / "reading.json").write_text(data + "\n")
    wrong = sum(q["wrong"] for s in sets for q in s["qs"])
    linked = sum(1 for s in sets for q in s["qs"] if q.get("orig"))
    ko = sum(1 for s in sets for q in s["qs"] if q["wrong"] and q["whyKo"])
    print(f"private/zhan/reading.js: 회차 {len(tests)} · 세트 {len(sets)} · 오답 {wrong} (한국어 해설 {ko}/{wrong}) · 앱 원본 오답과 연결 {linked}/{len(app_originals('R'))}")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
