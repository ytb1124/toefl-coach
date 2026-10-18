#!/usr/bin/env python3
"""New mock-test intake (see CLAUDE.md for the full procedure).

  python3 tools/intake.py new TPO5 2026-10-20     # scaffold content/tests/TPO5.json + screenshot inbox folder
  python3 tools/intake.py check TPO5              # QA everything + summary of this test vs. earlier tests
  python3 tools/intake.py report TPO5             # print the error report as Markdown (to paste in chat)
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

ROOT = build.ROOT
TESTS = build.CONTENT / "tests"
INBOX = ROOT.parent / "tpo오답"

TEMPLATE = {
    "_help": {
        "test": "reading/listening/ctest = [정답, 전체] — 화면에서 분모를 확인할 수 없으면 null. errors = originals 개수와 같아야 함.",
        "report": "headline 한 줄 / findings: 능력별 발견 (skill + text, recurrence: 'repeat'|'new'|'improved') / next: 다음 훈련 초점. 확인된 사실과 추정을 구분.",
        "originals": "content/originals.json 과 같은 형식. id = '<TEST>-R1' / '<TEST>-L1'. 모르는 값은 null + gaps[]. evidence 는 지문/스크립트 원문 그대로.",
        "audioSets": "리스닝 오답은 스크린샷의 스크립트로 음원 세트를 만든다. id = 'o-<test>-<topic>'. 화자: N 내레이터, W/M 여·남, W2/M2 두 번째 여·남.",
    },
    "test": {"id": "", "date": "", "reading": None, "listening": None, "ctest": None, "errors": 0, "note": ""},
    "report": {"headline": "", "findings": [], "next": ""},
    "audioSets": {},
    "originals": [],
}


def cmd_new(test_id, date):
    TESTS.mkdir(parents=True, exist_ok=True)
    f = TESTS / f"{test_id}.json"
    if f.exists():
        sys.exit(f"{f} already exists")
    t = json.loads(json.dumps(TEMPLATE))
    t["test"].update(id=test_id, date=date)
    f.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
    inbox = INBOX / f"{date}_{test_id}"
    inbox.mkdir(parents=True, exist_ok=True)
    print(f"created {f.relative_to(ROOT)}")
    print(f"screenshot inbox: {inbox}")


def summary(test_id):
    data = build.load_all()
    errs = build.check(data)
    test = next((t for t in data["tests"] if t["id"] == test_id), None)
    if not test:
        sys.exit(f"test {test_id} not found in content/tests/")
    mine = [o for o in data["originals"] if o["test"] == test_id]
    earlier = [t for t in data["tests"] if t["date"] < test["date"]]
    prev = Counter(o["skill"] for o in data["originals"] if o["test"] in {t["id"] for t in earlier})
    names = {s["id"]: s["name"] for s in data["skills"]}
    now = Counter(o["skill"] for o in mine)
    fresh = Counter(i["skill"] for i in data["items"] if i["tier"] == "transfer")
    return data, errs, test, mine, earlier, prev, now, names, fresh


def cmd_check(test_id):
    data, errs, test, mine, earlier, prev, now, names, fresh = summary(test_id)
    if errs:
        print("QA FAILED:")
        for e in errs:
            print("  -", e)
    else:
        print("QA passed")
    sec = Counter(o["sec"] for o in mine)
    unknown_my = sum(1 for o in mine if o.get("my") is None and o["skill"] != "UNKNOWN")
    print(f"\n{test_id} ({test['date']}): {len(mine)} errors — Reading {sec['R']}, Listening {sec['L']}; "
          f"내 답 UNKNOWN {unknown_my}, 분석 불가 {now.get('UNKNOWN', 0)}")
    print(f"earlier tests: {', '.join(t['id'] for t in earlier) or '(none)'}\n")
    print(f"{'skill':8} {'이번':>4} {'이전 합계':>8}  판정")
    for s in data["skills"]:
        k = s["id"]
        if not now[k] and not prev[k]:
            continue
        verdict = "재발 (이전에도 있음)" if now[k] and prev[k] else "새 패턴" if now[k] else "이번엔 없음"
        print(f"{k:8} {now[k]:>4} {prev[k]:>8}  {verdict}")
    newp = [k for k in now if k != "UNKNOWN" and not prev[k]]
    if newp:
        print("\n새 패턴 → 전용 transfer 문제가 충분한지 확인:", ", ".join(f"{k}({fresh[k]}문항)" for k in newp))
    rep = test.get("report") or {}
    if not rep.get("headline") or not rep.get("findings"):
        print("\n주의: report.headline / report.findings 가 비어 있음")
    if errs:
        sys.exit(1)


def cmd_report(test_id):
    data, errs, test, mine, earlier, prev, now, names, fresh = summary(test_id)
    rep = test.get("report") or {}
    L = lambda o, i: (o["options"][i] if o.get("options") and i is not None else (i or "기록 없음"))
    print(f"# {test_id} 오답 리포트 ({test['date']})\n")
    for k, label in (("reading", "Reading"), ("listening", "Listening"), ("ctest", "C-Test")):
        v = test.get(k)
        if v:
            print(f"- {label}: {v[0]}/{v[1]} ({round(100 * v[0] / v[1])}%)")
    print(f"- 오답 {len(mine)}개\n")
    if rep.get("headline"):
        print(f"**{rep['headline']}**\n")
    for f in rep.get("findings", []):
        tag = {"repeat": "재발", "new": "새 패턴", "improved": "개선 신호"}.get(f.get("recurrence"), "")
        print(f"- **{names.get(f.get('skill'), '기타')}** {('· ' + tag) if tag else ''}: {f['text']}")
    print("\n| # | 유형 | 내 답 → 정답 | 원인 (AI 추정) | 능력 |\n|---|---|---|---|---|")
    for o in mine:
        if "ctest" in o:
            pair = f"{o.get('my') or '기록 없음'} → {o['ctest']['answer']}"
        else:
            pair = f"{L(o, o.get('my'))} → {L(o, o.get('correct'))}"
        print(f"| {o['id']} | {o.get('qtype', '')} | {pair} | {o.get('causeAI', '')} | {names.get(o['skill'], o['skill'])} |")
    if rep.get("next"):
        print(f"\n**다음 훈련**: {rep['next']}")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, test_id = sys.argv[1], sys.argv[2]
    if cmd == "new":
        if len(sys.argv) < 4:
            sys.exit("usage: intake.py new <TEST_ID> <YYYY-MM-DD>")
        cmd_new(test_id, sys.argv[3])
    elif cmd == "check":
        cmd_check(test_id)
    elif cmd == "report":
        cmd_report(test_id)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
