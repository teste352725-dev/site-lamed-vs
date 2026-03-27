import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

class InfinitePayRequestError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "InfinitePayRequestError";
    this.status = status;
    Object.assign(this, details);
  }
}

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return sanitizePlainText(value, 120).toLowerCase();
}

function normalizePhone(value) {
  return String(value ?? "")
    .replace(/[^\d+]/g, "")
    .slice(0, 20);
}

function normalizePostalCode(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function roundCurrency(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toCents(value) {
  return Math.round(roundCurrency(value) * 100);
}

function normalizeInfinitePayWebhookEvent(payload) {
  if (!payload || typeof payload !== "object") return {};

  const direct = payload;
  const nested = [
    payload?.data,
    payload?.invoice,
    payload?.payment,
    payload?.invoice?.payment,
    payload?.data?.invoice,
    payload?.data?.payment
  ].find((entry) => entry && typeof entry === "object");

  return {
    ...direct,
    ...(nested || {})
  };
}

function normalizeInfinitePayWebhookStatus(value) {
  const normalized = sanitizePlainText(value, 40).toLowerCase();
  if (!normalized) return "";

  if (["paid", "approved", "completed", "complete", "authorized", "succeeded", "success"].includes(normalized)) {
    return "paid";
  }

  if (["pending", "waiting_payment", "awaiting_payment", "created"].includes(normalized)) {
    return "pending";
  }

  if (["failed", "canceled", "cancelled", "refunded", "chargeback"].includes(normalized)) {
    return normalized;
  }

  return normalized;
}

export function getInfinitePayHandle() {
  return sanitizePlainText(process.env.INFINITEPAY_HANDLE || process.env.INFINITEPAY_TAG, 80)
    .replace(/^\$/, "")
    .toLowerCase();
}

export function isInfinitePayConfigured() {
  return Boolean(getInfinitePayHandle());
}

export function getInfinitePayHealth() {
  return {
    ok: isInfinitePayConfigured() && Boolean(getInfinitePayWebhookSecret()),
    handleConfigured: Boolean(getInfinitePayHandle()),
    webhookSecretConfigured: Boolean(getInfinitePayWebhookSecret()),
    apiBaseUrl: getInfinitePayApiBaseUrl()
  };
}

function getInfinitePayApiBaseUrl() {
  return String(process.env.INFINITEPAY_API_BASE_URL || "https://api.infinitepay.io").replace(/\/+$/, "");
}

function getInfinitePayWebhookSecret() {
  return sanitizePlainText(process.env.INFINITEPAY_WEBHOOK_SECRET, 160);
}

function resolvePublicSiteBaseUrl(requestMeta = {}) {
  const explicit = String(
    process.env.PUBLIC_SITE_URL ||
    process.env.WEB_PUSH_CLICK_BASE_URL ||
    requestMeta.publicBaseUrl ||
    ""
  ).trim();

  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const origin = String(requestMeta.origin || "").trim();
  if (origin) {
    try {
      return new URL(origin).origin.replace(/\/+$/, "");
    } catch (error) {}
  }

  const host = sanitizePlainText(requestMeta.host || "", 180);
  const protocol = sanitizePlainText(requestMeta.protocol || "https", 10).toLowerCase() || "https";
  if (host) {
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  return "https://www.lamedvs.com.br";
}

function buildInfinitePayRedirectUrl(orderId, requestMeta = {}) {
  const baseUrl = resolvePublicSiteBaseUrl(requestMeta);
  return `${baseUrl}/minha-conta.html?pedido=${encodeURIComponent(orderId)}&gateway=infinitepay#pedidos`;
}

function buildInfinitePayWebhookUrl(requestMeta = {}) {
  const baseUrl = resolvePublicSiteBaseUrl(requestMeta);
  const secret = getInfinitePayWebhookSecret();
  return `${baseUrl}/api/payments/infinitepay/webhook${secret ? `?token=${encodeURIComponent(secret)}` : ""}`;
}

function buildInfinitePayItems(produtos) {
  return (Array.isArray(produtos) ? produtos : []).map((item) => ({
    quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
    price: toCents(item?.preco || 0),
    description: sanitizePlainText(item?.nome, 120) || "Produto"
  })).filter((item) => item.price > 0);
}

function buildInfinitePayShippingItem(frete) {
  const price = toCents(frete?.price || 0);
  if (price <= 0) return null;

  const company = sanitizePlainText(frete?.company, 80);
  const name = sanitizePlainText(frete?.name, 120);
  const description = [company, name].filter(Boolean).join(" - ") || "Frete";

  return {
    quantity: 1,
    price,
    description: sanitizePlainText(`Frete ${description}`, 120)
  };
}

function buildInfinitePayCustomer(cliente) {
  const name = sanitizePlainText(cliente?.nome, 120);
  const email = normalizeEmail(cliente?.email);
  const phone = normalizePhone(cliente?.telefone);

  if (!name && !email && !phone) return undefined;

  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone_number: phone } : {})
  };
}

