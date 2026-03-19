import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const host = req.hostname || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) || ["localhost", "127.0.0.1"].includes(host);
}

function requireDiagnosticAccess(req, res, next) {
  const diagnosticToken = process.env.DIAGNOSTIC_TOKEN;
  if (diagnosticToken && req.get("x-diagnostic-token") === diagnosticToken) {
    return next();
  }

  if (!diagnosticToken && isLocalRequest(req)) {
    return next();
  }

  return res.status(403).json({ ok: false, error: "Forbidden" });
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, false);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "100kb" }));

/* =========================
   STATUS
========================= */
app.get("/api/status", requireDiagnosticAccess, (req, res) => {
  res.json({
    ok: true,
    message: "Backend online 🚀",
    port: process.env.PORT || 3001,
    envLoaded: !!process.env.EFI_CLIENT_ID
  });
});

/* =========================
   EFI: HEALTH (confere .env)
========================= */
app.get("/api/efi/health", requireDiagnosticAccess, (req, res) => {
  const required = [
    "EFI_BASE_URL",
    "EFI_CLIENT_ID",
    "EFI_CLIENT_SECRET",
    "EFI_PIX_KEY"
  ];

  const missing = required.filter((k) => !process.env[k]);

  res.json({
    ok: missing.length === 0,
    missing
  });
});

/* =========================
   EFI: CERT CHECK (.p12)
========================= */
app.get("/api/efi/cert-check", requireDiagnosticAccess, (req, res) => {
  try {
    if (process.env.EFI_CERT_PATH) {
      const exists = fs.existsSync(process.env.EFI_CERT_PATH);
      return res.json({
        method: "path",
        pathConfigured: true,
        exists
      });
    }

    if (process.env.EFI_CERT_BASE64) {
      return res.json({
        method: "base64",
        base64Length: process.env.EFI_CERT_BASE64.length
      });
    }

    res.status(400).json({
      ok: false,
      error: "Configure EFI_CERT_PATH ou EFI_CERT_BASE64 no .env"
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ API rodando em http://localhost:${PORT}`);
});
