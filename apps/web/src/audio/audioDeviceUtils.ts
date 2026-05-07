export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export function toAudioDeviceOption(device: MediaDeviceInfo, fallbackName: string): AudioDeviceOption {
  return {
    deviceId: device.deviceId,
    label: device.label || `${fallbackName} (${device.deviceId.slice(0, 6) || "default"})`
  };
}

export function detectHeadphonesFromLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("headphone") ||
    normalized.includes("headset") ||
    normalized.includes("airpods") ||
    normalized.includes("earbud")
  );
}
