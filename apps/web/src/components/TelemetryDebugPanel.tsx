import type { MediaTelemetrySnapshot } from "@ultimate-meet/shared";

interface TelemetryDebugPanelProps {
  telemetry: MediaTelemetrySnapshot;
  refreshMs: number;
}

function formatRelativeTime(collectedAtMs: number): string {
  const ageMs = Math.max(0, Date.now() - collectedAtMs);
  if (ageMs < 1_000) {
    return "just now";
  }
  const seconds = Math.round(ageMs / 1_000);
  return `${seconds}s ago`;
}

export function TelemetryDebugPanel({ telemetry, refreshMs }: TelemetryDebugPanelProps) {
  return (
    <section className="card">
      <h2>Operator Telemetry</h2>
      <p className="status">
        Snapshot refresh cadence: {Math.round(refreshMs / 1000)}s • Updated{" "}
        {formatRelativeTime(telemetry.collectedAtMs)}
      </p>
      <div className="metric-grid">
        <p>Bitrate: {telemetry.bitrateKbps !== null ? `${telemetry.bitrateKbps} kbps` : "n/a"}</p>
        <p>FPS: {telemetry.fps !== null ? `${telemetry.fps}` : "n/a"}</p>
        <p>RTT: {telemetry.rttMs !== null ? `${telemetry.rttMs} ms` : "n/a"}</p>
        <p>Jitter: {telemetry.jitterMs !== null ? `${telemetry.jitterMs} ms` : "n/a"}</p>
        <p>
          Packet loss: {telemetry.packetLossPct !== null ? `${telemetry.packetLossPct.toFixed(1)}%` : "n/a"}
        </p>
        <p>Layer: {telemetry.selectedLayer ? telemetry.selectedLayer.toUpperCase() : "n/a"}</p>
        <p>Audio level: {telemetry.audioLevelPct}%</p>
        <p>Talkback: {telemetry.talkbackEnabled ? "enabled" : "disabled"}</p>
      </div>
    </section>
  );
}
