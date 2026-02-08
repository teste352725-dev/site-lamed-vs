import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   STATUS
========================= */
app.get("/api/status", (req, res) => {
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
app.get("/api/efi/health", (req, res) => {
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
app.get("/api/efi/cert-check", (req, res) => {
  try {
    if (process.env.EFI_CERT_PATH) {
      const exists = fs.existsSync(process.env.EFI_CERT_PATH);
      return res.json({
        method: "path",
        path: process.env.EFI_CERT_PATH,
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
