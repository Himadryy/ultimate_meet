Benchmark Plan

Purpose

This benchmark simulates join and runtime telemetry for a conferencing platform using the existing pilot fake signaling server and simulated clients. It is intentionally lightweight — no browsers or native WebRTC are used. The goal is to produce reproducible artifacts that approximate platform behavior across four network profiles and compare key metrics (join latency, packet-loss resilience, RTT distribution, join/drop rates) to acceptance thresholds inspired by Meet and Discord heuristics.

Profiles & simulated network parameters

- good
  - RTT: mean 40ms, std 10ms
  - Jitter: ~10ms
  - Packet loss: 0.1% (0.001)
  - Acceptance: median join latency <= 300ms; avg packet loss <= 0.5%; drop rate <= 2%

- moderate
  - RTT: mean 80ms, std 30ms
  - Jitter: ~20ms
  - Packet loss: 0.5% (0.005)
  - Acceptance: median join latency <= 600ms; avg packet loss <= 1.0%; drop rate <= 5%

- constrained
  - RTT: mean 150ms, std 50ms
  - Jitter: ~40ms
  - Packet loss: 1.5% (0.015)
  - Acceptance: median join latency <= 1500ms; avg packet loss <= 2.0%; drop rate <= 10%

- lossy
  - RTT: mean 300ms, std 100ms
  - Jitter: ~100ms
  - Packet loss: 5% (0.05)
  - Acceptance: median join latency <= 3000ms; avg packet loss <= 5.0%; drop rate <= 20%

Measured metrics

- Join latency (per client): time from client-side join send timestamp to receipt of the server's "joined" reply. We instrument join by sending a timestamped join message; the fake_signaling_server echoes serverTs in the joined reply. The client simulates network delay and loss and records sendTs, serverTs (as echoed), recvTs and computed latency.

- Packet loss: simulated by client-side probabilistic drops of outbound or inbound messages. Telemetry samples include a synthetic "packetLoss" metric; analysis computes average packetLoss across telemetry samples.

- RTT distribution: simulated by sampling from a normal distribution per profile. Analysis reports median and 95th percentile RTT from telemetry samples.

- Joins per second & drop rate: computed as successful joins divided by test duration; drop rate = failed joins / total clients.

Comparison to Meet/Discord heuristics

- This synthetic bench approximates end-to-end behavior by applying controlled delays and packet loss at the client side. While not a replacement for device/real-network tests, it provides reproducible baselines.

- Acceptance thresholds (above) are chosen to align with typical product goals: "good" should be near-instant and reliable; "moderate" tolerable; "constrained" degraded but usable; "lossy" likely to fail QoE.

- The benchmark_results.md will present per-profile metrics and a Pass/Fail assessment vs the acceptance columns above.

Notes and follow-ups

- For real-device validation, run the same measurement harness on phones/desktops across real networks and compare.
- Consider adding jitter buffer and reconnection/retry logic in clients to evaluate resilience strategies.
