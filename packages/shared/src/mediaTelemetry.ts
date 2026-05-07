import type { NetworkMetrics, VideoLayer } from "./adaptation.js";

export interface MediaTelemetrySnapshot {
  collectedAtMs: number;
  bitrateKbps: number | null;
  fps: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  selectedLayer: VideoLayer["name"] | null;
  talkbackEnabled: boolean;
  audioLevelPct: number;
}

export interface MediaTelemetryInput {
  networkMetrics: NetworkMetrics | null;
  selectedLayer: Pick<VideoLayer, "name"> | null;
  fps?: number | null;
  talkbackEnabled: boolean;
  audioLevelPct: number;
  nowMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeMetricValue(value: number): number {
  return Math.round(Math.max(0, value));
}

export function createMediaTelemetrySnapshot(input: MediaTelemetryInput): MediaTelemetrySnapshot {
  const metrics = input.networkMetrics;

  return {
    collectedAtMs: input.nowMs ?? Date.now(),
    bitrateKbps: metrics ? normalizeMetricValue(metrics.availableBitrateKbps) : null,
    fps:
      typeof input.fps === "number" && Number.isFinite(input.fps)
        ? normalizeMetricValue(input.fps)
        : null,
    rttMs: metrics ? normalizeMetricValue(metrics.rttMs) : null,
    jitterMs: metrics ? normalizeMetricValue(metrics.jitterMs) : null,
    packetLossPct:
      metrics && Number.isFinite(metrics.packetLossPct)
        ? clamp(Math.round(metrics.packetLossPct * 10) / 10, 0, 100)
        : null,
    selectedLayer: input.selectedLayer?.name ?? null,
    talkbackEnabled: input.talkbackEnabled,
    audioLevelPct:
      typeof input.audioLevelPct === "number" && Number.isFinite(input.audioLevelPct)
        ? clamp(Math.round(input.audioLevelPct), 0, 100)
        : 0
  };
}
