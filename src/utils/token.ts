import jwt from "jsonwebtoken";
import { ENV } from "../config/env";

export function generateToken(userId: string, role?: string): string {
  return jwt.sign({ userId, role }, ENV.JWT_SECRET, {
    expiresIn: ENV.JWT_EXPIRES_IN as any,
  });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: "refresh" }, ENV.JWT_SECRET, {
    expiresIn: ENV.REFRESH_TOKEN_EXPIRES_IN as any,
  });
}

export function verifyToken(token: string): { userId: string; role?: string } {
  return jwt.verify(token, ENV.JWT_SECRET) as { userId: string; role?: string };
}
