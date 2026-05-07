import * as jwt from "jsonwebtoken";
import type { ParticipantRole } from "./protocol.js";

const _jwtAny = (jwt as any).default ?? jwt;

export interface GuestTokenClaims {
  sub: string;
  role?: ParticipantRole;
  iat?: number;
  exp?: number;
}

export function signGuestToken(
  claims: { sub: string; role?: ParticipantRole },
  secret: string,
  expiresIn: string | number = "1h"
): string {
  const j: any = _jwtAny;
  return j.sign({ sub: claims.sub, role: claims.role }, secret, {
    algorithm: "HS256",
    expiresIn
  });
}

export function verifyGuestToken(token: string, secret: string): GuestTokenClaims {
  try {
    const j: any = _jwtAny;
    const decoded = j.verify(token, secret, { algorithms: ["HS256"] }) as any;
    if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string") {
      throw new Error("invalid_token");
    }
    return {
      sub: decoded.sub,
      role: decoded.role as ParticipantRole | undefined,
      iat: decoded.iat,
      exp: decoded.exp
    };
  } catch (err) {
    throw new Error("invalid_token");
  }
}
