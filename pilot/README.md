Pilot README

This folder contains artifacts and scripts to run a small-group pilot locally and a runbook for real-device execution.

Quick start (local simulated run):

1. From repository root, run the smoke script:
   chmod +x pilot/run_local_smoke.sh
   ./pilot/run_local_smoke.sh

   - This will run `npm test`, `npm run build`, install a lightweight 'ws' dependency if missing, start a fake signaling server, and run simulated clients.

2. After completion, logs and artifacts will be in /pilot:
   - npm_test.log, npm_build.log
   - signaling.log (fake signaling server output)
   - simulate.log (simulated client output)
   - telemetry_snapshot.json (parsed telemetry/events)
   - local_run_results.md (test/build summary)

Real-device runbook (manual):

1. Build and run the project (or use the dev servers):
   - Start signaling: npm run dev:signaling
   - Serve web app (from device-accessible host or use local network IP): build the web app and serve the build directory via a static server reachable by devices.

2. On real devices/browsers:
   - Open the served URL (use the host IP instead of localhost to access from other devices).
   - Join the same room from multiple devices and perform the echo test:
     a. One device plays a short audio; verify others hear it without feedback.
     b. Collect browser console logs (F12 -> Console) and save network logs if needed.

3. Collect telemetry and logs:
   - Server-side: signaling logs and any telemetry endpoints.
   - Client-side: browser console logs and the telemetry payloads (if the app exposes them).

Uploading logs for triage:
- Zip the /pilot directory and upload to your bug tracker or a secure artifact store. Example:
  zip -r pilot-logs.zip pilot/

Limitations:
- Browser-based WebRTC media paths are not simulated here. For media-level testing use real devices or a headless WebRTC solution (not included to avoid heavy deps). The simulation exercises signaling and telemetry only.
