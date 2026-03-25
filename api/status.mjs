import { getFirebaseAdminStatus } from "./_firebase-admin.mjs";
import { requireDiagnosticAccess } from "./_diagnostics.mjs";
import { getPushPublicConfig } from "./_notifications.mjs";
import { getShippingHealth, setNoStore } from "./_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  if (!requireDiagnosticAccess(req, res)) {
    return;
  }

  const firebaseAdmin = getFirebaseAdminStatus();
  const shipping = getShippingHealth();
  const notifications = getPushPublicConfig();

  return res.status(200).json({
    ok: true,
    message: "Vercel API online",
    shippingConfigured: shipping.ok,
    shippingProvider: shipping.provider,
    notificationsConfigured: notifications.enabled,
    ordersConfigured: firebaseAdmin.configured,
    firebaseAdmin
  });
}
