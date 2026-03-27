const RATE_LIMIT_BUCKETS = new Map();

function cleanupBucket(now = Date.now()) {
  for (const [key, entry] of RATE_LIMIT_BUCKETS.entries()) {
    if (!entry || !entry.resetAt || entry.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key);
    }
  }
}

export function getClientAddress(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = String(req?.headers?.["x-real-ip"] || "").trim();
  if (realIp) return realIp;

  return "unknown";
}

export function enforceInMemoryRateLimit({ key, maxRequests, windowMs }) {
  const safeKey = String(key || "").trim();
  const max = Math.max(1, parseInt(maxRequests, 10) || 1);
  const windowSize = Math.max(1000, parseInt(windowMs, 10) || 60000);
  const now = Date.now();

  cleanupBucket(now);

  const bucket = RATE_LIMIT_BUCKETS.get(safeKey);
  if (!bucket || bucket.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(safeKey, {
      count: 1,
      resetAt: now + windowSize
    });

    return {
      allowed: true,
      retryAfterSeconds: 0
    };
  }

  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  bucket.count += 1;
  RATE_LIMIT_BUCKETS.set(safeKey, bucket);

  return {
    allowed: true,
    retryAfterSeconds: 0
  };
}
