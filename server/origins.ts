/** Development previews can use another loopback port. Never trust Host headers. */
export function allowedOrigin(
  origin: string,
  production = process.env.NODE_ENV === "production",
  configured = process.env.ALLOWED_ORIGINS || "",
): boolean {
  const explicit = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return false;
    return (
      !production &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
