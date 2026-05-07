import { describe, expect, it } from "vitest";
import { findActiveStreamer, listStreamRecipients, type ParticipantInfo } from "../src/index.js";

const participants: ParticipantInfo[] = [
  { id: "streamer-a", role: "streamer", talkbackEnabled: true },
  { id: "viewer-a", role: "viewer", talkbackEnabled: false },
  { id: "viewer-b", role: "viewer", talkbackEnabled: true }
];

describe("listStreamRecipients", () => {
  it("returns only viewer ids for streamer", () => {
    expect(listStreamRecipients(participants, "streamer-a", "streamer")).toEqual([
      "viewer-a",
      "viewer-b"
    ]);
  });

  it("returns empty list for viewer role", () => {
    expect(listStreamRecipients(participants, "viewer-a", "viewer")).toEqual([]);
  });
});

describe("findActiveStreamer", () => {
  it("finds streamer that is not self", () => {
    expect(findActiveStreamer(participants, "viewer-a")?.id).toBe("streamer-a");
  });

  it("returns null if there is no other streamer", () => {
    expect(findActiveStreamer(participants, "streamer-a")).toBeNull();
  });
});
