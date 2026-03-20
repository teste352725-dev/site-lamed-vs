import {
  getRequestBody,
  normalizePostalCode,
  normalizeQuoteOptions,
  requestMelhorEnvioQuote,
  setNoStore
} from "../_shipping.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  const body = getRequestBody(req);
  const destinationPostalCode = normalizePostalCode(body?.postalCode);
  const items = Array.isArray(body?.cart) ? body.cart : [];

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
    const quote = await requestMelhorEnvioQuote({
      destinationPostalCode,
      items
    });

    const options = normalizeQuoteOptions(
      quote.options,
      quote.originPostalCode,
      destinationPostalCode
    );

    if (options.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Nenhuma opcao de frete foi encontrada para esse CEP.",
        options: []
      });
    }

    return res.status(200).json({
      ok: true,
      provider: "melhor_envio",
      options
    });
  } catch (error) {
    console.error("[vercel.shipping.quote]", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || "Erro ao consultar o Melhor Envio.")
    });
  }
}
