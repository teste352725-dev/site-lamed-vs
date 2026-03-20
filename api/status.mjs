import { normalizePostalCode, setNoStore } from "./_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const melhorEnvioOrigin = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const melhorEnvioAccessToken = String(process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();
  const melhorEnvioRefreshToken = String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();

  return res.status(200).json({
    ok: true,
    message: "Vercel API online",
    shippingConfigured: Boolean(melhorEnvioAccessToken || melhorEnvioRefreshToken) && melhorEnvioOrigin.length === 8
  });
}
