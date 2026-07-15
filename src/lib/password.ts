import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/** Current cost. Stored alongside each hash, so this can be raised without
 *  invalidating existing passwords — verification uses the stored value. */
const N = 16384;
const KEYLEN = 64;
const SALT_BYTES = 16;

// Node's default maxmem (32 MB) is too small once N climbs; 128*N*r bytes are needed.
const optionsFor = (cost: number): ScryptOptions => ({ N: cost, r: 8, p: 1, maxmem: 256 * cost * 8 });

/** Stored form: `scrypt$<N>$<saltHex>$<hashHex>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, optionsFor(N));
  return `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  // N must be a power of two; reject anything absurd rather than letting scrypt throw.
  if (!Number.isInteger(cost) || cost < 1024 || cost > 1 << 20 || (cost & (cost - 1)) !== 0) return false;

  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  const actual = await scrypt(password.normalize("NFKC"), salt, KEYLEN, optionsFor(cost));
  return timingSafeEqual(actual, expected);
}

export function passwordProblem(password: string): string | null {
  if (!password || password.length < 6) return "Password must be at least 6 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  return null;
}

/** Case- and whitespace-insensitive key used to look a user up by full name. */
export function normalizeFullName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
