import {
  getShippingHealth,
  setNoStore
} from "../_shipping.mjs";
import { requireDiagnosticAccess } from "../_diagnostics.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  if (!requireDiagnosticAccess(req, res)) {
    return;
  }

  return res.status(200).json(getShippingHealth());
}
