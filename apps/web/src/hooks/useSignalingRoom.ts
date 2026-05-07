import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientToServerMessage,
  IceCandidatePayload,
  ParticipantInfo,
  ParticipantRole,
  ServerToClientMessage
} from "@ultimate-meet/shared";

interface JoinRoomRequest {
  roomId: string;
  participantId: string;
  role: ParticipantRole;
}

interface RelayRequestBase {
  toId: string;
  channel: "stream" | "talkback";
}

interface RelaySdpRequest extends RelayRequestBase {
  sdp: string;
}

interface RelayIceRequest extends RelayRequestBase {
  candidate: IceCandidatePayload;
}

const DEFAULT_SIGNALING_URL = "ws://localhost:8080";
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 6;

function upsertParticipant(participants: ParticipantInfo[], incoming: ParticipantInfo): ParticipantInfo[] {
  const index = participants.findIndex((participant) => participant.id === incoming.id);
  if (index === -1) {
    return [...participants, incoming];
  }
  const next = [...participants];
  next[index] = incoming;
  return next;
}

function isServerMessage(value: unknown): value is ServerToClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { type?: unknown };
  return typeof record.type === "string";
}

export interface UseSignalingRoomResult {
  status: string;
  roomId: string | null;
  connected: boolean;
  self: ParticipantInfo | null;
  participants: ParticipantInfo[];
  lastMessage: ServerToClientMessage | null;
  joinRoom: (request: JoinRoomRequest) => void;
  leaveRoom: () => void;
  setTalkback: (enabled: boolean) => boolean;
  sendRelayOffer: (request: RelaySdpRequest) => boolean;
  sendRelayAnswer: (request: RelaySdpRequest) => boolean;
  sendRelayIce: (request: RelayIceRequest) => boolean;
}

