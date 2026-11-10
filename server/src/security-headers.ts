/** Minimal API hardening headers without a new dependency. The API serves JSON only, so a strict CSP is safe. */
export function securityHeaders(req: { path: string }, res: { setHeader(name: string, value: string): void }, next: () => void) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Authenticated responses contain personal data and must not be stored by shared caches or the browser.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}
