import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IceCandidatePayload,
  ParticipantInfo,
  ServerToClientMessage
} from "@ultimate-meet/shared";
import { findActiveStreamer } from "@ultimate-meet/shared";
import { DEFAULT_SIGNALING_WS_URL, resolveIceServersEndpoint } from "../network/signalingEndpoints";

interface UseTalkbackChannelInput {
  roomId: string | null;
  self: ParticipantInfo | null;
  participants: ParticipantInfo[];
  lastMessage: ServerToClientMessage | null;
  talkbackEnabled: boolean;
  micMuted: boolean;
  preferredInputDeviceId: string;
  sendRelayOffer: (request: { toId: string; channel: "talkback"; sdp: string }) => boolean;
  sendRelayAnswer: (request: { toId: string; channel: "talkback"; sdp: string }) => boolean;
  sendRelayIce: (request: { toId: string; channel: "talkback"; candidate: IceCandidatePayload }) => boolean;
}

const ICE_SERVERS_ENDPOINT = resolveIceServersEndpoint(DEFAULT_SIGNALING_WS_URL);

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as RTCIceServer;
  if (typeof candidate.urls !== "string" && !Array.isArray(candidate.urls)) return false;
  return true;
}

function toIcePayload(candidate: RTCIceCandidate): IceCandidatePayload {
  const candidateWithUsername = candidate as RTCIceCandidate & { usernameFragment?: string | null };
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidateWithUsername.usernameFragment ?? null
  };
}

