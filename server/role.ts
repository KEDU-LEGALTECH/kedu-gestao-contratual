/** KEDU_ROLE splits the portal for serverless hosting:
 * - "all" (default): one process serves HTTP and runs background work, as on the office computer;
 * - "api": serves requests only (Vercel Functions), no timers, reading queue, local backup or instance lease;
 * - "worker": GLPI sync and document reading without HTTP, kept running by its own timers. */
export const role = process.env.KEDU_ROLE === "api" ? "api" : process.env.KEDU_ROLE === "worker" ? "worker" : "all";
export const runsBackground = role !== "api";
export const servesHttp = role !== "worker";
