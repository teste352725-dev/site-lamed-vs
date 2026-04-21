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

const CORREIOS_SERVICE_NAME_MAP = {
  "03042": "SEDEX Contrato Grande Formato",
  "03050": "SEDEX Contrato AG",
  "03069": "SEDEX Contrato Pagamento na Entrega",
  "03085": "PAC Contrato AG",
  "03093": "PAC Contrato Pagamento na Entrega",
  "03107": "PAC Contrato Grande Formato",
  "03220": "SEDEX",
  "03298": "PAC",
  "04162": "SEDEX",
  "04669": "PAC",
  "04740": "SEDEX 10",
  "05691": "SEDEX 12",
  "05703": "SEDEX Hoje"
};

export function getShippingProvider() {
  const normalized = String(process.env.SHIPPING_PROVIDER || "melhor_envio")
    .trim()
    .toLowerCase();

  return normalized === "correios" ? "correios" : "melhor_envio";
}

export function isShippingApiEnabled() {
  return String(process.env.SHIPPING_API_ENABLED || "false")
    .trim()
    .toLowerCase() === "true";
}

export function getMelhorEnvioBaseUrl() {
  return String(process.env.MELHOR_ENVIO_BASE_URL || "https://www.melhorenvio.com.br").replace(/\/+$/, "");
}