export function useTalkbackChannel({
  roomId,
  self,
  participants,
  lastMessage,
  talkbackEnabled,
  micMuted,
  preferredInputDeviceId,
  sendRelayOffer,
  sendRelayAnswer,
  sendRelayIce
}: UseTalkbackChannelInput) {
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, IceCandidatePayload[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  
  const [remoteTalkbackStreams, setRemoteTalkbackStreams] = useState<MediaStream[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadIceServers = async () => {
      try {
        const response = await fetch(ICE_SERVERS_ENDPOINT, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`ice_http_${response.status}`);
        const payload = await response.json();
        const iceServers = Array.isArray(payload.iceServers)
          ? payload.iceServers.filter(isIceServer)
          : [];
        if (!cancelled) iceServersRef.current = iceServers;
      } catch {
        if (!cancelled) iceServersRef.current = [];
      }
    };
    void loadIceServers();
    return () => { cancelled = true; };
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
      peersRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const peerId of peersRef.current.keys()) closePeer(peerId);
  }, [closePeer]);

  const queueCandidate = useCallback((peerId: string, candidate: IceCandidatePayload) => {
    const pending = pendingCandidatesRef.current.get(peerId) ?? [];
    pending.push(candidate);
    pendingCandidatesRef.current.set(peerId, pending);
  }, []);

  const flushPendingCandidates = useCallback(async (peerId: string, peer: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerId);
    if (!queued || queued.length === 0) return;
    for (const candidate of queued) {
      try { await peer.addIceCandidate(candidate); } catch {}
    }
    pendingCandidatesRef.current.delete(peerId);
  }, []);

  const createPeer = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const peer = new RTCPeerConnection(
      iceServersRef.current.length > 0 ? { iceServers: iceServersRef.current } : undefined
    );

    peer.onicecandidate = (event) => {
      if (!event.candidate || !self || !roomId) return;
      sendRelayIce({ toId: peerId, channel: "talkback", candidate: toIcePayload(event.candidate) });
    };

    if (self?.role === "streamer") {
      peer.ontrack = (event) => {
        setRemoteTalkbackStreams((prev) => {
          const newStreams = [...prev];
          for (const stream of event.streams) {
            if (!newStreams.some((s) => s.id === stream.id)) newStreams.push(stream);
          }
          return newStreams;
        });
      };
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        closePeer(peerId);
      }
    };

    peersRef.current.set(peerId, peer);
    return peer;
  }, [closePeer, roomId, self, sendRelayIce]);

  const ensureLocalAudioStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: preferredInputDeviceId ? { deviceId: { exact: preferredInputDeviceId } } : true,
        video: false
      });
      localStreamRef.current = stream;
      return stream;
    } catch {
      return null;
    }
  }, [preferredInputDeviceId]);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !micMuted;
      });
    }
  }, [micMuted]);

  const publishToStreamer = useCallback(async (streamerId: string) => {
    if (!self || self.role !== "viewer" || !roomId || !talkbackEnabled) return;

    const stream = await ensureLocalAudioStream();
    if (!stream) return;

    const peer = createPeer(streamerId);
    
    let needsNegotiation = false;
    for (const track of stream.getTracks()) {
      if (!peer.getSenders().some((s) => s.track?.id === track.id)) {
        peer.addTrack(track, stream);
        needsNegotiation = true;
      }
    }

    if (!needsNegotiation && peer.currentLocalDescription) return;

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!offer.sdp) return;

    sendRelayOffer({ toId: streamerId, channel: "talkback", sdp: offer.sdp });
  }, [self, roomId, talkbackEnabled, ensureLocalAudioStream, createPeer, sendRelayOffer]);

  const processRelayOffer = useCallback(async (message: Extract<ServerToClientMessage, { type: "relay_offer" }>) => {
    if (!self || self.role !== "streamer" || !roomId) return;
    
    const peer = createPeer(message.fromId);
    await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
    await flushPendingCandidates(message.fromId, peer);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (!answer.sdp) return;

    sendRelayAnswer({ toId: message.fromId, channel: "talkback", sdp: answer.sdp });
  }, [self, roomId, createPeer, flushPendingCandidates, sendRelayAnswer]);

  const processRelayAnswer = useCallback(async (message: Extract<ServerToClientMessage, { type: "relay_answer" }>) => {
    const peer = peersRef.current.get(message.fromId);
    if (!peer) return;
    await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
    await flushPendingCandidates(message.fromId, peer);
  }, [flushPendingCandidates]);

  const processRelayIce = useCallback(async (message: Extract<ServerToClientMessage, { type: "relay_ice" }>) => {
    const peer = peersRef.current.get(message.fromId);
    if (!peer || !peer.remoteDescription) {
      queueCandidate(message.fromId, message.candidate);
      return;
    }
    try {
      await peer.addIceCandidate(message.candidate);
    } catch {
      queueCandidate(message.fromId, message.candidate);
    }
  }, [queueCandidate]);

  useEffect(() => {
    if (!lastMessage || !self || !roomId) return;
    if ("roomId" in lastMessage && lastMessage.roomId !== roomId) return;

    if (lastMessage.type === "participant_left") {
      closePeer(lastMessage.participantId);
      return;
    }

    if (lastMessage.type === "relay_offer" && lastMessage.channel === "talkback" && lastMessage.toId === self.id) {
      void processRelayOffer(lastMessage);
    } else if (lastMessage.type === "relay_answer" && lastMessage.channel === "talkback" && lastMessage.toId === self.id) {
      void processRelayAnswer(lastMessage);
    } else if (lastMessage.type === "relay_ice" && lastMessage.channel === "talkback" && lastMessage.toId === self.id) {
      void processRelayIce(lastMessage);
    }
  }, [lastMessage, self, roomId, closePeer, processRelayOffer, processRelayAnswer, processRelayIce]);

  useEffect(() => {
    if (!roomId || !self) {
      closeAllPeers();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      setRemoteTalkbackStreams([]);
      return;
    }

    if (self.role === "viewer") {
      setRemoteTalkbackStreams([]);
      const streamer = findActiveStreamer(participants, self.id);
      if (streamer && talkbackEnabled) {
        void publishToStreamer(streamer.id);
      } else {
        closeAllPeers();
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }
      }
    }
  }, [roomId, self, participants, talkbackEnabled, closeAllPeers, publishToStreamer]);

  useEffect(() => {
    return () => {
      closeAllPeers();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [closeAllPeers]);

  return { remoteTalkbackStreams };
}
