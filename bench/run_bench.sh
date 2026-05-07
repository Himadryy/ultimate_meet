#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RESULTS_DIR="$ROOT/bench/results"
mkdir -p "$RESULTS_DIR"

CLIENTS="${CLIENTS:-12}"
DURATION="${DURATION:-20}"
PORT="${PORT:-9090}"
PROFILES=(good moderate constrained lossy)

echo "Running npm test"
npm test --silent

echo "Running npm run build"
npm run build --silent

# Start fake signaling server
echo "Starting fake_signaling_server on port $PORT"
PORT=$PORT node pilot/fake_signaling_server.js > "$RESULTS_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$RESULTS_DIR/server.pid"
# give server a moment to start
sleep 1

for profile in "${PROFILES[@]}"; do
  echo "Running profile: $profile"
  TS=$(date +%s)
  OUT="$RESULTS_DIR/${profile}-${TS}.json"
  LOG="$RESULTS_DIR/${profile}-${TS}.log"

  node bench/simulate_profile_clients.js --profile "$profile" --clients "$CLIENTS" --duration "$DURATION" --url "ws://localhost:$PORT" --out "$OUT" 2>&1 | tee "$LOG"
  echo "Finished profile: $profile; results -> $OUT"
  sleep 1
done

# stop server
if [ -f "$RESULTS_DIR/server.pid" ]; then
  kill "$(cat $RESULTS_DIR/server.pid)" || true
  rm "$RESULTS_DIR/server.pid" || true
fi

# Analyze results
node bench/analysis.js --results_dir "$RESULTS_DIR" --out "$ROOT/bench/benchmark_results.md"

echo "Benchmark complete. Results: $RESULTS_DIR and $ROOT/bench/benchmark_results.md"
