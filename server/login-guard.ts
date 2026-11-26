import { sql } from "./db.js";

/** Failed sign-ins counted in the database, so the limit holds across Vercel instances and restarts. */
const windowMs = 15 * 60000;
const perEmail = 10;
const perAddress = 50;
const subjects = (email: string, address?: string) =>
  ["email:" + email.trim().toLowerCase(), ...(address ? ["ip:" + address] : [])];

export async function loginBlocked(email: string, address?: string) {
  const since = Date.now() - windowMs;
  await sql.run("DELETE FROM login_attempts WHERE created<?", since);
  for (const subject of subjects(email, address)) {
    const { n } = await sql.one("SELECT COUNT(*) AS n FROM login_attempts WHERE subject=? AND created>=?", subject, since);
    if (n >= (subject.startsWith("ip:") ? perAddress : perEmail)) return true;
  }
  return false;
}

export async function recordFailedLogin(email: string, address?: string) {
  for (const subject of subjects(email, address))
    await sql.run("INSERT INTO login_attempts(subject,created) VALUES(?,?)", subject, Date.now());
}

export async function clearFailedLogins(email: string) {
  await sql.run("DELETE FROM login_attempts WHERE subject=?", subjects(email)[0]);
}
