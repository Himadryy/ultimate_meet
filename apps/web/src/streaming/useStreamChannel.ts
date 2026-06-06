import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseAdaptiveVideoLayer,
  chooseVideoLayer,
  createAdaptiveLayerState,
  DEFAULT_VIDEO_LAYERS,
  findActiveStreamer,
  listStreamRecipients,
  type AudioConfig,
  type IceCandidatePayload,
  type NetworkMetrics,
  type ParticipantInfo,
  type ServerToClientMessage,
  type VideoLayer
} from "@ultimate-meet/shared";
import { aggregatePeerMetrics, readPeerNetworkMetrics, type StatsSnapshotMap } from "./webrtcMetrics";
import { DEFAULT_SIGNALING_WS_URL, resolveIceServersEndpoint } from "../network/signalingEndpoints";

interface UseStreamChannelInput {
  roomId: string | null;
  self: ParticipantInfo | null;
  participants: ParticipantInfo[];
  lastMessage: ServerToClientMessage | null;
  audioPolicy: Pick<
    AudioConfig,
    "autoEnableEchoCancellation" | "autoEnableNoiseSuppression" | "autoEnableAutoGainControl"
  >;
  preferredInputDeviceId: string;
  micMuted: boolean;
  cameraMuted: boolean;
  micLevelPct: number;
  sendRelayOffer: (request: { toId: string; channel: "stream"; sdp: string }) => boolean;
  sendRelayAnswer: (request: { toId: string; channel: "stream"; sdp: string }) => boolean;
  sendRelayIce: (request: {
    toId: string;
    channel: "stream";
    candidate: IceCandidatePayload;
  }) => boolean;
}

interface UseStreamChannelResult {
  localStreams: MediaStream[];
  remoteStreams: MediaStream[];
  streamStatus: string;
  iceServerStatus: string;
  networkMetrics: NetworkMetrics | null;
  videoFps: number | null;
  activeVideoLayer: VideoLayer;
  toggleScreenShare: () => Promise<void>;
  isScreenSharing: boolean;
}

const DEFAULT_ACTIVE_LAYER = DEFAULT_VIDEO_LAYERS[DEFAULT_VIDEO_LAYERS.length - 1];
const ICE_SERVERS_ENDPOINT = resolveIceServersEndpoint(DEFAULT_SIGNALING_WS_URL);

function toIcePayload(candidate: RTCIceCandidate): IceCandidatePayload {
  const candidateWithUsername = candidate as RTCIceCandidate & { usernameFragment?: string | null };
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidateWithUsername.usernameFragment ?? null
  };
}

async function applyTrackConstraints(track: MediaStreamTrack, layer: VideoLayer): Promise<void> {
  try {
    await track.applyConstraints({
      width: { ideal: layer.width, max: layer.width },
      height: { ideal: layer.height, max: layer.height },
      frameRate: { ideal: layer.fps, max: layer.fps }
    });
  } catch {
    // Keep current track settings when constraints cannot be applied by device/browser.
  }
}

