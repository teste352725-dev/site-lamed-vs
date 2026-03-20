const DEFAULT_SHIPPING_PROFILES = {
  vestido: { peso: 0.7, largura: 28, altura: 6, comprimento: 35 },
  conjunto: { peso: 0.95, largura: 30, altura: 8, comprimento: 36 },
  calca: { peso: 0.65, largura: 28, altura: 6, comprimento: 34 },
  camisa: { peso: 0.45, largura: 26, altura: 5, comprimento: 33 },
  saia: { peso: 0.45, largura: 26, altura: 5, comprimento: 32 },
  blusa: { peso: 0.35, largura: 24, altura: 4, comprimento: 30 },
  mesa_posta: { peso: 0.5, largura: 28, altura: 4, comprimento: 30 },
  lugar_americano: { peso: 0.42, largura: 28, altura: 3, comprimento: 30 },
  guardanapo: { peso: 0.12, largura: 16, altura: 2, comprimento: 16 },
  anel_guardanapo: { peso: 0.08, largura: 12, altura: 4, comprimento: 12 },
  porta_guardanapo: { peso: 0.08, largura: 12, altura: 4, comprimento: 12 },
  trilho_velas: { peso: 0.3, largura: 16, altura: 3, comprimento: 25 },
  caminho_mesa: { peso: 0.62, largura: 20, altura: 5, comprimento: 38 },
  capa_de_matza: { peso: 0.18, largura: 18, altura: 3, comprimento: 22 },
  outros: { peso: 0.4, largura: 24, altura: 5, comprimento: 28 },
  combo: { peso: 1.2, largura: 35, altura: 10, comprimento: 38 }
};

let cachedAccessToken = "";
let cachedRefreshToken = "";
let refreshPromise = null;

export function getMelhorEnvioBaseUrl() {
  return String(process.env.MELHOR_ENVIO_BASE_URL || "https://www.melhorenvio.com.br").replace(/\/+$/, "");
}

