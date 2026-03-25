import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { getFirebaseAdminStatus } from "../api/_firebase-admin.mjs";
import { createOrderFromBody, isOrderRequestError } from "../api/_orders.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../api/_security.mjs";
import { getShippingHealth, isShippingApiEnabled, requestShippingQuote } from "../api/_shipping.mjs";

dotenv.config();

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const LOCAL_ORIGINS = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_SHIPPING_PROFILES = {
  vestido: { peso: 0.7, largura: 28, altura: 6, comprimento: 35 },
  conjunto: { peso: 0.95, largura: 30, altura: 8, comprimento: 36 },
  calca: { peso: 0.65, largura: 28, altura: 6, comprimento: 34 },
  camisa: { peso: 0.45, largura: 26, altura: 5, comprimento: 33 },
  saia: { peso: 0.45, largura: 26, altura: 5, comprimento: 32 },
  blusa: { peso: 0.35, largura: 24, altura: 4, comprimento: 30 },
  mesa_posta: { peso: 0.5, largura: 28, altura: 4, comprimento: 30 },
  lugar_americano: { peso: 0.42, largura: 28, altura: 3, comprimento: 30 },
  guardanapo: { peso: 0.12, largura: 16, altura: 2, comprimento: 16 },
  anel_guardanapo: { peso: 0.08, largura: 12, altura: 4, comprimento: 12 },
  porta_guardanapo: { peso: 0.08, largura: 12, altura: 4, comprimento: 12 },
  trilho_velas: { peso: 0.3, largura: 16, altura: 3, comprimento: 25 },
  caminho_mesa: { peso: 0.62, largura: 20, altura: 5, comprimento: 38 },
  capa_de_matza: { peso: 0.18, largura: 18, altura: 3, comprimento: 22 },
  outros: { peso: 0.4, largura: 24, altura: 5, comprimento: 28 },
  combo: { peso: 1.2, largura: 35, altura: 10, comprimento: 38 }
};

const MELHOR_ENVIO_BASE_URL = String(
  process.env.MELHOR_ENVIO_BASE_URL || "https://sandbox.melhorenvio.com.br"
).replace(/\/+$/, "");
const ENV_FILE_PATH = new URL("./.env", import.meta.url);
let melhorEnvioRefreshPromise = null;

const MELHOR_ENVIO_SERVICES = (process.env.MELHOR_ENVIO_SERVICES || "")
  .split(",")
  .map((service) => service.trim())
  .filter(Boolean);

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const host = req.hostname || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) || ["localhost", "127.0.0.1"].includes(host);
}

function isLocalOrigin(origin) {
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (LOCAL_ORIGINS.has(origin)) return true;
  if (isLocalOrigin(origin)) return true;
  if (allowedOrigins.length === 0) return false;
  return allowedOrigins.includes(origin);
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

function normalizePostalCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function normalizeCategory(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toPositiveNumber(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getConfiguredShippingProfile(profile) {
  if (!profile || typeof profile !== "object") return null;

  const peso = toPositiveNumber(profile.peso, 3);
  const largura = toPositiveNumber(profile.largura, 0);
  const altura = toPositiveNumber(profile.altura, 0);
  const comprimento = toPositiveNumber(profile.comprimento, 0);

  if (!peso || !largura || !altura || !comprimento) return null;

  return {
    peso,
    largura,
    altura,
    comprimento
  };
}

function resolveShippingProfile(item) {
  const configured = getConfiguredShippingProfile(item?.frete);
  if (configured) return configured;

  const categoryKey = item?.isCombo === true
    ? "combo"
    : normalizeCategory(item?.categoria || "outros");

  return DEFAULT_SHIPPING_PROFILES[categoryKey] || DEFAULT_SHIPPING_PROFILES.outros;
}

function buildQuoteProducts(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("O carrinho enviado para cotacao esta vazio.");
  }

  return items.map((item, index) => {
    const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const price = roundCurrency(Number(item?.preco || 0));
    const profile = resolveShippingProfile(item);
    const productId = String(item?.id || item?.cartId || `item-${index + 1}`).slice(0, 120);

    return {
      id: productId,
      width: profile.largura,
      height: profile.altura,
      length: profile.comprimento,
      weight: profile.peso,
      insurance_value: price > 0 ? price : 1,
      quantity
    };
  });
}

function extractMelhorEnvioError(payload, status) {
  if (!payload) return `Melhor Envio respondeu com status ${status}.`;

  if (typeof payload === "string") {
    return payload.slice(0, 220);
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return payload.errors.map((item) => String(item)).join(" | ").slice(0, 220);
  }

  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim().slice(0, 220);
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim().slice(0, 220);
  }

  return `Melhor Envio respondeu com status ${status}.`;
}

function persistEnvValue(key, value) {
  const nextValue = String(value || "");
  process.env[key] = nextValue;

  let content = "";

  try {
    content = fs.readFileSync(ENV_FILE_PATH, "utf8");
  } catch (error) {
    content = "";
  }

  const lines = content ? content.split(/\r?\n/) : [];
  let updated = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return `${key}=${nextValue}`;
    }

    return line;
  });

  if (!updated) {
    nextLines.push(`${key}=${nextValue}`);
  }

  fs.writeFileSync(ENV_FILE_PATH, nextLines.join("\n"), "utf8");
}

