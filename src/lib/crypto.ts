import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for payout account numbers. The key (PAYOUT_DATA_KEY, 32 random bytes, base64) lives only in the
// server environment. Ciphertext format: v1.<iv>.<tag>.<data> (base64url). Plaintext never reaches the database,
// logs, notifications or the browser; dashboards show only the last four characters.
/** Pure format check, so setup screens can validate a key without touching process.env. */
export function payoutKeyValid(raw: string | undefined): boolean {
  return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test((raw ?? "").trim());   // exactly 32 bytes in canonical padded base64 (44 chars)
}
function key(): Buffer {
  const raw = (process.env.PAYOUT_DATA_KEY ?? "").trim();
  if (!payoutKeyValid(raw)) throw new Error("PAYOUT_DATA_KEY must be 32 random bytes encoded as base64");
  return Buffer.from(raw, "base64");
}
export function payoutEncryptionConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptSecret(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
export const last4 = (s: string) => s.replace(/\s+/g, "").slice(-4);
export const maskAccount = (l4: string) => `•••• ${l4}`;

/** ISO 13616 mod-97 check of an IBAN (letters A=10..Z=35). Catches mistyped numbers; it cannot prove the account exists or is owned by the holder. */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
    rem = (v > 9 ? rem * 100 + v : rem * 10 + v) % 97;   // piecewise mod keeps numbers small
  }
  return rem === 1;
}

// Account / IBAN plausibility only (format + IBAN checksum, not ownership). Real verification is the admin's bank-side check.
export function validateAccountNumber(raw: string, currency: "USD" | "PKR"): string {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  const iban = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s);
  if (currency === "PKR" && /^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(s)) { if (!ibanChecksumOk(s)) throw new Error("This IBAN has a typing error (its check digits do not match). Please re-check it."); return s; }   // Pakistani IBAN (24 characters)
  if (iban) { if (!ibanChecksumOk(s)) throw new Error("This IBAN has a typing error (its check digits do not match). Please re-check it."); return s; }                                                                       // other IBAN shapes
  if (/^\d{6,20}$/.test(s)) return s;                                                                                                                                                                                         // plain account number
  throw new Error("Enter a valid IBAN or account number");
}
