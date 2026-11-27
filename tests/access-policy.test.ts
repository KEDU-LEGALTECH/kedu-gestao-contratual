import { test } from "node:test";
import assert from "node:assert/strict";
import { permissions } from "../shared/access-policy.js";

test("Jurídico tem os mesmos poderes do Administrador", () => {
  assert.deepEqual([...permissions.Jurídico].sort(), [...permissions.Administrador].sort());
});
