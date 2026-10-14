import test from "node:test";
import assert from "node:assert/strict";
import { priceBreakdown, minorToDecimalString, checkoutAmount, usdToMinor, parseRate, formatUsd, formatPkr, estimatePkr, usdMinorToPkrWhole } from "../src/lib/money.ts";
import { classifyFreshness, mayLockForCheckout, needsRefresh, parseProviderResponse, validateManualRate, ageHours } from "../src/lib/fx.ts";

const d = (m: bigint) => minorToDecimalString(m);

test("$100 listing: customer pays $100, commission $2, publisher net $98", () => {
  const b = priceBreakdown("100");
  assert.deepEqual([d(b.customerBaseMinor), d(b.commissionMinor), d(b.publisherNetMinor)], ["100.00", "2.00", "98.00"]);
});
test("$250 listing: customer pays $250, commission $5, publisher net $245", () => {
  const b = priceBreakdown("250");
  assert.deepEqual([d(b.customerBaseMinor), d(b.commissionMinor), d(b.publisherNetMinor)], ["250.00", "5.00", "245.00"]);
});
test("no customer markup: the customer base price is always exactly the list price", () => {
  for (const p of ["1", "9.99", "49.50", "123.45", "99999.99"]) { const b = priceBreakdown(p); assert.equal(b.customerBaseMinor, b.listPriceMinor); }
});
test("commission + net always equals the list price exactly (no lost cent) and rounds half up", () => {
  for (const p of ["0.01", "0.25", "0.26", "9.99", "33.33", "49.99", "75.25", "100.01", "1234.56"]) {
    const b = priceBreakdown(p);
    assert.equal(b.commissionMinor + b.publisherNetMinor, b.listPriceMinor, p);
  }
  assert.equal(d(priceBreakdown("0.25").commissionMinor), "0.01");   // 0.005 -> 0.01 (half up)
  assert.equal(d(priceBreakdown("0.24").commissionMinor), "0.00");   // 0.0048 -> 0.00
  assert.equal(d(priceBreakdown("33.33").commissionMinor), "0.67");  // 0.6666
});
test("no floating point drift: 0.1 + 0.2 style inputs stay exact", () => {
  assert.equal(usdToMinor("0.1") + usdToMinor("0.2"), usdToMinor("0.3"));
  assert.equal(usdToMinor(19.99), 1999n);
});
test("invalid money input is rejected", () => {
  for (const bad of ["", "abc", "-5", "1.234", "1e3", "12,50", "NaN"]) assert.throws(() => usdToMinor(bad), Error, bad);
  assert.throws(() => priceBreakdown("0"));
  assert.throws(() => priceBreakdown("10", -1));
});
test("commission is derived from USD, never from the converted PKR amount", () => {
  const usd = priceBreakdown("100");
  const pkr = checkoutAmount("100", "PKR", "278.5");
  assert.equal(pkr.amountDue, "27850.00");
  assert.equal(d(usd.commissionMinor), "2.00");         // still $2, not 2% of 27,850
});
test("PKR rounding policy: whole rupee, half up", () => {
  assert.equal(usdMinorToPkrWhole(usdToMinor("1"), parseRate("278.5")), 279n);   // 278.5 -> 279
  assert.equal(usdMinorToPkrWhole(usdToMinor("1"), parseRate("278.499999")), 278n);
  assert.equal(checkoutAmount("49.99", "PKR", "280.25").amountDue, "14010.00"); // 49.99*280.25 = 14009.6975
});
test("USD checkout needs no rate and PKR checkout refuses to guess one", () => {
  assert.deepEqual(checkoutAmount("100", "USD"), { currency: "USD", amountDue: "100.00", fxRate: null });
  assert.throws(() => checkoutAmount("100", "PKR"));
  assert.throws(() => checkoutAmount("100", "PKR", "0"));
  assert.throws(() => checkoutAmount("100", "PKR", "abc"));
});
test("formatting", () => {
  assert.equal(formatUsd("100"), "$100.00");
  assert.equal(formatUsd("1234.5"), "$1,234.50");
  assert.equal(formatPkr(27740), "PKR 27,740");
  assert.equal(estimatePkr("100", "277.4"), "PKR 27,740");
});

// ---- exchange rates ---------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
test("freshness labels: only a recent rate may be called live", () => {
  assert.equal(classifyFreshness(ago(2), NOW), "live");
  assert.equal(classifyFreshness(ago(30), NOW), "recent");
  assert.equal(classifyFreshness(ago(72), NOW), "stale");
  assert.equal(classifyFreshness(ago(24 * 10), NOW), "unusable");
  assert.equal(classifyFreshness("garbage", NOW), "unusable");
});
test("checkout stale-rate policy: PKR checkout locks a rate only within 48 hours", () => {
  assert.equal(mayLockForCheckout(ago(47), NOW), true);
  assert.equal(mayLockForCheckout(ago(49), NOW), false);
  assert.equal(mayLockForCheckout("garbage", NOW), false);
});
test("refresh policy: cached rate is reused for 12 hours, then refreshed", () => {
  assert.equal(needsRefresh(ago(3), NOW), false);
  assert.equal(needsRefresh(ago(13), NOW), true);
  assert.equal(needsRefresh(null, NOW), true);
  assert.ok(ageHours(ago(5), NOW) > 4.99 && ageHours(ago(5), NOW) < 5.01);
});
test("provider responses: valid parses; error, wrong base, missing, absurd, non-numeric are rejected (never invented)", () => {
  const ok = parseProviderResponse({ result: "success", base_code: "USD", time_last_update_unix: 1760054401, rates: { USD: 1, PKR: 281.4567 } });
  assert.equal(ok.rate, "281.456700"); assert.ok(ok.providerUpdatedAt);
  for (const bad of [null, "x", { result: "error" }, { result: "success", base_code: "EUR", rates: { PKR: 300 } }, { result: "success", base_code: "USD", rates: {} },
    { result: "success", base_code: "USD", rates: { PKR: 0 } }, { result: "success", base_code: "USD", rates: { PKR: 1e9 } }, { result: "success", base_code: "USD", rates: { PKR: "281" } },
    { result: "success", base_code: "USD", rates: { PKR: NaN } }]) assert.throws(() => parseProviderResponse(bad));
});
test("manual rate must be plausible", () => {
  assert.equal(validateManualRate("281.5"), "281.500000");
  assert.throws(() => validateManualRate("2.5")); assert.throws(() => validateManualRate("99999"));
});

import { refetchTooSoon, MIN_REFETCH_MINUTES } from "../src/lib/fx.ts";
test("FX duplicate-refresh guard: a fetch within 10 minutes of the last stored rate is skipped; later ones and an empty table are allowed", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  assert.equal(MIN_REFETCH_MINUTES, 10);
  assert.equal(refetchTooSoon(null, now), false);
  assert.equal(refetchTooSoon("2026-10-14T11:55:00Z", now), true);
  assert.equal(refetchTooSoon("2026-10-14T11:49:00Z", now), false);
});
