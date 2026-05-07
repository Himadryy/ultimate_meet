import type { ParticipantRole, RelayChannel } from "@ultimate-meet/shared";

interface TelemetryWindowCounters {
  joins: number;
  leaves: number;
  talkbackChanges: number;
  relaySuccess: number;
  relayErrors: number;
}

interface RelayBreakdown {
  stream: number;
  talkback: number;
}

interface SignalingTelemetrySnapshot {
  atIso: string;
  activeRooms: number;
  activeParticipants: number;
  counters: TelemetryWindowCounters;
  relayByChannel: RelayBreakdown;
  relayErrorCodes: Record<string, number>;
}

export class SignalingTelemetry {
  private counters: TelemetryWindowCounters = {
    joins: 0,
    leaves: 0,
    talkbackChanges: 0,
    relaySuccess: 0,
    relayErrors: 0
  };

  private relayByChannel: RelayBreakdown = { stream: 0, talkback: 0 };
  private relayErrorCodes = new Map<string, number>();

  recordJoin(_roomId: string, _participantId: string, _role: ParticipantRole): void {
    this.counters.joins += 1;
  }

  recordLeave(_roomId: string, _participantId: string): void {
    this.counters.leaves += 1;
  }

  recordTalkbackChange(_roomId: string, _participantId: string, _enabled: boolean): void {
    this.counters.talkbackChanges += 1;
  }

  recordRelaySuccess(channel: RelayChannel): void {
    this.counters.relaySuccess += 1;
    this.relayByChannel[channel] += 1;
  }

  recordRelayError(code: string, channel?: RelayChannel): void {
    this.counters.relayErrors += 1;
    if (channel) {
      this.relayByChannel[channel] += 1;
    }
    this.relayErrorCodes.set(code, (this.relayErrorCodes.get(code) ?? 0) + 1);
  }

  flushSnapshot(activeRooms: number, activeParticipants: number): SignalingTelemetrySnapshot {
    const snapshot: SignalingTelemetrySnapshot = {
      atIso: new Date().toISOString(),
      activeRooms,
      activeParticipants,
      counters: { ...this.counters },
      relayByChannel: { ...this.relayByChannel },
      relayErrorCodes: Object.fromEntries(this.relayErrorCodes.entries())
    };

    this.counters = {
      joins: 0,
      leaves: 0,
      talkbackChanges: 0,
      relaySuccess: 0,
      relayErrors: 0
    };
    this.relayByChannel = { stream: 0, talkback: 0 };
    this.relayErrorCodes.clear();
    return snapshot;
  }
}
