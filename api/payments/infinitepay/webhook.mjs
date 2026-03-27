import { applyInfinitePayWebhook, assertInfinitePayWebhookAccess, isInfinitePayRequestError } from "../../../server/_infinitepay.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    assertInfinitePayWebhookAccess(req);
    const payload = getRequestBody(req);
    const result = await applyInfinitePayWebhook(payload);
    return res.status(200).json(result);
  } catch (error) {
    if (isInfinitePayRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel processar o webhook da InfinitePay.")
      });
    }

    console.error("[vercel.payments.infinitepay.webhook]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel processar o webhook da InfinitePay."
    });
  }
}
