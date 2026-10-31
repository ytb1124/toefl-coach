#!/usr/bin/env python3
"""독점 TPO 라이팅 Task 1 (Build a Sentence) 오답 → 앱의 비공개 데이터 (private/zhan/writing.js · writing.json).

입력 (gitignore된 private/zhan/writing/, 원본 저작물이라 공개 저장소에 올리지 않는다):
  Mock_Test_<N>_<workflowId>.json  리포트에서 내보낸 Build a Sentence 10문항 (parts: 말풍선 A/B, 빈칸 __SLOT_n__ 별 내 답·정답, options = 타일)
  ko.json                           (선택) 문항 id → {"why", "point"} 한국어 해설
출력 항목은 앱의 content/sw.json buildSentence와 같은 모양 (context · template '_' · answer 타일 순서 · extra 남는 타일)
에 my(시험 때 내가 놓은 타일 순서)·whyKo·test를 더한 것. 말하기·쓰기 탭의 Build a Sentence에서 '독점 TPO 오답'으로 푼다.
  python3 tools/zhan_write.py          변환
  python3 tools/zhan_write.py --todo   한국어 해설이 없는 오답 JSON (번역 작업용)
"""
import json, re, sys
from zhan import ROOT

Z = ROOT / "private" / "zhan"
W = Z / "writing"
SLOT = re.compile(r"__SLOT_(\d+)__")


def context_from_why(why, filled):
    """말풍선 A가 데이터에 없을 때: 해설 첫 줄(영어 문장, 정답 문장이 아님) 또는 '题干…：<영어>（' 에서 찾는다. 없으면 None."""
    why = (why or "").strip().strip('"')
    norm = lambda t: re.sub(r"[^a-z]", "", t.lower())
    is_answer = lambda t: norm(filled) in norm(t) or norm(t) in norm(filled)   # 정답 문장 자체면 버린다
    first = why.split("\n", 1)[0].strip()
    if re.fullmatch(r"[A-Za-z0-9 ,.'’?!\-]+", first) and not is_answer(first):
        return first
    m = re.search(r"题干[^：:]*[：:]\s*([A-Za-z][A-Za-z0-9 ,.'’?!\-]+[?.!])", why)
    return m.group(1).strip() if m and not is_answer(m.group(1)) else None


def fill(template, tiles):
    it = iter(tiles)
    return re.sub(r"_", lambda m: next(it, "_"), template)


def order_from_sentence(template, tiles, sentence):
    """템플릿 빈칸을 정답 문장과 맞춰 가며 타일 순서를 찾는다 (각 타일은 한 번씩). 못 맞추면 []."""
    words = lambda t: re.findall(r"[a-z'’\-]+", t.lower())
    target, fixed = words(sentence), template.split("_")
    def go(i, k, left):   # i: 다음 빈칸 번호, k: target에서의 위치
        f = words(fixed[i])
        if target[k:k + len(f)] != f:
            return None
        k += len(f)
        if i == len(fixed) - 1:
            return [] if k == len(target) else None
        for t in dict.fromkeys(left):
            w = words(t)
            if target[k:k + len(w)] == w:
                rest = list(left); rest.remove(t)
                r = go(i + 1, k + len(w), rest)
                if r is not None:
                    return [t] + r
        return None
    return go(0, 0, tiles) or []


def load():
    ko = json.loads((W / "ko.json").read_text()) if (W / "ko.json").exists() else {}
    tests, items = [], []
    for f in sorted(W.glob("Mock_Test_*.json"), key=lambda p: int(p.stem.split("_")[2])):
        d = json.loads(f.read_text())
        n = int(d["paper"].split()[-1])
        tid = f"Z{n}"
        tests.append({"id": tid, "name": f"독점 TPO {n}", "date": (d.get("date") or "")[:10], "correct": d.get("correct"), "total": d.get("total")})
        for q in d["qs"]:
            if not q["wrong"]:
                continue
            slotted = [p for p in q["parts"] if p.get("slots")]
            plain = [p for p in q["parts"] if not p.get("slots")]
            if len(slotted) != 1:
                continue
            sp = slotted[0]
            slots = sorted(sp["slots"], key=lambda s: s["index"])
            answer = [s["correctAnswer"] for s in slots]
            my = [s.get("userAnswer") or "" for s in slots]
            pool = list(q["options"])
            if len(pool) == 1 and "/" in pool[0]:   # 사이트 데이터가 깨져 타일이 '/'로 한 칸에 몰린 경우: 해설 첫 줄 정답 문장으로 복원, 내 답은 알 수 없음
                pool = [t.strip() for t in pool[0].split("/")]
                answer, my = order_from_sentence(SLOT.sub("_", sp["content"]), pool, (q.get("why") or "").strip().strip('"').split("\n", 1)[0]), None
            for a in answer:                      # 남는 타일 = 보기에서 정답 타일을 하나씩 뺀 나머지
                if a in pool:
                    pool.remove(a)
            iid = f"{tid}-BS{q['n']}"
            tr = ko.get(iid) or {}
            items.append({
                "id": iid, "test": tid, "src": f"독점 TPO {n}",
                "context": " ".join(p["content"] for p in plain).strip() or context_from_why(q.get("why"), fill(SLOT.sub("_", sp["content"]), answer)),
                "first": sp.get("label") == "A",    # 빈칸 문장이 먼저 나오는 경우 (A가 빈칸)
                "template": SLOT.sub("_", sp["content"]),
                "answer": answer, "extra": pool,
                "my": my,
                "point": tr.get("point") or "", "whyKo": tr.get("why"), "whyZh": q.get("why"),
            })
    return tests, items


def check(items):
    errs = []
    for it in items:
        if it["template"].count("_") != len(it["answer"]):
            errs.append(f"{it['id']}: 빈칸 {it['template'].count('_')}개 / 정답 타일 {len(it['answer'])}개")
        if not it["context"]:
            print(f"· {it['id']}: 앞 말풍선이 기록에 없음 (화면에 '기록 없음'으로 표시)")
    return errs


def main():
    tests, items = load()
    if "--todo" in sys.argv:
        print(json.dumps([{"id": i["id"], "context": i["context"], "template": i["template"], "answer": " ".join(i["answer"]),
                           "my": " ".join(i["my"]) if i["my"] else None, "tiles": i["answer"] + i["extra"], "whyZh": i["whyZh"]}
                          for i in items if not i["whyKo"]], ensure_ascii=False, indent=1))
        return
    errs = check(items)
    for e in errs:
        print("✗", e)
    for i in items:   # 중국어 해설 원문은 앱에 보내지 않는다
        i.pop("whyZh", None)
    data = json.dumps({"tests": tests, "items": items}, ensure_ascii=False)
    (Z / "writing.js").write_text("/* 생성 파일 (tools/zhan_write.py). 원본 저작물 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN_WRITE = " + data + ";\n")
    (Z / "writing.json").write_text(data + "\n")
    ko = sum(1 for i in items if i["whyKo"])
    print(f"private/zhan/writing.js: 회차 {len(tests)} · Build a Sentence 오답 {len(items)} (한국어 해설 {ko}/{len(items)})")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
