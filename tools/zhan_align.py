#!/usr/bin/env python3
"""시각(at)이 없는 소站 리스닝 스크립트 줄에 Whisper 단어 시각으로 시작 시각을 붙인다
('근거 구간만 다시 듣기'·받아쓰기 구간용). 출력 private/zhan/align.json {세트 id: [줄별 at 또는 null]} — zhan_pool.py가 합친다.
실행: ~/.venvs/whisper/bin/python tools/zhan_align.py  (faster-whisper base.en, 이미 있는 세트는 건너뜀)"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
OUT = Z / "align.json"
norm = lambda t: re.findall(r"[a-z0-9']+", t.lower().replace("’", "'"))


def align_lines(lines, words):
    """lines: 스크립트 줄 텍스트, words: [(word, start)] → 줄마다 첫 단어의 시작 시각 (순서대로 탐색, 못 찾으면 None)."""
    out, j = [], 0
    for t in lines:
        w = norm(t)
        if not w:
            out.append(None); continue
        head = w[:3]
        found = None
        for k in range(j, min(len(words), j + 400)):
            if [x[0] for x in words[k:k + len(head)]] == head:
                found = k; break
        if found is None:   # 첫 두 단어만으로 한 번 더
            for k in range(j, min(len(words), j + 400)):
                if [x[0] for x in words[k:k + 2]] == head[:2]:
                    found = k; break
        if found is None:
            out.append(None); continue
        out.append(round(words[found][1], 2))
        j = found + max(1, len(w) - 2)
    return out


def main():
    from faster_whisper import WhisperModel
    pool = json.loads((Z / "pool.json").read_text())
    done = json.loads(OUT.read_text()) if OUT.exists() else {}
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    for s in pool["sets"]:
        if s["sec"] != "L" or s["kind"] == "reply" or s["id"] in done or not s.get("audio"):
            continue
        if all(l.get("at") is not None for l in s["script"]):
            continue
        segs, _ = model.transcribe(str(ROOT / s["audio"]), language="en", word_timestamps=True)
        words = []
        for seg in segs:
            for w in seg.words or []:
                for t in norm(w.word):
                    words.append((t, w.start))
        ats = align_lines([l["t"] for l in s["script"]], words)
        done[s["id"]] = ats
        OUT.write_text(json.dumps(done))
        print(s["id"], f"{sum(a is not None for a in ats)}/{len(ats)} 줄", flush=True)
    print("정렬 완료:", len(done), "세트")


if __name__ == "__main__":
    main()
