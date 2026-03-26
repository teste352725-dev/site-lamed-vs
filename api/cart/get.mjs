import { getUserCart, isCartRequestError } from "../_cart.mjs";
import { isSessionRequestError, resolveAuthenticatedUserId } from "../_session.mjs";
import { setNoStore } from "../_shipping.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const userId = await resolveAuthenticatedUserId(authorizationHeader);
    const result = await getUserCart(userId);
    return res.status(200).json(result);
  } catch (error) {
    if (isSessionRequestError(error) || isCartRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel carregar o carrinho.")
      });
    }

    console.error("[vercel.cart.get]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel carregar o carrinho agora."
    });
  }
}
