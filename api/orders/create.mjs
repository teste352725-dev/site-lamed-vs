import { getRequestBody, setNoStore } from "../../server/_shipping.mjs";
import { createOrderFromBody, isOrderRequestError } from "../../server/_orders.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../../server/_security.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

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
    const body = getRequestBody(req);
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const result = await createOrderFromBody(body, authorizationHeader, {
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

    console.error("[vercel.orders.create]", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || "Erro ao criar o pedido.")
    });
  }
}
