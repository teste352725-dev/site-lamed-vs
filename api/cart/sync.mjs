import { isCartRequestError, saveUserCart } from "../_cart.mjs";
import { getRequestBody, setNoStore } from "../_shipping.mjs";
import { isSessionRequestError, resolveAuthenticatedUserId } from "../_session.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const userId = await resolveAuthenticatedUserId(authorizationHeader);
    const body = getRequestBody(req);
    const mode = String(body?.mode || "replace").trim().toLowerCase();

    const result = await saveUserCart({
      userId,
      items: body?.items,
      source: mode === "merge" ? "merge" : "replace"
    });

    return res.status(200).json(result);
  } catch (error) {
    if (isSessionRequestError(error) || isCartRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel sincronizar o carrinho.")
      });
    }

    console.error("[vercel.cart.sync]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel sincronizar o carrinho agora."
    });
  }
}
