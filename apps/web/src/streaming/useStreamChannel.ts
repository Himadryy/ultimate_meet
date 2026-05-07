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
  sendRelayOffer: (request: { toId: string; channel: "stream"; sdp: string }) => boolean;
  sendRelayAnswer: (request: { toId: string; channel: "stream"; sdp: string }) => boolean;
  sendRelayIce: (request: {
    toId: string;
    channel: "stream";
    candidate: IceCandidatePayload;
  }) => boolean;
}

interface UseStreamChannelResult {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  streamStatus: string;
  networkMetrics: NetworkMetrics | null;
  videoFps: number | null;
  activeVideoLayer: VideoLayer;
}

const DEFAULT_ACTIVE_LAYER = DEFAULT_VIDEO_LAYERS[DEFAULT_VIDEO_LAYERS.length - 1];

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

export function useStreamChannel({
  roomId,
  self,
  participants,
  lastMessage,
  audioPolicy,
  preferredInputDeviceId,
  micMuted,
  sendRelayOffer,
  sendRelayAnswer,
  sendRelayIce
}: UseStreamChannelInput): UseStreamChannelResult {
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, IceCandidatePayload[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const statsSnapshotsRef = useRef(new Map<string, StatsSnapshotMap>());
  const adaptiveStateRef = useRef(createAdaptiveLayerState(DEFAULT_ACTIVE_LAYER.name));
  const activeLayerRef = useRef(DEFAULT_ACTIVE_LAYER);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [streamStatus, setStreamStatus] = useState("Waiting to join room.");
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null);
  const [videoFps, setVideoFps] = useState<number | null>(null);
  const [activeVideoLayer, setActiveVideoLayer] = useState<VideoLayer>(DEFAULT_ACTIVE_LAYER);

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
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    localStreamRef.current = null;
    setLocalStream(null);
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

      const peer = new RTCPeerConnection();

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
          const incomingStream = event.streams[0] ?? new MediaStream([event.track]);
          setRemoteStream(incomingStream);
          setStreamStatus(`Subscribed to streamer ${peerId}.`);
        };
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          closePeer(peerId);
          if (self?.role === "viewer") {
            setRemoteStream(null);
          }
        }
      };

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [closePeer, roomId, self, sendRelayIce]
  );

  const ensureLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStreamStatus("Browser does not support media capture.");
      return null;
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: audioConstraint
        });

        const videoTrack = stream.getVideoTracks()[0] ?? null;
        if (videoTrack) {
          await applyTrackConstraints(videoTrack, activeLayerRef.current);
        }
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !micMuted;
        });

        localStreamRef.current = stream;
        setLocalStream(stream);
        setStreamStatus("Publishing local stream to viewers.");
        return stream;
    } catch {
      setStreamStatus("Could not access camera/microphone.");
      return null;
    }
  }, [audioPolicy, micMuted, preferredInputDeviceId]);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !micMuted;
    });
  }, [micMuted]);

  const publishToViewer = useCallback(
    async (viewerId: string) => {
      if (!self || self.role !== "streamer" || !roomId) {
        return;
      }

      const stream = await ensureLocalStream();
      if (!stream) {
        return;
      }

      const peer = createPeer(viewerId);
      for (const track of stream.getTracks()) {
        const hasTrack = peer
          .getSenders()
          .some((sender) => sender.track && sender.track.id === track.id);
        if (!hasTrack) {
          peer.addTrack(track, stream);
        }
      }

      await applyLayerToPeer(peer, activeLayerRef.current);

      if (peer.signalingState !== "stable" || peer.currentRemoteDescription) {
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
    [applyLayerToPeer, createPeer, ensureLocalStream, roomId, self, sendRelayOffer]
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
      setRemoteStream(null);
      resetAdaptiveState();
      setStreamStatus("Waiting to join room.");
      return;
    }

    if (self.role === "streamer") {
      setRemoteStream(null);
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
      setRemoteStream(null);
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
          setRemoteStream(null);
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

  return {
    localStream,
    remoteStream,
    streamStatus,
    networkMetrics,
    videoFps,
    activeVideoLayer
  };
}
