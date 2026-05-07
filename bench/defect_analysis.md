DEFECT HARDENING ANALYSIS

Summary
- Focus: reduce join failures, improve reconnect robustness, and harden signaling server.
- Inputs: bench/benchmark_results.md (pre-fix) and pilot/telemetry_snapshot.json.

Root causes identified
1) Client: no reconnect/backoff and no outbound buffering — transient blips caused lost join messages.
2) Server: send/broadcast calls were unprotected — a failing socket could throw and affect others.
3) Server: stale sockets (ghost participants) not detected — left-over state caused authorization/race issues.
4) Room state: duplicate-join/rejoin race (participant_already_joined) causing spurious join failures.
5) Network variability: packet loss spikes (pilot telemetry) amplify above issues.

Prioritized surgical fixes implemented
1) Client: apps/web/src/hooks/useSignalingRoom.ts
   - Exponential backoff reconnect, capped attempts.
   - Automatic rejoin on reconnect using stored join request.
   - Outbound message queueing and flushing on reconnect.
2) Server: apps/signaling/src/server.ts
   - sendMessage wrapped in try/catch + per-send logging.
   - broadcastToRoom guarded per-socket to avoid single-fault crash.
   - Heartbeat (ping/pong) with termination of stale sockets.
   - Added logging for relay rejections and join failures.
3) Room state: apps/signaling/src/roomState.ts
   - join() updated to handle re-joins into same room atomically (avoid duplicate errors).
4) Tests: apps/signaling/test/roomState.test.ts added covering duplicate joins, rapid leave/join, talkback toggles.

Validation
- Ran signaling package unit tests: PASS (RoomStateMachine tests).
- Re-ran moderate profile simulation twice (bench/results): both post-fix runs show 12/12 successful joins, drop rate 0.00% (previously one moderate run had 11/12, 8.33% drop).
- Updated bench/benchmark_results.md with post-fix results.

Notes, limitations, and next steps
- The bench simulation uses the local simulator; real-world device testing recommended to verify NAT and mobile behavior.
- We focused on code-level, low-risk fixes; larger design changes (e.g., authoritative reconnection protocol, persistent participant sessions) are left for a separate effort.
- Recommend: monitor telemetry over a longer run (hourly), add alerting for relay error spikes, and consider per-participant circuit-breaker for noisy clients.

Files changed
- apps/web/src/hooks/useSignalingRoom.ts
- apps/signaling/src/server.ts
- apps/signaling/src/roomState.ts
- apps/signaling/test/roomState.test.ts
- apps/signaling/package.json (test script)
- bench/simulate_profile_clients.js (compat: send join_room + accept joined_room)
- bench/benchmark_results.md (updated)
- bench/defect_analysis.md (this file)

If anything above needs more surgical tuning (e.g., backoff parameters), I can iterate.
