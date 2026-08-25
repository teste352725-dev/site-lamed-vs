import { createHash } from "node:crypto";
import { FieldValue, getAdminAuth, getAdminDb, getFirebaseAdminStatus } from "./_firebase-admin.mjs";
import { clearUserCart } from "./_cart.mjs";
import {
  calculateCheckoutAmounts,
  centsToMoney,
  getCatalogUnitPriceCents,
  isSafePixProductDiscountEnabled,
  moneyToCents
} from "./_checkout-finance.mjs";
import { createInfinitePayCheckoutLink, isInfinitePayConfigured } from "./_infinitepay.mjs";
import { isShippingCheckoutEnabled, requestShippingQuote } from "./_shipping.mjs";
import { getStoreOperations, isPublicStorefrontBlocked } from "./_store-operations.mjs";

const DEFAULT_ORDER_PHONE = "5527999287657";
const FALLBACK_ORIGIN_POSTAL_CODE = "29056015";

class RequestError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    Object.assign(this, details);
  }
}

const MAX_CART_ITEMS = 50;
const DUPLICATE_ORDER_WINDOW_MS = 15 * 60 * 1000;

function sanitizePlainText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stripAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizePostalCode(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function normalizeDocument(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14);
}

function formatDocument(value) {
  const digits = normalizeDocument(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }

  return digits;
}

function sanitizeStateCode(value) {
  return sanitizePlainText(value, 2).replace(/[^a-z]/gi, "").toUpperCase();
}

function splitCityAndState(cityValue, stateValue = "") {
  const explicitState = sanitizeStateCode(stateValue);
  const rawCity = sanitizePlainText(cityValue, 120);

  if (!rawCity) {
    return {
      cidade: "",
      estado: explicitState
    };
  }

  if (explicitState) {
    return {
      cidade: rawCity.replace(/\s*[-/]\s*[A-Za-z]{2}$/u, "").trim(),
      estado: explicitState
    };
  }

  const match = rawCity.match(/^(.*?)(?:\s*[-/]\s*)([A-Za-z]{2})$/u);
  if (match) {
    return {
      cidade: sanitizePlainText(match[1], 120),
      estado: sanitizeStateCode(match[2])
    };
  }

  return {
    cidade: rawCity,
    estado: explicitState
  };
}

function sanitizeSavedAddressId(value, fallback = "") {
  const normalized = sanitizePlainText(value, 80)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback || "";
}

function extractAddressFields(address) {
  if (!address || typeof address !== "object") return null;

  const cityState = splitCityAndState(address.cidade, address.estado);
  const normalized = {
    rua: sanitizePlainText(address.rua, 140),
    numero: sanitizePlainText(address.numero, 40),
    complemento: sanitizePlainText(address.complemento, 120),
    bairro: sanitizePlainText(address.bairro, 80),
    cidade: cityState.cidade,
    estado: cityState.estado,
    cep: normalizePostalCode(address.cep)
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function buildAddressSignature(address) {
  const normalized = extractAddressFields(address);
  if (!normalized) return "";

  return [
    sanitizePlainText(normalized.rua, 140).toLowerCase(),
    sanitizePlainText(normalized.numero, 40).toLowerCase(),
    sanitizePlainText(normalized.complemento, 120).toLowerCase(),
    sanitizePlainText(normalized.bairro, 80).toLowerCase(),
    sanitizePlainText(normalized.cidade, 120).toLowerCase(),
    sanitizePlainText(normalized.estado, 2).toLowerCase(),
    normalizePostalCode(normalized.cep)
  ].join("|");
}

function normalizeSavedAddressEntry(address, index = 0) {
  const normalized = extractAddressFields(address);
  if (!normalized) return null;

  return {
    id: sanitizeSavedAddressId(address?.id, `address-${index + 1}`),
    label: sanitizePlainText(address?.label, 60),
    principal: address?.principal === true,
    ...normalized
  };
}

function normalizeSavedAddressBook(list, primaryAddress = null, primaryAddressId = "") {
  const sourceList = Array.isArray(list) ? list : [];
  const entries = sourceList
    .map((item, index) => normalizeSavedAddressEntry(item, index))
    .filter(Boolean)
    .slice(0, 10);

  const normalizedPrimary = extractAddressFields(primaryAddress);
  let selectedId = sanitizeSavedAddressId(primaryAddressId);

  if (!selectedId) {
    selectedId = entries.find((item) => item.principal)?.id || "";
  }

  if (normalizedPrimary) {
    const primarySignature = buildAddressSignature(normalizedPrimary);
    const matchingEntry = primarySignature
      ? entries.find((item) => buildAddressSignature(item) === primarySignature)
      : null;

    if (matchingEntry) {
      Object.assign(matchingEntry, normalizedPrimary);
    } else if (!entries.length) {
      selectedId = selectedId || "address-1";
      entries.unshift({
        id: selectedId,
        label: "Endereco principal",
        principal: true,
        ...normalizedPrimary
      });
    } else {
      entries.push({
        id: `address-${entries.length + 1}`,
        label: `Endereco salvo ${entries.length + 1}`,
        principal: false,
        ...normalizedPrimary
      });
    }
  }

  const normalizedEntries = entries
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      id: sanitizeSavedAddressId(item.id, `address-${index + 1}`),
      label: sanitizePlainText(item.label, 60),
      principal: false
    }));

  if (!selectedId) {
    selectedId = normalizedEntries[0]?.id || "";
  }

  const selectedEntry = normalizedEntries.find((item) => item.id === selectedId) || normalizedEntries[0] || null;

  if (selectedEntry) {
    selectedEntry.principal = true;
    if (!selectedEntry.label) {
      selectedEntry.label = "Endereco principal";
    }
  }

  normalizedEntries.forEach((item, index) => {
    if (!item.label) {
      item.label = item.principal ? "Endereco principal" : `Endereco salvo ${index + 1}`;
    }
  });

  return {
    enderecos: normalizedEntries,
    enderecoPrincipalId: selectedEntry?.id || null,
    endereco: extractAddressFields(selectedEntry) || normalizedPrimary || null
  };
}

