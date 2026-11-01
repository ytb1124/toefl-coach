#!/usr/bin/env python3
"""시각(at)이 없는 소站 리스닝 스크립트 줄에 Whisper 단어 시각으로 시작 시각을 붙인다
('근거 구간만 다시 듣기'·받아쓰기 구간용). 출력 private/zhan/align.json {세트 id: [줄별 at 또는 null]} — zhan_pool.py가 합친다.
실행: ~/.venvs/whisper/bin/python tools/zhan_align.py [--all]  (faster-whisper base.en; --all이면 전 세트를 다시 정렬)"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
OUT = Z / "align.json"
norm = lambda t: re.findall(r"[a-z0-9']+", t.lower().replace("’", "'"))


def align_lines(lines, words):
    """lines: 스크립트 줄 텍스트, words: [(word, start)] → 줄마다 시작 시각.
    스크립트 전체 단어와 Whisper 단어를 한 번에 맞춘다 (difflib): 줄 첫머리 단어가 틀리게 들려도 그 줄의 다른 단어로 시각을 잡는다.
    줄에서 처음 맞은 단어가 k번째면 k × 0.3초를 앞당긴다. 맞는 단어가 하나도 없는 줄은 None."""
    import difflib
    sw, owner = [], []
    for i, t in enumerate(lines):
        for w in norm(t):
            sw.append(w); owner.append(i)
    hw = [w for w, _ in words]
    m = {}
    for a, b, n in difflib.SequenceMatcher(None, sw, hw, autojunk=False).get_matching_blocks():
        for k in range(n):
            m[a + k] = b + k
    out, prev = [], 0.0
    first = {}
    for idx, i in enumerate(owner):
        first.setdefault(i, idx)
    for i, t in enumerate(lines):
        if i not in first:
            out.append(None); continue
        idxs = [x for x in range(first[i], len(owner)) if owner[x] == i]
        hit = next((x for x in idxs[:12] if x in m), None)
        if hit is None:
            out.append(None); continue
        at = max(prev, words[m[hit]][1] - 0.3 * (hit - first[i]))
        out.append(round(at, 2)); prev = at
    return out


def main():
    """모든 리스닝 세트를 다시 정렬한다 (--all 없이 실행하면 아직 없는 세트만)."""
    from faster_whisper import WhisperModel
    pool = json.loads((Z / "pool.json").read_text())
    redo = "--all" in sys.argv
    done = {} if redo else (json.loads(OUT.read_text()) if OUT.exists() else {})
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    for s in pool["sets"]:
        if s["sec"] != "L" or s["kind"] == "reply" or s["id"] in done or not s.get("audio"):
            continue
        def run(**kw):
            segs, _ = model.transcribe(str(ROOT / s["audio"]), language="en", word_timestamps=True, **kw)
            words = []
            for seg in segs:
                for w in seg.words or []:
                    for t in norm(w.word):
                        words.append((t, w.start))
            return align_lines([l["t"] for l in s["script"]], words)
        ats = run()
        if sum(a is None for a in ats[1:]) > 0:   # Whisper가 첫 문장 뒤를 건너뛰는 경우가 있다 → 앞 문맥 없이·무음 거르고 다시
            again = run(condition_on_previous_text=False, vad_filter=True)
            if sum(a is None for a in again) < sum(a is None for a in ats):
                ats = again
        done[s["id"]] = ats
        OUT.write_text(json.dumps(done))
        print(s["id"], f"{sum(a is not None for a in ats)}/{len(ats)} 줄", flush=True)
    print("정렬 완료:", len(done), "세트")


if __name__ == "__main__":
    main()
