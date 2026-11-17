// Background worker: GLPI sync and document reading against the same database, without HTTP.
// Runs where OCR is available (a Vercel Daemon or an always-on machine): `npm run worker`.
process.env.KEDU_ROLE = "worker";
if (process.env.KEDU_WORKER_DEFERRED_OCR_ONLY === "true") {
  const { sql } = await import("./db.js");
  try {
    const { runReadingCycle } = await import("./contract-processing.js");
    const result = await runReadingCycle(10 * 60_000);
    console.log(result.paused ? "Fila de leitura pausada." : "Ciclo de OCR concluído.");
  } finally {
    await sql.close?.();
  }
} else {
  await import("./index.js");
}
export {};
