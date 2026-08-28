import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const keys = JSON.parse(readFileSync(join(root, "tests/packing/keys/ed25519.test.json"), "utf8")) as {
  label: string;
  note: string;
  secret_key: string;
  public_key_hash: string;
};

test("packing edsk is labeled synthetic test-only and is the fixture key only", () => {
  assert.equal(keys.label, "tezoracle-packing-test-ed25519-v1");
  assert.match(keys.note, /SYNTHETIC TEST-ONLY KEY/);
  assert.match(keys.note, /Never funded/);
  assert.equal(
    keys.secret_key,
    "edskSAoiNS22migarRXPB9Uhs7A1Q3fP23hxQGK5Ji8X5gHTXzpA4wyuyR1unDoSbSeYc839zaVwF68kdxgL2CHZLoTvZTu4tJ",
  );
  assert.equal(keys.public_key_hash, "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC");
});
