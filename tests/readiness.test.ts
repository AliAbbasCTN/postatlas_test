import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readiness } from "../src/lib/readiness.ts";
import { payoutKeyValid } from "../src/lib/crypto.ts";

const good = { PAYOUT_DATA_KEY: randomBytes(32).toString("base64"), CRON_SECRET: "x".repeat(32), SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJzdXBhYmFzZS1zZXJ2aWNl", SITE_URL: "https://postatlas.example",
  ADMIN_NOTIFICATION_EMAIL: "a@b.co", EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "re_9fQ2xLmN7vTzR4bW", EMAIL_FROM_ADDRESS: "PostAtlas <n@b.co>", NODE_ENV: "production" };
const failing = (env: Record<string, string | undefined>) => readiness(env).filter((r) => r.required && !r.ok).map((r) => r.id);

test("payout key validation: only exactly 32 random bytes in base64 is accepted (placeholder, short, long, empty rejected)", () => {
  for (let i = 0; i < 50; i++) assert.equal(payoutKeyValid(randomBytes(32).toString("base64")), true);
  for (const bad of [undefined, "", "GENERATE_32_RANDOM_BYTES_BASE64", randomBytes(16).toString("base64"), randomBytes(33).toString("base64"), randomBytes(32).toString("base64").slice(0, 43)]) assert.equal(payoutKeyValid(bad), false, String(bad));
});
test("a fully configured environment has nothing required failing", () => assert.deepEqual(failing(good), []));
test("each missing or weak setting is reported by name", () => {
  assert.deepEqual(failing({ ...good, PAYOUT_DATA_KEY: "GENERATE_32_RANDOM_BYTES_BASE64" }), ["payout_key"]);
  assert.deepEqual(failing({ ...good, CRON_SECRET: "short" }), ["cron"]);
  assert.deepEqual(failing({ ...good, EMAIL_API_KEY: "" }), ["email"]);
  assert.deepEqual(failing({ ...good, SITE_URL: "http://insecure.example" }), ["site_url"]);
  assert.deepEqual(failing({ ...good, ADMIN_NOTIFICATION_EMAIL: undefined }), ["admin_email"]);
});
test("the report never contains secret values", () => {
  const json = JSON.stringify(readiness(good));
  for (const secret of [good.PAYOUT_DATA_KEY, good.CRON_SECRET, good.EMAIL_API_KEY, good.SUPABASE_SERVICE_ROLE_KEY]) assert.ok(!json.includes(secret), "secret leaked into the readiness report");
});
