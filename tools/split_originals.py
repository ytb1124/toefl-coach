#!/usr/bin/env python3
"""한 번만 실행 (개편 단계 2): 원본 오답의 원문 필드를 비공개 저장소로 옮긴다 (OVERHAUL.md 원칙 3).
content/originals.json · content/tests/<ID>.json 의 각 원본 오답에서 TEXT 필드, audioSets의 lines를
private/zhan/originals/<파일>.json 으로 옮기고 공개 파일에는 메타데이터만 남긴다. <ID>.screens.md(캡처 전사본)도 옮긴다.
이미 옮긴 항목은 건너뛴다 (다시 실행해도 안전). 새 회차를 추가할 때도 이 스크립트로 나눈다."""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIV = ROOT / "private" / "zhan" / "originals"
TEXT = ("stem", "options", "passage", "ctest", "evidence", "trap", "diff")


def split(path):
    d = json.loads(path.read_text(encoding="utf-8"))
    out_f = PRIV / (path.stem + ".json")
    priv = json.loads(out_f.read_text()) if out_f.exists() else {"originals": {}, "audioSets": {}}
    moved = 0
    for o in d.get("originals", []):
        t = {k: o.pop(k) for k in TEXT if k in o}
        if t:
            priv["originals"].setdefault(o["id"], {}).update(t)
            moved += 1
        if "options" in priv["originals"].get(o["id"], {}):
            o["nOptions"] = len(priv["originals"][o["id"]]["options"])
        if "ctest" in priv["originals"].get(o["id"], {}):
            o["isCtest"] = True
    for sid, a in (d.get("audioSets") or {}).items():
        if "lines" in a:
            priv["audioSets"][sid] = {"lines": a.pop("lines")}
            a["private"] = True
    PRIV.mkdir(parents=True, exist_ok=True)
    out_f.write_text(json.dumps(priv, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    scr = path.with_name(path.stem + ".screens.md")
    if scr.exists():
        shutil.move(str(scr), str(PRIV / scr.name))
    print(f"{path.relative_to(ROOT)}: 원문 {moved}개 → {out_f.relative_to(ROOT)}")


if __name__ == "__main__":
    split(ROOT / "content" / "originals.json")
    for f in sorted((ROOT / "content" / "tests").glob("*.json")):
        split(f)


SW_TEXT = ("to", "subject", "scenario", "tasks", "prof", "students", "q")


def split_sw(ids):
    """content/sw.json에서 소站 원문과 같은 문제(빌드 누출 검사가 찾은 id)의 문제 문장을 private/zhan/sw_private.json으로."""
    p = ROOT / "content" / "sw.json"
    sw = json.loads(p.read_text(encoding="utf-8"))
    out_f = ROOT / "private" / "zhan" / "sw_private.json"
    priv = json.loads(out_f.read_text()) if out_f.exists() else {}
    n = 0
    for kind in ("email", "discussion"):
        for it in sw.get(kind, []):
            if it["id"] not in ids:
                continue
            t = {k: it.pop(k) for k in SW_TEXT if k in it}
            if t:
                priv.setdefault(kind, {}).setdefault(it["id"], {}).update(t)
                it["private"] = True
                n += 1
    out_f.write_text(json.dumps(priv, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    p.write_text(json.dumps(sw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"content/sw.json: 소站 원문 문제 {n}개 → private/zhan/sw_private.json")
