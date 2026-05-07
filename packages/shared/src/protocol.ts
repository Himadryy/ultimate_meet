export type ParticipantRole = "streamer" | "viewer";
export type RelayChannel = "stream" | "talkback";
export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface ParticipantInfo {
  id: string;
  role: ParticipantRole;
  talkbackEnabled: boolean;
  // muted indicates moderator-enforced mute (prevents talkback)
  muted?: boolean;
}

export type ClientToServerMessage =
  | {
      type: "join_room";
      roomId: string;
      participantId: string;
      role: ParticipantRole;
      // optional guest JWT for auth; required when SIGNALING server has JWT_SECRET set
      token?: string;
    }
  | {
      type: "kick_participant";
      roomId: string;
      fromId: string;
      participantId: string; // target
    }
  | {
      type: "mute_participant";
      roomId: string;
      fromId: string;
      participantId: string; // target
      muted: boolean;
    }
  | {
      type: "relay_offer";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      sdp: string;
    }
  | {
      type: "relay_answer";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      sdp: string;
    }
  | {
      type: "relay_ice";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      candidate: IceCandidatePayload;
    }
  | {
      type: "set_talkback";
      roomId: string;
      participantId: string;
      enabled: boolean;
    };

export type ServerToClientMessage =
  | {
      type: "joined_room";
      roomId: string;
      you: ParticipantInfo;
      participants: ParticipantInfo[];
    }
  | {
      type: "participant_joined";
      roomId: string;
      participant: ParticipantInfo;
    }
  | {
      type: "participant_left";
      roomId: string;
      participantId: string;
    }
  | {
      type: "talkback_changed";
      roomId: string;
      participantId: string;
      enabled: boolean;
    }
  | {
      type: "participant_kicked";
      roomId: string;
      participantId: string;
    }
  | {
      type: "participant_muted";
      roomId: string;
      participantId: string;
      muted: boolean;
    }
  | {
      type: "relay_offer";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      sdp: string;
    }
  | {
      type: "relay_answer";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      sdp: string;
    }
  | {
      type: "relay_ice";
      roomId: string;
      fromId: string;
      toId: string;
      channel: RelayChannel;
      candidate: IceCandidatePayload;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };
