import type { NetworkMetrics } from "@ultimate-meet/shared";

const DEFAULT_METRICS: NetworkMetrics = {
  rttMs: 80,
  jitterMs: 10,
  packetLossPct: 0,
  availableBitrateKbps: 1_200,
  cpuLoadPct: 45
};

export interface StatsSnapshot {
  timestamp: number;
  bytesSent?: number;
  bytesReceived?: number;
  totalEncodeTime?: number;
  framesEncoded?: number;
  framesDecoded?: number;
}

export type StatsSnapshotMap = Map<string, StatsSnapshot>;

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) {
    return fallback;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function readPeerNetworkMetrics(
  report: RTCStatsReport,
  previousSnapshots: StatsSnapshotMap
): { metrics: NetworkMetrics; snapshots: StatsSnapshotMap; fps: number | null } {
  const snapshots: StatsSnapshotMap = new Map(previousSnapshots);
  const rttValues: number[] = [];
  const jitterValues: number[] = [];
  const bitrateValues: number[] = [];
  const cpuValues: number[] = [];
  const fpsValues: number[] = [];

  let packetsLost = 0;
  let packetsTotal = 0;

  for (const stat of report.values()) {
    const record = stat as RTCStats & Record<string, unknown>;

    if (stat.type === "candidate-pair") {
      const nominated = record.nominated === true;
      const state = record.state;
      if (nominated && state === "succeeded") {
        const rtt = toNumber(record.currentRoundTripTime);
        if (rtt !== null) {
          rttValues.push(rtt * 1000);
        }
        const availableOutgoing = toNumber(record.availableOutgoingBitrate);
        if (availableOutgoing !== null) {
          bitrateValues.push(availableOutgoing / 1000);
        }
      }
      continue;
    }

    if (stat.type === "inbound-rtp" || stat.type === "outbound-rtp" || stat.type === "remote-inbound-rtp") {
      if (record.kind !== "video") {
        continue;
      }

      const jitter = toNumber(record.jitter);
      if (jitter !== null) {
        jitterValues.push(jitter * 1000);
      }

      const fps = toNumber(record.framesPerSecond);
      if (fps !== null && fps > 0) {
        fpsValues.push(fps);
      }

      const roundTrip = toNumber(record.roundTripTime);
      if (roundTrip !== null) {
        rttValues.push(roundTrip * 1000);
      }

      const lost = toNumber(record.packetsLost);
      const received = toNumber(record.packetsReceived) ?? toNumber(record.packetsSent);
      if (lost !== null && received !== null) {
        packetsLost += Math.max(0, lost);
        packetsTotal += Math.max(0, lost) + Math.max(0, received);
      }

      if (stat.type === "outbound-rtp") {
        if (record.qualityLimitationReason === "cpu") {
          cpuValues.push(95);
        }

        const totalEncodeTime = toNumber(record.totalEncodeTime);
        const framesEncoded = toNumber(record.framesEncoded);
        const previous = previousSnapshots.get(stat.id);
        if (
          previous &&
          totalEncodeTime !== null &&
          framesEncoded !== null &&
          previous.totalEncodeTime !== undefined &&
          previous.framesEncoded !== undefined &&
          framesEncoded > previous.framesEncoded
        ) {
          const encodedFramesDelta = framesEncoded - previous.framesEncoded;
          const encodeTimeDelta = totalEncodeTime - previous.totalEncodeTime;
          if (encodeTimeDelta >= 0) {
            const encodeMsPerFrame = (encodeTimeDelta * 1000) / encodedFramesDelta;
            cpuValues.push(Math.max(5, Math.min(100, (encodeMsPerFrame / 33) * 100)));
          }
        }
      }

      const bytesSent = toNumber(record.bytesSent);
      const bytesReceived = toNumber(record.bytesReceived);
      const framesEncoded = toNumber(record.framesEncoded);
      const framesDecoded = toNumber(record.framesDecoded);
      const previous = previousSnapshots.get(stat.id);
      if (previous && stat.timestamp > previous.timestamp) {
        const elapsedSeconds = (stat.timestamp - previous.timestamp) / 1000;
        if (elapsedSeconds > 0) {
          const sentDelta =
            bytesSent !== null && previous.bytesSent !== undefined
              ? bytesSent - previous.bytesSent
              : null;
          if (sentDelta !== null && sentDelta > 0) {
            bitrateValues.push(((sentDelta * 8) / elapsedSeconds) / 1000);
          }
          const receivedDelta =
            bytesReceived !== null && previous.bytesReceived !== undefined
              ? bytesReceived - previous.bytesReceived
              : null;
          if (receivedDelta !== null && receivedDelta > 0) {
            bitrateValues.push(((receivedDelta * 8) / elapsedSeconds) / 1000);
          }

          const encodedDelta =
            framesEncoded !== null && previous.framesEncoded !== undefined
              ? framesEncoded - previous.framesEncoded
              : null;
          if (encodedDelta !== null && encodedDelta > 0) {
            fpsValues.push(encodedDelta / elapsedSeconds);
          }

          const decodedDelta =
            framesDecoded !== null && previous.framesDecoded !== undefined
              ? framesDecoded - previous.framesDecoded
              : null;
          if (decodedDelta !== null && decodedDelta > 0) {
            fpsValues.push(decodedDelta / elapsedSeconds);
          }
        }
      }

      snapshots.set(stat.id, {
        timestamp: stat.timestamp,
        bytesSent: bytesSent ?? previous?.bytesSent,
        bytesReceived: bytesReceived ?? previous?.bytesReceived,
        totalEncodeTime: toNumber(record.totalEncodeTime) ?? previous?.totalEncodeTime,
        framesEncoded: framesEncoded ?? previous?.framesEncoded,
        framesDecoded: framesDecoded ?? previous?.framesDecoded
      });
    }
  }

  return {
    metrics: {
      rttMs: Math.max(0, Math.round(average(rttValues, DEFAULT_METRICS.rttMs))),
      jitterMs: Math.max(0, Math.round(average(jitterValues, DEFAULT_METRICS.jitterMs))),
      packetLossPct:
        packetsTotal > 0 ? Math.max(0, Math.min(100, (packetsLost / packetsTotal) * 100)) : 0,
      availableBitrateKbps: Math.max(
        150,
        Math.round(average(bitrateValues, DEFAULT_METRICS.availableBitrateKbps))
      ),
      cpuLoadPct: Math.max(0, Math.min(100, Math.round(average(cpuValues, DEFAULT_METRICS.cpuLoadPct))))
    },
    snapshots,
    fps: fpsValues.length > 0 ? Math.max(1, Math.round(average(fpsValues, 0))) : null
  };
}

export function aggregatePeerMetrics(metrics: NetworkMetrics[]): NetworkMetrics | null {
  if (metrics.length === 0) {
    return null;
  }
  return {
    rttMs: Math.round(Math.max(...metrics.map((metric) => metric.rttMs))),
    jitterMs: Math.round(Math.max(...metrics.map((metric) => metric.jitterMs))),
    packetLossPct: Math.max(...metrics.map((metric) => metric.packetLossPct)),
    availableBitrateKbps: Math.max(
      150,
      Math.round(Math.min(...metrics.map((metric) => metric.availableBitrateKbps)))
    ),
    cpuLoadPct: Math.round(Math.max(...metrics.map((metric) => metric.cpuLoadPct)))
  };
}
