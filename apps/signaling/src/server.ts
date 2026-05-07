import WebSocket, { WebSocketServer } from "ws";
import type { ClientToServerMessage, ServerToClientMessage } from "@ultimate-meet/shared";
import { clientMessageSchema } from "./messageSchema.js";
import { RoomStateMachine } from "./roomState.js";
import { SignalingTelemetry } from "./telemetry.js";
import { verifyGuestToken } from "@ultimate-meet/shared";
import crypto from "crypto";
import { PubSub } from "./pubsub.js";
import type { ClusterEvent } from "@ultimate-meet/shared";

const PORT = Number.parseInt(process.env.SIGNALING_PORT ?? "8080", 10);
const TELEMETRY_LOG_INTERVAL_MS = Number.parseInt(process.env.SIGNALING_TELEMETRY_INTERVAL_MS ?? "15000", 10);
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const ENFORCE_AUTH = Boolean(JWT_SECRET);

if (!ENFORCE_AUTH) {
  console.warn("[signaling] JWT_SECRET not set — running in dev mode (auth disabled)");
}

const state = new RoomStateMachine();
const socketByParticipant = new Map<string, WebSocket>();
const telemetry = new SignalingTelemetry();

const NODE_ID = process.env.SIGNALING_NODE_ID ?? crypto.randomUUID();
const pubsub = new PubSub({ nodeId: NODE_ID });
await pubsub.start();

pubsub.subscribe((event: ClusterEvent) => {
  if (event.nodeId === NODE_ID) return;
  try {
    switch (event.type) {
      case "participant_joined":
        broadcastToRoom(event.roomId, {
          type: "participant_joined",
          roomId: event.roomId,
          participant: event.participant
        });
        break;
      case "participant_left":
        broadcastToRoom(event.roomId, {
          type: "participant_left",
          roomId: event.roomId,
          participantId: event.participantId
        });
        break;
      case "talkback_changed":
        broadcastToRoom(event.roomId, {
          type: "talkback_changed",
          roomId: event.roomId,
          participantId: event.participantId,
          enabled: event.enabled
        });
        break;
      case "participant_kicked":
        broadcastToRoom(event.roomId, {
          type: "participant_kicked",
          roomId: event.roomId,
          participantId: event.participantId
        });
        break;
      case "participant_muted":
        broadcastToRoom(event.roomId, {
          type: "participant_muted",
          roomId: event.roomId,
          participantId: event.participantId,
          muted: !!event.muted
        });
        break;
      case "relay_offer":
      case "relay_answer":
      case "relay_ice": {
        const message = (event as any).message;
        const targetSocket = socketByParticipant.get(message.toId);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          try {
            sendMessage(targetSocket, message as any);
          } catch (e) {
            console.warn("[signaling] failed to forward relay from pubsub", e);
          }
        }
        break;
      }
    }
  } catch (e) {
    console.warn("[signaling] pubsub handler failed", e);
  }
});

function sendMessage(socket: WebSocket, message: ServerToClientMessage): void {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  } catch (err) {
    console.warn("[signaling] sendMessage failed", err);
  }
}

function broadcastToRoom(roomId: string, message: ServerToClientMessage): void {
  const participants = state.listParticipants(roomId);
  for (const participant of participants) {
    const socket = socketByParticipant.get(participant.id);
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        sendMessage(socket, message);
      } catch (err) {
        console.warn(`[signaling] failed to broadcast to ${participant.id}`, err);
      }
    }
  }
}

function parseMessage(raw: string): ClientToServerMessage {
  const parsedJson: unknown = JSON.parse(raw);
  const validated = clientMessageSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(`invalid_message:${validated.error.issues[0]?.message ?? "unknown_error"}`);
  }
  return validated.data;
}

