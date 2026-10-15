import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigin } from "../server/origins.js";
test("Desenvolvimento permite previews locais sem depender da porta", () => {
  for (const origin of [
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:4173",
    "http://[::1]:3001",
  ])
    assert.equal(allowedOrigin(origin, false, ""), true);
});
test("Proteção de origem continua bloqueando sites externos e origens malformadas", () => {
  for (const origin of [
    "null",
    "https://malicioso.example",
    "http://localhost.malicioso.example:5173",
    "http://localhost:5173/caminho",
    "http://usuario@localhost:5173",
  ])
    assert.equal(allowedOrigin(origin, false, ""), false);
});
test("Produção exige domínio explicitamente autorizado", () => {
  assert.equal(allowedOrigin("http://localhost:5173", true, ""), false);
  assert.equal(
    allowedOrigin(
      "https://contratos.example",
      true,
      "https://contratos.example",
    ),
    true,
  );
  assert.equal(
    allowedOrigin("https://outro.example", true, "https://contratos.example"),
    false,
  );
});
