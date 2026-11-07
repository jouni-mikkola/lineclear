import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface TotpKey {
  key: Buffer;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
}

function base32(text: string): Buffer {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean === "") throw new Error("empty");
  let bits = 0;
  let acc = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error("not base32");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** A stored key: plain base32 (spaces, dashes and case ignored) or an otpauth:// address with its own options. */
export function parseTotpKey(value: string): TotpKey {
  const text = value.trim();
  if (!text.toLowerCase().startsWith("otpauth://")) return { key: base32(text), digits: 6, period: 30, algorithm: "sha1" };
  const q = new URL(text).searchParams;
  const secret = q.get("secret");
  if (!secret) throw new Error("no secret in the otpauth address");
  const algorithm = (q.get("algorithm") ?? "SHA1").toLowerCase();
  if (algorithm !== "sha1" && algorithm !== "sha256" && algorithm !== "sha512") throw new Error("unknown algorithm");
  const digits = Number(q.get("digits") ?? 6);
  const period = Number(q.get("period") ?? 30);
  if (![6, 7, 8].includes(digits) || !(period > 0)) throw new Error("bad digits or period");
  return { key: base32(secret), digits, period, algorithm };
}

/** The RFC 6238 code at `nowMs`. */
export function totpCode(k: TotpKey, nowMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / k.period)));
  const mac = createHmac(k.algorithm, k.key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const number = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** k.digits).padStart(k.digits, "0");
}
