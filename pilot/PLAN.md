# Small-Group Pilot Plan

## Overview
Run a small-group pilot to validate signaling reliability, join/leave behavior, telemetry collection, and audio/voice quality under mixed device and network conditions. Focus on lightweight, reproducible local runs and a clear runbook for real-device tests.

## Goals
- Verify signaling server handles join/leave at small scale (2-6 participants)
- Validate telemetry collection pipeline and formats
- Exercise common device mixes and network impairments
- Compare basic acceptance criteria vs Google Meet / Discord (audio only)

## Scenario matrix
- Participants: 2, 3, 4
- Stream types: (1) audio+video, (2) audio-only, (3) screen-share (if available)
- Device mixes: all-desktop, all-mobile, mixed (1 mobile + 1 desktop), 3rd-party mobile+desktop combos
- Network conditions to emulate:
  - Good: 20 Mbps, 20 ms RTT
  - Moderate: 5 Mbps, 80 ms RTT
  - Constrained: 512 kbps, 150-250 ms RTT
  - Lossy: 1-2% packet loss, 100-300 ms RTT

## Echo test procedure
1. Start the app on two endpoints (or two browser tabs). Enable microphone and speakers.
2. One participant (A) plays a short tone (or speaks) while participant B mutes their microphone and records received audio if possible.
3. Measure whether participant B hears the audio and whether A hears an echo. Verify acoustic echo suppression is working (no persistent loop feedback).

Notes: Local echoes are environment-dependent — compare behavior qualitatively against Meet/Discord.

## Acceptance criteria (audio focus)
- Join latency: < 200 ms from signaling acknowledgement to "joined" event on peers
- Audio continuity: < 1% long disconnects in a 5 minute call
- Packet loss resilience: audio remains intelligible at up to 2% loss under constrained conditions
- Compare: For baseline, Meet/Discord usually show near-instant join and consistent audio quality. Pilot is acceptable if there are no frequent reconnect loops and telemetry shows stable connections for > 2 minutes.

## Telemetry and artifacts to collect
- Server logs (signaling join/leave/telemetry events)
- Client telemetry samples (rtt, jitter, packetLoss estimates)
- Local_run_results.md with test/build summaries
- telemetry_snapshot.json containing recent telemetry events
- Any browser console logs (for real-device runs)

## Network emulation (local)
- Linux: tc/netem (examples in README)
- macOS: Network Link Conditioner (or use Chrome DevTools throttling for latency/bandwidth)
- Chrome DevTools: Use Network -> Throttling -> Add custom profile

## Comparison checklist vs Meet/Discord
- Basic pass: audio stable, no repeated reconnects, telemetry present
- Good pass: join latency and audio quality comparable to Meet/Discord in similar conditions

## Run matrix (minimal)
- 2 participants, audio-only, Good network
- 2 participants, audio-only, Constrained network
- 3 participants, mixed devices, Moderate network
- 4 participants, audio-only, Lossy network

## Notes on limitations
- This pilot uses a lightweight simulated client (WebSocket + telemetry) and may not exercise full WebRTC media path locally without real devices or headless WebRTC stacks. For media tests, follow the real-device runbook in README.
