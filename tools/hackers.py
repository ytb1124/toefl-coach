#!/usr/bin/env python3
"""해커스 Updated TOEFL Writing '20일 완성 모범 답안' 전사본 → 앱의 비공개 데이터 (private/zhan/hackers.js · hackers.json).

입력 (gitignore된 private/zhan/hackers/raw/, 저작물이라 공개 저장소에 올리지 않는다):
  email_01-10.json · email_11-20.json   Task 2 Day 1–20 (p.322–341): situation·instruction·tasks·outline·greeting·parts[{label,text}]·signoff·name·bold·underline·ko
  disc_01-10.json  · disc_11-20.json    Task 3 Day 1–20 (p.344–383): prof·students·outline[{side,chosen,lines}]·parts·bold·underline·ko
앱(app/hackers.js)이 HE01–HE20 · HD01–HD20을 라벨 재구성 훈련으로 쓴다.
  python3 tools/hackers.py          검사 + 변환
"""
import json, re, sys
from zhan import ROOT

Z = ROOT / "private" / "zhan"
RAW = Z / "hackers" / "raw"


def check(items):
    errs = []
    ids = [x["id"] for x in items]
    want = [f"HE{i:02d}" for i in range(1, 21)] + [f"HD{i:02d}" for i in range(1, 21)]
    missing = [i for i in want if i not in ids]
    if missing:
        errs.append(f"빠진 문제: {missing}")
    for x in items:
        p = x["id"]
        if len(set(ids)) != len(ids):
            errs.append("중복 id")
            break
        if not x.get("parts") or any(not (q.get("label") and q.get("text")) for q in x["parts"]):
            errs.append(f"{p}: 라벨·문장이 빈 parts")
        body = " ".join(q["text"] for q in x.get("parts", []))
        for b in x.get("bold", []):
            if b not in body:
                errs.append(f"{p}: 굵은 표현이 본문에 없음: {b!r}")
        if p.startswith("HE"):
            if len(x.get("tasks", [])) != 3:
                errs.append(f"{p}: 과제 3개가 아님")
        else:
            if len(x.get("students", [])) != 2:
                errs.append(f"{p}: 학생 글 2개가 아님")
            if sum(1 for o in x.get("outline", []) if o.get("chosen")) != 1:
                errs.append(f"{p}: 아웃라인 선택(*)이 하나가 아님")
        if "[unreadable]" in json.dumps(x, ensure_ascii=False):
            print(f"  주의 {p}: [unreadable] 있음")
    return errs


def main():
    items = []
    for f in sorted(RAW.glob("*.json")):
        items += json.loads(f.read_text(encoding="utf-8"))
    items.sort(key=lambda x: (x["id"][:2] != "HE", x["id"]))
    errs = check(items)
    if errs:
        print("hackers QA FAILED:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    out = {"source": "해커스 Updated TOEFL Writing · 20일 완성 모범 답안 (전사본)", "items": items}
    s = json.dumps(out, ensure_ascii=False)
    (Z / "hackers.json").write_text(s, encoding="utf-8")
    (Z / "hackers.js").write_text("window.HACKERS = " + s + ";\n", encoding="utf-8")
    words = lambda x: len(re.findall(r"[A-Za-z0-9'’-]+", " ".join(q["text"] for q in x["parts"])))
    for t in ("HE", "HD"):
        ws = [words(x) for x in items if x["id"].startswith(t)]
        print(f"{t}: {len(ws)}개, 모범답안 {min(ws)}–{max(ws)}단어 (평균 {sum(ws) // len(ws)})")
    print(f"→ {Z / 'hackers.js'}")


if __name__ == "__main__":
    main()