function buildInfinitePayAddress(cliente) {
  const endereco = cliente?.endereco || {};
  const cep = normalizePostalCode(endereco?.cep);
  const street = sanitizePlainText(endereco?.rua, 140);
  const number = sanitizePlainText(endereco?.numero, 40);
  const neighborhood = sanitizePlainText(endereco?.bairro, 80);
  const complement = sanitizePlainText(endereco?.complemento, 80);

  if (!cep && !street && !number && !neighborhood && !complement) return undefined;

  return {
    ...(cep ? { cep } : {}),
    ...(street ? { street } : {}),
    ...(neighborhood ? { neighborhood } : {}),
    ...(number ? { number } : {}),
    ...(complement ? { complement } : {})
  };
}

function extractInfinitePayCheckoutUrl(payload) {
  const candidates = [
    payload?.url,
    payload?.checkout_url,
    payload?.checkoutUrl,
    payload?.link,
    payload?.data?.url,
    payload?.data?.checkout_url,
    payload?.data?.checkoutUrl,
    payload?.data?.link
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
  }

  return "";
}

export async function createInfinitePayCheckoutLink({ orderId, pedido, requestMeta = {} }) {
  if (!isInfinitePayConfigured()) {
    throw new InfinitePayRequestError(503, "InfinitePay nao configurada neste ambiente.");
  }

  if (!getInfinitePayWebhookSecret()) {
    throw new InfinitePayRequestError(503, "Configure INFINITEPAY_WEBHOOK_SECRET antes de ativar a InfinitePay.");
  }

  const items = buildInfinitePayItems(pedido?.produtos);
  const shippingItem = buildInfinitePayShippingItem(pedido?.frete);
  if (shippingItem) items.push(shippingItem);
  if (items.length === 0) {
    throw new InfinitePayRequestError(400, "Nao foi possivel gerar o checkout sem itens validos.");
  }

  const payload = {
    handle: getInfinitePayHandle(),
    items,
    order_nsu: orderId,
    redirect_url: buildInfinitePayRedirectUrl(orderId, requestMeta),
    webhook_url: buildInfinitePayWebhookUrl(requestMeta)
  };

  const customer = buildInfinitePayCustomer(pedido?.cliente);
  if (customer) payload.customer = customer;

  const address = buildInfinitePayAddress(pedido?.cliente);
  if (address) payload.address = address;

  const response = await fetch(`${getInfinitePayApiBaseUrl()}/invoices/public/checkout/links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responsePayload = await response.json().catch(() => null);
  const checkoutUrl = extractInfinitePayCheckoutUrl(responsePayload);

  if (!response.ok || !checkoutUrl) {
    throw new InfinitePayRequestError(
      502,
      sanitizePlainText(responsePayload?.message || responsePayload?.error || "Nao foi possivel gerar o checkout InfinitePay.", 220),
      { providerPayload: responsePayload }
    );
  }

  return {
    provider: "infinitepay",
    handle: payload.handle,
    orderNsu: orderId,
    checkoutUrl,
    redirectUrl: payload.redirect_url,
    webhookUrl: payload.webhook_url,
    rawResponse: responsePayload
  };
}

function normalizeWebhookToken(rawValue) {
  return sanitizePlainText(rawValue, 160);
}

export function assertInfinitePayWebhookAccess(req) {
  const expectedToken = getInfinitePayWebhookSecret();
  if (!expectedToken) {
    throw new InfinitePayRequestError(503, "Webhook InfinitePay indisponivel sem INFINITEPAY_WEBHOOK_SECRET configurado.");
  }

  const providedToken = normalizeWebhookToken(req?.query?.token || req?.headers?.["x-webhook-token"] || req?.headers?.["x-infinitepay-token"]);
  if (!providedToken || providedToken !== expectedToken) {
    throw new InfinitePayRequestError(403, "Webhook InfinitePay nao autorizado.");
  }
}

function normalizeInfinitePayCaptureMethod(value) {
  const normalized = sanitizePlainText(value, 40).toLowerCase();
  if (normalized === "pix") return "pix";
  if (normalized === "credit_card") return "credit_card";
  return normalized || "desconhecido";
}

function buildPaymentSummaryUpdate(order, payload) {
  const amount = Number(payload?.amount || payload?.paid_amount || payload?.total_amount || 0);
  const totalInCents = toCents(order?.total || 0);

  if (amount > 0 && totalInCents > 0 && amount !== totalInCents) {
    throw new InfinitePayRequestError(400, "O valor confirmado pela InfinitePay nao corresponde ao total do pedido.");
  }

  return {
    paymentGateway: "infinitepay",
    paymentStatus: "paid",
    payment: {
      gateway: "infinitepay",
      status: "paid",
      invoiceSlug: sanitizePlainText(payload?.invoice_slug || payload?.slug, 120),
      transactionNsu: sanitizePlainText(payload?.transaction_nsu, 120),
      captureMethod: normalizeInfinitePayCaptureMethod(payload?.capture_method),
      amount: amount > 0 ? roundCurrency(amount / 100) : roundCurrency(order?.total || 0),
      paidAmount: Number(payload?.paid_amount || 0) > 0 ? roundCurrency(Number(payload.paid_amount) / 100) : roundCurrency(order?.total || 0),
      installments: Math.max(1, parseInt(payload?.installments, 10) || 1),
      receiptUrl: sanitizePlainText(payload?.receipt_url, 500),
      updatedAt: new Date().toISOString()
    }
  };
}

export async function applyInfinitePayWebhook(payload, db = getAdminDb()) {
  const normalizedPayload = normalizeInfinitePayWebhookEvent(payload);
  const normalizedStatus = normalizeInfinitePayWebhookStatus(
    normalizedPayload?.status || normalizedPayload?.payment_status || normalizedPayload?.invoice_status || normalizedPayload?.event
  );

  if (normalizedStatus && normalizedStatus !== "paid") {
    return {
      ok: true,
      ignored: true,
      paymentStatus: normalizedStatus
    };
  }

  const orderId = sanitizePlainText(
    normalizedPayload?.order_nsu ||
    normalizedPayload?.external_reference ||
    normalizedPayload?.metadata?.order_nsu,
    120
  );
  if (!orderId) {
    throw new InfinitePayRequestError(400, "Webhook InfinitePay sem order_nsu.");
  }

  const orderRef = db.collection("pedidos").doc(orderId);
  const snapshot = await orderRef.get();
  if (!snapshot.exists) {
    throw new InfinitePayRequestError(404, "Pedido nao encontrado para este webhook.");
  }

  const order = snapshot.data() || {};
  const paymentUpdate = buildPaymentSummaryUpdate(order, normalizedPayload);

  const nextStatus = sanitizePlainText(order?.status, 20).toLowerCase() === "pendente"
    ? "processando"
    : sanitizePlainText(order?.status, 20) || "processando";

  await orderRef.set({
    paymentGateway: paymentUpdate.paymentGateway,
    paymentStatus: paymentUpdate.paymentStatus,
    payment: paymentUpdate.payment,
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    orderId,
    paymentStatus: "paid",
    status: nextStatus
  };
}

export function isInfinitePayRequestError(error) {
  return error instanceof InfinitePayRequestError;
}
