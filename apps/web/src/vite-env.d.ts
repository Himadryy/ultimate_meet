/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_SIGNALING_HTTP_URL?: string;
  readonly VITE_ICE_SERVERS_URL?: string;
  readonly VITE_GUEST_TOKEN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
