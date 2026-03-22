import { getFirebaseAdminStatus } from "./_firebase-admin.mjs";
import { getShippingHealth, setNoStore } from "./_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const firebaseAdmin = getFirebaseAdminStatus();
  const shipping = getShippingHealth();

  return res.status(200).json({
    ok: true,
    message: "Vercel API online",
    shippingConfigured: shipping.ok,
    shippingProvider: shipping.provider,
    ordersConfigured: firebaseAdmin.configured,
    firebaseAdmin
  });
}
