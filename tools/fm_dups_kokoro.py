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


def targets():
    for g in json.loads((Z / "dups.json").read_text())["groups"]:
        if g["cat"] in ("L1", "L2", "L3"):
            yield g["id"], g["script"]
        elif g["cat"] == "S2":
            yield g["id"], g["question"]
        elif g["cat"] == "S3":
            for k, q in enumerate(g["questions"]):
                yield f"{g['id']}_q{k}", q


def main():
    import numpy as np, soundfile as sf
    from kokoro import KPipeline
    OUT.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a")
    n = 0
    todo = [(i, re.sub(r"\s+", " ", t or "").strip()) for i, t in targets()]
    for gid, text in todo:
        mp3 = OUT / f"{gid}.mp3"
        if mp3.exists() or not text:
            continue
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
