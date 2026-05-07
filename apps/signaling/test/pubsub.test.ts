import assert from "node:assert";
import { PubSub } from "../src/pubsub.js";
import type { ClusterEvent } from "@ultimate-meet/shared";

(async () => {
  const pubsub = new PubSub({ nodeId: "test-node" });
  await pubsub.start();
  let received: ClusterEvent | null = null;
  pubsub.subscribe((e) => { received = e; });
  const ev: ClusterEvent = { type: "participant_joined", nodeId: "other-node", roomId: "room1", participant: { id: "p1", role: "viewer", talkbackEnabled: false } };
  await pubsub.publish(ev);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(received !== null, "expected to receive event");
  console.log("pubsub test ok");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
