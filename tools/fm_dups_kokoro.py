#!/usr/bin/env python3
"""중복 문제(dups.json)의 음성을 Kokoro로 만든다. FM-TOEFL은 원본 음원을 받을 수 없어 전사 스크립트로 재구성 (앱에 'Kokoro 생성' 표시).
대상: L1·L2·L3 스크립트 → private/zhan/dups_audio/<id>.mp3 · S2 질문 → <id>.mp3 · S3 질문 → <id>_q<k>.mp3
실행: ~/.venvs/kokoro/bin/python tools/fm_dups_kokoro.py   (py3.10, 속도 1.25배, 이미 있으면 건너뜀)"""
import json, re, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
OUT = Z / "dups_audio"
SPEED, VOICE = 1.25, "am_michael"
VOICES = {"M": "am_michael", "W": "af_heart"}   # 대화: 남 / 여
GAP = 0.35   # 말차례 사이 쉼(초)


def targets():
    for g in json.loads((Z / "dups.json").read_text())["groups"]:
        if g["cat"] in ("L1", "L2", "L3"):
            yield g["id"], g["script"]
        elif g["cat"] == "S2":
            yield g["id"], g["question"]
        elif g["cat"] == "S3":
            for k, q in enumerate(g["questions"]):
                yield f"{g['id']}_q{k}", q


def turns_for(gid, text):
    """남녀 말차례: private/zhan/dups_turns.txt(손으로 나눈 대화) → 스크립트의 (man)/(woman) 표시 → 없으면 None(한 목소리)."""
    f = Z / "dups_turns.txt"
    if f.exists():
        cur, got = None, {}
        for ln in f.read_text().splitlines():
            if ln.startswith("## "):
                cur = ln[3:].strip(); got[cur] = []
            elif cur and re.match(r"^[MW]: ", ln):
                got[cur].append((ln[0], ln[3:].strip()))
        if got.get(gid):
            return got[gid]
    parts = re.split(r"\((man|woman)\)\s*", text)
    if len(parts) > 2:
        return [("M" if parts[i] == "man" else "W", parts[i + 1].strip()) for i in range(1, len(parts) - 1, 2) if parts[i + 1].strip()]
    return None


def main():
    import sys
    import numpy as np, soundfile as sf
    from kokoro import KPipeline
    force = "--force-dialog" in sys.argv   # 화자를 나눈 대화는 이미 있어도 다시 만든다
    OUT.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a")
    n = 0
    todo = [(i, re.sub(r"\s+", " ", t or "").strip()) for i, t in targets()]
    for gid, text in todo:
        mp3 = OUT / f"{gid}.mp3"
        turns = turns_for(gid, text) if gid.startswith(("L2-", "L3-")) else None
        if (mp3.exists() and not (force and turns)) or not text:
            continue
        if turns:
            gap = np.zeros(int(24000 * GAP), dtype=np.float32)
            segs = []
            for who, t in turns:
                segs += [np.concatenate([np.asarray(a) for _, _, a in pipe(t, voice=VOICES[who], speed=SPEED)]), gap]
            audio = np.concatenate(segs)
        else:
            audio = np.concatenate([np.asarray(a) for _, _, a in pipe(text, voice=VOICE, speed=SPEED)])
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "a.wav"
            sf.write(wav, audio, 24000)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", "64k", str(mp3)], check=True)
        n += 1
        print(gid, round(len(audio) / 24000, 1), "s", flush=True)
    print(f"Kokoro 생성 {n}개 (전체 대상 {len(todo)}개) → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