function formatPostalCode(value) {
  const digits = normalizePostalCode(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "https://www.lamedvs.com.br/");
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function sanitizeHexColor(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "#000000";
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{3,8}$/.test(normalized) ? normalized : "#000000";
}

function getPaymentKey(value) {
  return stripAccents(sanitizePlainText(value, 40)).toLowerCase();
}

function normalizeShippingProfile(profile) {
  if (!profile || typeof profile !== "object") return null;

  const peso = roundCurrency(Number(profile.peso));
  const largura = Math.max(1, parseInt(profile.largura, 10) || 0);
  const altura = Math.max(1, parseInt(profile.altura, 10) || 0);
  const comprimento = Math.max(1, parseInt(profile.comprimento, 10) || 0);

  if (!Number.isFinite(peso) || peso <= 0 || !largura || !altura || !comprimento) {
    return null;
  }

  return {
    peso: Math.round((peso + Number.EPSILON) * 1000) / 1000,
    largura,
    altura,
    comprimento
  };
}

function normalizeColorSelection(color) {
  if (!color || typeof color !== "object") return null;
  const nome = sanitizePlainText(color.nome, 40);
  if (!nome) return null;

  return {
    nome,
    hex: sanitizeHexColor(color.hex)
  };
}

function normalizePersonalization(input) {
  if (!input || typeof input !== "object") return null;

  const texto = sanitizePlainText(input.texto, 120);
  const observacoes = sanitizePlainText(input.observacoes, 280);

  if (!texto && !observacoes) return null;

  return {
    texto,
    observacoes
  };
}

function normalizeComboSelections(input) {
  if (!input || typeof input !== "object") return {};

  return Object.entries(input).reduce((acc, [key, value]) => {
    const idx = parseInt(key, 10);
    if (!Number.isInteger(idx) || idx < 0 || !value || typeof value !== "object") return acc;

    const nextValue = {};
    const safeColor = normalizeColorSelection(value.cor);
    const safeSize = sanitizePlainText(value.tamanho, 20);

    if (safeColor) nextValue.cor = safeColor;
    if (safeSize) nextValue.tamanho = safeSize;
    if (Object.keys(nextValue).length > 0) acc[idx] = nextValue;
    return acc;
  }, {});
}

function sanitizeCartItem(item) {
  if (!item || typeof item !== "object") return null;

  const cartId = sanitizePlainText(item.cartId, 120);
  const nome = sanitizePlainText(item.nome, 120);
  const preco = roundCurrency(Number(item.preco));
  const quantity = Math.max(1, Math.min(99, parseInt(item.quantity, 10) || 0));

  if (!cartId || !nome || !Number.isFinite(preco) || preco < 0 || quantity < 1) return null;

  return {
    cartId,
    id: sanitizePlainText(item.id, 120),
    categoria: sanitizePlainText(item.categoria, 40),
    nome,
    preco,
    imagem: normalizeUrl(item.imagem),
    frete: normalizeShippingProfile(item.frete),
    tamanho: sanitizePlainText(item.tamanho, 20),
    cor: normalizeColorSelection(item.cor),
    quantity,
    isCombo: item.isCombo === true,
    componentes: Array.isArray(item.componentes)
      ? item.componentes.map((comp) => ({
          id: sanitizePlainText(comp?.id, 120),
          nome: sanitizePlainText(comp?.nome, 120),
          quantidade: Math.max(1, parseInt(comp?.quantidade, 10) || 1),
          categoria: sanitizePlainText(comp?.categoria, 40)
        }))
      : null,
    comboSelections: normalizeComboSelections(item.comboSelections),
    personalizacao: normalizePersonalization(item.personalizacao)
  };
}

function normalizeSizeLabel(value) {
  const safe = sanitizePlainText(value, 20);
  if (!safe) return "";

  const upper = stripAccents(safe).toUpperCase();
  if (upper === "UNICO") return "Unico";
  if (["PP", "P", "M", "G", "GG", "COMBO"].includes(upper)) return upper;
  return safe;
}

function isRoupaCategory(categoria) {
  const normalized = stripAccents(sanitizePlainText(categoria, 40)).toLowerCase();
  return ["vestido", "conjunto", "calca", "camisa", "saia", "blusa"].includes(normalized);
}

function checkIsMesaPosta(categoria) {
  return [
    "mesa_posta",
    "lugar_americano",
    "guardanapo",
    "caminho_mesa",
    "anel_guardanapo",
    "porta_guardanapo",
    "trilho_velas",
    "capa_de_matza"
  ].includes(sanitizePlainText(categoria, 40));
}

function isSudeste(cep) {
  const cepClean = normalizePostalCode(cep);
  if (cepClean.length !== 8) return false;
  const prefix = parseInt(cepClean.slice(0, 2), 10);
  return prefix >= 1 && prefix <= 39;
}

function isHanukahProduct(item) {
  const term = stripAccents(String(item?.nome || "")).toLowerCase();
  return term.includes("hanukah") || term.includes("chanukia") || term.includes("chanuka") || term.includes("judaica");
}

function getDiscountedProductPrice(product) {
  return centsToMoney(getCatalogUnitPriceCents(product));
}

function normalizeShippingSelection(selection) {
  if (!selection || typeof selection !== "object") return null;

  const id = sanitizePlainText(selection.id || selection.serviceCode || selection.serviceId, 120);
  const serviceId = sanitizePlainText(selection.serviceId || selection.id, 120);
  const serviceCode = sanitizePlainText(selection.serviceCode || selection.id, 120);
  const name = sanitizePlainText(selection.name, 120);
  const company = sanitizePlainText(selection.company, 80);
  const numericPrice = Number(selection.price);
  const numericOriginalPrice = Number(selection.originalPrice ?? selection.price);
  const priceCents = moneyToCents(numericPrice);
  const originalPriceCents = moneyToCents(numericOriginalPrice);
  const deliveryTime = Math.max(1, parseInt(selection.deliveryTime, 10) || 0);
  const fromPostalCode = normalizePostalCode(selection.fromPostalCode);
  const toPostalCode = normalizePostalCode(selection.toPostalCode);

  if (!id || !serviceId || !serviceCode || !name || !company || !Number.isFinite(numericPrice) || numericPrice < 0) {
    return null;
  }

  if (!Number.isFinite(numericOriginalPrice) || numericOriginalPrice < 0 || deliveryTime < 1) {
    return null;
  }

  return {
    id,
    serviceId,
    serviceCode,
    name,
    company,
    price: centsToMoney(priceCents),
    priceCents,
    originalPrice: centsToMoney(originalPriceCents),
    originalPriceCents,
    deliveryTime,
    fromPostalCode,
    toPostalCode
  };
}

function calculateCheckoutTotals(cartItems, shippingSelection = null, { applyPixProductDiscount = false } = {}) {
  const safeShipping = normalizeShippingSelection(shippingSelection);
  const finance = calculateCheckoutAmounts({
    products: cartItems,
    shippingCents: safeShipping?.priceCents || 0,
    applyPixProductDiscount
  });

  return {
    productLines: finance.productLines,
    subtotal: centsToMoney(finance.productSubtotalCents),
    subtotalCents: finance.productSubtotalCents,
    productCharge: centsToMoney(finance.productChargeCents),
    productChargeCents: finance.productChargeCents,
    pixDiscount: centsToMoney(finance.pixDiscountCents),
    pixDiscountCents: finance.pixDiscountCents,
    cardFee: 0,
    cardFeeCents: 0,
    shippingCost: centsToMoney(finance.shippingCents),
    shippingCostCents: finance.shippingCents,
    shippingOriginal: safeShipping?.originalPrice || 0,
    shippingOriginalCents: safeShipping?.originalPriceCents || 0,
    shippingDiscount: 0,
    shippingDiscountCents: 0,
    final: centsToMoney(finance.totalCents),
    totalCents: finance.totalCents,
    freeShipping: false,
    freeShippingEligible: false
  };
}

function buildManualShippingSelection(destinationCep = "") {
  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE) || FALLBACK_ORIGIN_POSTAL_CODE;
  const normalizedDestinationCep = normalizePostalCode(destinationCep) || originPostalCode;

  return {
    id: "manual-pendente",
    serviceId: "manual-pendente",
    serviceCode: "manual-pendente",
    name: "Frete definido após o pedido",
    company: "A combinar",
    price: 0,
    priceCents: 0,
    originalPrice: 0,
    originalPriceCents: 0,
    deliveryTime: 1,
    quotedAt: new Date().toISOString(),
    fromPostalCode: originPostalCode,
    toPostalCode: normalizedDestinationCep,
    freeShippingApplied: false
  };
}

