import { describe, expect, it } from "vitest";
import { createMediaTelemetrySnapshot } from "../src/mediaTelemetry.js";

describe("createMediaTelemetrySnapshot", () => {
  it("maps network metrics and rounds expected values", () => {
    const snapshot = createMediaTelemetrySnapshot({
      networkMetrics: {
        rttMs: 81.7,
        jitterMs: 10.2,
        packetLossPct: 2.34,
        availableBitrateKbps: 1550.3,
        cpuLoadPct: 42
      },
      selectedLayer: { name: "mid" },
      fps: 27.6,
      talkbackEnabled: true,
      audioLevelPct: 34.8,
      nowMs: 12345
    });

    expect(snapshot).toEqual({
      collectedAtMs: 12345,
      bitrateKbps: 1550,
      fps: 28,
      rttMs: 82,
      jitterMs: 10,
      packetLossPct: 2.3,
      selectedLayer: "mid",
      talkbackEnabled: true,
      audioLevelPct: 35
    });
  });

  it("returns null telemetry fields when network metrics are unavailable", () => {
    const snapshot = createMediaTelemetrySnapshot({
      networkMetrics: null,
      selectedLayer: null,
      fps: null,
      talkbackEnabled: false,
      audioLevelPct: 12,
      nowMs: 22
    });

    expect(snapshot.bitrateKbps).toBeNull();
    expect(snapshot.fps).toBeNull();
    expect(snapshot.rttMs).toBeNull();
    expect(snapshot.jitterMs).toBeNull();
    expect(snapshot.packetLossPct).toBeNull();
    expect(snapshot.selectedLayer).toBeNull();
    expect(snapshot.talkbackEnabled).toBe(false);
    expect(snapshot.audioLevelPct).toBe(12);
  });

  it("clamps packet loss and audio level to safe bounds", () => {
    const snapshot = createMediaTelemetrySnapshot({
      networkMetrics: {
        rttMs: 42,
        jitterMs: 8,
        packetLossPct: 140,
        availableBitrateKbps: 500,
        cpuLoadPct: 20
      },
      selectedLayer: { name: "low" },
      fps: Number.NaN,
      talkbackEnabled: false,
      audioLevelPct: 300
    });

    expect(snapshot.packetLossPct).toBe(100);
    expect(snapshot.audioLevelPct).toBe(100);
    expect(snapshot.fps).toBeNull();
  });
});
