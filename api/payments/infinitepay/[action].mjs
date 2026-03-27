import {
  applyInfinitePayWebhook,
  assertInfinitePayWebhookAccess,
  confirmInfinitePayPayment,
  isInfinitePayRequestError
} from "../../../server/_infinitepay.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";
import { isSessionRequestError, resolveAuthenticatedUser } from "../../../server/_session.mjs";

function getActionValue(req) {
  const rawAction = Array.isArray(req?.query?.action) ? req.query.action[0] : req?.query?.action;
  return String(rawAction || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  setNoStore(res);

  const action = getActionValue(req);
  if (!action || !["webhook", "confirm"].includes(action)) {
    return res.status(404).json({ ok: false, error: "Acao nao encontrada." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const payload = getRequestBody(req);

    if (action === "webhook") {
      assertInfinitePayWebhookAccess(req);
      const result = await applyInfinitePayWebhook(payload);
      return res.status(200).json(result);
    }

    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const decodedUser = await resolveAuthenticatedUser(authorizationHeader);
    const result = await confirmInfinitePayPayment({
      orderId: payload?.orderId || payload?.order_nsu,
      slug: payload?.slug,
      transactionNsu: payload?.transactionNsu || payload?.transaction_nsu,
      decodedUser
    });
    return res.status(200).json(result);
  } catch (error) {
    if (isSessionRequestError(error) || isInfinitePayRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel processar a confirmacao da InfinitePay.")
      });
    }

    console.error("[vercel.payments.infinitepay]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel processar a confirmacao da InfinitePay."
    });
  }
}
