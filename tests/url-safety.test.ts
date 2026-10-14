import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicHttpUrl, isBlockedIp, normalizeDomain, safeRedirectPath } from "../src/lib/url-safety.ts";
import { safeFetch } from "../src/lib/safe-fetch.ts";
import http from "node:http";

const blocked = [
  "http://localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/",
  "http://10.0.0.5/", "http://172.16.0.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
  "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
  "http://0.0.0.0/", "http://metadata.google.internal/", "http://printer.local/", "http://intranet/",
  "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/",
  "https://example.com:22/", "https://example.com:6379/", "http://100.64.0.1/", "http://[64:ff9b::7f00:1]/"
];
for (const u of blocked) {
  test(`blocks ${u}`, () => assert.equal(validatePublicHttpUrl(u).ok, false, u));
}

test("allows ordinary public URLs", () => {
  for (const u of ["https://example.com/", "http://example.org/path?q=1", "https://sub.example.co.uk:8443/x"]) {
    assert.equal(validatePublicHttpUrl(u).ok, true, u);
  }
});

test("requireHttps option", () => {
  assert.equal(validatePublicHttpUrl("http://example.com", { requireHttps: true }).ok, false);
  assert.equal(validatePublicHttpUrl("https://example.com", { requireHttps: true }).ok, true);
});

test("rejects empty and oversized input", () => {
  assert.equal(validatePublicHttpUrl("").ok, false);
  assert.equal(validatePublicHttpUrl("https://example.com/" + "a".repeat(3000)).ok, false);
});

test("isBlockedIp covers mapped and unparseable addresses", () => {
  assert.equal(isBlockedIp("::ffff:10.0.0.1"), true);
  assert.equal(isBlockedIp("not-an-ip"), true);
  assert.equal(isBlockedIp("93.184.216.34"), false);
  assert.equal(isBlockedIp("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("normalizeDomain", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path"), "example.com");
  assert.equal(normalizeDomain("example.com"), "example.com");
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("http://127.0.0.1"), null);
  assert.equal(normalizeDomain("not a domain"), null);
});

test("safeRedirectPath blocks open redirects", () => {
  assert.equal(safeRedirectPath("//evil.com"), "/dashboard");
  assert.equal(safeRedirectPath("/\\evil.com"), "/dashboard");
  assert.equal(safeRedirectPath("https://evil.com"), "/dashboard");
  assert.equal(safeRedirectPath("/dashboard/orders?x=1"), "/dashboard/orders?x=1");
  assert.equal(safeRedirectPath(undefined), "/dashboard");
  assert.equal(safeRedirectPath("/a\r\nSet-Cookie: x"), "/dashboard");
});

test("safeFetch refuses loopback servers and internal names without connecting", async () => {
  let hits = 0;
  const server = http.createServer((_, res) => { hits++; res.end("secret"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    for (const u of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, "http://169.254.169.254/", "http://[::1]/"]) {
      const out = await safeFetch(u);
      assert.equal(out.kind, "unreachable", u);
    }
    assert.equal(hits, 0, "no request may reach the internal server");
  } finally { server.close(); }
});