async function resolveOrderShippingSelection(cliente, canonicalCart, submittedShipping, { requireQuotedShipping = false } = {}) {
  if (!isShippingCheckoutEnabled()) {
    if (requireQuotedShipping) {
      throw new RequestError(503, "O pagamento integrado com frete esta em homologacao. Continue pelo WhatsApp neste ambiente.", {
        code: "SHIPPING_PREVIEW_ONLY"
      });
    }
    return buildManualShippingSelection(cliente?.endereco?.cep);
  }

  const normalizedSelection = normalizeShippingSelection(submittedShipping);
  if (!normalizedSelection) {
    if (requireQuotedShipping) {
      throw new RequestError(400, "Calcule e escolha uma opcao de entrega antes de pagar com a InfinitePay.", {
        code: "SHIPPING_SELECTION_REQUIRED"
      });
    }
    return buildManualShippingSelection(cliente?.endereco?.cep);
  }

  let quote;
  try {
    quote = await requestShippingQuote({
      destinationPostalCode: cliente?.endereco?.cep,
      items: canonicalCart
    });
  } catch (error) {
    if (!requireQuotedShipping) {
      return buildManualShippingSelection(cliente?.endereco?.cep);
    }
    throw new RequestError(502, "Nao foi possivel revalidar o frete agora. Continue pelo WhatsApp ou tente novamente.", {
      code: "SHIPPING_REVALIDATION_FAILED"
    });
  }

  const options = Array.isArray(quote?.options)
    ? quote.options.map((option) => normalizeShippingSelection(option)).filter(Boolean)
    : [];
  const matchedOption = options.find((option) =>
    option.id === normalizedSelection.id ||
    (
      option.serviceId === normalizedSelection.serviceId &&
      option.serviceCode === normalizedSelection.serviceCode
    )
  );

  if (!matchedOption) {
    if (!requireQuotedShipping) {
      return buildManualShippingSelection(cliente?.endereco?.cep);
    }
    throw new RequestError(409, "A opcao de frete mudou. Recalcule a entrega e confira o resumo antes de pagar.", {
      code: "SHIPPING_QUOTE_CHANGED"
    });
  }

  return {
    ...matchedOption,
    provider: sanitizePlainText(quote?.provider, 40),
    quotedAt: new Date().toISOString(),
    freeShippingApplied: false
  };
}

async function getProductMapByIds(db, ids) {
  const productMap = new Map();
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return productMap;
  }

  const snapshots = await Promise.all(uniqueIds.map((id) => db.collection("pecas").doc(id).get()));
  snapshots.forEach((snapshot) => {
    if (!snapshot.exists) return;
    const data = snapshot.data();
    productMap.set(snapshot.id, { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) });
  });

  return productMap;
}

