// Vercel Function entry: the Express app answers every /api route (see vercel.json).
// The project must set KEDU_ROLE=api so no timers or background reading start inside the function.
export { default } from "../server/index.js";
