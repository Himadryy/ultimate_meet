import type { ParticipantInfo, ParticipantRole } from "./protocol.js";

export function listStreamRecipients(
  participants: ParticipantInfo[],
  selfId: string,
  role: ParticipantRole
): string[] {
  if (role !== "streamer") {
    return [];
  }

  return participants
    .filter((participant) => participant.id !== selfId && participant.role === "viewer")
    .map((participant) => participant.id);
}

export function findActiveStreamer(
  participants: ParticipantInfo[],
  selfId: string
): ParticipantInfo | null {
  return (
    participants.find((participant) => participant.id !== selfId && participant.role === "streamer") ?? null
  );
}