async function ensureProductLoaded(db, productMap, id) {
  if (productMap.has(id)) return productMap.get(id);
  if (!id) return null;

  const snapshot = await db.collection("pecas").doc(id).get();
  if (!snapshot.exists) return null;

  const data = snapshot.data();
  const product = { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) };
  productMap.set(snapshot.id, product);
  return product;
}

async function buildCanonicalCartSnapshot(db, sourceCart) {
  const baseIds = Array.isArray(sourceCart)
    ? sourceCart.map((item) => sanitizePlainText(item?.id, 120)).filter(Boolean)
    : [];

  const productMap = await getProductMapByIds(db, baseIds);
  const canonicalCart = [];

  for (const rawItem of sourceCart) {
    const sourceItem = sanitizeCartItem(rawItem);
    if (!sourceItem?.id) {
      throw new RequestError(400, "Seu carrinho contem itens invalidos. Atualize a pagina e tente novamente.");
    }

    const product = await ensureProductLoaded(db, productMap, sourceItem.id);
    if (!product || product.status !== "active") {
      throw new RequestError(400, `O produto "${sourceItem.nome}" nao esta mais disponivel.`);
    }

    const quantity = Math.max(1, Math.min(99, parseInt(sourceItem.quantity, 10) || 0));
    const unitPriceCents = getCatalogUnitPriceCents(product);
    const canonicalItem = {
      cartId: sourceItem.cartId,
      id: product.id,
      categoria: sanitizePlainText(product.categoria, 40),
      nome: sanitizePlainText(product.nome, 120) || sourceItem.nome,
      preco: centsToMoney(unitPriceCents),
      precoCentavos: unitPriceCents,
      imagem: normalizeUrl(Array.isArray(product.imagens) ? product.imagens[0] : "") || "https://placehold.co/600x800/eee/ccc?text=Sem+imagem",
      frete: normalizeShippingProfile(product.frete),
      quantity
    };

    if (product.tipo === "combo") {
      if (!Array.isArray(product.componentes) || product.componentes.length === 0) {
        throw new RequestError(400, `O combo "${canonicalItem.nome}" esta incompleto no cadastro.`);
      }

      const canonicalSelections = {};
      canonicalItem.isCombo = true;
      canonicalItem.tamanho = "Combo";
      canonicalItem.cor = null;
      canonicalItem.componentes = [];

      for (let idx = 0; idx < product.componentes.length; idx += 1) {
        const component = product.componentes[idx];
        const componentProduct = await ensureProductLoaded(db, productMap, component.id);
        if (!componentProduct) {
          throw new RequestError(400, `Um item do combo "${canonicalItem.nome}" nao foi encontrado.`);
        }

        const requestedSelection = sourceItem.comboSelections?.[idx] || sourceItem.comboSelections?.[String(idx)] || {};
        const componentQuantity = Math.max(1, parseInt(component.quantidade, 10) || 1);
        const canonicalComponent = {
          id: sanitizePlainText(component.id, 120),
          nome: sanitizePlainText(component.nome || componentProduct.nome, 120) || "Item do combo",
          quantidade: componentQuantity,
          categoria: sanitizePlainText(component.categoria || componentProduct.categoria, 40)
        };

        const availableColors = Array.isArray(componentProduct.cores) ? componentProduct.cores : [];
        let canonicalColor = { nome: "Padrao", hex: "#000000" };

        if (availableColors.length > 0) {
          const requestedColorName = sanitizePlainText(requestedSelection.cor?.nome, 40);
          const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
          if (!matchedColor) {
            throw new RequestError(400, `Uma cor do combo "${canonicalItem.nome}" nao esta mais disponivel.`);
          }

          canonicalColor = {
            nome: sanitizePlainText(matchedColor.nome, 40),
            hex: sanitizeHexColor(matchedColor.hex)
          };
        }

        let canonicalSize = "Unico";
        if (isRoupaCategory(canonicalComponent.categoria)) {
          canonicalSize = normalizeSizeLabel(requestedSelection.tamanho);
          if (!["PP", "P", "M", "G", "GG"].includes(canonicalSize)) {
            throw new RequestError(400, `Um tamanho do combo "${canonicalItem.nome}" precisa ser selecionado novamente.`);
          }
        }

        canonicalSelections[idx] = { cor: canonicalColor, tamanho: canonicalSize };
        canonicalItem.componentes.push(canonicalComponent);
      }

      canonicalItem.comboSelections = canonicalSelections;
    } else {
      const availableColors = Array.isArray(product.cores) ? product.cores : [];
      canonicalItem.isCombo = false;
      canonicalItem.personalizacao = product.personalizavel ? normalizePersonalization(sourceItem.personalizacao) : null;

      if (availableColors.length > 0) {
        const requestedColorName = sanitizePlainText(sourceItem.cor?.nome, 40);
        const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
        if (!matchedColor) {
          throw new RequestError(400, `A cor selecionada para "${canonicalItem.nome}" nao esta mais disponivel.`);
        }

        canonicalItem.cor = {
          nome: sanitizePlainText(matchedColor.nome, 40),
          hex: sanitizeHexColor(matchedColor.hex)
        };
      } else {
        canonicalItem.cor = null;
      }

      const canonicalSize = checkIsMesaPosta(product.categoria)
        ? "Unico"
        : normalizeSizeLabel(sourceItem.tamanho);

      if (!canonicalSize || canonicalSize === "Combo") {
        throw new RequestError(400, `As opcoes de "${canonicalItem.nome}" precisam ser selecionadas novamente.`);
      }

      canonicalItem.tamanho = canonicalSize;
    }

    canonicalCart.push(canonicalItem);
  }

  return canonicalCart;
}

