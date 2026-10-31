#!/bin/bash
# 더블클릭으로 실행: 로컬 서버(정적 파일 + Whisper 받아쓰기)를 켜고 브라우저에서 엽니다. (창을 닫으면 서버 종료)
# 받아쓰기는 ~/.venvs/whisper (faster-whisper)가 있으면 켜지고, 없으면 정적 서버만 (앱은 '내 녹음 ↔ 원문 번갈아 듣기'로 대체).
cd "$(dirname "$0")"
PORT=8765
( sleep 1; open "http://localhost:$PORT/" ) &
echo "같은 와이파이의 휴대폰: http://$(ipconfig getifaddr en0 2>/dev/null):$PORT"
if [ -x "$HOME/.venvs/whisper/bin/python" ]; then
  exec "$HOME/.venvs/whisper/bin/python" tools/serve.py $PORT
else
  echo "(받아쓰기 없음: ~/.venvs/whisper 가 없습니다)"
  exec python3 tools/serve.py $PORT
fi
