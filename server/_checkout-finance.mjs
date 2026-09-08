export const PIX_PRODUCT_DISCOUNT_BASIS_POINTS = 0;

function clampInteger(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

export function moneyToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100);
}

export function centsToMoney(value) {
  return clampInteger(value, 0, Number.MAX_SAFE_INTEGER) / 100;
}

export function percentageToBasisPoints(value) {
  return clampInteger(Number(value) * 100, 0, 10_000);
}

export function applyDiscountBasisPoints(amountCents, discountBasisPoints = 0) {
  const safeAmount = clampInteger(amountCents, 0, Number.MAX_SAFE_INTEGER);
  const safeDiscount = clampInteger(discountBasisPoints, 0, 10_000);
  return Math.round((safeAmount * (10_000 - safeDiscount)) / 10_000);
}

export function getCatalogUnitPriceCents(product) {
  const listPriceCents = moneyToCents(product?.preco);
  const catalogDiscountBasisPoints = percentageToBasisPoints(product?.desconto);
  return applyDiscountBasisPoints(listPriceCents, catalogDiscountBasisPoints);
}

export function isSafePixProductDiscountEnabled() {
  // Desconto adicional por forma de pagamento foi retirado.
  // Promocoes do catalogo continuam sendo calculadas pelo campo `desconto` da peca.
  return false;
}

export function calculateCheckoutAmounts({
  products,
  shippingCents = 0,
  applyPixProductDiscount = false
} = {}) {
  const safeShippingCents = clampInteger(shippingCents, 0, Number.MAX_SAFE_INTEGER);
  let productSubtotalCents = 0;
  let productChargeCents = 0;

  const productLines = (Array.isArray(products) ? products : []).map((item) => {
    const quantity = clampInteger(item?.quantity || 1, 1, 99);
    const unitPriceCents = clampInteger(
      item?.precoCentavos ?? moneyToCents(item?.preco),
      0,
      Number.MAX_SAFE_INTEGER
    );
    // Mantem o parametro por compatibilidade com clientes antigos, mas nao aplica
    // abatimento extra por Pix. O valor cobrado e sempre o preco do catalogo.
    const chargedUnitPriceCents = unitPriceCents;

    productSubtotalCents += unitPriceCents * quantity;
    productChargeCents += chargedUnitPriceCents * quantity;

    return {
      ...item,
      quantity,
      precoCentavos: unitPriceCents,
      preco: centsToMoney(unitPriceCents),
      precoCobrancaCentavos: chargedUnitPriceCents,
      precoCobranca: centsToMoney(chargedUnitPriceCents)
    };
  });

  const pixDiscountCents = 0;
  const totalCents = productChargeCents + safeShippingCents;

  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError("Total financeiro fora do limite seguro.");
  }

  return {
    productLines,
    productSubtotalCents,
    productChargeCents,
    pixDiscountCents,
    shippingCents: safeShippingCents,
    totalCents
  };
}

export function sumChargeItemsCents(items) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => {
    const quantity = clampInteger(item?.quantity || 1, 1, 99);
    const price = clampInteger(item?.price, 0, Number.MAX_SAFE_INTEGER);
    return total + (quantity * price);
  }, 0);
}