function handleRelay(
  message: Extract<ClientToServerMessage, { type: "relay_offer" | "relay_answer" | "relay_ice" }>
): void {
  const relayCheck = state.canRelay(message.roomId, message.fromId, message.toId, message.channel);
  if (!relayCheck.allowed) {
    const relayErrorCode = relayCheck.code ?? "relay_blocked";
    telemetry.recordRelayError(relayErrorCode, message.channel);
    console.warn(`[signaling] relay rejected ${relayErrorCode} from ${message.fromId} to ${message.toId} channel ${message.channel}`);
    const sourceSocket = socketByParticipant.get(message.fromId);
    if (sourceSocket) {
      sendMessage(sourceSocket, {
        type: "error",
        code: relayErrorCode,
        message: "Relay rejected by server media policy."
      });
    }
    return;
  }

  const targetSocket = socketByParticipant.get(message.toId);
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
    // publish to cluster so the node owning the target can forward if present
    pubsub.publish({
      type: message.type,
      nodeId: NODE_ID,
      message
    }).catch((e) => {
      telemetry.recordRelayError("publish_failed", message.channel);
      console.warn(`[signaling] relay publish failed`, e);
      const sourceSocket = socketByParticipant.get(message.fromId);
      if (sourceSocket) {
        sendMessage(sourceSocket, {
          type: "error",
          code: "target_offline",
          message: "Relay target is not connected."
        });
      }
    });
    return;
  }
  sendMessage(targetSocket, message);
  telemetry.recordRelaySuccess(message.channel);
}

function assertAuthorizedParticipant(
  socket: WebSocket,
  participantId: string | null,
  messageParticipantId: string,
  roomId: string
): boolean {
  if (!participantId) {
    sendMessage(socket, {
      type: "error",
      code: "not_joined",
      message: "Join a room before sending signaling messages."
    });
    return false;
  }
  if (participantId !== messageParticipantId) {
    sendMessage(socket, {
      type: "error",
      code: "unauthorized_sender",
      message: "Message sender does not match authenticated socket participant."
    });
    return false;
  }
  if (state.participantRoom(participantId) !== roomId) {
    sendMessage(socket, {
      type: "error",
      code: "room_mismatch",
      message: "Message room does not match participant room."
    });
    return false;
  }
  return true;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[signaling] listening on ws://localhost:${PORT}`);
const telemetryTimer = setInterval(() => {
  const snapshot = telemetry.flushSnapshot(state.roomCount(), state.participantCount());
  if (
    snapshot.counters.joins === 0 &&
    snapshot.counters.leaves === 0 &&
    snapshot.counters.talkbackChanges === 0 &&
    snapshot.counters.relaySuccess === 0 &&
    snapshot.counters.relayErrors === 0
  ) {
    return;
  }
  console.log(`[signaling][telemetry] ${JSON.stringify(snapshot)}`);
}, TELEMETRY_LOG_INTERVAL_MS);

// Heartbeat to detect stale sockets
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.SIGNALING_HEARTBEAT_MS ?? "30000", 10);
const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    const s = ws as WebSocket & { isAlive?: boolean; participantId?: string };
    if ((s as any).isAlive === false) {
      console.warn(`[signaling] terminating stale socket for participant ${(s as any).participantId ?? "unknown"}`);
      try {
        s.terminate();
      } catch (e) {}
      continue;
    }
    (s as any).isAlive = false;
    try {
      s.ping();
    } catch (e) {
      try { s.terminate(); } catch {}
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(telemetryTimer);
  clearInterval(heartbeatTimer);
});

