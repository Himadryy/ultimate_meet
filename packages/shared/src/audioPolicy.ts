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
  const autoEnableNoiseSuppression = context.noisyEnvironment;
  const autoEnableAutoGainControl = true;

  if (!context.supportsEchoCancellation) {
    warnings.push("Echo cancellation is not supported on this device/browser.");
  }
  if (!context.hasHeadphones && context.outputVolumePct > 70) {
    warnings.push("Use headphones or reduce volume to avoid acoustic feedback.");
  }

  return {
    autoEnableEchoCancellation,
    autoEnableNoiseSuppression,
    autoEnableAutoGainControl,
    viewerMicDefaultMuted: role === "viewer",
    warnings
  };
}

