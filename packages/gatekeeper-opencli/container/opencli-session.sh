#!/usr/bin/env bash
set -euo pipefail

profile_root=/workspace/opencli/profile
mkdir -p "$profile_root"

case "${1:-}" in
  start)
    if curl --fail --silent http://127.0.0.1:9222/json/version >/dev/null 2>&1; then exit 0; fi
    rm -f /tmp/.X99-lock
    Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
    DISPLAY=:99 fluxbox >/tmp/fluxbox.log 2>&1 &
    DISPLAY=:99 google-chrome --no-sandbox --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 \
      --remote-debugging-port=9222 --user-data-dir="$profile_root" about:blank >/tmp/chromium.log 2>&1 &
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
    websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
    for _ in $(seq 1 60); do
      if curl --fail --silent http://127.0.0.1:9222/json/version >/dev/null; then exit 0; fi
      sleep 0.25
    done
    echo "Chromium did not start" >&2
    exit 1
    ;;
  stop)
    pkill -TERM -f 'chrome.*opencli/profile' 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! pgrep -f 'chrome.*opencli/profile' >/dev/null; then break; fi
      sleep 0.25
    done
    pkill -KILL -f 'chrome.*opencli/profile' 2>/dev/null || true
    pkill -TERM x11vnc 2>/dev/null || true
    pkill -TERM websockify 2>/dev/null || true
    pkill -TERM Xvfb 2>/dev/null || true
    ;;
  ping)
    curl --fail --silent http://127.0.0.1:9222/json/version >/dev/null
    ;;
  *) echo "usage: opencli-session start|stop|ping" >&2; exit 2 ;;
esac
