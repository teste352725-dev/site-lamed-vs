import {
  getMelhorEnvioBaseUrl,
  getMelhorEnvioServices,
  normalizePostalCode,
  setNoStore
} from "../_shipping.mjs";

export default function handler(req, res) {
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const accessToken = String(process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();
  const refreshToken = String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();

  return res.status(200).json({
    ok: Boolean(accessToken || refreshToken) && originPostalCode.length === 8,
    provider: "melhor_envio",
    baseUrl: getMelhorEnvioBaseUrl(),
    originPostalCodeConfigured: originPostalCode.length === 8,
    accessTokenConfigured: Boolean(accessToken),
    refreshTokenConfigured: Boolean(refreshToken),
    servicesConfigured: getMelhorEnvioServices()
  });
}
