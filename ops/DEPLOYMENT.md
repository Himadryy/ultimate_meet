# Ultimate Meet deployment runbook

## Live stack
- Frontend (Cloudflare Pages): `https://ultimate-meet.pages.dev`
- Signaling backend (Render): `https://ultimate-meet.onrender.com`
- TURN provider: Metered (`ultimatemeet` app)

## Architecture notes
- Signaling now serves:
  - WebSocket signaling at `/`
  - Health probe at `/health`
  - Guest token bootstrap at `/api/guest-token`
  - ICE server bootstrap at `/api/ice-servers`
- Frontend derives HTTP bootstrap endpoints from `VITE_SIGNALING_URL` (`ws/wss` → `http/https`).

## Render (signaling) deployment

Build command:
```bash
npm ci && npm run build -w @ultimate-meet/shared && npm run build -w @ultimate-meet/signaling
```

Start command:
```bash
SIGNALING_PORT=$PORT npm run start -w @ultimate-meet/signaling
```

Required environment variables:
- `SIGNALING_PORT` (Render injects via `$PORT`)
- `JWT_SECRET` (required for signed guest-token and join auth enforcement)
- `METERED_APP_NAME` (e.g. `ultimatemeet`)
- `METERED_API_KEY` (Metered credential API key)

Optional environment variables:
- `METERED_REGION` (e.g. `india`, `us_east`, `global`)
- `METERED_CACHE_TTL_MS` (default `45000`)
- `SIGNALING_GUEST_TOKEN_TTL` (default `15m`)
- `SIGNALING_ALLOWED_ORIGINS` (comma-separated CORS/upgrade allowlist)
- `REDIS_URL` (required when scaling signaling horizontally)

## Cloudflare Pages (frontend) deployment

Build command:
```bash
npm ci && npm run build -w @ultimate-meet/shared && npm run build -w @ultimate-meet/web
```

Build output directory:
```text
apps/web/dist
```

Required frontend environment variable:
- `VITE_SIGNALING_URL=wss://ultimate-meet.onrender.com`

Optional frontend overrides (normally not needed):
- `VITE_SIGNALING_HTTP_URL=https://ultimate-meet.onrender.com`
- `VITE_ICE_SERVERS_URL=https://ultimate-meet.onrender.com/api/ice-servers`
- `VITE_GUEST_TOKEN_URL=https://ultimate-meet.onrender.com/api/guest-token`

## Metered credential verification

Validate TURN bootstrap manually:
```bash
curl "https://ultimatemeet.metered.live/api/v1/turn/credentials?apiKey=<METERED_API_KEY>"
```

Expected result: JSON array containing STUN/TURN entries with `urls`, and TURN entries with `username` + `credential`.

## Production verification checklist
1. Open `https://ultimate-meet.pages.dev` on two devices (preferably different networks).
2. Device A joins as streamer, Device B joins as viewer.
3. Confirm:
   - room join + participant list updates
   - video/audio media path works
   - talkback toggle works (and safety restriction appears on loud speaker/no headphones)
4. In backend logs, confirm no repeated `/api/ice-servers` errors.
5. Visit `https://ultimate-meet.onrender.com/health` and verify `{ "status": "ok" }`.
