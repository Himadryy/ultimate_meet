import type { AudioConfig, AudioDeviceContext } from "./audioPolicy.js";

export type EchoRiskLevel = "low" | "medium" | "high";

export interface EchoRiskGuidance {
  level: EchoRiskLevel;
  summary: string;
  recommendations: string[];
}

export function buildEchoRiskGuidance(
  config: AudioConfig,
  context: Pick<AudioDeviceContext, "hasHeadphones" | "outputVolumePct">
): EchoRiskGuidance {
  let score = 0;
  const recommendations: string[] = [];

  if (!config.autoEnableEchoCancellation) {
    score += 3;
    recommendations.push("Use a browser/device that supports echo cancellation when possible.");
  }

  if (!context.hasHeadphones) {
    score += 2;
    recommendations.push("Use headphones to reduce speaker-to-mic feedback.");
  }

  if (context.outputVolumePct >= 70) {
    score += 2;
    recommendations.push("Lower speaker volume below 70% to reduce feedback risk.");
  } else if (context.outputVolumePct >= 50) {
    score += 1;
  }

  if (config.warnings.some((warning) => warning.toLowerCase().includes("feedback"))) {
    score += 1;
  }

  if (score >= 5) {
    return {
      level: "high",
      summary: "High echo risk detected. Keep mic muted and use short talkback bursts only.",
      recommendations
    };
  }

  if (score >= 3) {
    return {
      level: "medium",
      summary: "Moderate echo risk. Watch speaker volume and microphone behavior.",
      recommendations
    };
  }

  return {
    level: "low",
    summary: "Low echo risk for the current setup.",
    recommendations
  };
}
