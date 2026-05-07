export interface NetworkMetrics {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  availableBitrateKbps: number;
  cpuLoadPct: number;
}

export interface VideoLayer {
  name: "low" | "mid" | "high";
  width: number;
  height: number;
  fps: number;
  targetBitrateKbps: number;
}

export const DEFAULT_VIDEO_LAYERS: VideoLayer[] = [
  { name: "low", width: 640, height: 360, fps: 15, targetBitrateKbps: 450 },
  { name: "mid", width: 960, height: 540, fps: 24, targetBitrateKbps: 950 },
  { name: "high", width: 1280, height: 720, fps: 30, targetBitrateKbps: 1800 }
];

type VideoLayerName = VideoLayer["name"];

export interface AdaptiveLayerState {
  currentLayerName: VideoLayerName;
  lastSwitchAtMs: number;
  upgradeVotes: number;
  downgradeVotes: number;
}

export interface AdaptiveLayerTuning {
  switchCooldownMs: number;
  upgradeVotesRequired: number;
  downgradeVotesRequired: number;
  emergencyPacketLossPct: number;
  emergencyRttMs: number;
  emergencyJitterMs: number;
  emergencyCpuLoadPct: number;
}

export interface AdaptiveLayerResult {
  layer: VideoLayer;
  state: AdaptiveLayerState;
  changed: boolean;
  reason: "stable" | "upgrade" | "downgrade" | "emergency_downgrade" | "cooldown";
}

const DEFAULT_ADAPTIVE_TUNING: AdaptiveLayerTuning = {
  switchCooldownMs: 8_000,
  upgradeVotesRequired: 3,
  downgradeVotesRequired: 2,
  emergencyPacketLossPct: 9,
  emergencyRttMs: 260,
  emergencyJitterMs: 45,
  emergencyCpuLoadPct: 92
};

function scoreMetrics(metrics: NetworkMetrics): number {
  let score = 100;
  score -= Math.min(metrics.rttMs / 4, 25);
  score -= Math.min(metrics.jitterMs / 2, 20);
  score -= Math.min(metrics.packetLossPct * 4, 25);
  score -= Math.min(metrics.cpuLoadPct / 4, 20);
  return Math.max(0, Math.round(score));
}

function toSortedLayers(layers: VideoLayer[]): VideoLayer[] {
  return [...layers].sort((a, b) => a.targetBitrateKbps - b.targetBitrateKbps);
}

function clampLayerByStress(
  metrics: NetworkMetrics,
  bitrateCandidate: VideoLayer,
  sortedLayers: VideoLayer[]
): VideoLayer {
  const midLayer = sortedLayers[Math.min(1, sortedLayers.length - 1)];
  if (
    metrics.packetLossPct >= DEFAULT_ADAPTIVE_TUNING.emergencyPacketLossPct ||
    metrics.rttMs >= DEFAULT_ADAPTIVE_TUNING.emergencyRttMs ||
    metrics.jitterMs >= DEFAULT_ADAPTIVE_TUNING.emergencyJitterMs ||
    metrics.cpuLoadPct >= DEFAULT_ADAPTIVE_TUNING.emergencyCpuLoadPct
  ) {
    return sortedLayers[0];
  }

  if (metrics.packetLossPct >= 4 || metrics.rttMs >= 140 || metrics.jitterMs >= 25 || metrics.cpuLoadPct >= 78) {
    return sortedLayers[Math.min(sortedLayers.indexOf(bitrateCandidate), sortedLayers.indexOf(midLayer))];
  }

  return bitrateCandidate;
}

function layerFromName(name: VideoLayerName, sortedLayers: VideoLayer[]): VideoLayer {
  return sortedLayers.find((layer) => layer.name === name) ?? sortedLayers[sortedLayers.length - 1];
}

function isEmergency(metrics: NetworkMetrics, tuning: AdaptiveLayerTuning): boolean {
  return (
    metrics.packetLossPct >= tuning.emergencyPacketLossPct ||
    metrics.rttMs >= tuning.emergencyRttMs ||
    metrics.jitterMs >= tuning.emergencyJitterMs ||
    metrics.cpuLoadPct >= tuning.emergencyCpuLoadPct
  );
}

