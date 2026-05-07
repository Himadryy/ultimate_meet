import { useEffect, useRef, useState } from "react";
import {
  createMediaTelemetrySnapshot,
  type MediaTelemetryInput,
  type MediaTelemetrySnapshot
} from "@ultimate-meet/shared";

interface UseMediaTelemetryInput extends Omit<MediaTelemetryInput, "nowMs"> {
  refreshMs?: number;
}

export function useMediaTelemetry(input: UseMediaTelemetryInput): MediaTelemetrySnapshot {
  const { refreshMs = 1_000 } = input;
  const latestInputRef = useRef(input);
  latestInputRef.current = input;

  const [snapshot, setSnapshot] = useState<MediaTelemetrySnapshot>(() =>
    createMediaTelemetrySnapshot({
      ...input,
      nowMs: Date.now()
    })
  );

  useEffect(() => {
    const updateSnapshot = () => {
      const latest = latestInputRef.current;
      setSnapshot(
        createMediaTelemetrySnapshot({
          ...latest,
          nowMs: Date.now()
        })
      );
    };

    updateSnapshot();
    const timer = window.setInterval(updateSnapshot, refreshMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  useEffect(() => {
    setSnapshot(
      createMediaTelemetrySnapshot({
        ...input,
        nowMs: Date.now()
      })
    );
  }, [input.audioLevelPct, input.fps, input.networkMetrics, input.selectedLayer, input.talkbackEnabled]);

  return snapshot;
}
