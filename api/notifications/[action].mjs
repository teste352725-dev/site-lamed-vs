import { isAccountRequestError, toggleFavoriteForUser, upsertUserProfile } from "../../server/_account.mjs";
import { getPushPublicConfig, isNotificationRequestError, registerPushSubscription, unregisterPushSubscription } from "../../server/_notifications.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../../server/_security.mjs";
import { getRequestBody, setNoStore } from "../../server/_shipping.mjs";
import { isSessionRequestError, resolveAuthenticatedUser } from "../../server/_session.mjs";

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

  if (action === "profile-sync") {
    return {
      generic: "Erro ao sincronizar sua conta.",
      request: "Nao foi possivel sincronizar sua conta agora."
    };
  }

  if (action === "favorite-toggle") {
    return {
      generic: "Erro ao salvar o favorito.",
      request: "Nao foi possivel salvar este favorito agora."
    };
  }

  return {
    generic: "Erro ao consultar as notificacoes.",
    request: "Nao foi possivel consultar as notificacoes."
  };
}

function getActionRateLimit(action) {
  if (action === "favorite-toggle") {
    return {
      maxRequests: 120,
      windowMs: 60 * 60 * 1000
    };
  }

  if (action === "profile-sync") {
    return {
      maxRequests: 60,
      windowMs: 60 * 60 * 1000
    };
  }

  return {
    maxRequests: 12,
    windowMs: 60 * 60 * 1000
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

  if (!["register", "unregister", "profile-sync", "favorite-toggle"].includes(action)) {
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
  const actionLimit = getActionRateLimit(action);
  const rateLimit = enforceInMemoryRateLimit({
    key: `notifications:${action}:${clientAddress}`,
    maxRequests: actionLimit.maxRequests,
    windowMs: actionLimit.windowMs
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
    const decodedUser = await resolveAuthenticatedUser(authorizationHeader);
    const body = getRequestBody(req);

    let result;

    if (action === "register") {
      result = await registerPushSubscription({
        userId: decodedUser?.uid,
        token: body?.token,
        permission: body?.permission,
        userAgent: String(req.headers?.["user-agent"] || "").slice(0, 240)
      });
    } else if (action === "unregister") {
      result = await unregisterPushSubscription({
        userId: decodedUser?.uid,
        token: body?.token
      });
    } else if (action === "profile-sync") {
      result = await upsertUserProfile({
        userId: decodedUser?.uid,
        authUser: decodedUser,
        input: body?.profile && typeof body.profile === "object" ? body.profile : body
      });
    } else {
      result = await toggleFavoriteForUser({
        userId: decodedUser?.uid,
        authUser: decodedUser,
        productId: body?.productId,
        favorite: typeof body?.favorite === "boolean" ? body.favorite : null
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    const messages = getNotificationErrorMessage(action);

    if (isSessionRequestError(error) || isNotificationRequestError(error) || isAccountRequestError(error)) {
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