export function chooseVideoLayer(
  metrics: NetworkMetrics,
  layers: VideoLayer[] = DEFAULT_VIDEO_LAYERS
): VideoLayer {
  const sortedLayers = toSortedLayers(layers);
  const qualityScore = scoreMetrics(metrics);

  const allowedByBitrate = sortedLayers.filter(
    (layer) => layer.targetBitrateKbps <= metrics.availableBitrateKbps * 0.8
  );
  const bitrateCandidate = allowedByBitrate.at(-1) ?? sortedLayers[0];
  const stressAdjustedCandidate = clampLayerByStress(metrics, bitrateCandidate, sortedLayers);

  if (qualityScore >= 70) {
    return stressAdjustedCandidate;
  }
  if (qualityScore >= 45) {
    return sortedLayers[Math.max(0, sortedLayers.indexOf(stressAdjustedCandidate) - 1)];
  }
  return sortedLayers[0];
}

export function createAdaptiveLayerState(
  currentLayerName: VideoLayerName = "high",
  nowMs = 0
): AdaptiveLayerState {
  return {
    currentLayerName,
    lastSwitchAtMs: nowMs,
    upgradeVotes: 0,
    downgradeVotes: 0
  };
}

export function chooseAdaptiveVideoLayer(
  metrics: NetworkMetrics,
  state: AdaptiveLayerState,
  options?: {
    layers?: VideoLayer[];
    nowMs?: number;
    tuning?: Partial<AdaptiveLayerTuning>;
  }
): AdaptiveLayerResult {
  const sortedLayers = toSortedLayers(options?.layers ?? DEFAULT_VIDEO_LAYERS);
  const tuning = { ...DEFAULT_ADAPTIVE_TUNING, ...(options?.tuning ?? {}) };
  const nowMs = options?.nowMs ?? Date.now();

  const currentLayer = layerFromName(state.currentLayerName, sortedLayers);
  const targetLayer = chooseVideoLayer(metrics, sortedLayers);

  const currentIndex = sortedLayers.indexOf(currentLayer);
  const targetIndex = sortedLayers.indexOf(targetLayer);
  const inCooldown =
    state.lastSwitchAtMs > 0 && nowMs - state.lastSwitchAtMs < tuning.switchCooldownMs;

  if (targetIndex === currentIndex) {
    return {
      layer: currentLayer,
      state: { ...state, upgradeVotes: 0, downgradeVotes: 0 },
      changed: false,
      reason: "stable"
    };
  }

  if (targetIndex < currentIndex) {
    const emergency = isEmergency(metrics, tuning);
    const nextVotes = state.downgradeVotes + 1;
    if (!emergency && inCooldown) {
      return {
        layer: currentLayer,
        state: { ...state, upgradeVotes: 0, downgradeVotes: nextVotes },
        changed: false,
        reason: "cooldown"
      };
    }

    if (!emergency && nextVotes < tuning.downgradeVotesRequired) {
      return {
        layer: currentLayer,
        state: { ...state, upgradeVotes: 0, downgradeVotes: nextVotes },
        changed: false,
        reason: "stable"
      };
    }

    const nextIndex = emergency ? targetIndex : Math.max(targetIndex, currentIndex - 1);
    const nextLayer = sortedLayers[nextIndex];
    return {
      layer: nextLayer,
      state: {
        currentLayerName: nextLayer.name,
        lastSwitchAtMs: nowMs,
        upgradeVotes: 0,
        downgradeVotes: 0
      },
      changed: true,
      reason: emergency ? "emergency_downgrade" : "downgrade"
    };
  }

  const nextVotes = state.upgradeVotes + 1;
  if (inCooldown) {
    return {
      layer: currentLayer,
      state: { ...state, upgradeVotes: nextVotes, downgradeVotes: 0 },
      changed: false,
      reason: "cooldown"
    };
  }

  if (nextVotes < tuning.upgradeVotesRequired) {
    return {
      layer: currentLayer,
      state: { ...state, upgradeVotes: nextVotes, downgradeVotes: 0 },
      changed: false,
      reason: "stable"
    };
  }

  const nextLayer = sortedLayers[Math.min(targetIndex, currentIndex + 1)];
  return {
    layer: nextLayer,
    state: {
      currentLayerName: nextLayer.name,
      lastSwitchAtMs: nowMs,
      upgradeVotes: 0,
      downgradeVotes: 0
    },
    changed: true,
    reason: "upgrade"
  };
}
