import type { ParticipantRole } from "./protocol.js";

export interface AudioDeviceContext {
  supportsEchoCancellation: boolean;
  hasHeadphones: boolean;
  outputVolumePct: number;
  noisyEnvironment: boolean;
}

export interface AudioConfig {
  autoEnableEchoCancellation: boolean;
  autoEnableNoiseSuppression: boolean;
  autoEnableAutoGainControl: boolean;
  viewerMicDefaultMuted: boolean;
  warnings: string[];
}

export function buildAudioConfig(
  role: ParticipantRole,
  context: AudioDeviceContext
): AudioConfig {
  const warnings: string[] = [];
  const autoEnableEchoCancellation = context.supportsEchoCancellation;
  const autoEnableNoiseSuppression = context.noisyEnvironment || role === "viewer";
  const autoEnableAutoGainControl = true;

  if (!context.supportsEchoCancellation) {
    warnings.push("Echo cancellation is not supported on this device/browser.");
  }
  if (!context.hasHeadphones && context.outputVolumePct > 70) {
    warnings.push("Use headphones or reduce volume to avoid acoustic feedback.");
  }
  if (role === "viewer" && !context.hasHeadphones && context.outputVolumePct > 45) {
    warnings.push("Viewer talkback is safest with headphones and speaker volume below 45%.");
  }
  if (role === "viewer" && context.outputVolumePct > 60) {
    warnings.push("Reduce speaker volume below 60% before enabling talkback.");
  }

  return {
    autoEnableEchoCancellation,
    autoEnableNoiseSuppression,
    autoEnableAutoGainControl,
    viewerMicDefaultMuted: role === "viewer",
    warnings
  };
}
