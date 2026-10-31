#!/usr/bin/env python3
"""로컬 서버: 정적 파일 + Whisper 받아쓰기(/stt). start.command가 띄운다 (같은 Mac, 같은 와이파이의 휴대폰).
  GET  /stt/health  → {"ok": true, "model": "base.en"}  (앱이 STT를 쓸 수 있는지 확인)
  POST /stt         → 녹음 바이트(webm/ogg/wav, 브라우저 MediaRecorder) → {"text", "words": [{w, start, end}], "duration"}
faster-whisper가 없는 파이썬으로 실행하면 /stt는 503 (앱은 '내 녹음 ↔ 원문 번갈아 듣기'로 대체).
  ~/.venvs/whisper/bin/python tools/serve.py [port]"""
import io, json, os, sys, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = os.environ.get("STT_MODEL", "base.en")
_model, _lock = None, threading.Lock()


def model():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
        return _model


def available():
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def transcribe(data, prompt=None):
    t0 = time.time()
    # vad_filter: 소리 없는 녹음에서 Whisper가 말을 지어내지 않게 (예: 무음 → "You")
    segs, info = model().transcribe(io.BytesIO(data), language="en", word_timestamps=True, vad_filter=True,
                                    initial_prompt=prompt or None, condition_on_previous_text=False)
    words, text = [], []
    for s in segs:
        text.append(s.text)
        for w in s.words or []:
            words.append({"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)})
    return {"text": "".join(text).strip(), "words": words, "duration": round(info.duration, 2), "ms": int(1000 * (time.time() - t0))}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, fmt, *args):
        if "/stt" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/stt/health"):
            return self._json(200 if available() else 503, {"ok": available(), "model": MODEL_NAME})
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/stt"):
            return self._json(404, {"error": "not found"})
        if not available():
            return self._json(503, {"error": "faster-whisper 없음"})
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > 20_000_000:
            return self._json(400, {"error": "녹음 크기 이상"})
        data = self.rfile.read(n)
        prompt = self.headers.get("X-Prompt")
        try:
            return self._json(200, transcribe(data, prompt))
        except Exception as e:  # 손상된 녹음 등
            return self._json(500, {"error": str(e)[:200]})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"TOEFL 교정 코치: http://localhost:{port}  · 받아쓰기(Whisper {MODEL_NAME}): {'사용 가능' if available() else '없음 (faster-whisper 미설치)'}", flush=True)
    if available():
        threading.Thread(target=model, daemon=True).start()   # 첫 요청이 느리지 않게 미리 불러 둔다
    ThreadingHTTPServer((host, port), H).serve_forever()


if __name__ == "__main__":
    main()
