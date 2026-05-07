import type { ParticipantInfo, ClientToServerMessage } from "./protocol.js";

export type ClusterEvent =
  | { type: "participant_joined"; nodeId: string; roomId: string; participant: ParticipantInfo }
  | { type: "participant_left"; nodeId: string; roomId: string; participantId: string }
  | { type: "talkback_changed"; nodeId: string; roomId: string; participantId: string; enabled: boolean }
  | { type: "participant_kicked"; nodeId: string; roomId: string; participantId: string }
  | { type: "participant_muted"; nodeId: string; roomId: string; participantId: string; muted: boolean }
  | { type: "relay_offer" | "relay_answer" | "relay_ice"; nodeId: string; message: ClientToServerMessage };

export const CLUSTER_CHANNEL = "ultimate-meet:signaling:events";

/**
 * Compact pubsub message shape used for simple scaling messages.
 * Keeps payloads JSON-serializable and compact:
 * { event: 'join' | 'leave' | 'relay', roomId, payload }
 */
export type PubSubEventName = "join" | "leave" | "relay";
export interface PubSubMessage {
  event: PubSubEventName;
  roomId: string;
  payload: unknown;
}

export function isRelayEvent(
  ev: ClusterEvent
): ev is { type: "relay_offer" | "relay_answer" | "relay_ice"; nodeId: string; message: ClientToServerMessage } {
  return ev.type === "relay_offer" || ev.type === "relay_answer" || ev.type === "relay_ice";
}
