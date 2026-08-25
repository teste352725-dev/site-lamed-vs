import {
  getRequestBody,
  isShippingProviderCredentialError,
  isShippingCheckoutEnabled,
  normalizePostalCode,
  requestShippingQuote,
  setNoStore
} from "../../server/_shipping.mjs";
import { enforceInMemoryRateLimit, getClientAddress } from "../../server/_security.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  if (!isShippingCheckoutEnabled()) {
    return res.status(503).json({
      ok: false,
      code: "SHIPPING_PREVIEW_ONLY",
      error: "O frete automatico esta disponivel somente no ambiente seguro de homologacao. Continue pelo WhatsApp neste ambiente."
    });
  }

  const clientAddress = getClientAddress(req);
  const rateLimit = enforceInMemoryRateLimit({
    key: `shipping:quote:${clientAddress}`,
    maxRequests: 20,
    windowMs: 5 * 60 * 1000
  });

  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      code: "SHIPPING_RATE_LIMIT",
      error: "Muitas consultas em pouco tempo. Aguarde um instante e tente novamente."
    });
  }

  const body = getRequestBody(req);
  const destinationPostalCode = normalizePostalCode(body?.postalCode);
  const items = Array.isArray(body?.cart) ? body.cart.slice(0, 30) : [];
  const testModeEnabled = String(process.env.SHIPPING_TEST_MODE || "").trim().toLowerCase() === "true" ||
    String(process.env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
  const packageOverride = testModeEnabled && body?.packageOverride && typeof body.packageOverride === "object"
    ? body.packageOverride
    : null;

  if (destinationPostalCode.length !== 8) {
    return res.status(400).json({
      ok: false,
      error: "Informe um CEP valido com 8 digitos para calcular o frete."
    });
  }

  if (items.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Nao foi possivel calcular o frete para um carrinho vazio."
    });
  }

  try {
    const quote = await requestShippingQuote({
      destinationPostalCode,
      items,
      packageOverride
    });
    const options = Array.isArray(quote.options) ? quote.options : [];

    if (options.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Nenhuma opcao de frete foi encontrada para esse CEP.",
        options: []
      });
    }

    return res.status(200).json({
      ok: true,
      provider: quote.provider,
      options
    });
  } catch (error) {
    console.error("[vercel.shipping.quote]", error);
    const credentialError = isShippingProviderCredentialError(error);
    return res.status(credentialError ? 503 : 502).json({
      ok: false,
      code: credentialError ? "SHIPPING_CREDENTIAL_EXPIRED" : "SHIPPING_PROVIDER_ERROR",
      error: credentialError
        ? "A conexao de frete precisa ser renovada pelo administrador."
        : "A transportadora nao respondeu agora. Tente novamente em alguns instantes."
    });
  }
}
