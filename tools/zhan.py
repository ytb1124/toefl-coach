#!/usr/bin/env python3
"""소站(zhan.com) TPO独家 리스닝 오답 세트 → 앱의 로컬 전용 데이터 (private/zhan/listen.js).

입력 (모두 gitignore된 private/zhan/, 저작권 때문에 공개 저장소에 올리지 않는다):
  Mock_Test_<N>_<workflowId>.json  리포트 페이지에서 내보낸 오답 세트 (스크립트·문항·내 답·정답·중국어 해설·음원 URL)
  audio/<파일명>                    원본 음원 (URL의 마지막 경로)
  ko.json                           (선택) 문항 id → 한국어 해설 {"why": "...", "point": "..."}
출력: private/zhan/listen.js (window.ZHAN, 로컬 서버용) + listen.json (비공개 저장소 ytb1124/toefl-coach-private용)
  python3 tools/zhan.py           변환
  python3 tools/zhan.py --todo    한국어 해설이 아직 없는 오답 문항을 JSON으로 출력 (번역 작업용)
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
LETTERS = "ABCDEFGHI"
TIME = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\]\s*")
SPEAKER_TAG = re.compile(r"^\(([A-Za-z0-9\- ]{1,8})\):?\s*")          # (WA) (M-Can)
SPEAKER_HASH = re.compile(r"^####_\d+_([^#:]+):_####\s*")              # ####_1_Woman:_####


def script_lines(text):
    """스크립트 두 형식을 {sp, t, at} 줄로.
    A: '(WA) Hello.'  B: '[00:05.06]####_1_Woman:_#### Hello.' (타임스탬프 = 원본 음원 위치, 초).
    화자 표시가 없는 줄: 첫 안내문은 내레이터 N, 그 뒤는 앞 화자를 이어받는다."""
    out, cur = [], None
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        at = None
        m = TIME.match(line)
        if m:
            at = round(int(m.group(1)) * 60 + float(m.group(2)), 2)
            line = line[m.end():]
        m = SPEAKER_HASH.match(line) or SPEAKER_TAG.match(line)
        if m:
            cur = m.group(1).strip()
            line = line[m.end():]
        line = line.strip()
        if not line:
            continue
        if at is None and out and m is None and cur and out[-1]["sp"] == cur:
            out[-1]["t"] += " " + line          # 타임스탬프·화자 없이 이어지는 줄
            continue
        out.append({"sp": cur or "N", "t": line, "at": at})
        if cur is None:
            cur = None                         # 안내문 다음 줄은 화자 태그로 시작한다
    return out


def local_audio(url):
    if not url:
        return None
    name = url.rstrip("/").split("/")[-1]
    return f"private/zhan/audio/{name}" if (Z / "audio" / name).exists() else None


def kind(title):
    t = title.lower()
    if "reply" in t or "best respon" in t:
        return "reply"
    for k in ("conversation", "announcement", "lecture"):
        if k in t:
            return k
    return "other"


def app_originals():
    """앱 '오늘 훈련'의 리스닝 원본 오답 (content/originals.json + content/tests/*.json). 같은 문제를 연결하려고 읽는다."""
    o = json.loads((ROOT / "content" / "originals.json").read_text())
    o = o if isinstance(o, list) else o.get("originals", [])
    for f in sorted((ROOT / "content" / "tests").glob("*.json")):
        o += json.loads(f.read_text()).get("originals", [])
    return [x for x in o if x.get("sec") == "L" and x.get("options")]


def norm(t):
    return re.sub(r"[^a-z]", "", (t or "").lower())


def match_orig(q, origs, used):
    """같은 질문(문장 일치) → 없으면 같은 정답 보기 문장. 한 원본은 한 문항에만."""
    for key in (lambda o: norm(o["stem"]) == norm(q["stem"]),
                lambda o: o.get("correct") is not None and norm(o["options"][o["correct"]]) == norm(q["choices"][q["answer"]])):
        for o in origs:
            if o["id"] not in used and norm(o["stem"]) and key(o):
                used.add(o["id"])
                return o["id"]
    return None


def load():
    origs, used = app_originals(), set()
    ko = json.loads((Z / "ko.json").read_text()) if (Z / "ko.json").exists() else {}
    tests, sets = [], []
    for f in sorted(Z.glob("Mock_Test_*.json"), key=lambda p: int(p.stem.split("_")[2])):
        d = json.loads(f.read_text())
        n = int(d["paper"].split()[-1])
        tid = f"Z{n}"
        tests.append({"id": tid, "name": f"TPO独家 {n}", "date": (d.get("date") or "")[:10],
                      "score": d.get("score"), "correct": d.get("correct"), "total": d.get("total")})
        for s in d["sets"]:
            sid = f"{tid}-M{s['m']}-T{s['task']}"
            k = kind(s["title"])
            qs = []
            for i, q in enumerate(s["qs"], 1):
                qid = f"{sid}-Q{i}"
                tr = ko.get(qid) or {}
                qs.append({
                    "id": qid, "wrong": q["wrong"], "stem": q["stem"], "choices": q["choices"],
                    "answer": LETTERS.index(q["answer"]) if q.get("answer") in LETTERS else None,
                    "my": LETTERS.index(q["my"]) if q.get("my") and q["my"] in LETTERS else None,
                    "audio": local_audio(q.get("audio")),
                    "whyKo": tr.get("why"), "point": tr.get("point"), "whyZh": q.get("why") or None,
                })
                if q["wrong"]:
                    qs[-1]["orig"] = match_orig(qs[-1], origs, used)
            sets.append({"id": sid, "test": tid, "module": s["m"], "task": s["task"], "title": s["title"], "kind": k,
                         "audio": local_audio(s.get("audio")), "script": script_lines(s.get("script")), "qs": qs})
    return tests, sets


def check(tests, sets):
    errs = []
    for s in sets:
        if s["kind"] != "reply" and not s["audio"]:
            errs.append(f"{s['id']}: 음원 파일 없음")
        if s["kind"] != "reply" and not s["script"]:
            errs.append(f"{s['id']}: 스크립트 없음")
        for q in s["qs"]:
            if q["answer"] is None or q["answer"] >= len(q["choices"]):
                errs.append(f"{q['id']}: 정답 인덱스 이상")
            if s["kind"] == "reply" and not q["audio"]:
                errs.append(f"{q['id']}: Listen & Reply 음원 없음")
    return errs


def main():
    tests, sets = load()
    if "--todo" in sys.argv:
        todo = [{"id": q["id"], "set": s["title"], "script": " ".join(f"({l['sp']}) {l['t']}" for l in s["script"]) or None,
                 "stem": q["stem"], "choices": q["choices"], "answer": LETTERS[q["answer"]], "my": LETTERS[q["my"]] if q["my"] is not None else None,
                 "whyZh": q["whyZh"]}
                for s in sets for q in s["qs"] if q["wrong"] and not q["whyKo"]]
        print(json.dumps(todo, ensure_ascii=False, indent=1))
        return
    errs = check(tests, sets)
    for e in errs:
        print("✗", e)
    data = json.dumps({"tests": tests, "sets": sets}, ensure_ascii=False)
    out = Z / "listen.js"   # 로컬 서버(start.command)용
    out.write_text("/* 생성 파일 (tools/zhan.py). 원본 저작물 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN = " + data + ";\n")
    (Z / "listen.json").write_text(data + "\n")   # 비공개 GitHub 저장소용 (앱이 토큰으로 읽음)
    wrong = sum(q["wrong"] for s in sets for q in s["qs"])
    linked = sum(1 for s in sets for q in s["qs"] if q.get("orig"))
    ko = sum(1 for s in sets for q in s["qs"] if q["wrong"] and q["whyKo"])
    print(f"{out.relative_to(ROOT)}: 회차 {len(tests)} · 세트 {len(sets)} · 오답 {wrong} (한국어 해설 {ko}/{wrong}) · 앱 원본 오답과 연결 {linked}")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