async function refreshMelhorEnvioAccessToken() {
  const refreshToken = String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();

  if (!refreshToken) {
    throw new Error("Configure MELHOR_ENVIO_ACCESS_TOKEN ou MELHOR_ENVIO_REFRESH_TOKEN no backend.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: String(process.env.MELHOR_ENVIO_CLIENT_ID || "").trim(),
    client_secret: String(process.env.MELHOR_ENVIO_CLIENT_SECRET || "").trim(),
    redirect_uri: String(process.env.MELHOR_ENVIO_REDIRECT_URI || "").trim(),
    refresh_token: refreshToken
  });

  const response = await fetch(`${MELHOR_ENVIO_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractMelhorEnvioError(data, response.status));
  }

  const nextAccessToken = String(data?.access_token || "").trim();
  const nextRefreshToken = String(data?.refresh_token || refreshToken).trim();

  if (!nextAccessToken) {
    throw new Error("Melhor Envio nao retornou um access_token valido.");
  }

  persistEnvValue("MELHOR_ENVIO_ACCESS_TOKEN", nextAccessToken);
  persistEnvValue("MELHOR_ENVIO_REFRESH_TOKEN", nextRefreshToken);

  return nextAccessToken;
}

async function getMelhorEnvioAccessToken({ forceRefresh = false } = {}) {
  const accessToken = String(process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();

  if (accessToken && !forceRefresh) {
    return accessToken;
  }

  if (!melhorEnvioRefreshPromise) {
    melhorEnvioRefreshPromise = refreshMelhorEnvioAccessToken().finally(() => {
      melhorEnvioRefreshPromise = null;
    });
  }

  return melhorEnvioRefreshPromise;
}

async function requestMelhorEnvioQuote({ destinationPostalCode, items }) {
  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const userAgent = String(process.env.MELHOR_ENVIO_USER_AGENT || "Studio Lamed (contato@lamed.com.br)").trim();

  if (originPostalCode.length !== 8) {
    throw new Error("Configure MELHOR_ENVIO_ORIGIN_POSTAL_CODE com um CEP de origem valido.");
  }

  const products = buildQuoteProducts(items);
  const payload = {
    from: { postal_code: originPostalCode },
    to: { postal_code: destinationPostalCode },
    products,
    options: {
      receipt: false,
      own_hand: false,
      collect: false
    }
  };

  if (MELHOR_ENVIO_SERVICES.length > 0) {
    payload.services = MELHOR_ENVIO_SERVICES.join(",");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    async function sendQuoteRequest(accessToken) {
      const response = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": userAgent
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);
      return { response, data };
    }

    let accessToken = await getMelhorEnvioAccessToken();
    let { response, data } = await sendQuoteRequest(accessToken);

    if (response.status === 401) {
      accessToken = await getMelhorEnvioAccessToken({ forceRefresh: true });
      ({ response, data } = await sendQuoteRequest(accessToken));
    }

    if (!response.ok) {
      throw new Error(extractMelhorEnvioError(data, response.status));
    }

    return {
      originPostalCode,
      options: Array.isArray(data) ? data : []
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A cotacao demorou demais para responder. Tente novamente.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeQuoteOptions(rawOptions, originPostalCode, destinationPostalCode) {
  return rawOptions
    .filter((option) => option && !option.error)
    .map((option) => {
      const price = roundCurrency(Number(option.custom_price ?? option.price ?? option.total ?? 0));
      const originalPrice = roundCurrency(Number(option.price ?? option.custom_price ?? price));
      const deliveryTime = Math.max(
        1,
        parseInt(option.custom_delivery_time ?? option.delivery_time ?? option.delivery_range?.max ?? 0, 10) || 0
      );
      const company = String(option.company?.name || option.company?.company_name || "Transportadora").trim();
      const name = String(option.name || option.service?.name || "Frete").trim();
      const serviceId = String(option.id ?? option.service?.id ?? name).trim();
      const serviceCode = String(option.service_code ?? option.id ?? serviceId).trim();

      if (!serviceId || !serviceCode || !name || !company || !Number.isFinite(price) || price < 0) {
        return null;
      }

      return {
        id: `${serviceCode}:${serviceId}`,
        serviceId,
        serviceCode,
        name,
        company,
        price,
        originalPrice: Number.isFinite(originalPrice) && originalPrice >= 0 ? originalPrice : price,
        deliveryTime,
        fromPostalCode: originPostalCode,
        toPostalCode: destinationPostalCode
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.price - second.price || first.deliveryTime - second.deliveryTime);
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
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "250kb" }));

app.get("/api/status", requireDiagnosticAccess, (req, res) => {
  const firebaseAdmin = getFirebaseAdminStatus();
  const shipping = getShippingHealth();

  res.json({
    ok: true,
    message: "Backend online",
    port: process.env.PORT || 3001,
    envLoaded: !!process.env.EFI_CLIENT_ID,
    shippingConfigured: shipping.ok,
    shippingProvider: shipping.provider,
    ordersConfigured: firebaseAdmin.configured,
    firebaseAdmin
  });
});

app.get("/api/efi/health", requireDiagnosticAccess, (req, res) => {
  const required = [
    "EFI_BASE_URL",
    "EFI_CLIENT_ID",
    "EFI_CLIENT_SECRET",
    "EFI_PIX_KEY"
  ];

  const missing = required.filter((key) => !process.env[key]);
  res.json({ ok: missing.length === 0, missing });
});

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
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/shipping/health", requireDiagnosticAccess, (req, res) => {
  res.json(getShippingHealth());
});

app.post("/api/shipping/quote", async (req, res) => {
  if (!isShippingApiEnabled()) {
    return res.status(503).json({
      ok: false,
      error: "Frete automatico pausado temporariamente. O valor e o prazo sao definidos manualmente apos o pedido."
    });
  }

  const destinationPostalCode = normalizePostalCode(req.body?.postalCode);
  const items = Array.isArray(req.body?.cart) ? req.body.cart : [];
  const packageOverride = req.body?.packageOverride && typeof req.body.packageOverride === "object"
    ? req.body.packageOverride
    : null;

  if (destinationPostalCode.length !== 8) {
    return res.status(400).json({
      ok: false,
      error: "Informe um CEP valido com 8 digitos para calcular o frete."
    });
  }

  if (items.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Nao foi possivel calcular o frete para um carrinho vazio."
    });
  }

  try {
    const quote = await requestShippingQuote({
      destinationPostalCode,
      items,
      packageOverride
    });
    const options = Array.isArray(quote.options) ? quote.options : [];

    if (options.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Nenhuma opcao de frete foi encontrada para esse CEP.",
        options: []
      });
    }

    return res.json({
      ok: true,
      provider: quote.provider,
      options
    });
  } catch (error) {
    console.error("[shipping.quote]", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || "Erro ao consultar o Melhor Envio.")
    });
  }
});

app.post("/api/orders/create", async (req, res) => {
  const clientAddress = getClientAddress(req);
  const rateLimit = enforceInMemoryRateLimit({
    key: `orders:create:${clientAddress}`,
    maxRequests: 6,
    windowMs: 10 * 60 * 1000
  });

  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: "Muitas tentativas em pouco tempo. Aguarde um instante antes de tentar novamente."
    });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const result = await createOrderFromBody(req.body, authorizationHeader, {
      clientAddress,
      userAgent: String(req.headers?.["user-agent"] || "").slice(0, 240)
    });
    return res.status(201).json(result);
  } catch (error) {
    if (isOrderRequestError(error)) {
      const status = Number(error.status) || 400;
      const payload = {
        ok: false,
        error: String(error.message || "Nao foi possivel criar o pedido.")
      };

      if (typeof error.code === "string" && error.code) {
        payload.code = error.code;
      }

      if (Array.isArray(error.canonicalCart)) {
        payload.canonicalCart = error.canonicalCart;
      }

      if (error.totalsPreview && typeof error.totalsPreview === "object") {
        payload.totalsPreview = error.totalsPreview;
      }

      return res.status(status).json(payload);
    }

    console.error("[orders.create]", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || "Erro ao criar o pedido.")
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
