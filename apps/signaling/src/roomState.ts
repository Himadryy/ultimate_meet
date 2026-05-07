import {
  MAX_STREAMERS_PER_ROOM,
  MAX_VIEWERS_PER_ROOM,
  type ParticipantInfo,
  type ParticipantRole,
  type RelayChannel
} from "@ultimate-meet/shared";

interface Room {
  roomId: string;
  participants: Map<string, ParticipantInfo>;
  owner?: string;
}

interface ParticipantLocation {
  roomId: string;
  participantId: string;
}

export class RoomStateMachine {
  private readonly rooms = new Map<string, Room>();
  private readonly participantLocations = new Map<string, ParticipantLocation>();

  join(roomId: string, participantId: string, role: ParticipantRole): ParticipantInfo[] {
    const existingLocation = this.participantLocations.get(participantId);
    if (existingLocation) {
      if (existingLocation.roomId === roomId) {
        // Participant is re-joining the same room — update role atomically and return participants
        const room = this.getOrCreateRoom(roomId);
        const updated: ParticipantInfo = {
          id: participantId,
          role,
          talkbackEnabled: role === "streamer",
          muted: false
        };
        room.participants.set(participantId, updated);
        this.participantLocations.set(participantId, { roomId, participantId });
        return [...room.participants.values()];
      }
      throw new Error("participant_already_joined");
    }

    const room = this.getOrCreateRoom(roomId);
    const participants = [...room.participants.values()];
    const streamerCount = participants.filter((p) => p.role === "streamer").length;
    const viewerCount = participants.filter((p) => p.role === "viewer").length;

    if (role === "streamer" && streamerCount >= MAX_STREAMERS_PER_ROOM) {
      throw new Error("streamer_limit_reached");
    }
    if (role === "viewer" && viewerCount >= MAX_VIEWERS_PER_ROOM) {
      throw new Error("viewer_limit_reached");
    }

    room.participants.set(participantId, {
      id: participantId,
      role,
      talkbackEnabled: role === "streamer",
      muted: false
    });
    this.participantLocations.set(participantId, { roomId, participantId });

    // If room has no owner yet, first participant becomes owner. Per product spec: owner is first streamer who created the room or first participant if streamer absent.
    if (!room.owner) {
      room.owner = participantId;
    }

    return [...room.participants.values()];
  }

  leave(participantId: string): { roomId: string; remaining: ParticipantInfo[] } | null {
    const location = this.participantLocations.get(participantId);
    if (!location) {
      return null;
    }

    const room = this.rooms.get(location.roomId);
    if (!room) {
      this.participantLocations.delete(participantId);
      return null;
    }

    room.participants.delete(participantId);
    this.participantLocations.delete(participantId);

    const remaining = [...room.participants.values()];
    if (remaining.length === 0) {
      this.rooms.delete(location.roomId);
    } else if (room.owner === participantId) {
      // transfer ownership: prefer first streamer, otherwise first participant
      const streamer = remaining.find((p) => p.role === "streamer");
      room.owner = streamer ? streamer.id : remaining[0].id;
    }
    return { roomId: location.roomId, remaining };
  }

  setTalkback(roomId: string, participantId: string, enabled: boolean): ParticipantInfo {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room_not_found");
    }
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error("participant_not_found");
    }
    if (participant.role !== "viewer") {
      throw new Error("talkback_only_for_viewers");
    }
    const updated = { ...participant, talkbackEnabled: enabled };
    // respect moderator mute: if participant is muted, talkback cannot be enabled
    if (updated.muted) {
      updated.talkbackEnabled = false;
    }
    room.participants.set(participantId, updated);
    return updated;
  }

  listParticipants(roomId: string): ParticipantInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return [...room.participants.values()];
  }

  participantRoom(participantId: string): string | null {
    return this.participantLocations.get(participantId)?.roomId ?? null;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  participantCount(): number {
    return this.participantLocations.size;
  }

  getOwner(roomId: string): string | null {
    return this.rooms.get(roomId)?.owner ?? null;
  }

  kick(roomId: string, issuerId: string, targetId: string): { roomId: string; participantId: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room_not_found");
    }
    const issuer = room.participants.get(issuerId);
    if (!issuer) {
      throw new Error("issuer_not_in_room");
    }
    if (room.owner !== issuerId) {
      throw new Error("not_owner");
    }
    const target = room.participants.get(targetId);
    if (!target) {
      throw new Error("participant_not_found");
    }

    room.participants.delete(targetId);
    this.participantLocations.delete(targetId);

    const remaining = [...room.participants.values()];
    if (remaining.length === 0) {
      this.rooms.delete(roomId);
    } else if (room.owner === targetId) {
      const streamer = remaining.find((p) => p.role === "streamer");
      room.owner = streamer ? streamer.id : remaining[0].id;
    }

    return { roomId, participantId: targetId };
  }

  mute(roomId: string, issuerId: string, targetId: string, muted: boolean): ParticipantInfo {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room_not_found");
    }
    const issuer = room.participants.get(issuerId);
    if (!issuer) {
      throw new Error("issuer_not_in_room");
    }
    if (room.owner !== issuerId) {
      throw new Error("not_owner");
    }
    const target = room.participants.get(targetId);
    if (!target) {
      throw new Error("participant_not_found");
    }

    const updated: ParticipantInfo = { ...target, muted };
    // if muted, disable talkback
    if (updated.muted) {
      updated.talkbackEnabled = false;
    }
    room.participants.set(targetId, updated);
    return updated;
  }

  canRelay(
    roomId: string,
    fromId: string,
    toId: string,
    channel: RelayChannel
  ): { allowed: boolean; code?: string } {
    if (fromId === toId) {
      return { allowed: false, code: "self_relay_forbidden" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { allowed: false, code: "room_not_found" };
    }

    const from = room.participants.get(fromId);
    const to = room.participants.get(toId);
    if (!from || !to) {
      return { allowed: false, code: "participant_not_found" };
    }

    if (channel === "stream") {
      const isStreamerViewerPair =
        (from.role === "streamer" && to.role === "viewer") ||
        (from.role === "viewer" && to.role === "streamer");
      if (!isStreamerViewerPair) {
        return { allowed: false, code: "stream_channel_requires_streamer_source" };
      }
    }
    if (channel === "talkback") {
      if (from.role !== "viewer" || to.role !== "streamer") {
        return { allowed: false, code: "talkback_channel_requires_viewer_source" };
      }
      if (!from.talkbackEnabled || from.muted) {
        return { allowed: false, code: "talkback_disabled" };
      }
    }

    return { allowed: true };
  }

  private getOrCreateRoom(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) {
      return existing;
    }
    const room: Room = { roomId, participants: new Map() };
    this.rooms.set(roomId, room);
    return room;
  }
}