function buildComparableCartSignature(cartItems) {
  return JSON.stringify(
    (Array.isArray(cartItems) ? cartItems : []).map((item) => {
      const safeItem = sanitizeCartItem(item) || item;

      return {
        cartId: sanitizePlainText(safeItem?.cartId, 120),
        id: sanitizePlainText(safeItem?.id, 120),
        categoria: sanitizePlainText(safeItem?.categoria, 40),
        nome: sanitizePlainText(safeItem?.nome, 120),
        preco: roundCurrency(Number(safeItem?.preco || 0)),
        quantity: Math.max(1, Math.min(99, parseInt(safeItem?.quantity, 10) || 1)),
        isCombo: safeItem?.isCombo === true,
        frete: normalizeShippingProfile(safeItem?.frete),
        tamanho: normalizeSizeLabel(safeItem?.tamanho),
        cor: normalizeColorSelection(safeItem?.cor),
        personalizacao: normalizePersonalization(safeItem?.personalizacao),
        componentes: Array.isArray(safeItem?.componentes)
          ? safeItem.componentes.map((comp) => ({
              id: sanitizePlainText(comp?.id, 120),
              nome: sanitizePlainText(comp?.nome, 120),
              quantidade: Math.max(1, parseInt(comp?.quantidade, 10) || 1),
              categoria: sanitizePlainText(comp?.categoria, 40)
            }))
          : null,
        comboSelections: normalizeComboSelections(safeItem?.comboSelections)
      };
    })
  );
}

function buildCliente(rawCliente) {
  const cityState = splitCityAndState(rawCliente?.endereco?.cidade, rawCliente?.endereco?.estado);
  const documento = normalizeDocument(
    rawCliente?.documento ||
    rawCliente?.cpf ||
    rawCliente?.cnpj ||
    rawCliente?.endereco?.documento
  );
  const cliente = {
    nome: sanitizePlainText(rawCliente?.nome, 120),
    telefone: sanitizePlainText(rawCliente?.telefone, 30),
    email: sanitizePlainText(rawCliente?.email, 120),
    documento,
    endereco: {
      rua: sanitizePlainText(rawCliente?.endereco?.rua, 140),
      numero: sanitizePlainText(rawCliente?.endereco?.numero, 40),
      complemento: sanitizePlainText(rawCliente?.endereco?.complemento, 120),
      bairro: sanitizePlainText(rawCliente?.endereco?.bairro, 80),
      estado: cityState.estado,
      cep: normalizePostalCode(rawCliente?.endereco?.cep),
      cidade: cityState.cidade
    }
  };

  if (
    !cliente.nome ||
    !cliente.telefone ||
    !cliente.email ||
    ![11, 14].includes(cliente.documento.length) ||
    !cliente.endereco.rua ||
    !cliente.endereco.numero ||
    !cliente.endereco.bairro ||
    cliente.endereco.cep.length !== 8 ||
    !cliente.endereco.cidade ||
    cliente.endereco.estado.length !== 2
  ) {
    throw new RequestError(400, "Preencha nome, WhatsApp, e-mail, CPF ou CNPJ, CEP, rua, número, bairro, cidade e UF antes de finalizar.");
  }

  return cliente;
}

function normalizePagamento(rawPagamento, rawPaymentPreference) {
  const paymentKey = getPaymentKey(rawPagamento);

  if (paymentKey.includes("whatsapp") || paymentKey.includes("combinar") || paymentKey === "manual") {
    return {
      pagamento: "A combinar pelo WhatsApp",
      parcelas: 1,
      paymentGateway: "manual",
      paymentPreference: "manual",
      applyPixProductDiscount: false
    };
  }

  if (paymentKey.includes("infinitepay")) {
    const preference = getPaymentKey(rawPaymentPreference);
    const requestedPixDiscount = preference === "pix";
    const applyPixProductDiscount = requestedPixDiscount && isSafePixProductDiscountEnabled();

    if (requestedPixDiscount && !applyPixProductDiscount) {
      throw new RequestError(409, "O desconto no Pix ainda nao pode ser usado neste checkout porque a InfinitePay tambem permite trocar para cartao.", {
        code: "PIX_DISCOUNT_REQUIRES_PIX_ONLY_CHECKOUT"
      });
    }

    return {
      pagamento: applyPixProductDiscount ? "Pix via InfinitePay" : "InfinitePay",
      parcelas: 1,
      paymentGateway: "infinitepay",
      paymentPreference: applyPixProductDiscount ? "pix" : "mixed",
      applyPixProductDiscount
    };
  }

  if (paymentKey === "pix" || paymentKey.includes("cartao")) {
    throw new RequestError(400, "Escolha o checkout seguro da InfinitePay ou continue pelo WhatsApp.");
  }

  throw new RequestError(400, "Continue pelo WhatsApp para confirmar o pedido.");
}

function isAdminDecodedToken(decoded) {
  return Boolean(
    decoded?.uid && (
      decoded.uid === "NoGsCqiKc0VJwWb6rppk7QVLV1B2" ||
      decoded.admin === true
    )
  );
}

async function resolveAuthenticatedUserSession(authorizationHeader) {
  const rawHeader = String(authorizationHeader || "").trim();
  if (!rawHeader) return { userId: null, isAdmin: false };

  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new RequestError(401, "Token de autenticacao invalido.");
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    return {
      userId: decoded?.uid || null,
      isAdmin: isAdminDecodedToken(decoded)
    };
  } catch (error) {
    throw new RequestError(401, "Nao foi possivel validar sua sessao. Entre novamente e tente de novo.");
  }
}

