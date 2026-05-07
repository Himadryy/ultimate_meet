#!/usr/bin/env node
const jwt = require("jsonwebtoken");

const argv = process.argv.slice(2);
const params = {};
for (const arg of argv) {
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq === -1) continue;
  const key = arg.slice(2, eq);
  const val = arg.slice(eq + 1);
  params[key] = val;
}

const id = params.id || params.sub || params.participantId;
const role = params.role || "viewer";
const secret = params.secret || process.env.JWT_SECRET;
const expiresIn = params.expires || "1h";

if (!id) {
  console.error("Missing --id parameter");
  process.exit(2);
}
if (!secret) {
  console.error("Missing JWT secret. Provide --secret or set JWT_SECRET env var.");
  process.exit(2);
}

const token = jwt.sign({ sub: id, role }, secret, { algorithm: "HS256", expiresIn });
console.log(token);
