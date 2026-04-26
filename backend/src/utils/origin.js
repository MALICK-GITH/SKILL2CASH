const LOCAL_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function isLocalOrigin(origin) {
  return typeof origin === 'string' && LOCAL_ORIGIN_PATTERN.test(origin);
}

export function isAllowedOrigin(origin, allowedOrigins) {
  return !origin || isLocalOrigin(origin) || allowedOrigins.has(origin);
}