export function useSignalingRoom(signalingUrl = DEFAULT_SIGNALING_URL): UseSignalingRoomResult {
  const socketRef = useRef<WebSocket | null>(null);
  const joinRef = useRef<JoinRoomRequest | null>(null);
  const manualCloseRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const messageQueueRef = useRef<ClientToServerMessage[]>([]);

  const [status, setStatus] = useState("Idle");
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [self, setSelf] = useState<ParticipantInfo | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [lastMessage, setLastMessage] = useState<ServerToClientMessage | null>(null);

  const flushQueue = useCallback((socket?: WebSocket | null) => {
    const s = socket ?? socketRef.current;
    if (!s || s.readyState !== WebSocket.OPEN) return;
    while (messageQueueRef.current.length) {
      const msg = messageQueueRef.current.shift()!;
      try {
        s.send(JSON.stringify(msg));
      } catch (err) {
        console.warn("[signaling] failed to send queued message, re-queueing", err);
        messageQueueRef.current.unshift(msg);
        break;
      }
    }
  }, []);

  const sendMessage = useCallback((message: ClientToServerMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // buffer message for later
      messageQueueRef.current.push(message);
      return true;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.warn("[signaling] send failed, queueing", err);
      messageQueueRef.current.push(message);
      return true;
    }
  }, []);

  const leaveRoom = useCallback(() => {
    manualCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      reconnectAttemptsRef.current = 0;
    }
    const socket = socketRef.current;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
    socketRef.current = null;
    joinRef.current = null;
    setConnected(false);
    setRoomId(null);
    setSelf(null);
    setParticipants([]);
    setLastMessage(null);
    setStatus("Disconnected");
  }, []);

  const joinRoom = useCallback(
    (request: JoinRoomRequest) => {
      // cancel any pending reconnect
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      manualCloseRef.current = false;

      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {}
      }

      setConnected(false);
      setRoomId(request.roomId);
      setSelf(null);
      setParticipants([]);
      setLastMessage(null);
      joinRef.current = request;

      const socket = new WebSocket(signalingUrl);
      socketRef.current = socket;
      setStatus(`Connecting to signaling at ${signalingUrl}...`);

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        try {
          socket.send(
            JSON.stringify({
              type: "join_room",
              roomId: request.roomId,
              participantId: request.participantId,
              role: request.role
            } satisfies ClientToServerMessage)
          );
        } catch (err) {
          console.warn("[signaling] failed to send join on open", err);
        }
        setConnected(true);
        setStatus(`Connected to signaling at ${signalingUrl}`);
        flushQueue(socket);
      };

      socket.onerror = () => {
        setStatus("Could not connect to signaling server.");
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
          setConnected(false);
          setStatus("Disconnected from signaling server.");
          // schedule reconnect if appropriate
          if (joinRef.current && !manualCloseRef.current) {
            const attempts = reconnectAttemptsRef.current || 0;
            if (attempts >= RECONNECT_MAX_ATTEMPTS) {
              setStatus("Max reconnect attempts reached.");
              joinRef.current = null;
              return;
            }
            const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempts));
            reconnectAttemptsRef.current = attempts + 1;
            setStatus(`Reconnecting in ${delay}ms...`);
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              if (!joinRef.current) return;
              joinRoom(joinRef.current);
            }, delay);
          }
        }
      };

      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          setStatus("Received invalid message from signaling server.");
          return;
        }

        if (!isServerMessage(parsed)) {
          return;
        }

        const message = parsed;
        setLastMessage(message);

        switch (message.type) {
          case "joined_room":
            setRoomId(message.roomId);
            setSelf(message.you);
            setParticipants(message.participants);
            setStatus(`Joined room ${message.roomId} as ${message.you.role}.`);
            // drain any queued outgoing messages now that we're joined
            flushQueue();
            break;
          case "participant_joined":
            setParticipants((previous) => upsertParticipant(previous, message.participant));
            break;
          case "participant_left":
            setParticipants((previous) =>
              previous.filter((participant) => participant.id !== message.participantId)
            );
            break;
          case "talkback_changed":
            setSelf((previous) =>
              previous?.id === message.participantId
                ? { ...previous, talkbackEnabled: message.enabled }
                : previous
            );
            setParticipants((previous) =>
              previous.map((participant) =>
                participant.id === message.participantId
                  ? { ...participant, talkbackEnabled: message.enabled }
                  : participant
              )
            );
            break;
          case "error":
            setStatus(`Server error (${message.code}): ${message.message}`);
            break;
          default:
            break;
        }
      };
    },
    [signalingUrl, flushQueue]
  );

  const setTalkback = useCallback(
    (enabled: boolean): boolean => {
      const joined = joinRef.current;
      if (!joined || joined.role !== "viewer") {
        return false;
      }
      return sendMessage({
        type: "set_talkback",
        roomId: joined.roomId,
        participantId: joined.participantId,
        enabled
      });
    },
    [sendMessage]
  );

  const sendRelayOffer = useCallback(
    (request: RelaySdpRequest): boolean => {
      const joined = joinRef.current;
      if (!joined) {
        return false;
      }
      return sendMessage({
        type: "relay_offer",
        roomId: joined.roomId,
        fromId: joined.participantId,
        toId: request.toId,
        channel: request.channel,
        sdp: request.sdp
      });
    },
    [sendMessage]
  );

  const sendRelayAnswer = useCallback(
    (request: RelaySdpRequest): boolean => {
      const joined = joinRef.current;
      if (!joined) {
        return false;
      }
      return sendMessage({
        type: "relay_answer",
        roomId: joined.roomId,
        fromId: joined.participantId,
        toId: request.toId,
        channel: request.channel,
        sdp: request.sdp
      });
    },
    [sendMessage]
  );

  const sendRelayIce = useCallback(
    (request: RelayIceRequest): boolean => {
      const joined = joinRef.current;
      if (!joined) {
        return false;
      }
      return sendMessage({
        type: "relay_ice",
        roomId: joined.roomId,
        fromId: joined.participantId,
        toId: request.toId,
        channel: request.channel,
        candidate: request.candidate
      });
    },
    [sendMessage]
  );

  useEffect(() => leaveRoom, [leaveRoom]);

  return {
    status,
    roomId,
    connected,
    self,
    participants,
    lastMessage,
    joinRoom,
    leaveRoom,
    setTalkback,
    sendRelayOffer,
    sendRelayAnswer,
    sendRelayIce
  };
}
