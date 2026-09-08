import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDiscountBasisPoints,
  calculateCheckoutAmounts,
  getCatalogUnitPriceCents,
  isSafePixProductDiscountEnabled,
  moneyToCents,
  sumChargeItemsCents
} from "../server/_checkout-finance.mjs";

test("converte valores monetarios para centavos inteiros", () => {
  assert.equal(moneyToCents(519), 51_900);
  assert.equal(moneyToCents("30.45"), 3_045);
  assert.equal(moneyToCents(0.1 + 0.2), 30);
});

test("aplica desconto de catalogo por unidade em centavos", () => {
  assert.equal(getCatalogUnitPriceCents({ preco: 199.9, desconto: 10 }), 17_991);
});

test("checkout nao concede desconto adicional por Pix", () => {
  const result = calculateCheckoutAmounts({
    products: [
      { nome: "Peca A", precoCentavos: 10_000, quantity: 1 },
      { nome: "Peca B", precoCentavos: 3_333, quantity: 2 }
    ],
    shippingCents: 2_750,
    applyPixProductDiscount: true
  });

  assert.equal(result.productSubtotalCents, 16_666);
  assert.equal(result.productChargeCents, 16_666);
  assert.equal(result.pixDiscountCents, 0);
  assert.equal(result.shippingCents, 2_750);
  assert.equal(result.totalCents, 19_416);
  assert.equal(result.productLines[0].precoCobrancaCentavos, 10_000);
  assert.equal(result.productLines[1].precoCobrancaCentavos, 3_333);
});

test("desconto Pix permanece desativado independentemente das flags antigas", () => {
  assert.equal(isSafePixProductDiscountEnabled({}), false);
  assert.equal(isSafePixProductDiscountEnabled({ INFINITEPAY_PIX_PRODUCT_DISCOUNT_ENABLED: "true" }), false);
  assert.equal(isSafePixProductDiscountEnabled({ INFINITEPAY_CHECKOUT_PIX_ONLY: "true" }), false);
  assert.equal(isSafePixProductDiscountEnabled({
    INFINITEPAY_PIX_PRODUCT_DISCOUNT_ENABLED: "true",
    INFINITEPAY_CHECKOUT_PIX_ONLY: "true"
  }), false);
});

test("soma dos itens enviados precisa coincidir com o total", () => {
  assert.equal(sumChargeItemsCents([
    { price: 10_000, quantity: 1 },
    { price: 3_333, quantity: 2 },
    { price: 2_750, quantity: 1 }
  ]), 19_416);
  assert.equal(applyDiscountBasisPoints(10_000, 500), 9_500);
});
