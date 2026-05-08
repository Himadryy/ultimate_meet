export const DEFAULT_SIGNALING_WS_URL = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8080";
const SIGNALING_HTTP_URL_OVERRIDE = import.meta.env.VITE_SIGNALING_HTTP_URL ?? "";
const ICE_SERVERS_URL_OVERRIDE = import.meta.env.VITE_ICE_SERVERS_URL ?? "";
const GUEST_TOKEN_URL_OVERRIDE = import.meta.env.VITE_GUEST_TOKEN_URL ?? "";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toHttpBaseFromWs(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return trimTrailingSlash(parsed.toString());
}

export function resolveSignalingHttpBase(signalingWsUrl = DEFAULT_SIGNALING_WS_URL): string {
  if (SIGNALING_HTTP_URL_OVERRIDE) {
    return trimTrailingSlash(SIGNALING_HTTP_URL_OVERRIDE);
  }
  return toHttpBaseFromWs(signalingWsUrl);
}

export function resolveIceServersEndpoint(signalingWsUrl = DEFAULT_SIGNALING_WS_URL): string {
  if (ICE_SERVERS_URL_OVERRIDE) {
    return ICE_SERVERS_URL_OVERRIDE;
  }
  return `${resolveSignalingHttpBase(signalingWsUrl)}/api/ice-servers`;
}

export function resolveGuestTokenEndpoint(signalingWsUrl = DEFAULT_SIGNALING_WS_URL): string {
  if (GUEST_TOKEN_URL_OVERRIDE) {
    return GUEST_TOKEN_URL_OVERRIDE;
  }
  return `${resolveSignalingHttpBase(signalingWsUrl)}/api/guest-token`;
}
