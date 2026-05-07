import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioConfig } from "@ultimate-meet/shared";
import { detectHeadphonesFromLabel, toAudioDeviceOption, type AudioDeviceOption } from "./audioDeviceUtils";

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface UseAudioControlsOptions {
  audioPolicy: AudioConfig;
  initialMicMuted: boolean;
  initialSpeakerVolumePct: number;
}

export function useAudioControls(options: UseAudioControlsOptions) {
  const { audioPolicy, initialMicMuted, initialSpeakerVolumePct } = options;
  const [micMuted, setMicMuted] = useState(initialMicMuted);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [speakerVolumePct, setSpeakerVolumePct] = useState(initialSpeakerVolumePct);
  const [micLevelPct, setMicLevelPct] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");

  const outputAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);

  const supportsOutputSelection = useMemo(() => {
    if (typeof window === "undefined" || typeof HTMLMediaElement === "undefined") {
      return false;
    }
    return "setSinkId" in HTMLMediaElement.prototype;
  }, []);

  const hasHeadphones = useMemo(() => {
    const output = outputDevices.find((device) => device.deviceId === selectedOutputId);
    return output ? detectHeadphonesFromLabel(output.label) : false;
  }, [outputDevices, selectedOutputId]);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setMicLevelPct(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioError("Media device enumeration is not supported in this browser.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => toAudioDeviceOption(device, "Microphone"));
      const outputs = devices
        .filter((device) => device.kind === "audiooutput")
        .map((device) => toAudioDeviceOption(device, "Speaker"));

      setInputDevices(inputs);
      setOutputDevices(outputs);
      setSelectedInputId((current) =>
        inputs.some((device) => device.deviceId === current) ? current : (inputs[0]?.deviceId ?? "")
      );
      setSelectedOutputId((current) =>
        outputs.some((device) => device.deviceId === current) ? current : (outputs[0]?.deviceId ?? "")
      );
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Could not enumerate media devices.");
    }
  }, []);

  const startMeter = useCallback(
    async (stream: MediaStream) => {
      stopMeter();
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) {
        return;
      }

      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      const source = context.createMediaStreamSource(stream);
      analyser.fftSize = 512;
      source.connect(analyser);

      audioContextRef.current = context;
      sourceNodeRef.current = source;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        const activeAnalyser = analyserRef.current;
        if (!activeAnalyser) {
          return;
        }
        activeAnalyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        setMicLevelPct(Math.min(100, Math.round(rms * 180)));
        meterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    },
    [stopMeter]
  );

  const openMicrophone = useCallback(
    async (inputDeviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setAudioError("Microphone access is not supported in this browser.");
        return false;
      }

      try {
        const audioConstraint: MediaTrackConstraints = {
          echoCancellation: audioPolicy.autoEnableEchoCancellation,
          noiseSuppression: audioPolicy.autoEnableNoiseSuppression,
          autoGainControl: audioPolicy.autoEnableAutoGainControl
        };

        if (inputDeviceId) {
          audioConstraint.deviceId = { exact: inputDeviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: false
        });

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !micMuted;
        });

        await startMeter(stream);
        await refreshDevices();
        setAudioError(null);
        return true;
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : "Could not access microphone.");
        return false;
      }
    },
    [audioPolicy, micMuted, refreshDevices, startMeter]
  );

  const toggleMicMuted = useCallback(async () => {
    if (micMuted && !streamRef.current) {
      const ready = await openMicrophone(selectedInputId || undefined);
      if (!ready) {
        return;
      }
    }
    setMicMuted((current) => !current);
  }, [micMuted, openMicrophone, selectedInputId]);

  const selectInputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedInputId(deviceId);
      await openMicrophone(deviceId || undefined);
    },
    [openMicrophone]
  );

  const selectOutputDevice = useCallback((deviceId: string) => {
    setSelectedOutputId(deviceId);
  }, []);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !micMuted;
    });
  }, [micMuted]);

  useEffect(() => {
    if (!supportsOutputSelection || !selectedOutputId) {
      return;
    }

    const element = outputAudioRef.current as SinkCapableAudioElement | null;
    if (!element || typeof element.setSinkId !== "function") {
      return;
    }

    void element.setSinkId(selectedOutputId).catch((error: unknown) => {
      setAudioError(error instanceof Error ? error.message : "Could not switch audio output device.");
    });
  }, [selectedOutputId, supportsOutputSelection]);

  useEffect(() => {
    if (!outputAudioRef.current) {
      return;
    }
    outputAudioRef.current.muted = speakerMuted;
    outputAudioRef.current.volume = Math.max(0, Math.min(1, speakerVolumePct / 100));
  }, [speakerMuted, speakerVolumePct]);

  useEffect(() => {
    void refreshDevices();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.addEventListener !== "function") {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

  useEffect(() => {
    setMicMuted(initialMicMuted);
  }, [initialMicMuted]);

  useEffect(() => {
    return () => {
      stopMeter();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stopMeter]);

  return {
    micMuted,
    speakerMuted,
    speakerVolumePct,
    micLevelPct,
    audioError,
    inputDevices,
    outputDevices,
    selectedInputId,
    selectedOutputId,
    supportsOutputSelection,
    hasHeadphones,
    outputAudioRef,
    setSpeakerMuted,
    setSpeakerVolumePct,
    selectInputDevice,
    selectOutputDevice,
    toggleMicMuted
  };
}