export function getMelhorEnvioServices() {
  return String(process.env.MELHOR_ENVIO_SERVICES || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
}

export function normalizePostalCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function normalizeCategory(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toPositiveNumber(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getConfiguredShippingProfile(profile) {
  if (!profile || typeof profile !== "object") return null;

  const peso = toPositiveNumber(profile.peso, 3);
  const largura = toPositiveNumber(profile.largura, 0);
  const altura = toPositiveNumber(profile.altura, 0);
  const comprimento = toPositiveNumber(profile.comprimento, 0);

  if (!peso || !largura || !altura || !comprimento) return null;

  return { peso, largura, altura, comprimento };
}

function resolveShippingProfile(item) {
  const configured = getConfiguredShippingProfile(item?.frete);
  if (configured) return configured;

  const categoryKey = item?.isCombo === true ? "combo" : normalizeCategory(item?.categoria || "outros");
  return DEFAULT_SHIPPING_PROFILES[categoryKey] || DEFAULT_SHIPPING_PROFILES.outros;
}

function buildQuoteProducts(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("O carrinho enviado para cotacao esta vazio.");
  }

  return items.map((item, index) => {
    const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const price = roundCurrency(Number(item?.preco || 0));
    const profile = resolveShippingProfile(item);
    const productId = String(item?.id || item?.cartId || `item-${index + 1}`).slice(0, 120);

    return {
      id: productId,
      width: profile.largura,
      height: profile.altura,
      length: profile.comprimento,
      weight: profile.peso,
      insurance_value: price > 0 ? price : 1,
      quantity
    };
  });
}

function extractMelhorEnvioError(payload, status) {
  if (!payload) return `Melhor Envio respondeu com status ${status}.`;

  if (typeof payload === "string") {
    return payload.slice(0, 220);
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return payload.errors.map((item) => String(item)).join(" | ").slice(0, 220);
  }

  if (typeof payload?.hint === "string" && payload.hint.trim()) {
    return payload.hint.trim().slice(0, 220);
  }

  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim().slice(0, 220);
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim().slice(0, 220);
  }

  return `Melhor Envio respondeu com status ${status}.`;
}

async function refreshMelhorEnvioAccessToken() {
  const refreshToken = String(cachedRefreshToken || process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();
  const clientId = String(process.env.MELHOR_ENVIO_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MELHOR_ENVIO_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.MELHOR_ENVIO_REDIRECT_URI || "").trim();

  if (!refreshToken) {
    throw new Error("Configure MELHOR_ENVIO_REFRESH_TOKEN na Vercel.");
  }

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Configure MELHOR_ENVIO_CLIENT_ID, MELHOR_ENVIO_CLIENT_SECRET e MELHOR_ENVIO_REDIRECT_URI na Vercel.");
  }

  const response = await fetch(`${getMelhorEnvioBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      refresh_token: refreshToken
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractMelhorEnvioError(data, response.status));
  }

  const nextAccessToken = String(data?.access_token || "").trim();
  const nextRefreshToken = String(data?.refresh_token || refreshToken).trim();

  if (!nextAccessToken) {
    throw new Error("Melhor Envio nao retornou um access_token valido.");
  }

  cachedAccessToken = nextAccessToken;
  cachedRefreshToken = nextRefreshToken;
  return nextAccessToken;
}

async function getMelhorEnvioAccessToken({ forceRefresh = false } = {}) {
  const accessToken = String(cachedAccessToken || process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();
  const refreshToken = String(cachedRefreshToken || process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();

  if (accessToken && !forceRefresh) {
    return accessToken;
  }

  if (!refreshToken) {
    if (!accessToken) {
      throw new Error("Configure MELHOR_ENVIO_ACCESS_TOKEN ou MELHOR_ENVIO_REFRESH_TOKEN na Vercel.");
    }
    return accessToken;
  }

  if (!refreshPromise) {
    refreshPromise = refreshMelhorEnvioAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function requestMelhorEnvioQuote({ destinationPostalCode, items }) {
  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const userAgent = String(process.env.MELHOR_ENVIO_USER_AGENT || "Studio Lamed (contato@lamed.com.br)").trim();

  if (originPostalCode.length !== 8) {
    throw new Error("Configure MELHOR_ENVIO_ORIGIN_POSTAL_CODE com um CEP de origem valido.");
  }

  const products = buildQuoteProducts(items);
  const payload = {
    from: { postal_code: originPostalCode },
    to: { postal_code: destinationPostalCode },
    products,
    options: {
      receipt: false,
      own_hand: false,
      collect: false
    }
  };

  const services = getMelhorEnvioServices();
  if (services.length > 0) {
    payload.services = services.join(",");
  }

  async function sendQuoteRequest(accessToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${getMelhorEnvioBaseUrl()}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": userAgent
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);
      return { response, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let accessToken = await getMelhorEnvioAccessToken();
    let { response, data } = await sendQuoteRequest(accessToken);

    if (response.status === 401 && String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim()) {
      accessToken = await getMelhorEnvioAccessToken({ forceRefresh: true });
      ({ response, data } = await sendQuoteRequest(accessToken));
    }

    if (!response.ok) {
      throw new Error(extractMelhorEnvioError(data, response.status));
    }

    return {
      originPostalCode,
      options: Array.isArray(data) ? data : []
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A cotacao demorou demais para responder. Tente novamente.");
    }

    throw error;
  }
}

export function normalizeQuoteOptions(rawOptions, originPostalCode, destinationPostalCode) {
  return rawOptions
    .filter((option) => option && !option.error)
    .map((option) => {
      const price = roundCurrency(Number(option.custom_price ?? option.price ?? option.total ?? 0));
      const originalPrice = roundCurrency(Number(option.price ?? option.custom_price ?? price));
      const deliveryTime = Math.max(
        1,
        parseInt(option.custom_delivery_time ?? option.delivery_time ?? option.delivery_range?.max ?? 0, 10) || 0
      );
      const company = String(option.company?.name || option.company?.company_name || "Transportadora").trim();
      const name = String(option.name || option.service?.name || "Frete").trim();
      const serviceId = String(option.id ?? option.service?.id ?? name).trim();
      const serviceCode = String(option.service_code ?? option.id ?? serviceId).trim();

      if (!serviceId || !serviceCode || !name || !company || !Number.isFinite(price) || price < 0) {
        return null;
      }

      return {
        id: `${serviceCode}:${serviceId}`,
        serviceId,
        serviceCode,
        name,
        company,
        price,
        originalPrice: Number.isFinite(originalPrice) && originalPrice >= 0 ? originalPrice : price,
        deliveryTime,
        fromPostalCode: originPostalCode,
        toPostalCode: destinationPostalCode
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.price - second.price || first.deliveryTime - second.deliveryTime);
}

export function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
}

export function getRequestBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}
