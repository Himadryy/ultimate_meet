import assert from "assert";
import { signGuestToken, verifyGuestToken } from "../../../packages/shared/src/auth";

const secret = "test-secret";
const token = signGuestToken({ sub: "alice", role: "viewer" }, secret, "1h");
const claims = verifyGuestToken(token, secret);
assert.strictEqual(claims.sub, "alice");
assert.strictEqual(claims.role, "viewer");
console.log("auth.test passed");
