import test from "node:test";
import assert from "node:assert/strict";
import { text, uuid, oneOf, integer, money, email, headerSafe, ValidationError, countWords, isUuid } from "../src/lib/validation.ts";
import { scanContentPolicy, describeFlags } from "../src/lib/content-policy.ts";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

test("uuid validation rejects junk and SQL-ish input", () => {
  assert.throws(() => uuid(fd({ id: "1 OR 1=1" }), "id"), ValidationError);
  assert.throws(() => uuid(fd({ id: "' or '1'='1" }), "id"), ValidationError);
  assert.throws(() => uuid(fd({}), "id"), ValidationError);
  assert.equal(uuid(fd({ id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301" }), "id"), "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  assert.equal(isUuid("nope"), false);
});
test("text limits, control characters and multiline", () => {
  assert.throws(() => text(fd({ a: "x".repeat(11) }), "a", "A", { max: 10 }), ValidationError);
  assert.throws(() => text(fd({ a: "a\u0000b" }), "a", "A", { max: 10 }), ValidationError);
  assert.throws(() => text(fd({ a: "a\nb" }), "a", "A", { max: 10 }), ValidationError);
  assert.equal(text(fd({ a: "a\nb" }), "a", "A", { max: 10, multiline: true }), "a\nb");
  assert.equal(text(fd({}), "a", "A", { max: 10, optional: true }), "");
});
test("oneOf, integer, money", () => {
  assert.throws(() => oneOf(fd({ s: "ADMIN" }), "s", "S", ["a", "b"] as const), ValidationError);
  assert.throws(() => integer(fd({ n: "1e3" }), "n", "N", { min: 0, max: 100 }), ValidationError);
  assert.throws(() => integer(fd({ n: "101" }), "n", "N", { min: 0, max: 100 }), ValidationError);
  assert.equal(integer(fd({ n: "42" }), "n", "N", { min: 0, max: 100 }), 42);
  assert.throws(() => money(fd({ m: "-5" }), "m", "M", { max: 1000 }), ValidationError);
  assert.throws(() => money(fd({ m: "1.234" }), "m", "M", { max: 1000 }), ValidationError);
  assert.equal(money(fd({ m: "180.50" }), "m", "M", { max: 1000 }), 180.5);
});
test("email validation and header-injection stripping", () => {
  assert.throws(() => email(fd({ e: "a@b.c\r\nBcc: x@y.z" }), "e"), ValidationError);
  assert.throws(() => email(fd({ e: "not-an-email" }), "e"), ValidationError);
  assert.equal(email(fd({ e: "  Me@Example.com " }), "e"), "me@example.com");
  assert.equal(headerSafe("Hello\r\nBcc: evil@x.com"), "Hello Bcc: evil@x.com");
});
test("word count", () => assert.equal(countWords("  one two\nthree  "), 3));

test("content policy flags prohibited categories without false-flagging common words", () => {
  assert.deepEqual(scanContentPolicy("Best online casino bonuses").map((f) => f.category), ["gambling"]);
  assert.ok(scanContentPolicy("CBD gummies").some((f) => f.category === "cbd"));
  assert.ok(scanContentPolicy("Top vape pens").some((f) => f.category === "vape"));
  assert.ok(scanContentPolicy("buy backlinks from our PBN").some((f) => f.category === "link_scheme"));
  assert.deepEqual(scanContentPolicy("A guide to project management software for teams"), []);
  assert.deepEqual(scanContentPolicy("Cascading style sheets and the Casablanca film"), []);
  assert.match(describeFlags(scanContentPolicy("poker night")), /gambling/i);
});

import { containsActiveMarkup } from "../src/lib/validation.ts";
test("active markup in article text is detected; ordinary text and links are not", () => {
  for (const bad of ["<script>alert(1)</script>", "x <IFRAME src=a>", `<a href="x" onclick="y()">`, "click javascript:alert(1)", "<img src=x onerror=alert(1)>", "<svg onload=1>"]) {
    assert.equal(containsActiveMarkup(bad), true, bad);
  }
  for (const ok of ["Use a < b and c > d in math", "Read https://example.com/page?a=1&b=2", "Tom & Jerry <3"]) {
    assert.equal(containsActiveMarkup(ok), false, ok);
  }
});