async function applyLayerToPeer(peer: RTCPeerConnection, layer: VideoLayer): Promise<void> {
  const updates: Promise<void>[] = [];
  for (const sender of peer.getSenders()) {
    if (!sender.track || sender.track.kind !== "video") {
      continue;
    }

    const parameters = sender.getParameters();
    const existingEncoding = parameters.encodings?.[0] ?? {};
    parameters.encodings = [
      {
        ...existingEncoding,
        maxBitrate: layer.targetBitrateKbps * 1000,
        maxFramerate: layer.fps,
        scaleResolutionDownBy: 1
      }
    ];

    const update = sender
      .setParameters(parameters)
      .catch(() => undefined)
      .then(() => undefined);
    updates.push(update);
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as RTCIceServer;
  const validUrls = typeof candidate.urls === "string" || Array.isArray(candidate.urls);
  if (!validUrls) {
    return false;
  }
  if (Array.isArray(candidate.urls) && candidate.urls.some((entry) => typeof entry !== "string")) {
    return false;
  }
  if (candidate.username !== undefined && typeof candidate.username !== "string") {
    return false;
  }
  if (candidate.credential !== undefined && typeof candidate.credential !== "string") {
    return false;
  }
  return true;
}

export function useStreamChannel({
  roomId,
  self,
  participants,
  lastMessage,
  audioPolicy,
  preferredInputDeviceId,
  micMuted,
  cameraMuted,
  micLevelPct,
  sendRelayOffer,
  sendRelayAnswer,
  sendRelayIce
}: UseStreamChannelInput): UseStreamChannelResult {
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, IceCandidatePayload[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localDisplayStreamRef = useRef<MediaStream | null>(null);
  const duckingGainNodeRef = useRef<GainNode | null>(null);
  const statsSnapshotsRef = useRef(new Map<string, StatsSnapshotMap>());
  const adaptiveStateRef = useRef(createAdaptiveLayerState(DEFAULT_ACTIVE_LAYER.name));
  const activeLayerRef = useRef(DEFAULT_ACTIVE_LAYER);
  const iceServersRef = useRef<RTCIceServer[]>([]);

  const [localStreams, setLocalStreams] = useState<MediaStream[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const [streamStatus, setStreamStatus] = useState("Waiting to join room.");
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null);
  const [videoFps, setVideoFps] = useState<number | null>(null);
  const [activeVideoLayer, setActiveVideoLayer] = useState<VideoLayer>(DEFAULT_ACTIVE_LAYER);
  const [iceServerStatus, setIceServerStatus] = useState("Loading relay profile...");
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  useEffect(() => {
    if (duckingGainNodeRef.current) {
      const targetGain = micLevelPct > 15 ? 0.15 : 1.0;
      duckingGainNodeRef.current.gain.setTargetAtTime(targetGain, duckingGainNodeRef.current.context.currentTime, 0.1);
    }
  }, [micLevelPct]);

  useEffect(() => {
    let cancelled = false;
    const loadIceServers = async () => {
      try {
        const response = await fetch(ICE_SERVERS_ENDPOINT, {
          method: "GET",
          headers: { accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(`ice_http_${response.status}`);
        }
        const payload = (await response.json()) as { iceServers?: unknown };
        const iceServers = Array.isArray(payload.iceServers)
          ? payload.iceServers.filter((entry): entry is RTCIceServer => isIceServer(entry))
          : [];
        if (cancelled) {
          return;
        }
        iceServersRef.current = iceServers;
        setIceServerStatus(
          iceServers.length > 0
            ? `Relay profile loaded (${iceServers.length} ICE routes).`
            : "No relay routes returned. Falling back to direct ICE."
        );
      } catch {
        if (cancelled) {
          return;
        }
        iceServersRef.current = [];
        setIceServerStatus("Relay bootstrap unavailable. Falling back to direct ICE.");
      }
    };
    void loadIceServers();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLayerToOutbound = useCallback(async (layer: VideoLayer) => {
    const localVideoTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    if (localVideoTrack) {
      await applyTrackConstraints(localVideoTrack, layer);
    }

    const updates: Promise<void>[] = [];
    for (const peer of peersRef.current.values()) {
      updates.push(applyLayerToPeer(peer, layer));
    }
    if (updates.length > 0) {
      await Promise.all(updates);
    }
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
    statsSnapshotsRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const peerId of peersRef.current.keys()) {
      closePeer(peerId);
    }
  }, [closePeer]);

  const resetAdaptiveState = useCallback(() => {
    activeLayerRef.current = DEFAULT_ACTIVE_LAYER;
    adaptiveStateRef.current = createAdaptiveLayerState(DEFAULT_ACTIVE_LAYER.name);
    setActiveVideoLayer(DEFAULT_ACTIVE_LAYER);
    setNetworkMetrics(null);
    setVideoFps(null);
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localDisplayStreamRef.current) {
      localDisplayStreamRef.current.getTracks().forEach((t) => t.stop());
      localDisplayStreamRef.current = null;
    }
    setLocalStreams([]);
  }, []);

  const queueCandidate = useCallback((peerId: string, candidate: IceCandidatePayload) => {
    const pending = pendingCandidatesRef.current.get(peerId) ?? [];
    pending.push(candidate);
    pendingCandidatesRef.current.set(peerId, pending);
  }, []);

  const flushPendingCandidates = useCallback(
    async (peerId: string, peer: RTCPeerConnection) => {
      const queued = pendingCandidatesRef.current.get(peerId);
      if (!queued || queued.length === 0) {
        return;
      }
      for (const candidate of queued) {
        try {
          await peer.addIceCandidate(candidate);
        } catch {
          setStreamStatus("ICE candidate processing delayed while connection negotiates.");
        }
      }
      pendingCandidatesRef.current.delete(peerId);
    },
    []
  );

  const createPeer = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        return existing;
      }

      const peer = new RTCPeerConnection(
        iceServersRef.current.length > 0 ? { iceServers: iceServersRef.current } : undefined
      );

      peer.onicecandidate = (event) => {
        if (!event.candidate || !self || !roomId) {
          return;
        }
        sendRelayIce({
          toId: peerId,
          channel: "stream",
          candidate: toIcePayload(event.candidate)
        });
      };

      if (self?.role === "viewer") {
        peer.ontrack = (event) => {
          setRemoteStreams((prev) => {
            const newStreams = [...prev];
            for (const stream of event.streams) {
              if (!newStreams.some((s) => s.id === stream.id)) {
                newStreams.push(stream);
              }
            }
            return newStreams;
          });
          setStreamStatus(`Subscribed to streamer ${peerId}.`);
        };
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          closePeer(peerId);
          if (self?.role === "viewer") {
            setRemoteStreams([]);
          }
        }
      };

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [closePeer, roomId, self, sendRelayIce]
  );

  const ensureLocalStreams = useCallback(async (): Promise<MediaStream[]> => {
    let cameraStream = localStreamRef.current;
    if (!cameraStream) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStreamStatus("Browser does not support media capture.");
        return [];
      }
      try {
        const audioConstraint: MediaTrackConstraints = {
          echoCancellation: audioPolicy.autoEnableEchoCancellation,
          noiseSuppression: audioPolicy.autoEnableNoiseSuppression,
          autoGainControl: audioPolicy.autoEnableAutoGainControl
        };
        if (preferredInputDeviceId) {
          audioConstraint.deviceId = { exact: preferredInputDeviceId };
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: audioConstraint
        });

        const videoTrack = cameraStream.getVideoTracks()[0] ?? null;
        if (videoTrack) {
          await applyTrackConstraints(videoTrack, activeLayerRef.current);
        }
        localStreamRef.current = cameraStream;
      } catch {
        setStreamStatus("Could not access camera/microphone.");
        return [];
      }
    }

    let displayStream = localDisplayStreamRef.current;
    if (isScreenSharing && !displayStream && navigator.mediaDevices.getDisplayMedia) {
      try {
        const rawStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: activeLayerRef.current.fps, max: activeLayerRef.current.fps } },
          audio: {
            suppressLocalAudioPlayback: true,
            echoCancellation: false,
            noiseSuppression: false
          } as MediaTrackConstraints
        });

        const rawAudioTrack = rawStream.getAudioTracks()[0];
        if (rawAudioTrack && window.AudioContext) {
          const audioCtx = new window.AudioContext();
          const source = audioCtx.createMediaStreamSource(new MediaStream([rawAudioTrack]));
          const gainNode = audioCtx.createGain();
          source.connect(gainNode);
          const dest = audioCtx.createMediaStreamDestination();
          gainNode.connect(dest);
          
          duckingGainNodeRef.current = gainNode;
          
          const duckedAudioTrack = dest.stream.getAudioTracks()[0];
          rawStream.removeTrack(rawAudioTrack);
          rawStream.addTrack(duckedAudioTrack);
        }

        displayStream = rawStream;
        localDisplayStreamRef.current = displayStream;
        displayStream.getVideoTracks()[0].onended = () => {
          // Re-trigger by turning off screen sharing
          setIsScreenSharing(false);
        };
      } catch {
        setIsScreenSharing(false);
      }
    } else if (!isScreenSharing && displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
      localDisplayStreamRef.current = null;
      displayStream = null;
    }
    if (cameraStream) {
      cameraStream.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
      cameraStream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraMuted;
      });
    }

    const activeStreams = [cameraStream, displayStream].filter(Boolean) as MediaStream[];
    setLocalStreams(activeStreams);
    setStreamStatus("Publishing local stream(s) to viewers.");
    return activeStreams;
  }, [audioPolicy, micMuted, cameraMuted, preferredInputDeviceId, isScreenSharing]);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !micMuted;
    });
  }, [micMuted]);

  useEffect(() => {
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !cameraMuted;
    });
  }, [cameraMuted]);

  const toggleScreenShare = useCallback(async () => {
    setIsScreenSharing((prev) => !prev);
    // Since publishToViewer handles the current state of tracks and negotiation,
    // we can rely on a useEffect to trigger publishToViewer when isScreenSharing changes.
  }, []);

  const publishToViewer = useCallback(
    async (viewerId: string) => {
      if (!self || self.role !== "streamer" || !roomId) {
        return;
      }

      const streams = await ensureLocalStreams();
      if (streams.length === 0) {
        return;
      }

      const peer = createPeer(viewerId);
      
      let needsNegotiation = false;
      
      for (const sender of peer.getSenders()) {
        if (sender.track) {
          const stillExists = streams.some((s) => s.getTracks().includes(sender.track!));
          if (!stillExists) {
            peer.removeTrack(sender);
            needsNegotiation = true;
          }
        }
      }

      for (const stream of streams) {
        for (const track of stream.getTracks()) {
          const hasTrack = peer
            .getSenders()
            .some((sender) => sender.track && sender.track.id === track.id);
          if (!hasTrack) {
            peer.addTrack(track, stream);
            needsNegotiation = true;
          }
        }
      }

      await applyLayerToPeer(peer, activeLayerRef.current);

      if (!needsNegotiation && peer.currentLocalDescription) {
        return;
      }

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) {
        setStreamStatus("Offer generation failed (missing SDP).");
        return;
      }

      sendRelayOffer({
        toId: viewerId,
        channel: "stream",
        sdp: offer.sdp
      });
    },
    [applyLayerToPeer, createPeer, ensureLocalStreams, roomId, self, sendRelayOffer]
  );

  const processRelayOffer = useCallback(
    async (message: Extract<ServerToClientMessage, { type: "relay_offer" }>) => {
      if (!self || self.role !== "viewer" || !roomId) {
        return;
      }
      const peer = createPeer(message.fromId);

      await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
      await flushPendingCandidates(message.fromId, peer);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (!answer.sdp) {
        setStreamStatus("Answer generation failed (missing SDP).");
        return;
      }

      sendRelayAnswer({
        toId: message.fromId,
        channel: "stream",
        sdp: answer.sdp
      });
    },
    [createPeer, flushPendingCandidates, roomId, self, sendRelayAnswer]
  );

  const processRelayAnswer = useCallback(
    async (message: Extract<ServerToClientMessage, { type: "relay_answer" }>) => {
      const peer = peersRef.current.get(message.fromId);
      if (!peer) {
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
      await flushPendingCandidates(message.fromId, peer);
    },
    [flushPendingCandidates]
  );

  const processRelayIce = useCallback(
    async (message: Extract<ServerToClientMessage, { type: "relay_ice" }>) => {
      const peer = peersRef.current.get(message.fromId);
      if (!peer) {
        queueCandidate(message.fromId, message.candidate);
        return;
      }
      if (!peer.remoteDescription) {
        queueCandidate(message.fromId, message.candidate);
        return;
      }
      try {
        await peer.addIceCandidate(message.candidate);
      } catch {
        queueCandidate(message.fromId, message.candidate);
      }
    },
    [queueCandidate]
  );

  useEffect(() => {
    if (!roomId || !self) {
      closeAllPeers();
      stopLocalStream();
      setRemoteStreams([]);
      resetAdaptiveState();
      setStreamStatus("Waiting to join room.");
      return;
    }

    if (self.role === "streamer") {
      setRemoteStreams([]);
      const viewerIds = listStreamRecipients(participants, self.id, self.role);
      for (const viewerId of viewerIds) {
        void publishToViewer(viewerId);
      }
      for (const existingPeerId of peersRef.current.keys()) {
        if (!viewerIds.includes(existingPeerId)) {
          closePeer(existingPeerId);
        }
      }
      if (viewerIds.length === 0) {
        setStreamStatus("Streamer ready. Waiting for viewers to subscribe.");
      }
      return;
    }

    stopLocalStream();
    const streamer = findActiveStreamer(participants, self.id);
    if (!streamer) {
      setRemoteStreams([]);
      setStreamStatus("Viewer connected. Waiting for streamer.");
    }
  }, [
    closeAllPeers,
    closePeer,
    participants,
    publishToViewer,
    resetAdaptiveState,
    roomId,
    self,
    stopLocalStream
  ]);

  useEffect(() => {
    if (!roomId || !self) {
      return;
    }

    let cancelled = false;

    const collectStats = async () => {
      const peerMetrics: NetworkMetrics[] = [];
      const peerFps: number[] = [];

      for (const [peerId, peer] of peersRef.current.entries()) {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          continue;
        }
        try {
          const report = await peer.getStats();
          const previous = statsSnapshotsRef.current.get(peerId) ?? new Map();
          const parsed = readPeerNetworkMetrics(report, previous);
          statsSnapshotsRef.current.set(peerId, parsed.snapshots);
          peerMetrics.push(parsed.metrics);
          if (parsed.fps !== null) {
            peerFps.push(parsed.fps);
          }
        } catch {
          // Ignore transient stats read issues.
        }
      }

      if (cancelled) {
        return;
      }

      const aggregated = aggregatePeerMetrics(peerMetrics);
      if (!aggregated) {
        setVideoFps(null);
        return;
      }

      setNetworkMetrics(aggregated);
      setVideoFps(
        peerFps.length > 0
          ? Math.max(1, Math.round(peerFps.reduce((sum, fps) => sum + fps, 0) / peerFps.length))
          : null
      );

      if (self.role !== "streamer") {
        const suggestedLayer = chooseVideoLayer(aggregated, DEFAULT_VIDEO_LAYERS);
        if (suggestedLayer.name !== activeLayerRef.current.name) {
          activeLayerRef.current = suggestedLayer;
          setActiveVideoLayer(suggestedLayer);
        }
        return;
      }

      const decision = chooseAdaptiveVideoLayer(aggregated, adaptiveStateRef.current, {
        layers: DEFAULT_VIDEO_LAYERS
      });
      adaptiveStateRef.current = decision.state;

      if (!decision.changed || decision.layer.name === activeLayerRef.current.name) {
        return;
      }

      activeLayerRef.current = decision.layer;
      setActiveVideoLayer(decision.layer);
      await applyLayerToOutbound(decision.layer);

      const reasonLabel =
        decision.reason === "upgrade"
          ? "improved"
          : decision.reason === "emergency_downgrade"
            ? "protected from severe network stress"
            : "stabilized under network stress";

      setStreamStatus(
        `Adaptive quality set to ${decision.layer.name.toUpperCase()} (${decision.layer.width}x${decision.layer.height}@${decision.layer.fps}) - ${reasonLabel}.`
      );
    };

    void collectStats();
    const timer = window.setInterval(() => {
      void collectStats();
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyLayerToOutbound, roomId, self]);

  useEffect(() => {
    if (!lastMessage || !self || !roomId) {
      return;
    }

    if ("roomId" in lastMessage && lastMessage.roomId !== roomId) {
      return;
    }

    if (lastMessage.type === "participant_left") {
      closePeer(lastMessage.participantId);
      if (self.role === "viewer") {
        const streamer = findActiveStreamer(participants, self.id);
        if (!streamer) {
          setRemoteStreams([]);
        }
      }
      return;
    }

    if (lastMessage.type === "relay_offer") {
      if (lastMessage.channel !== "stream" || lastMessage.toId !== self.id) {
        return;
      }
      void processRelayOffer(lastMessage);
      return;
    }

    if (lastMessage.type === "relay_answer") {
      if (lastMessage.channel !== "stream" || lastMessage.toId !== self.id) {
        return;
      }
      void processRelayAnswer(lastMessage);
      return;
    }

    if (lastMessage.type === "relay_ice") {
      if (lastMessage.channel !== "stream" || lastMessage.toId !== self.id) {
        return;
      }
      void processRelayIce(lastMessage);
    }
  }, [
    closePeer,
    lastMessage,
    participants,
    processRelayAnswer,
    processRelayIce,
    processRelayOffer,
    roomId,
    self
  ]);

  useEffect(
    () => () => {
      closeAllPeers();
      stopLocalStream();
    },
    [closeAllPeers, stopLocalStream]
  );

  useEffect(() => {
    if (self?.role === "streamer" && roomId) {
      const viewerIds = listStreamRecipients(participants, self.id, self.role);
      for (const viewerId of viewerIds) {
        void publishToViewer(viewerId);
      }
    }
  }, [isScreenSharing, self, roomId, participants, publishToViewer]);

  return {
    localStreams,
    remoteStreams,
    streamStatus,
    iceServerStatus,
    networkMetrics,
    videoFps,
    activeVideoLayer,
    toggleScreenShare,
    isScreenSharing
  };
}
