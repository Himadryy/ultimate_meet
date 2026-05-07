import { describe, expect, it } from "vitest";
import { buildAudioConfig } from "../src/audioPolicy.js";

describe("buildAudioConfig", () => {
  it("mutes viewer microphone by default", () => {
    const config = buildAudioConfig("viewer", {
      supportsEchoCancellation: true,
      hasHeadphones: true,
      outputVolumePct: 40,
      noisyEnvironment: false
    });
    expect(config.viewerMicDefaultMuted).toBe(true);
    expect(config.warnings).toHaveLength(0);
  });

  it("warns about high speaker volume without headphones", () => {
    const config = buildAudioConfig("streamer", {
      supportsEchoCancellation: false,
      hasHeadphones: false,
      outputVolumePct: 90,
      noisyEnvironment: true
    });
    expect(config.warnings.length).toBeGreaterThan(0);
  });
});

