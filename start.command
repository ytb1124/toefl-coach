#!/bin/bash
# 더블클릭으로 실행: 로컬 서버를 켜고 브라우저에서 엽니다. (창을 닫으면 서버 종료)
cd "$(dirname "$0")"
PORT=8765
( sleep 1; open "http://localhost:$PORT/" ) &
echo "TOEFL 교정 코치: http://localhost:$PORT  (같은 와이파이의 휴대폰: http://$(ipconfig getifaddr en0 2>/dev/null):$PORT)"
python3 -m http.server $PORT --bind 0.0.0.0
