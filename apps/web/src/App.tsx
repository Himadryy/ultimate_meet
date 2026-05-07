import { useEffect, useMemo, useState } from "react";
import {
  buildAudioConfig,
  buildEchoRiskGuidance,
  type ParticipantRole
} from "@ultimate-meet/shared";
import { AudioControlsCard } from "./audio/AudioControlsCard";
import { useAudioControls } from "./audio/useAudioControls";
import { MediaStage } from "./components/MediaStage";
import { ParticipantsList } from "./components/ParticipantsList";
import { TelemetryDebugPanel } from "./components/TelemetryDebugPanel";
import { useSignalingRoom } from "./hooks/useSignalingRoom";
import { useStreamChannel } from "./streaming/useStreamChannel";
import { useMediaTelemetry } from "./telemetry/useMediaTelemetry";

const TELEMETRY_REFRESH_MS = 1_000;

export default function App() {
  const [role, setRole] = useState<ParticipantRole>("viewer");
  const [participantId, setParticipantId] = useState("");
  const [roomId, setRoomId] = useState("alpha-room");
  const [talkbackEnabled, setTalkbackEnabled] = useState(false);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [supportsEchoCancellation, setSupportsEchoCancellation] = useState(true);

  const signaling = useSignalingRoom();
  const { connected, self, setTalkback } = signaling;

  useEffect(() => {
    setSupportsEchoCancellation(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getSupportedConstraints?.().echoCancellation
    );
  }, []);

  useEffect(() => {
    if (self?.role === "viewer") {
      setTalkbackEnabled(self.talkbackEnabled);
    }
  }, [self]);

  useEffect(() => {
    if (role !== "viewer") {
      setTalkbackEnabled(false);
    }
  }, [role]);

  useEffect(() => {
    if (!connected || role !== "viewer") {
      return;
    }
    setTalkback(talkbackEnabled);
  }, [connected, role, setTalkback, talkbackEnabled]);

  const captureAudioPolicy = useMemo(
    () =>
      buildAudioConfig(role, {
        supportsEchoCancellation,
        hasHeadphones: false,
        outputVolumePct: 45,
        noisyEnvironment: false
      }),
    [role, supportsEchoCancellation]
  );

  const audioControls = useAudioControls({
    audioPolicy: captureAudioPolicy,
    initialMicMuted: captureAudioPolicy.viewerMicDefaultMuted,
    initialSpeakerVolumePct: 45
  });

  const { localStream, remoteStream, streamStatus, networkMetrics, videoFps, activeVideoLayer } = useStreamChannel({
    roomId: signaling.roomId,
    self: signaling.self,
    participants: signaling.participants,
    lastMessage: signaling.lastMessage,
    audioPolicy: captureAudioPolicy,
    preferredInputDeviceId: audioControls.selectedInputId,
    micMuted: audioControls.micMuted,
    sendRelayOffer: signaling.sendRelayOffer,
    sendRelayAnswer: signaling.sendRelayAnswer,
    sendRelayIce: signaling.sendRelayIce
  });

  const audioContext = useMemo(
    () => ({
      supportsEchoCancellation,
      hasHeadphones: audioControls.hasHeadphones,
      outputVolumePct: audioControls.speakerVolumePct,
      noisyEnvironment: false
    }),
    [audioControls.hasHeadphones, audioControls.speakerVolumePct, supportsEchoCancellation]
  );

  const audioPolicy = useMemo(() => buildAudioConfig(role, audioContext), [audioContext, role]);

  const echoGuidance = useMemo(
    () =>
      buildEchoRiskGuidance(audioPolicy, {
        hasHeadphones: audioContext.hasHeadphones,
        outputVolumePct: audioContext.outputVolumePct
      }),
    [audioContext.hasHeadphones, audioContext.outputVolumePct, audioPolicy]
  );

  const telemetry = useMediaTelemetry({
    networkMetrics,
    selectedLayer: activeVideoLayer,
    fps: videoFps,
    talkbackEnabled: self?.talkbackEnabled ?? talkbackEnabled,
    audioLevelPct: audioControls.micLevelPct,
    refreshMs: TELEMETRY_REFRESH_MS
  });

  useEffect(() => {
    void audioControls.attachOutputStream(remoteStream);
  }, [audioControls.attachOutputStream, remoteStream]);

  function joinRoom() {
    const nextParticipantId = participantId.trim();
    const nextRoomId = roomId.trim();

    if (!nextParticipantId) {
      setStatusOverride("Participant ID is required.");
      return;
    }

    if (!nextRoomId) {
      setStatusOverride("Room ID is required.");
      return;
    }

    setStatusOverride(null);
    signaling.joinRoom({
      roomId: nextRoomId,
      participantId: nextParticipantId,
      role
    });
  }

  function updateTalkback(enabled: boolean): void {
    if (role !== "viewer") {
      return;
    }

    setTalkbackEnabled(enabled);
    if (!connected) {
      setStatusOverride("Join room first before toggling talkback.");
      return;
    }

    const sent = setTalkback(enabled);
    if (!sent) {
      setStatusOverride("Could not send talkback update.");
    } else {
      setStatusOverride(null);
    }
  }

  return (
    <main className="layout">
      <h1>Ultimate Meet MVP Foundation</h1>

      <section className="card">
        <h2>Room Join</h2>
        <label>
          Room ID
          <input value={roomId} onChange={(event) => setRoomId(event.target.value)} />
        </label>
        <label>
          Participant ID
          <input
            value={participantId}
            onChange={(event) => setParticipantId(event.target.value)}
            placeholder="your-name"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as ParticipantRole)}>
            <option value="streamer">Streamer</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={joinRoom}>
            Join Room
          </button>
          <button type="button" onClick={signaling.leaveRoom}>
            Leave Room
          </button>
        </div>
      </section>

      <MediaStage role={role} localStream={localStream} remoteStream={remoteStream} />
      <ParticipantsList participants={signaling.participants} />

      <section className="card">
        <h2>Adaptive Stream Policy</h2>
        {networkMetrics ? (
          <div className="metric-grid">
            <p>RTT: {Math.round(networkMetrics.rttMs)}ms</p>
            <p>Jitter: {Math.round(networkMetrics.jitterMs)}ms</p>
            <p>Packet loss: {networkMetrics.packetLossPct.toFixed(1)}%</p>
            <p>Bitrate: {Math.round(networkMetrics.availableBitrateKbps)} kbps</p>
            <p>CPU proxy: {Math.round(networkMetrics.cpuLoadPct)}%</p>
          </div>
        ) : (
          <p>Waiting for live WebRTC metrics…</p>
        )}
        <p>
          Selected layer: <strong>{activeVideoLayer.name.toUpperCase()}</strong> (
          {activeVideoLayer.width}x{activeVideoLayer.height} @ {activeVideoLayer.fps}fps)
        </p>
      </section>

      <TelemetryDebugPanel telemetry={telemetry} refreshMs={TELEMETRY_REFRESH_MS} />

      <AudioControlsCard
        role={role}
        micMuted={audioControls.micMuted}
        speakerMuted={audioControls.speakerMuted}
        speakerVolumePct={audioControls.speakerVolumePct}
        micLevelPct={audioControls.micLevelPct}
        inputDevices={audioControls.inputDevices}
        outputDevices={audioControls.outputDevices}
        selectedInputId={audioControls.selectedInputId}
        selectedOutputId={audioControls.selectedOutputId}
        supportsOutputSelection={audioControls.supportsOutputSelection}
        talkbackEnabled={talkbackEnabled}
        canToggleTalkback={role === "viewer" && connected && self?.role === "viewer"}
        audioError={audioControls.audioError}
        policyWarnings={audioPolicy.warnings}
        echoRiskLevel={echoGuidance.level}
        echoRiskSummary={echoGuidance.summary}
        echoRecommendations={echoGuidance.recommendations}
        outputAudioRef={audioControls.outputAudioRef}
        onToggleMicMuted={() => {
          void audioControls.toggleMicMuted();
        }}
        onToggleSpeakerMuted={() => audioControls.setSpeakerMuted((current) => !current)}
        onSpeakerVolumeChange={audioControls.setSpeakerVolumePct}
        onInputDeviceChange={(deviceId) => {
          void audioControls.selectInputDevice(deviceId);
        }}
        onOutputDeviceChange={audioControls.selectOutputDevice}
        onTalkbackChange={updateTalkback}
      />

      <p className="status">{statusOverride ?? signaling.status}</p>
      <p className="status">{streamStatus}</p>
      <p className="status">Talkback requested: {talkbackEnabled ? "enabled" : "disabled"}</p>
    </main>
  );
}
