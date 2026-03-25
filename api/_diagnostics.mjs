function readHeader(req, name) {
  return String(req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || "").trim();
}

function looksLocalHost(hostname) {
  return ["localhost", "127.0.0.1"].includes(String(hostname || "").toLowerCase());
}

function looksLocalIp(value) {
  const raw = String(value || "").toLowerCase();
  return raw.includes("127.0.0.1") || raw.includes("::1");
}

export function hasDiagnosticAccess(req) {
  const configuredToken = String(process.env.DIAGNOSTIC_TOKEN || "").trim();
  const providedToken = readHeader(req, "x-diagnostic-token");

  if (configuredToken && providedToken && providedToken === configuredToken) {
    return true;
  }

  const hostHeader = readHeader(req, "host");
  const originHeader = readHeader(req, "origin");
  const forwardedFor = readHeader(req, "x-forwarded-for");
  const realIp = readHeader(req, "x-real-ip");

  if (looksLocalHost(hostHeader) || looksLocalIp(forwardedFor) || looksLocalIp(realIp)) {
    return true;
  }

  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      if (looksLocalHost(parsed.hostname)) return true;
    } catch (error) {
      return false;
    }
  }

  return false;
}

export function requireDiagnosticAccess(req, res) {
  if (hasDiagnosticAccess(req)) return true;

  res.status(403).json({
    ok: false,
    error: "Forbidden"
  });
  return false;
}
