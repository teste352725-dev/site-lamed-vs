import { getPushPublicConfig, isNotificationRequestError, registerPushSubscription, unregisterPushSubscription } from "../../server/_notifications.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../../server/_security.mjs";
import { getRequestBody, setNoStore } from "../../server/_shipping.mjs";
import { isSessionRequestError, resolveAuthenticatedUserId } from "../../server/_session.mjs";

function getNotificationAction(req) {
  return String(req.query?.action || "")
    .trim()
    .toLowerCase();
}

function getNotificationErrorMessage(action) {
  if (action === "register") {
    return {
      generic: "Erro ao ativar as notificacoes.",
      request: "Nao foi possivel ativar as notificacoes."
    };
  }

  if (action === "unregister") {
    return {
      generic: "Erro ao desativar as notificacoes.",
      request: "Nao foi possivel desativar as notificacoes."
    };
  }

  return {
    generic: "Erro ao consultar as notificacoes.",
    request: "Nao foi possivel consultar as notificacoes."
  };
}

export default async function handler(req, res) {
  setNoStore(res);

  const action = getNotificationAction(req);

  if (action === "config") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
    }

    return res.status(200).json({
      ok: true,
      ...getPushPublicConfig()
    });
  }

  if (!["register", "unregister"].includes(action)) {
    return res.status(404).json({
      ok: false,
      error: "Acao de notificacao nao encontrada."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const clientAddress = getClientAddress(req);
  const rateLimit = enforceInMemoryRateLimit({
    key: `notifications:${action}:${clientAddress}`,
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

    const result = action === "register"
      ? await registerPushSubscription({
          userId,
          token: body?.token,
          permission: body?.permission,
          userAgent: String(req.headers?.["user-agent"] || "").slice(0, 240)
        })
      : await unregisterPushSubscription({
          userId,
          token: body?.token
        });

    return res.status(200).json(result);
  } catch (error) {
    const messages = getNotificationErrorMessage(action);

    if (isSessionRequestError(error) || isNotificationRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || messages.request)
      });
    }

    console.error(`[vercel.notifications.${action}]`, error);
    return res.status(500).json({
      ok: false,
      error: messages.generic
    });
  }
}
