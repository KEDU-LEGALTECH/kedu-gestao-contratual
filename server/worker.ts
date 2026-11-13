// Background worker: GLPI sync and document reading against the same database, without HTTP.
// Runs where OCR is available (a Vercel Daemon or an always-on machine): `npm run worker`.
process.env.KEDU_ROLE = "worker";
await import("./index.js");
export {};
