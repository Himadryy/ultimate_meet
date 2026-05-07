# Ultimate Meet (MVP Foundation)

This repository now contains the first implementation slice for a streaming platform focused on:
- smooth adaptive quality (toward 720p/30fps when conditions allow),
- anti-echo defaults and routing guards,
- small-room MVP constraints (1 streamer + 4 viewers).

## Workspace Layout

- `apps/signaling`: WebSocket signaling server with room state machine and relay policy checks
- `apps/web`: React web client with room join, stream publish/subscribe, and policy preview
- `packages/shared`: shared protocol/types + adaptation and audio policy logic

## Run

```bash
npm install
npm run build
```

Start signaling server:

```bash
npm run dev:signaling
```

Start web app:

```bash
npm run dev:web
```

## Current Core Mechanics Included

- Room lifecycle constraints and session state (`join`, `leave`, talkback gating)
- Relay policy to prevent unsafe paths (`stream` vs `talkback` channel checks)
- WebRTC MVP publish/subscribe flow (1 streamer publishes camera/mic to up to 4 viewers)
- Adaptive video-layer selection algorithm using RTT/jitter/loss/bitrate/CPU metrics
- Audio safety policy defaults (AEC/noise suppression/AGC + warnings)
- Web audio controls and diagnostics (mute/deafen, device routing, talkback toggle, mic meter)
