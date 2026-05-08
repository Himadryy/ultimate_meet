import { describe, expect, it } from "vitest";
import {
  chooseAdaptiveVideoLayer,
  chooseVideoLayer,
  createAdaptiveLayerState
} from "../src/adaptation.js";

describe("chooseVideoLayer", () => {
  it("selects fullhd layer when network is healthy", () => {
    const layer = chooseVideoLayer({
      rttMs: 35,
      jitterMs: 5,
      packetLossPct: 0.5,
      availableBitrateKbps: 4000,
      cpuLoadPct: 35
    });
    expect(layer.name).toBe("fullhd");
  });

  it("downshifts for weak network conditions", () => {
    const layer = chooseVideoLayer({
      rttMs: 220,
      jitterMs: 40,
      packetLossPct: 8,
      availableBitrateKbps: 500,
      cpuLoadPct: 90
    });
    expect(layer.name).toBe("low");
  });

  it("requires consecutive healthy samples before upgrading", () => {
    let state = createAdaptiveLayerState("mid", 0);
    const healthyMetrics = {
      rttMs: 30,
      jitterMs: 4,
      packetLossPct: 0.2,
      availableBitrateKbps: 5000,
      cpuLoadPct: 30
    };

    const first = chooseAdaptiveVideoLayer(healthyMetrics, state, { nowMs: 10_000 });
    expect(first.changed).toBe(false);
    expect(first.layer.name).toBe("mid");
    state = first.state;

    const second = chooseAdaptiveVideoLayer(healthyMetrics, state, { nowMs: 12_000 });
    expect(second.changed).toBe(true);
    expect(second.layer.name).toBe("high");
  });

  it("drops immediately under emergency conditions despite cooldown", () => {
    const state = createAdaptiveLayerState("high", 20_000);
    const decision = chooseAdaptiveVideoLayer(
      {
        rttMs: 300,
        jitterMs: 55,
        packetLossPct: 12,
        availableBitrateKbps: 450,
        cpuLoadPct: 96
      },
      state,
      { nowMs: 22_000 }
    );

    expect(decision.changed).toBe(true);
    expect(decision.layer.name).toBe("low");
    expect(decision.reason).toBe("emergency_downgrade");
  });

  it("holds layer during cooldown for non-emergency downgrade", () => {
    const state = createAdaptiveLayerState("high", 20_000);
    const decision = chooseAdaptiveVideoLayer(
      {
        rttMs: 150,
        jitterMs: 26,
        packetLossPct: 4.5,
        availableBitrateKbps: 850,
        cpuLoadPct: 72
      },
      state,
      { nowMs: 22_000 }
    );

    expect(decision.changed).toBe(false);
    expect(decision.layer.name).toBe("high");
    expect(decision.reason).toBe("cooldown");
  });
});
