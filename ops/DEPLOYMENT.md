Signaling server Docker deployment

Build and run:

1. Build image:
   docker build -t ultimate-meet-signaling -f apps/signaling/Dockerfile .

2. Run container (example):
   docker run -p 8080:8080 \
     -e SIGNALING_PORT=8080 \
     -e JWT_SECRET="your_jwt_secret_here" \
     --rm ultimate-meet-signaling

Environment variables:
- SIGNALING_PORT: port the WS server listens on (default 8080)
- JWT_SECRET: HS256 secret for verifying guest JWTs. If unset, server runs in dev mode and will NOT enforce tokens (not for production).

Notes:
- For local testing create guest tokens with scripts/create_guest_token.js or use your own JWTs signed with the same JWT_SECRET.
- The server emits participant_kicked and participant_muted events when owner mutes/kicks participants.
