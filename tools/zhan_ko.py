#!/usr/bin/env python3
"""한국어로 풀어 보기: 독점 TPO 리딩·리스닝 세트의 한국어 번역 → 앱의 비공개 데이터 (private/zhan/kotrial.js · kotrial.json).
시험에서 틀린 문제를 한국어로 맞히면 영어 이해가 원인, 한국어로도 틀리면 판단이 원인이라고 가른다 (#/ko).

입력 (원문의 번역도 2차 저작물이라 공개 저장소에 올리지 않는다):
  private/zhan/kotrial/ko.json   세트 id → {title, passage | script[] (영어 스크립트 줄과 같은 순서), qs[] {stem, choices?, sentence?, vocab?}}
  private/zhan/reading.json · listen.json   정답·시험 때 내 답·오답 여부·한국어 해설은 영어 세트에서 가져온다
  python3 tools/zhan_ko.py
"""
import json, re, sys
from zhan import ROOT

Z = ROOT / "private" / "zhan"


def build():
    ko = json.loads((Z / "kotrial" / "ko.json").read_text())
    src = {}
    for name, sec in (("reading", "R"), ("listen", "L")):
        d = json.loads((Z / f"{name}.json").read_text())
        tests = {t["id"]: t["name"] for t in d["tests"]}
        for s in d["sets"]:
            src[s["id"]] = (sec, tests[s["test"]], s)
    sets, errs = [], []
    for sid, k in ko.items():
        if sid not in src:
            errs.append(f"{sid}: 영어 세트 없음"); continue
        sec, tname, s = src[sid]
        if len(k["qs"]) != len(s["qs"]):
            errs.append(f"{sid}: 문항 수 {len(k['qs'])} / 영어 {len(s['qs'])}")
        qs = []
        for i, (kq, q) in enumerate(zip(k["qs"], s["qs"])):
            choices = kq.get("choices") or q["choices"]   # 문장 삽입은 ■A… 위치 그대로
            if len(choices) != len(q["choices"]):
                errs.append(f"{sid} Q{i + 1}: 보기 수 {len(choices)} / 영어 {len(q['choices'])}")
            qs.append({"stem": kq["stem"], "choices": choices, "sentence": kq.get("sentence"), "type": q.get("type", "mc"),
                       "vocab": bool(kq.get("vocab")), "answer": q["answer"], "my": q["my"], "wrong": q["wrong"],
                       "stemEn": q["stem"], "whyKo": q.get("whyKo"), "point": q.get("point")})
        item = {"id": sid, "sec": sec, "test": s["test"], "testName": tname, "module": s["module"], "kind": s["kind"],
                "title": k["title"], "qs": qs}
        if sec == "R":
            item["passage"] = k["passage"]
            if re.findall(r"\[\[[is][A-Z]\]\]", k["passage"]) != re.findall(r"\[\[[is][A-Z]\]\]", s["passage"]):
                errs.append(f"{sid}: 삽입 표시가 영어 지문과 다름")
        else:
            if len(k["script"]) != len(s["script"]):
                errs.append(f"{sid}: 스크립트 {len(k['script'])}줄 / 영어 {len(s['script'])}줄")
            item["script"] = [{"sp": l["sp"], "t": t} for l, t in zip(s["script"], k["script"])]
        sets.append(item)
    return sets, errs


def main():
    sets, errs = build()
    for e in errs:
        print("✗", e)
    data = json.dumps({"sets": sets}, ensure_ascii=False)
    (Z / "kotrial.js").write_text("/* 생성 파일 (tools/zhan_ko.py). 원본의 번역 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN_KO = " + data + ";\n")
    (Z / "kotrial.json").write_text(data + "\n")
    wrong = sum(q["wrong"] for s in sets for q in s["qs"])
    print(f"private/zhan/kotrial.js: 세트 {len(sets)} (리딩 {sum(s['sec'] == 'R' for s in sets)} · 리스닝 {sum(s['sec'] == 'L' for s in sets)}) · 문항 {sum(len(s['qs']) for s in sets)} · 시험 오답 {wrong}")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
