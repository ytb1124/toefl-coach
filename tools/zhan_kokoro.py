#!/usr/bin/env python3
"""소站 원본 음원이 없는 문항의 음성을 Kokoro로 만든다 (OVERHAUL.md 원칙 6: 받을 수 없을 때만, 앱에 'Kokoro 생성' 표시).
지금 대상: Interview 질문 (소站 데이터에는 세트 도입부 음성뿐). 출력 private/zhan/kokoro/<문항 id>.mp3 (비공개).
실행: ~/.venvs/kokoro/bin/python tools/zhan_kokoro.py   (py3.10, 속도 1.25배, 이미 있으면 건너뜀)"""
import json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Z = ROOT / "private" / "zhan"
OUT = Z / "kokoro"
SPEED, VOICE = 1.25, "am_michael"


def targets():
    pool = json.loads((Z / "pool.json").read_text())
    for s in pool["sets"]:
        if s["kind"] == "interview":
            for q in s["qs"]:
                if not q.get("audio"):
                    yield q["id"], re.sub(r"\s+", " ", q["text"]).strip()


def main():
    import numpy as np, soundfile as sf
    from kokoro import KPipeline
    OUT.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a")
    n = 0
    for qid, text in targets():
        mp3 = OUT / f"{qid}.mp3"
        if mp3.exists():
            continue
        audio = np.concatenate([np.asarray(a) for _, _, a in pipe(text, voice=VOICE, speed=SPEED)])
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "a.wav"
            sf.write(wav, audio, 24000)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", "64k", str(mp3)], check=True)
        n += 1
        print(qid, round(len(audio) / 24000, 1), "s", flush=True)
    print(f"Kokoro 생성 {n}개 (전체 대상 {sum(1 for _ in targets())}개) → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
