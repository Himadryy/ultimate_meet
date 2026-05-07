import { z } from "zod";

const relayChannelSchema = z.enum(["stream", "talkback"]);
const roleSchema = z.enum(["streamer", "viewer"]);
const candidateSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional()
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_room"),
    roomId: z.string().min(1),
    participantId: z.string().min(1),
    role: roleSchema,
    token: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("kick_participant"),
    roomId: z.string().min(1),
    fromId: z.string().min(1),
    participantId: z.string().min(1)
  }),
  z.object({
    type: z.literal("mute_participant"),
    roomId: z.string().min(1),
    fromId: z.string().min(1),
    participantId: z.string().min(1),
    muted: z.boolean()
  }),
  z.object({
    type: z.literal("relay_offer"),
    roomId: z.string().min(1),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    channel: relayChannelSchema,
    sdp: z.string().min(1)
  }),
  z.object({
    type: z.literal("relay_answer"),
    roomId: z.string().min(1),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    channel: relayChannelSchema,
    sdp: z.string().min(1)
  }),
  z.object({
    type: z.literal("relay_ice"),
    roomId: z.string().min(1),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    channel: relayChannelSchema,
    candidate: candidateSchema
  }),
  z.object({
    type: z.literal("set_talkback"),
    roomId: z.string().min(1),
    participantId: z.string().min(1),
    enabled: z.boolean()
  })
]);

