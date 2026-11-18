import { safeTokenEquals } from "./_security.mjs";

function readHeader(req, name) {
  return String(req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || "").trim();
}

function looksLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1";
}

// Seguranca (auditoria 2026-11-03): antes, um cabecalho "Origin: http://localhost"
// ou "X-Forwarded-For: 127.0.0.1" (ambos controlados pelo cliente) liberava o
// diagnostico em producao. Agora so o DIAGNOSTIC_TOKEN libera; o atalho local
// vale apenas fora da Vercel (servidor de desenvolvimento na propria maquina).
export function hasDiagnosticAccess(req, env = process.env) {
  const configuredToken = String(env.DIAGNOSTIC_TOKEN || "").trim();
  const providedToken = readHeader(req, "x-diagnostic-token");

  if (safeTokenEquals(providedToken, configuredToken)) {
    return true;
  }

  const runningOnVercel = Boolean(env.VERCEL || env.VERCEL_ENV);
  if (!runningOnVercel && looksLocalHost(readHeader(req, "host"))) {
    return true;
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
