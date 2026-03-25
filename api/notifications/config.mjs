import { getPushPublicConfig } from "../_notifications.mjs";
import { setNoStore } from "../_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  return res.status(200).json({
    ok: true,
    ...getPushPublicConfig()
  });
}
