import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentSecurityPolicy } from "../server/security-headers.js";

test("a Vercel envia a mesma política de segurança que o servidor local", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const header = vercel.headers.flatMap((rule: any) => rule.headers).find((h: any) => h.key === "Content-Security-Policy");
  assert.equal(header?.value, contentSecurityPolicy);
});

test("a página não tem script embutido, que a política bloquearia", () => {
  assert.doesNotMatch(readFileSync("index.html", "utf8"), /<script(?![^>]*\bsrc=)[^>]*>/);
});
