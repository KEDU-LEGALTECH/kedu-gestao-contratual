/** Content-Security-Policy for the portal. Vercel serves the page itself (vercel.json repeats this value,
 * checked by tests/security-headers.test.ts); Express sends it for local use and the API.
 * Styles allow 'unsafe-inline' because React style attributes and the summary page opened from a blob use them.
 * connect-src includes Supabase because large uploads go straight to Storage through a signed URL. */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