export function getMelhorEnvioServices() {
  return String(process.env.MELHOR_ENVIO_SERVICES || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
}

export function getCorreiosBaseUrl() {
  return String(process.env.CORREIOS_BASE_URL || "https://api.correios.com.br").replace(/\/+$/, "");
}

export function getCorreiosServiceCodes() {
  return String(process.env.CORREIOS_SERVICE_CODES || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
}

export function getCorreiosContract() {
  return String(process.env.CORREIOS_CONTRACT || "").trim();
}

export function getCorreiosPostageCard() {
  return String(process.env.CORREIOS_POSTAGE_CARD || "").trim();
}

export function getCorreiosRegionalCode() {
  const rawValue = String(process.env.CORREIOS_DR || "").trim();
  if (!rawValue) return null;

  const numeric = parseInt(rawValue, 10);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
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

function parseCorreiosCurrency(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? roundCurrency(numeric) : null;
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

function getPackageOverride(volume) {
  if (!volume || typeof volume !== "object") return null;

  const peso = toPositiveNumber(volume.peso ?? volume.weight, 3);
  const largura = toPositiveNumber(volume.largura ?? volume.width, 0);
  const altura = toPositiveNumber(volume.altura ?? volume.height, 0);
  const comprimento = toPositiveNumber(volume.comprimento ?? volume.length, 0);
  const insurance = toPositiveNumber(
    volume.insuranceValue ?? volume.insurance ?? volume.insurance_value ?? 1,
    2
  ) || 1;
  const format = String(volume.formato || volume.format || "box").trim().toLowerCase();

  if (!peso || !largura || !altura || !comprimento) return null;

  return {
    format: format === "envelope" ? "envelope" : "box",
    weight: peso,
    width: largura,
    height: altura,
    length: comprimento,
    insurance,
    insurance_value: insurance
  };
}

function formatCorreiosDate(value = new Date()) {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  return `${day}/${month}/${year}`;
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

function buildAggregatePackage(items) {
  const products = buildQuoteProducts(items);

  return products.reduce((acc, item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    acc.weight = roundCurrency(acc.weight + (Number(item.weight || 0) * quantity));
    acc.width = Math.max(acc.width, Number(item.width || 0));
    acc.length = Math.max(acc.length, Number(item.length || 0));
    acc.height += Math.max(1, Number(item.height || 0)) * quantity;
    acc.insurance = roundCurrency(acc.insurance + ((Number(item.insurance_value || 0) || 1) * quantity));
    return acc;
  }, {
    weight: 0,
    width: 0,
    length: 0,
    height: 0,
    insurance: 0
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

export function isShippingProviderCredentialError(error) {
  const safeMessage = String(error?.message || error || "").toLowerCase();
  return safeMessage.includes("token has been revoked") ||
    safeMessage.includes("acesso nao autorizado") ||
    safeMessage.includes("acesso não autorizado") ||
    safeMessage.includes("unauthorized") ||
    safeMessage.includes("forbidden") ||
    safeMessage.includes("api restrita") ||
    safeMessage.includes("token expirado") ||
    safeMessage.includes("token invalido");
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

export async function requestMelhorEnvioQuote({ destinationPostalCode, items, packageOverride = null }) {
  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const userAgent = String(process.env.MELHOR_ENVIO_USER_AGENT || "Studio Lamed (contato@lamed.com.br)").trim();

  if (originPostalCode.length !== 8) {
    throw new Error("Configure MELHOR_ENVIO_ORIGIN_POSTAL_CODE com um CEP de origem valido.");
  }

  const services = getMelhorEnvioServices();
  const products = buildQuoteProducts(items);
  const basePayload = {
    from: { postal_code: originPostalCode },
    to: { postal_code: destinationPostalCode },
    options: {
      receipt: false,
      own_hand: false,
      collect: false
    }
  };

  const manualVolume = getPackageOverride(packageOverride);
  const payloadAttempts = manualVolume
    ? [
        { ...basePayload, volumes: [manualVolume] },
        { ...basePayload, packages: [manualVolume] }
      ]
    : [
        { ...basePayload, products }
      ];

  payloadAttempts.forEach((payload) => {
    if (services.length > 0) {
      payload.services = services.join(",");
    }
  });

  async function sendQuoteRequest(accessToken, payload) {
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
    let lastFailure = null;

    for (const payload of payloadAttempts) {
      let { response, data } = await sendQuoteRequest(accessToken, payload);

      if (response.status === 401 && String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim()) {
        accessToken = await getMelhorEnvioAccessToken({ forceRefresh: true });
        ({ response, data } = await sendQuoteRequest(accessToken, payload));
      }

      if (response.ok) {
        return {
          originPostalCode,
          options: Array.isArray(data) ? data : []
        };
      }

      lastFailure = { response, data };
    }

    throw new Error(extractMelhorEnvioError(lastFailure?.data, lastFailure?.response?.status || 500));
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A cotacao demorou demais para responder. Tente novamente.");
    }

    throw error;
  }
}

async function fetchCorreiosJson(pathname, { method = "GET", body = null } = {}) {
  const accessToken = String(process.env.CORREIOS_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    throw new Error("Configure CORREIOS_ACCESS_TOKEN na Vercel.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${getCorreiosBaseUrl()}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (Array.isArray(payload?.msgs) && payload.msgs.length > 0 ? payload.msgs.join(" | ") : null) ||
        payload?.message ||
        payload?.mensagem ||
        payload?.msg ||
        payload?.error ||
        payload?.causa ||
        `Correios respondeu com status ${response.status}.`;
      throw new Error(String(message).slice(0, 220));
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A consulta aos Correios demorou demais para responder. Tente novamente.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCorreiosQuoteOptions(pricePayload, prazoPayload, originPostalCode, destinationPostalCode) {
  const priceOptions = Array.isArray(pricePayload) ? pricePayload : (pricePayload ? [pricePayload] : []);
  const deadlineOptions = Array.isArray(prazoPayload) ? prazoPayload : (prazoPayload ? [prazoPayload] : []);

  const deadlineByRequest = new Map();
  const deadlineByCode = new Map();

  deadlineOptions.forEach((option) => {
    const requestId = String(option?.nuRequisicao || "").trim();
    const code = String(option?.coProduto || "").trim();
    if (requestId) deadlineByRequest.set(requestId, option);
    if (code) deadlineByCode.set(code, option);
  });

  return priceOptions
    .map((option) => {
      const serviceCode = String(option?.coProduto || option?.codigoServico || "").trim();
      const requestId = String(option?.nuRequisicao || "").trim();
      const deadline = deadlineByRequest.get(requestId) || deadlineByCode.get(serviceCode) || null;
      const price = parseCorreiosCurrency(option?.pcFinal ?? option?.precoFinal ?? option?.valor);
      const originalPrice = parseCorreiosCurrency(option?.pcReferencia ?? option?.pcFinal ?? option?.valor);
      const deliveryTime = Math.max(1, parseInt(deadline?.prazoEntrega, 10) || 0);

      if (!serviceCode || !Number.isFinite(price) || price < 0 || deliveryTime < 1) {
        return null;
      }

      return {
        id: `correios:${serviceCode}`,
        serviceId: serviceCode,
        serviceCode,
        name: CORREIOS_SERVICE_NAME_MAP[serviceCode] || `Servico ${serviceCode}`,
        company: "Correios",
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

export async function requestCorreiosQuote({ destinationPostalCode, items, packageOverride = null }) {
  const originPostalCode = normalizePostalCode(process.env.CORREIOS_ORIGIN_POSTAL_CODE || process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  if (originPostalCode.length !== 8) {
    throw new Error("Configure CORREIOS_ORIGIN_POSTAL_CODE com um CEP de origem valido.");
  }

  const serviceCodes = getCorreiosServiceCodes();
  if (serviceCodes.length === 0) {
    throw new Error("Configure CORREIOS_SERVICE_CODES com os codigos do seu contrato.");
  }

  const objectType = String(process.env.CORREIOS_OBJECT_TYPE || "2").trim();
  const additionalServices = String(process.env.CORREIOS_ADDITIONAL_SERVICES || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
  const contract = getCorreiosContract();
  const regionalCode = getCorreiosRegionalCode();
  const contractFields =
    contract && regionalCode !== null
      ? {
          nuContrato: contract,
          nuDR: regionalCode
        }
      : {};

  const manualVolume = getPackageOverride(packageOverride);
  const packageProfile = manualVolume || buildAggregatePackage(items);
  const declaredValue = Math.max(1, Math.round(Number(packageProfile.insurance || 1)));

  const parametrosProduto = serviceCodes.map((serviceCode, index) => ({
    coProduto: serviceCode,
    nuRequisicao: String(index + 1),
    cepOrigem: originPostalCode,
    cepDestino: destinationPostalCode,
    psObjeto: String(Math.max(1, Math.round(Number(packageProfile.weight || 0) * 1000))),
    tpObjeto: objectType,
    comprimento: String(Math.max(1, Math.round(Number(packageProfile.length || 0)))),
    largura: String(Math.max(1, Math.round(Number(packageProfile.width || 0)))),
    altura: String(Math.max(1, Math.round(Number(packageProfile.height || 0)))),
    vlDeclarado: String(declaredValue),
    dtEvento: formatCorreiosDate(),
    ...contractFields,
    ...(additionalServices.length > 0
      ? { servicosAdicionais: additionalServices.map((code) => ({ coServAdicional: code })) }
      : {})
  }));

  const parametrosPrazo = serviceCodes.map((serviceCode, index) => ({
    coProduto: serviceCode,
    nuRequisicao: String(index + 1),
    cepOrigem: originPostalCode,
    cepDestino: destinationPostalCode,
    dtEvento: formatCorreiosDate()
  }));

  const [pricePayload, deadlinePayload] = await Promise.all([
    fetchCorreiosJson("/preco/v1/nacional", {
      method: "POST",
      body: {
        idLote: "1",
        parametrosProduto
      }
    }),
    fetchCorreiosJson("/prazo/v1/nacional", {
      method: "POST",
      body: {
        idLote: "1",
        parametrosPrazo
      }
    })
  ]);

  return {
    originPostalCode,
    options: normalizeCorreiosQuoteOptions(pricePayload, deadlinePayload, originPostalCode, destinationPostalCode)
  };
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

export async function requestShippingQuote({ destinationPostalCode, items, packageOverride = null }) {
  const provider = getShippingProvider();

  if (provider === "correios") {
    const quote = await requestCorreiosQuote({
      destinationPostalCode,
      items,
      packageOverride
    });

    return {
      provider,
      originPostalCode: quote.originPostalCode,
      options: quote.options
    };
  }

  const quote = await requestMelhorEnvioQuote({
    destinationPostalCode,
    items,
    packageOverride
  });

  return {
    provider,
    originPostalCode: quote.originPostalCode,
    options: normalizeQuoteOptions(quote.options, quote.originPostalCode, destinationPostalCode)
  };
}

export function getShippingHealth() {
  const provider = getShippingProvider();
  const enabled = isShippingApiEnabled();

  if (provider === "correios") {
    const originPostalCode = normalizePostalCode(process.env.CORREIOS_ORIGIN_POSTAL_CODE || process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
    const accessToken = String(process.env.CORREIOS_ACCESS_TOKEN || "").trim();
    const serviceCodes = getCorreiosServiceCodes();
    const regionalCode = getCorreiosRegionalCode();
    const contract = getCorreiosContract();
    const postageCard = getCorreiosPostageCard();

    return {
      ok: enabled && Boolean(accessToken) && originPostalCode.length === 8 && serviceCodes.length > 0,
      enabled,
      paused: !enabled,
      provider,
      baseUrl: getCorreiosBaseUrl(),
      originPostalCodeConfigured: originPostalCode.length === 8,
      accessTokenConfigured: Boolean(accessToken),
      refreshTokenConfigured: false,
      servicesConfigured: serviceCodes,
      contractConfigured: Boolean(contract),
      postageCardConfigured: Boolean(postageCard),
      regionalCodeConfigured: regionalCode !== null,
      contractFieldsApplied: Boolean(contract) && regionalCode !== null
    };
  }

  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE);
  const accessToken = String(process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();
  const refreshToken = String(process.env.MELHOR_ENVIO_REFRESH_TOKEN || "").trim();

  return {
    ok: enabled && Boolean(accessToken || refreshToken) && originPostalCode.length === 8,
    enabled,
    paused: !enabled,
    provider,
    baseUrl: getMelhorEnvioBaseUrl(),
    originPostalCodeConfigured: originPostalCode.length === 8,
    accessTokenConfigured: Boolean(accessToken),
    refreshTokenConfigured: Boolean(refreshToken),
    servicesConfigured: getMelhorEnvioServices()
  };
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
