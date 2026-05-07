#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)
LOGDIR="$ROOT_DIR/pilot"
mkdir -p "$LOGDIR"

echo "=== Running local smoke script ==="

# Run tests and build
echo "Running npm test..." | tee "$LOGDIR/npm_test.log"
if npm test 2>&1 | tee -a "$LOGDIR/npm_test.log"; then
  echo "TESTS: PASS" > "$LOGDIR/local_run_results.md"
else
  echo "TESTS: FAIL" > "$LOGDIR/local_run_results.md"
fi

echo "Running npm run build..." | tee -a "$LOGDIR/npm_build.log"
if npm run build 2>&1 | tee -a "$LOGDIR/npm_build.log"; then
  echo "BUILD: PASS" >> "$LOGDIR/local_run_results.md"
else
  echo "BUILD: FAIL" >> "$LOGDIR/local_run_results.md"
fi

# Ensure ws is available for local simulation
echo "Ensuring 'ws' websocket package is installed (locally)" | tee -a "$LOGDIR/local_run_results.md"
if node -e "require.resolve('ws')" >/dev/null 2>&1; then
  echo "ws already installed" >> "$LOGDIR/local_run_results.md"
else
  echo "Installing ws..." | tee -a "$LOGDIR/npm_install_ws.log"
  npm install ws --no-audit --no-fund 2>&1 | tee -a "$LOGDIR/npm_install_ws.log"
fi

# Start a lightweight fake signaling server (for simulation)
SIGNALING_LOG="$LOGDIR/signaling.log"
SIGNALING_PIDFILE="$LOGDIR/signaling.pid"
node pilot/fake_signaling_server.js > "$SIGNALING_LOG" 2>&1 &
SIGNALING_PID=$!
echo $SIGNALING_PID > "$SIGNALING_PIDFILE"
echo "Started fake signaling server (pid=$SIGNALING_PID)"

# Serve built web content (if any) using a simple static server (python3)
# Find first index.html in repo (built web assets)
BUILD_INDEX=$(find . -type f -name index.html -path "./apps/*" -o -path "./packages/*" -print -quit || true)
if [ -n "$BUILD_INDEX" ]; then
  BUILD_DIR=$(dirname "$BUILD_INDEX")
  echo "Serving built web files from $BUILD_DIR on port 8000" | tee -a "$LOGDIR/local_run_results.md"
  (cd "$BUILD_DIR" && python3 -m http.server 8000) &
  HTTP_PID=$!
  echo $HTTP_PID > "$LOGDIR/http.pid"
else
  echo "No built web index.html found; skipping static serve" | tee -a "$LOGDIR/local_run_results.md"
fi

# Run simulated clients against the fake signaling server
SIM_LOG="$LOGDIR/simulate.log"
echo "Running simulated clients (4 clients, 15s)" | tee -a "$LOGDIR/local_run_results.md"
node pilot/simulate_clients.js --clients 4 --duration 15 2>&1 | tee "$SIM_LOG"

# Collect telemetry snapshot from signaling log
echo "Collecting telemetry snapshot to $LOGDIR/telemetry_snapshot.json"
node - <<'NODE'
const fs = require('fs');
const path = 'pilot/signaling.log';
if (!fs.existsSync(path)) {
  console.error('signaling.log not found');
  process.exit(0);
}
const lines = fs.readFileSync(path,'utf8').split('\n').filter(Boolean);
const telemetry = lines.map(l=>{
  try { return JSON.parse(l); } catch(e){ return { raw: l }; }
}).filter(x=>x && (x.event==='telemetry' || x.event==='join' || x.event==='leave'));
fs.writeFileSync('pilot/telemetry_snapshot.json', JSON.stringify(telemetry, null, 2));
console.log('wrote pilot/telemetry_snapshot.json with', telemetry.length, 'entries');
NODE

# Print a short summary
echo "=== Local smoke script complete ==="
echo "Logs: $LOGDIR/npm_test.log, $LOGDIR/npm_build.log, $SIM_LOG, $SIGNALING_LOG" | tee -a "$LOGDIR/local_run_results.md"

echo "To stop the fake signaling server: kill $(cat $SIGNALING_PIDFILE)"

exit 0
