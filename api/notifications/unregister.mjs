import { getRequestBody, setNoStore } from "../_shipping.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../_security.mjs";
import { isNotificationRequestError, unregisterPushSubscription } from "../_notifications.mjs";
import { isSessionRequestError, resolveAuthenticatedUserId } from "../_session.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const clientAddress = getClientAddress(req);
  const rateLimit = enforceInMemoryRateLimit({
    key: `notifications:unregister:${clientAddress}`,
    maxRequests: 12,
    windowMs: 60 * 60 * 1000
  });

  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: "Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente."
    });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const userId = await resolveAuthenticatedUserId(authorizationHeader);
    const body = getRequestBody(req);
    const result = await unregisterPushSubscription({
      userId,
      token: body?.token
    });
    return res.status(200).json(result);
  } catch (error) {
    if (isSessionRequestError(error) || isNotificationRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel desativar as notificacoes.")
      });
    }

    console.error("[vercel.notifications.unregister]", error);
    return res.status(500).json({
      ok: false,
      error: "Erro ao desativar as notificacoes."
    });
  }
}
