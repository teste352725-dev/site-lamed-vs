import { getRequestBody, setNoStore } from "../_shipping.mjs";
import { createOrderFromBody, isOrderRequestError } from "../_orders.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const body = getRequestBody(req);
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const result = await createOrderFromBody(body, authorizationHeader);
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
