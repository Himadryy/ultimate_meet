import { describe, expect, it } from "vitest";
import { buildAudioConfig } from "../src/audioPolicy.js";
import { buildEchoRiskGuidance } from "../src/audioDiagnostics.js";

describe("buildEchoRiskGuidance", () => {
  it("returns high risk when no AEC and loud speaker output", () => {
    const config = buildAudioConfig("viewer", {
      supportsEchoCancellation: false,
      hasHeadphones: false,
      outputVolumePct: 85,
      noisyEnvironment: false
    });

    const guidance = buildEchoRiskGuidance(config, {
      hasHeadphones: false,
      outputVolumePct: 85
    });

    expect(guidance.level).toBe("high");
    expect(guidance.recommendations.length).toBeGreaterThan(0);
  });

  it("returns low risk for safe defaults", () => {
    const config = buildAudioConfig("streamer", {
      supportsEchoCancellation: true,
      hasHeadphones: true,
      outputVolumePct: 35,
      noisyEnvironment: false
    });

    const guidance = buildEchoRiskGuidance(config, {
      hasHeadphones: true,
      outputVolumePct: 35
    });

    expect(guidance.level).toBe("low");
  });
});
