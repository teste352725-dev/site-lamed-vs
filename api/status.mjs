import { getFirebaseAdminStatus } from "../server/_firebase-admin.mjs";
import { getInfinitePayHealth } from "../server/_infinitepay.mjs";
import { requireDiagnosticAccess } from "../server/_diagnostics.mjs";
import { getPushPublicConfig } from "../server/_notifications.mjs";
import { getRequestBody, getShippingHealth, setNoStore } from "../server/_shipping.mjs";
import { recordEvent } from "../server/_analytics.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../server/_security.mjs";

// POST /api/eventos (reescrito para ca em vercel.json): contador anonimo de visitas.
// Fica nesta funcao porque o plano Hobby da Vercel permite no maximo 12 funcoes.
async function handleEvent(req, res) {
  const limit = enforceInMemoryRateLimit({ key: `eventos:${getClientAddress(req)}`, maxRequests: 60, windowMs: 60000 });
  // Teto geral por instancia: uma enxurrada de eventos falsos nao vira conta alta no Firebase.
  const global = enforceInMemoryRateLimit({ key: "eventos:global", maxRequests: 1200, windowMs: 60000 });
  if (!limit.allowed || !global.allowed) return res.status(204).end();
  try {
    await recordEvent(getRequestBody(req), { userAgent: req.headers?.["user-agent"] });
  } catch (error) {
    console.error("[eventos]", error?.message || error);
  }
  return res.status(204).end();
}

export default function handler(req, res) {
  setNoStore(res);

  if (req.method === "POST") {
    return handleEvent(req, res);
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  if (!requireDiagnosticAccess(req, res)) {
    return;
  }

  const firebaseAdmin = getFirebaseAdminStatus();
  const shipping = getShippingHealth();
  const infinitePay = getInfinitePayHealth();
  const notifications = getPushPublicConfig();

  return res.status(200).json({
    ok: true,
    message: "Vercel API online",
    shippingConfigured: shipping.ok,
    shippingProvider: shipping.provider,
    infinitePayConfigured: infinitePay.ok,
    infinitePay,
    notificationsConfigured: notifications.enabled,
    ordersConfigured: firebaseAdmin.configured,
    firebaseAdmin
  });
}
