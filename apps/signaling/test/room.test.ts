import assert from "assert";
import { RoomStateMachine } from "../src/roomState";

// owner is first participant
const s1 = new RoomStateMachine();
s1.join("room-a", "p1", "viewer");
assert.strictEqual(s1.getOwner("room-a"), "p1");

// owner is streamer if created by streamer
const s2 = new RoomStateMachine();
s2.join("room-b", "s1", "streamer");
assert.strictEqual(s2.getOwner("room-b"), "s1");

// kick by owner
const s3 = new RoomStateMachine();
s3.join("room-c", "owner", "streamer");
s3.join("room-c", "v1", "viewer");
s3.kick("room-c", "owner", "v1");
assert.strictEqual(s3.participantRoom("v1"), null);

// mute by owner
s3.join("room-c", "v2", "viewer");
const muted = s3.mute("room-c", "owner", "v2", true);
assert.strictEqual(muted.muted, true);
console.log("room.test passed");