wss.on("connection", (socket) => {
  let participantId: string | null = null;
  // mark socket as alive for heartbeat pings
  (socket as any).isAlive = true;
  socket.on("pong", () => {
    (socket as any).isAlive = true;
  });

  socket.on("message", (buffer) => {
    const raw = buffer.toString();
    let message: ClientToServerMessage;
    try {
      message = parseMessage(raw);
    } catch (error) {
      sendMessage(socket, {
        type: "error",
        code: "invalid_payload",
        message: error instanceof Error ? error.message : "Payload must match signaling schema."
      });
      return;
    }

    if (message.type === "join_room") {
      try {
        const participants = state.join(message.roomId, message.participantId, message.role);
        telemetry.recordJoin(message.roomId, message.participantId, message.role);
        participantId = message.participantId;
        socketByParticipant.set(message.participantId, socket);
        (socket as any).participantId = message.participantId;

        const you = participants.find((participant) => participant.id === message.participantId);
        if (!you) {
          throw new Error("participant_not_found_after_join");
        }

        sendMessage(socket, {
          type: "joined_room",
          roomId: message.roomId,
          you,
          participants
        });
        broadcastToRoom(message.roomId, {
          type: "participant_joined",
          roomId: message.roomId,
          participant: you
        });
        pubsub.publish({
          type: "participant_joined",
          nodeId: NODE_ID,
          roomId: message.roomId,
          participant: you
        }).catch((e) => {
          console.warn("[signaling] pubsub publish failed", e);
        });
      } catch (error) {
        console.warn(`[signaling] join failed for ${message.participantId} room ${message.roomId}:`, error);
        sendMessage(socket, {
          type: "error",
          code: "join_failed",
          message: error instanceof Error ? error.message : "Could not join room."
        });
      }
      return;
    }

    if (message.type === "set_talkback") {
      if (!assertAuthorizedParticipant(socket, participantId, message.participantId, message.roomId)) {
        return;
      }
      try {
        state.setTalkback(message.roomId, message.participantId, message.enabled);
        telemetry.recordTalkbackChange(message.roomId, message.participantId, message.enabled);
        broadcastToRoom(message.roomId, {
          type: "talkback_changed",
          roomId: message.roomId,
          participantId: message.participantId,
          enabled: message.enabled
        });
        pubsub.publish({
          type: "talkback_changed",
          nodeId: NODE_ID,
          roomId: message.roomId,
          participantId: message.participantId,
          enabled: message.enabled
        }).catch((e) => { console.warn("[signaling] pubsub publish failed", e); });
      } catch (error) {
        sendMessage(socket, {
          type: "error",
          code: "talkback_update_failed",
          message: error instanceof Error ? error.message : "Could not update talkback."
        });
      }
      return;
    }

    // handle moderation messages (kick/mute) and relays
    if (message.type === "kick_participant") {
      if (!assertAuthorizedParticipant(socket, participantId, message.fromId, message.roomId)) {
        return;
      }
      try {
        state.kick(message.roomId, message.fromId, message.participantId);
        const targetSocket = socketByParticipant.get(message.participantId);
        if (targetSocket) {
          sendMessage(targetSocket, {
            type: "participant_kicked",
            roomId: message.roomId,
            participantId: message.participantId
          });
          try { targetSocket.close(); } catch (e) {}
          socketByParticipant.delete(message.participantId);
        }
        broadcastToRoom(message.roomId, {
          type: "participant_kicked",
          roomId: message.roomId,
          participantId: message.participantId
        });
        pubsub.publish({
          type: "participant_kicked",
          nodeId: NODE_ID,
          roomId: message.roomId,
          participantId: message.participantId
        }).catch((e) => { console.warn("[signaling] pubsub publish failed", e); });
      } catch (error) {
        sendMessage(socket, {
          type: "error",
          code: "kick_failed",
          message: error instanceof Error ? error.message : "Could not kick participant."
        });
      }
      return;
    }

    if (message.type === "mute_participant") {
      if (!assertAuthorizedParticipant(socket, participantId, message.fromId, message.roomId)) {
        return;
      }
      try {
        const updated = state.mute(message.roomId, message.fromId, message.participantId, message.muted);
        broadcastToRoom(message.roomId, {
          type: "participant_muted",
          roomId: message.roomId,
          participantId: message.participantId,
          muted: !!updated.muted
        });
        pubsub.publish({
          type: "participant_muted",
          nodeId: NODE_ID,
          roomId: message.roomId,
          participantId: message.participantId,
          muted: !!updated.muted
        }).catch((e) => { console.warn("[signaling] pubsub publish failed", e); });
      } catch (error) {
        sendMessage(socket, {
          type: "error",
          code: "mute_failed",
          message: error instanceof Error ? error.message : "Could not mute participant."
        });
      }
      return;
    }

    if (message.type === "relay_offer" || message.type === "relay_answer" || message.type === "relay_ice") {
      if (!assertAuthorizedParticipant(socket, participantId, message.fromId, message.roomId)) {
        return;
      }
      handleRelay(message);
      return;
    }

    // unknown message type (should be rejected by schema)
    sendMessage(socket, {
      type: "error",
      code: "unsupported_message",
      message: "Unsupported message type."
    });
  });

  socket.on("close", () => {
    if (!participantId) {
      return;
    }
    socketByParticipant.delete(participantId);
    const leave = state.leave(participantId);
    if (!leave) {
      return;
    }
    telemetry.recordLeave(leave.roomId, participantId);
    broadcastToRoom(leave.roomId, {
      type: "participant_left",
      roomId: leave.roomId,
      participantId
    });
    pubsub.publish({
      type: "participant_left",
      nodeId: NODE_ID,
      roomId: leave.roomId,
      participantId
    }).catch((e) => { console.warn("[signaling] pubsub publish failed", e); });
  });
});
