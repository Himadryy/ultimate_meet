import type { ParticipantRole } from "@ultimate-meet/shared";
import type { RefObject } from "react";
import type { AudioDeviceOption } from "./audioDeviceUtils";

interface AudioControlsCardProps {
  role: ParticipantRole;
  micMuted: boolean;
  speakerMuted: boolean;
  speakerVolumePct: number;
  micLevelPct: number;
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputId: string;
  selectedOutputId: string;
  supportsOutputSelection: boolean;
  talkbackEnabled: boolean;
  canToggleTalkback: boolean;
  talkbackRestrictionReason: string | null;
  audioError: string | null;
  policyWarnings: string[];
  echoRiskLevel: "low" | "medium" | "high";
  echoRiskSummary: string;
  echoRecommendations: string[];
  outputAudioRef: RefObject<HTMLAudioElement | null>;
  onToggleMicMuted: () => void;
  onToggleSpeakerMuted: () => void;
  onSpeakerVolumeChange: (value: number) => void;
  onInputDeviceChange: (deviceId: string) => void;
  onOutputDeviceChange: (deviceId: string) => void;
  onTalkbackChange: (enabled: boolean) => void;
}

export function AudioControlsCard(props: AudioControlsCardProps) {
  const {
    role,
    micMuted,
    speakerMuted,
    speakerVolumePct,
    micLevelPct,
    inputDevices,
    outputDevices,
    selectedInputId,
    selectedOutputId,
    supportsOutputSelection,
    talkbackEnabled,
    canToggleTalkback,
    talkbackRestrictionReason,
    audioError,
    policyWarnings,
    echoRiskLevel,
    echoRiskSummary,
    echoRecommendations,
    outputAudioRef,
    onToggleMicMuted,
    onToggleSpeakerMuted,
    onSpeakerVolumeChange,
    onInputDeviceChange,
    onOutputDeviceChange,
    onTalkbackChange
  } = props;

  return (
    <section className="card">
      <h2>Audio Studio</h2>
      <div className="control-row">
        <button type="button" onClick={onToggleMicMuted}>
          {micMuted ? "Unmute Mic" : "Mute Mic"}
        </button>
        <button type="button" onClick={onToggleSpeakerMuted}>
          {speakerMuted ? "Undeafen Speaker" : "Deafen Speaker"}
        </button>
      </div>

      <div className="metric-grid">
        <label>
          Input device
          <select value={selectedInputId} onChange={(event) => onInputDeviceChange(event.target.value)}>
            {inputDevices.length === 0 ? (
              <option value="">No input devices found</option>
            ) : (
              inputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label>
          Output device
          <select
            value={selectedOutputId}
            onChange={(event) => onOutputDeviceChange(event.target.value)}
            disabled={!supportsOutputSelection || outputDevices.length === 0}
          >
            {outputDevices.length === 0 ? (
              <option value="">No output devices found</option>
            ) : (
              outputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {!supportsOutputSelection && (
        <p className="status">Output routing is not supported by this browser. Deafen still works locally.</p>
      )}

      <label>
        Speaker volume ({speakerVolumePct}%)
        <input
          type="range"
          min={0}
          max={100}
          value={speakerVolumePct}
          onChange={(event) => onSpeakerVolumeChange(Number(event.target.value))}
        />
      </label>

      <div className="meter-wrap" aria-label="Microphone level diagnostics">
        <div className="meter-fill" style={{ width: `${micLevelPct}%` }} />
      </div>
      <p className="status">Mic level: {micLevelPct}%</p>

      {role === "viewer" && (
        <label className="inline-toggle">
          Talkback
          <input
            type="checkbox"
            checked={talkbackEnabled}
            disabled={!canToggleTalkback}
            onChange={(event) => onTalkbackChange(event.target.checked)}
          />
        </label>
      )}
      {role === "viewer" && talkbackRestrictionReason && (
        <p className="status status-warning">{talkbackRestrictionReason}</p>
      )}

      <div className={`echo-risk echo-risk-${echoRiskLevel}`}>
        <strong>Echo risk: {echoRiskLevel.toUpperCase()}</strong>
        <p>{echoRiskSummary}</p>
        {echoRecommendations.length > 0 && (
          <ul>
            {echoRecommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
        )}
      </div>

      {policyWarnings.length > 0 && (
        <div className="policy-warning-list">
          <strong>Policy warnings</strong>
          <ul>
            {policyWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {audioError && <p className="status status-error">Audio issue: {audioError}</p>}
      <audio ref={outputAudioRef} className="hidden-audio" autoPlay playsInline />
    </section>
  );
}
