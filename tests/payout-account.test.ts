import test from "node:test";
import assert from "node:assert/strict";
import { ibanChecksumOk, validateAccountNumber, encryptSecret, decryptSecret, payoutEncryptionConfigured, last4, maskAccount } from "../src/lib/crypto.ts";

test("IBAN checksum: known-valid IBANs pass, a single typo fails", () => {
  for (const ok of ["GB82WEST12345698765432", "DE89370400440532013000", "PK36SCBL0000001123456702"]) assert.equal(ibanChecksumOk(ok), true, ok);
  for (const bad of ["GB82WEST12345698765433", "DE89370400440532013001", "PK36SCBL0000001123456703"]) assert.equal(ibanChecksumOk(bad), false, bad);
});
test("validateAccountNumber normalises, checks IBAN digits, and still accepts plain account numbers", () => {
  assert.equal(validateAccountNumber("pk36 scbl 0000 0011 2345 6702", "PKR"), "PK36SCBL0000001123456702");
  assert.throws(() => validateAccountNumber("PK36SCBL0000001123456703", "PKR"), /typing error/);
  assert.throws(() => validateAccountNumber("GB82WEST12345698765433", "USD"), /typing error/);
  assert.equal(validateAccountNumber("123-456-7890", "USD"), "1234567890");
  for (const junk of ["", "abc", "12", "<script>", "1; drop table"]) assert.throws(() => validateAccountNumber(junk, "USD"), /valid IBAN or account number/);
});

test("payout encryption: authenticated AES-GCM round trip; tampering, wrong key and a malformed key all fail safely", () => {
  const prev = process.env.PAYOUT_DATA_KEY;
  try {
    process.env.PAYOUT_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
    assert.equal(payoutEncryptionConfigured(), true);
    const t = encryptSecret("PK36SCBL0000001123456702");
    assert.ok(!t.includes("PK36"), "plaintext must not appear in the stored token");
    assert.notEqual(encryptSecret("PK36SCBL0000001123456702"), t, "a fresh IV every time");
    assert.equal(decryptSecret(t), "PK36SCBL0000001123456702");
    const parts = t.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    assert.throws(() => decryptSecret(parts.join(".")), "a modified ciphertext is rejected (authentication tag)");
    process.env.PAYOUT_DATA_KEY = Buffer.alloc(32, 9).toString("base64");
    assert.throws(() => decryptSecret(t), "a different key cannot decrypt");
    for (const bad of ["", "GENERATE_32_RANDOM_BYTES_BASE64", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64")]) {
      process.env.PAYOUT_DATA_KEY = bad;
      assert.equal(payoutEncryptionConfigured(), false, `"${bad}" must be reported as not configured`);
      assert.throws(() => encryptSecret("x"), /PAYOUT_DATA_KEY must be 32 random bytes/);
    }
  } finally { if (prev === undefined) delete process.env.PAYOUT_DATA_KEY; else process.env.PAYOUT_DATA_KEY = prev; }
});
test("masking shows only the last four characters", () => {
  assert.equal(last4("PK36 SCBL 0000 0011 2345 6702"), "6702");
  assert.equal(maskAccount("6702"), "•••• 6702");
});
