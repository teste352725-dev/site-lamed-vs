import { isSafePixProductDiscountEnabled } from "../../server/_checkout-finance.mjs";
import { getInfinitePayHealth } from "../../server/_infinitepay.mjs";
import { isShippingCheckoutEnabled, setNoStore } from "../../server/_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const shippingCheckoutEnabled = isShippingCheckoutEnabled();
  const infinitePayEnabled = shippingCheckoutEnabled && getInfinitePayHealth().ok;
  const pixProductDiscountEnabled = infinitePayEnabled && isSafePixProductDiscountEnabled();

  return res.status(200).json({
    ok: true,
    shippingCheckoutEnabled,
    infinitePayEnabled,
    pixProductDiscountEnabled,
    pixProductDiscountPercent: pixProductDiscountEnabled ? 5 : 0,
    whatsappFallbackEnabled: true
  });
}
