import { scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_SALT = "quizheroes-dev-salt";

export function hashPassword(plainPassword: string): string {
  return scryptSync(plainPassword, PASSWORD_SALT, 64).toString("hex");
}

export function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): boolean {
  const incomingHash = Buffer.from(hashPassword(plainPassword), "hex");
  const storedHash = Buffer.from(passwordHash, "hex");

  if (incomingHash.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(incomingHash, storedHash);
}

