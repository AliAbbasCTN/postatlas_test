// Small dependency-free validation helpers for server actions. Every function
// returns a typed value or throws ValidationError with a user-safe message.

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function raw(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function text(fd: FormData, key: string, label: string, o: { min?: number; max: number; optional?: boolean; multiline?: boolean }): string {
  const v = raw(fd, key).replace(/\r\n/g, "\n").trim();
  if (!v) {
    if (o.optional) return "";
    throw new ValidationError(`${label} is required.`);
  }
  if (CONTROL_RE.test(v)) throw new ValidationError(`${label} contains invalid characters.`);
  if (!o.multiline && /[\n\r]/.test(v)) throw new ValidationError(`${label} must be a single line.`);
  if (v.length < (o.min ?? 1)) throw new ValidationError(`${label} must be at least ${o.min} characters.`);
  if (v.length > o.max) throw new ValidationError(`${label} must be at most ${o.max} characters.`);
  return v;
}

export function uuid(fd: FormData, key: string, label = "Identifier"): string {
  const v = raw(fd, key).trim();
  if (!UUID_RE.test(v)) throw new ValidationError(`${label} is not valid.`);
  return v.toLowerCase();
}

export function optionalUuid(fd: FormData, key: string, label = "Identifier"): string | null {
  return raw(fd, key).trim() ? uuid(fd, key, label) : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function oneOf<T extends string>(fd: FormData, key: string, label: string, allowed: readonly T[]): T {
  const v = raw(fd, key).trim();
  if (!(allowed as readonly string[]).includes(v)) throw new ValidationError(`${label} is not valid.`);
  return v as T;
}

export function integer(fd: FormData, key: string, label: string, o: { min: number; max: number; optional?: boolean }): number | null {
  const v = raw(fd, key).trim();
  if (!v) {
    if (o.optional) return null;
    throw new ValidationError(`${label} is required.`);
  }
  if (!/^-?\d+$/.test(v)) throw new ValidationError(`${label} must be a whole number.`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < o.min || n > o.max) throw new ValidationError(`${label} must be between ${o.min} and ${o.max}.`);
  return n;
}

export function money(fd: FormData, key: string, label: string, o: { max: number; optional?: boolean }): number | null {
  const v = raw(fd, key).trim();
  if (!v) {
    if (o.optional) return null;
    throw new ValidationError(`${label} is required.`);
  }
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) throw new ValidationError(`${label} must be a valid amount.`);
  const n = Number(v);
  if (n <= 0 || n > o.max) throw new ValidationError(`${label} must be between 0 and ${o.max}.`);
  return n;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
export function email(fd: FormData, key: string, label = "Email"): string {
  const v = text(fd, key, label, { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new ValidationError(`${label} is not a valid email address.`);
  return v;
}

export function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

// Strips characters that could break out of an email header or subject line.
export function headerSafe(s: string, max = 200): string {
  return s.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

// Removes markup from user text that will be shown as plain text. We never
// render user content as HTML, so this is defence in depth for emails/exports.
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
}

export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  return e instanceof ValidationError ? e.message : fallback;
}

// Article text is stored and shown as plain text, never as HTML. We still
// refuse obviously active markup so it cannot travel on to a publisher's CMS.
export function containsActiveMarkup(s: string): boolean {
  return /<\s*(script|iframe|object|embed|form|meta|link|style|svg)\b/i.test(s)
    || /\bjavascript\s*:/i.test(s)
    || /<[^>]+\son[a-z]+\s*=/i.test(s)
    || /\bdata\s*:\s*text\/html/i.test(s);
}