async function saveUserProfileIfNeeded(db, userId, cliente) {
  if (!userId) return;

  const ref = db.collection("usuarios").doc(userId);
  const snapshot = await ref.get();
  const existingData = snapshot.data() || {};
  const addressBook = normalizeSavedAddressBook(
    existingData.enderecos,
    cliente.endereco,
    existingData.enderecoPrincipalId
  );

  await ref.set(
    {
      nome: cliente.nome,
      email: cliente.email,
      telefone: cliente.telefone,
      documento: cliente.documento,
      endereco: addressBook.endereco,
      enderecos: addressBook.enderecos,
      enderecoPrincipalId: addressBook.enderecoPrincipalId
    },
    { merge: true }
  );
}

function buildWhatsAppOrderMessage(orderId, pedido) {
  const paymentKey = getPaymentKey(pedido.pagamento);
  const lines = [];
  const orderCode = String(orderId).slice(0, 6).toUpperCase();
  const customerName = sanitizePlainText(pedido?.cliente?.nome, 80) || "Cliente";
  const customerDocument = formatDocument(pedido?.cliente?.documento);
  const paymentLabel = sanitizePlainText(pedido?.pagamento, 60) || "A combinar";
  const postalCode = formatPostalCode(pedido?.cliente?.endereco?.cep);
  const addressLine = [
    sanitizePlainText(pedido?.cliente?.endereco?.rua, 140),
    sanitizePlainText(pedido?.cliente?.endereco?.numero, 40)
  ].filter(Boolean).join(", ");
  const complementLine = sanitizePlainText(pedido?.cliente?.endereco?.complemento, 120);
  const districtLine = [
    sanitizePlainText(pedido?.cliente?.endereco?.bairro, 80),
    sanitizePlainText(pedido?.cliente?.endereco?.cidade, 120),
    sanitizeStateCode(pedido?.cliente?.endereco?.estado)
  ].filter(Boolean).join(" - ");

  lines.push(`*Novo pedido #${orderCode}*`);
  lines.push(`Cliente: ${customerName}`);
  if (customerDocument) {
    lines.push(`Documento: ${customerDocument}`);
  }

  let paymentLine = `Pagamento: ${paymentLabel}`;
  if (paymentKey.includes("cartao")) {
    paymentLine += ` (${pedido.parcelas}x)`;
  }
  lines.push(paymentLine);

  if (pedido.frete?.serviceId === "manual-pendente") {
    lines.push("Frete: valor e prazo a combinar pelo WhatsApp");
  } else {
    const freightCompany = sanitizePlainText(pedido?.frete?.company, 60);
    const freightName = sanitizePlainText(pedido?.frete?.name, 80);
    const freightLabel = [freightCompany, freightName].filter(Boolean).join(" - ") || "Frete selecionado";

    lines.push(`Frete: ${freightLabel}`);
    lines.push(`Prazo estimado: ${Number(pedido?.frete?.deliveryTime || 0)} dia(s) uteis`);
    lines.push(`Valor do frete: ${formatCurrency(pedido?.frete?.price)}`);
  }

  if (addressLine) {
    lines.push(`Endereco: ${addressLine}`);
  }
  if (complementLine) {
    lines.push(`Complemento: ${complementLine}`);
  }
  if (districtLine) {
    lines.push(`Bairro/Cidade: ${districtLine}`);
  }
  if (postalCode) {
    lines.push(`CEP: ${postalCode}`);
  }

  lines.push("");
  lines.push("*Itens do pedido*");

  pedido.produtos.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.quantity}x ${sanitizePlainText(item.nome, 120)}`);

    if (item.isCombo && item.comboSelections) {
      lines.push("   Combo personalizado:");
      item.componentes.forEach((comp, idx) => {
        const selection = item.comboSelections[idx] || item.comboSelections[String(idx)];
        const color = sanitizePlainText(selection?.cor?.nome, 40) || "Padrao";
        const size = normalizeSizeLabel(selection?.tamanho);
        const detailParts = [color];
        if (size && size !== "Unico") detailParts.push(size);
        lines.push(`   - ${comp.quantidade}x ${sanitizePlainText(comp.nome, 120)} (${detailParts.join(" / ")})`);
      });
    } else {
      const detailParts = [];
      const size = normalizeSizeLabel(item.tamanho);
      if (size && size !== "Unico") detailParts.push(`Tam ${size}`);
      if (item.cor?.nome) detailParts.push(`Cor ${sanitizePlainText(item.cor.nome, 40)}`);
      if (item.personalizacao?.texto) detailParts.push(`Personalizacao ${sanitizePlainText(item.personalizacao.texto, 120)}`);
      if (detailParts.length > 0) {
        lines.push(`   ${detailParts.join(" | ")}`);
      }
      if (item.personalizacao?.observacoes) {
        lines.push(`   Obs: ${sanitizePlainText(item.personalizacao.observacoes, 240)}`);
      }
    }

    lines.push(`   Valor: ${formatCurrency(item.preco * item.quantity)}`);
    lines.push("");
  });

  lines.push("*Resumo do pedido*");
  lines.push(`Total das peças: ${formatCurrency(pedido.subtotal)}`);
  if (Number(pedido?.ajustes?.pixDiscountCentavos || 0) > 0) {
    lines.push(`Desconto Pix nas peças: -${formatCurrency(pedido?.ajustes?.pixDiscount)}`);
  }
  if (pedido.frete?.serviceId === "manual-pendente") {
    lines.push("Frete: ainda não incluído");
    lines.push("");
    lines.push("A equipe confirmará aqui no WhatsApp o frete, o valor completo e a forma de pagamento antes de qualquer cobrança.");
  } else {
    lines.push(`Frete: ${formatCurrency(pedido?.frete?.price)}`);
    lines.push(`Total completo: ${formatCurrency(pedido?.total)}`);
    lines.push("");
    lines.push("Esta cotação e o resumo foram preservados para você continuar com a equipe pelo WhatsApp.");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function buildReviewResponse(canonicalCart, totals) {
  return {
    ok: false,
    code: "ORDER_REVIEW_REQUIRED",
    error: "Seu carrinho foi atualizado com os dados mais recentes. Revise o pedido e confirme novamente.",
    canonicalCart,
    totalsPreview: {
      subtotal: totals.subtotal,
      total: totals.final,
      pixDiscount: totals.pixDiscount,
      cardFee: totals.cardFee,
      shippingCost: totals.shippingCost
    }
  };
}

function normalizeEmail(value) {
  return sanitizePlainText(value, 120).toLowerCase();
}

function buildOrderFingerprint(cliente, pagamento, parcelas, canonicalCart, totals) {
  const fingerprintSource = {
    cliente: {
      email: normalizeEmail(cliente?.email),
      telefone: String(cliente?.telefone || "").replace(/\D/g, "").slice(-11),
      documento: normalizeDocument(cliente?.documento),
      cep: normalizePostalCode(cliente?.endereco?.cep),
      numero: sanitizePlainText(cliente?.endereco?.numero, 40)
    },
    pagamento: getPaymentKey(pagamento),
    parcelas: Math.max(1, parseInt(parcelas, 10) || 1),
    total: roundCurrency(totals?.final || 0),
    subtotal: roundCurrency(totals?.subtotal || 0),
    produtos: (Array.isArray(canonicalCart) ? canonicalCart : []).map((item) => ({
      id: sanitizePlainText(item?.id, 120),
      quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
      tamanho: normalizeSizeLabel(item?.tamanho),
      cor: sanitizePlainText(item?.cor?.nome, 40),
      personalizacao: normalizePersonalization(item?.personalizacao),
      comboSelections: normalizeComboSelections(item?.comboSelections)
    }))
  };

  return createHash("sha256").update(JSON.stringify(fingerprintSource)).digest("hex");
}

function getTimestampMillis(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isFinite(date?.getTime?.()) ? date.getTime() : null;
  }

  if (typeof value?.seconds === "number") {
    return value.seconds * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function findRecentDuplicateOrder(db, fingerprint) {
  const snapshot = await db
    .collection("pedidos")
    .where("fingerprint", "==", fingerprint)
    .limit(5)
    .get();

  if (snapshot.empty) return null;

  const cutoff = Date.now() - DUPLICATE_ORDER_WINDOW_MS;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const timestamp = getTimestampMillis(data.data);
    const status = sanitizePlainText(data.status, 20).toLowerCase();
    const isOpenOrder = ["pendente", "processando"].includes(status);

    if (timestamp && timestamp >= cutoff && isOpenOrder) {
      return { id: doc.id, ...data };
    }
  }

  return null;
}

export async function createOrderFromBody(body, authorizationHeader, requestMeta = {}) {
  const adminStatus = getFirebaseAdminStatus();
  if (!adminStatus.configured) {
    throw new RequestError(503, "Pedidos temporariamente indisponiveis. Tente novamente em instantes.");
  }

  const db = getAdminDb();
  const session = await resolveAuthenticatedUserSession(authorizationHeader);
  const userId = session.userId;
  const operations = await getStoreOperations(db);
  if (isPublicStorefrontBlocked(operations, session.isAdmin)) {
    throw new RequestError(403, operations.maintenanceMode
      ? "A loja esta em manutencao no momento. Tente novamente em instantes."
      : "A loja esta temporariamente fechada para novos pedidos.");
  }

  const cliente = buildCliente(body?.cliente);
  const {
    pagamento,
    parcelas,
    paymentGateway,
    paymentPreference,
    applyPixProductDiscount
  } = normalizePagamento(body?.pagamento, body?.paymentPreference);
  const submittedCart = Array.isArray(body?.cart) ? body.cart : [];
  const hasExpectedTotal = body?.expectedTotal !== undefined && body?.expectedTotal !== null && String(body.expectedTotal).trim() !== "";
  const expectedTotalCents = hasExpectedTotal ? moneyToCents(body.expectedTotal) : null;

  if (submittedCart.length === 0) {
    throw new RequestError(400, "Sua sacola esta vazia.");
  }

  if (paymentGateway === "infinitepay") {
    if (!isInfinitePayConfigured()) {
      throw new RequestError(503, "A InfinitePay ainda nao esta configurada neste ambiente.", {
        code: "INFINITEPAY_NOT_CONFIGURED"
      });
    }

    if (!userId) {
      throw new RequestError(401, "Entre ou crie sua conta para pagar com InfinitePay.");
    }
  }

  if (submittedCart.length > MAX_CART_ITEMS) {
    throw new RequestError(400, "Seu pedido excede o limite de itens permitido. Revise a sacola e tente novamente.");
  }

  const canonicalCart = await buildCanonicalCartSnapshot(db, submittedCart);
  if (!canonicalCart.length) {
    throw new RequestError(400, "Os itens do carrinho nao estao mais disponiveis.");
  }

  const frete = await resolveOrderShippingSelection(cliente, canonicalCart, body?.shipping, {
    requireQuotedShipping: paymentGateway === "infinitepay"
  });
  const totals = calculateCheckoutTotals(canonicalCart, frete, { applyPixProductDiscount });
  const sourceSignature = buildComparableCartSignature(submittedCart);
  const canonicalSignature = buildComparableCartSignature(canonicalCart);

  if (sourceSignature !== canonicalSignature || (expectedTotalCents != null && expectedTotalCents !== totals.totalCents)) {
    throw new RequestError(409, "Pedido precisa de revisao.", buildReviewResponse(canonicalCart, totals));
  }

  const fingerprint = buildOrderFingerprint(cliente, pagamento, parcelas, canonicalCart, totals);
  const duplicatedOrder = await findRecentDuplicateOrder(db, fingerprint);
  if (duplicatedOrder) {
    const existingCheckoutUrl = normalizeUrl(duplicatedOrder?.payment?.checkoutUrl);
    if (paymentGateway === "infinitepay" && existingCheckoutUrl) {
      return {
        ok: true,
        reusedOrder: true,
        orderId: duplicatedOrder.id,
        order: duplicatedOrder,
        paymentGateway: "infinitepay",
        paymentStatus: sanitizePlainText(duplicatedOrder?.paymentStatus || duplicatedOrder?.payment?.status, 40).toLowerCase() || "pending",
        paymentRedirectUrl: existingCheckoutUrl
      };
    }

    const canRevealDuplicateId = Boolean(
      userId && sanitizePlainText(duplicatedOrder?.userId, 128) === userId
    );
    const orderCode = String(duplicatedOrder.id).slice(0, 6).toUpperCase();
    const whatsappMessage = canRevealDuplicateId
      ? `Oi! Quero continuar o pedido #${orderCode} que acabei de enviar pelo site.`
      : "Oi! Acabei de enviar meu pedido pelo site e quero continuar o atendimento.";
    const whatsappPhone = sanitizePlainText(process.env.LAMED_WHATSAPP_PHONE, 20) || DEFAULT_ORDER_PHONE;
    throw new RequestError(409, "Ja recebemos um pedido igual ha pouco tempo. Se precisar, fale com a loja antes de tentar novamente.", {
      code: "DUPLICATE_ORDER",
      ...(canRevealDuplicateId ? { duplicatedOrderId: duplicatedOrder.id } : {}),
      whatsappUrl: `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMessage)}`
    });
  }

  const pedido = {
    cliente,
    pagamento,
    parcelas,
    produtos: totals.productLines,
    subtotal: totals.subtotal,
    subtotalCentavos: totals.subtotalCents,
    totalProdutos: totals.productCharge,
    totalProdutosCentavos: totals.productChargeCents,
    total: totals.final,
    totalCentavos: totals.totalCents,
    frete,
    ajustes: {
      pixDiscount: totals.pixDiscount,
      pixDiscountCentavos: totals.pixDiscountCents,
      cardFee: totals.cardFee,
      cardFeeCentavos: totals.cardFeeCents,
      freeShipping: false
    },
    data: FieldValue.serverTimestamp(),
    status: "pendente",
    paymentGateway,
    paymentStatus: "pending",
    paymentPreference,
    userId,
    estoque_baixado: false,
    fingerprint,
    productIds: canonicalCart.map((item) => sanitizePlainText(item?.id, 120)).filter(Boolean),
    metadata: {
      clientAddress: sanitizePlainText(requestMeta?.clientAddress, 80),
      userAgent: sanitizePlainText(requestMeta?.userAgent, 240)
    }
  };

  await saveUserProfileIfNeeded(db, userId, cliente);

  const pedidosCollection = db.collection("pedidos");
  const ref = pedidosCollection.doc();

  if (paymentGateway === "infinitepay") {
    const publicOrder = {
      ...pedido,
      data: new Date().toISOString()
    };

    await ref.set(pedido);

    try {
      const checkout = await createInfinitePayCheckoutLink({
        orderId: ref.id,
        pedido: publicOrder,
        requestMeta: {
          ...requestMeta,
          userId
        }
      });

      await ref.set({
        payment: {
          gateway: "infinitepay",
          status: "pending",
          checkoutUrl: checkout.checkoutUrl,
          redirectUrl: checkout.redirectUrl,
          handle: checkout.handle,
          updatedAt: new Date().toISOString()
        },
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      await clearUserCart(userId).catch(() => {});

      return {
        ok: true,
        orderId: ref.id,
        order: {
          ...publicOrder,
          payment: {
            gateway: "infinitepay",
            status: "pending",
            checkoutUrl: checkout.checkoutUrl,
            redirectUrl: checkout.redirectUrl,
            handle: checkout.handle
          }
        },
        paymentGateway: "infinitepay",
        paymentStatus: "pending",
        paymentRedirectUrl: checkout.checkoutUrl
      };
    } catch (error) {
      const fallbackOrder = {
        ...publicOrder,
        pagamento: "A combinar pelo WhatsApp",
        paymentGateway: "manual",
        paymentStatus: "checkout_failed"
      };
      const whatsappMessage = buildWhatsAppOrderMessage(ref.id, fallbackOrder);
      const whatsappPhone = sanitizePlainText(process.env.LAMED_WHATSAPP_PHONE, 20) || DEFAULT_ORDER_PHONE;

      await ref.set({
        pagamento: fallbackOrder.pagamento,
        paymentGateway: fallbackOrder.paymentGateway,
        paymentStatus: fallbackOrder.paymentStatus,
        payment: {
          gateway: "infinitepay",
          status: "checkout_failed",
          updatedAt: new Date().toISOString()
        },
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await clearUserCart(userId).catch(() => {});

      return {
        ok: true,
        fallback: "whatsapp",
        fallbackReason: "PAYMENT_LINK_UNAVAILABLE",
        orderId: ref.id,
        order: fallbackOrder,
        paymentGateway: "manual",
        paymentStatus: "checkout_failed",
        whatsappMessage,
        whatsappUrl: `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMessage)}`
      };
    }
  }

  await ref.set(pedido);
  await clearUserCart(userId).catch(() => {});
  const publicOrder = {
    ...pedido,
    data: new Date().toISOString()
  };
  const whatsappMessage = buildWhatsAppOrderMessage(ref.id, publicOrder);
  const whatsappPhone = sanitizePlainText(process.env.LAMED_WHATSAPP_PHONE, 20) || DEFAULT_ORDER_PHONE;

  return {
    ok: true,
    orderId: ref.id,
    order: publicOrder,
    whatsappMessage,
    whatsappUrl: `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMessage)}`
  };
}

export function isOrderRequestError(error) {
  return error instanceof RequestError;
}
