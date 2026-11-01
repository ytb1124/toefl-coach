#!/usr/bin/env python3
"""build.py가 부르는 Kokoro 렌더러: 문장 목록(JSON, stdin) → 문장별 WAV (24 kHz mono).
입력: [{"voice": "af_heart", "text": "...", "out": "/tmp/.../0.wav"}, ...]
실행: ~/.venvs/kokoro/bin/python tools/kokoro_render.py <speed> < jobs.json   (py3.10)"""
import json, sys


def main():
    import numpy as np, soundfile as sf
    from kokoro import KPipeline
    speed = float(sys.argv[1])
    jobs = json.load(sys.stdin)
    pipes = {}
    for j in jobs:
        lang = j["voice"][0]          # a = American, b = British
        pipe = pipes.get(lang) or pipes.setdefault(lang, KPipeline(lang_code=lang))
        audio = np.concatenate([np.asarray(a) for _, _, a in pipe(j["text"], voice=j["voice"], speed=speed)])
        sf.write(j["out"], audio, 24000)


if __name__ == "__main__":
    main()
