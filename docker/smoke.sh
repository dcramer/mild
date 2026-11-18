#!/bin/sh
# Builds the image and runs it as docker/compose.yaml does (read-only, no capabilities, /tmp the only scratch space,
# a fresh volume for its home), then checks it answers /api/session and stops cleanly when asked.
#   sh docker/smoke.sh
set -eu
cd "$(dirname "$0")/.."
image=sift:smoke
volume="sift-smoke-$$"
port="${PORT:-18787}"
docker build -q -f docker/Dockerfile -t "$image" . > /dev/null
echo "image $(docker images "$image" --format '{{.Size}}') on disk, $(docker image inspect "$image" --format '{{.Size}}' | awk '{ printf "%d MB", $1 / 1000000 }') to pull"
container=$(docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp \
  -v "$volume:/data" -p "127.0.0.1:$port:8787" "$image" run --host 0.0.0.0)
cleanup() { docker rm -f "$container" > /dev/null 2>&1 || true; docker volume rm "$volume" > /dev/null 2>&1 || true; }
trap cleanup EXIT
tries=0
until reply=$(curl -sf "http://127.0.0.1:$port/api/session"); do
  tries=$((tries + 1))
  [ "$tries" -lt 120 ] || { docker logs "$container"; echo "no answer at /api/session" >&2; exit 1; }
  sleep 0.5
done
echo "answers  $reply"
started=$(date +%s)
docker stop -t 30 "$container" > /dev/null
echo "stopped in $(($(date +%s) - started))s, exit $(docker inspect "$container" --format '{{.State.ExitCode}}')"
docker logs "$container" 2>&1 | grep -iE 'error|fail' && { echo "the log names a failure" >&2; exit 1; }
echo ok
