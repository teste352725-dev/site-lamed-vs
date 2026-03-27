import { createHash } from "node:crypto";
import { FieldValue, getAdminAuth, getAdminDb, getFirebaseAdminStatus } from "./_firebase-admin.mjs";
import { clearUserCart } from "./_cart.mjs";
import { createInfinitePayCheckoutLink, isInfinitePayConfigured } from "./_infinitepay.mjs";
import { isShippingApiEnabled, requestShippingQuote } from "./_shipping.mjs";
import { getStoreOperations, isPublicStorefrontBlocked } from "./_store-operations.mjs";

const TAXA_JUROS = 0.0549;
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
  const price = Number(product?.preco || 0);
  const discount = Number(product?.desconto || 0);
  return roundCurrency(price * (1 - discount / 100));
}

function normalizeShippingSelection(selection) {
  if (!selection || typeof selection !== "object") return null;

  const id = sanitizePlainText(selection.id || selection.serviceCode || selection.serviceId, 120);
  const serviceId = sanitizePlainText(selection.serviceId || selection.id, 120);
  const serviceCode = sanitizePlainText(selection.serviceCode || selection.id, 120);
  const name = sanitizePlainText(selection.name, 120);
  const company = sanitizePlainText(selection.company, 80);
  const price = roundCurrency(Number(selection.price));
  const originalPrice = roundCurrency(Number(selection.originalPrice ?? selection.price));
  const deliveryTime = Math.max(1, parseInt(selection.deliveryTime, 10) || 0);
  const fromPostalCode = normalizePostalCode(selection.fromPostalCode);
  const toPostalCode = normalizePostalCode(selection.toPostalCode);

  if (!id || !serviceId || !serviceCode || !name || !company || !Number.isFinite(price) || price < 0) {
    return null;
  }

  if (!Number.isFinite(originalPrice) || originalPrice < 0 || deliveryTime < 1) {
    return null;
  }

  return {
    id,
    serviceId,
    serviceCode,
    name,
    company,
    price,
    originalPrice,
    deliveryTime,
    fromPostalCode,
    toPostalCode
  };
}

function calculateCheckoutTotals(cartItems, pagamento, parcelas, cep, shippingSelection = null) {
  const subtotal = roundCurrency(cartItems.reduce((acc, item) => acc + item.preco * item.quantity, 0));
  const hanukahSubtotal = roundCurrency(
    cartItems.reduce((acc, item) => acc + (isHanukahProduct(item) ? item.preco * item.quantity : 0), 0)
  );

  let final = subtotal;
  let pixDiscount = 0;
  let cardFee = 0;

  const paymentKey = getPaymentKey(pagamento);
  if (paymentKey === "pix") {
    pixDiscount = roundCurrency(subtotal * 0.05);
    final = roundCurrency(final - pixDiscount);
  } else if (paymentKey.includes("cartao") && parcelas > 2) {
    cardFee = roundCurrency(subtotal * TAXA_JUROS);
    final = roundCurrency(final + cardFee);
  }

  const safeShipping = normalizeShippingSelection(shippingSelection);
  const freeShippingEligible = isSudeste(cep) && hanukahSubtotal >= 500;
  const shippingOriginal = safeShipping ? safeShipping.originalPrice : 0;
  const shippingCost = safeShipping ? roundCurrency(freeShippingEligible ? 0 : safeShipping.price) : 0;
  const shippingDiscount = safeShipping && freeShippingEligible ? roundCurrency(shippingOriginal) : 0;
  final = roundCurrency(final + shippingCost);

  return {
    subtotal,
    hanukahSubtotal,
    pixDiscount,
    cardFee,
    shippingCost,
    shippingOriginal,
    shippingDiscount,
    final,
    freeShipping: freeShippingEligible && !!safeShipping,
    freeShippingEligible
  };
}

function buildManualShippingSelection(destinationCep = "") {
  const originPostalCode = normalizePostalCode(process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE) || FALLBACK_ORIGIN_POSTAL_CODE;
  const normalizedDestinationCep = normalizePostalCode(destinationCep) || originPostalCode;

  return {
    id: "manual-pendente",
    serviceId: "manual-pendente",
    serviceCode: "manual-pendente",
    name: "Frete definido apos o pedido",
    company: "A combinar",
    price: 0,
    originalPrice: 0,
    deliveryTime: 1,
    quotedAt: new Date().toISOString(),
    fromPostalCode: originPostalCode,
    toPostalCode: normalizedDestinationCep,
    freeShippingApplied: false
  };
}

async function resolveOrderShippingSelection(cliente, canonicalCart, submittedShipping) {
  if (!isShippingApiEnabled()) {
    return buildManualShippingSelection(cliente?.endereco?.cep);
  }

  const normalizedSelection = normalizeShippingSelection(submittedShipping);
  if (!normalizedSelection) {
    throw new RequestError(400, "Escolha uma opcao de frete antes de continuar.");
  }

  let quote;
  try {
    quote = await requestShippingQuote({
      destinationPostalCode: cliente?.endereco?.cep,
      items: canonicalCart
    });
  } catch (error) {
    throw new RequestError(502, String(error?.message || "Nao foi possivel validar o frete agora."));
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
    throw new RequestError(400, "A opcao de frete escolhida nao esta mais disponivel. Revise o CEP e selecione novamente.");
  }

  return matchedOption;
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
    const canonicalItem = {
      cartId: sourceItem.cartId,
      id: product.id,
      categoria: sanitizePlainText(product.categoria, 40),
      nome: sanitizePlainText(product.nome, 120) || sourceItem.nome,
      preco: getDiscountedProductPrice(product),
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
  const cliente = {
    nome: sanitizePlainText(rawCliente?.nome, 120),
    telefone: sanitizePlainText(rawCliente?.telefone, 30),
    email: sanitizePlainText(rawCliente?.email, 120),
    endereco: {
      rua: sanitizePlainText(rawCliente?.endereco?.rua, 140),
      numero: sanitizePlainText(rawCliente?.endereco?.numero, 40),
      cep: normalizePostalCode(rawCliente?.endereco?.cep),
      cidade: sanitizePlainText(rawCliente?.endereco?.cidade, 120)
    }
  };

  if (
    !cliente.nome ||
    !cliente.telefone ||
    !cliente.email ||
    !cliente.endereco.rua ||
    !cliente.endereco.numero ||
    cliente.endereco.cep.length !== 8 ||
    !cliente.endereco.cidade
  ) {
    throw new RequestError(400, "Preencha todos os dados obrigatorios antes de finalizar.");
  }

  return cliente;
}

function normalizePagamento(rawPagamento, rawParcelas) {
  const paymentKey = getPaymentKey(rawPagamento);

  if (paymentKey === "pix") {
    return {
      pagamento: "PIX",
      parcelas: 1
    };
  }

  if (paymentKey.includes("cartao")) {
    const parcelas = Math.max(1, Math.min(12, parseInt(rawParcelas, 10) || 1));
    return {
      pagamento: "Cartao de Credito",
      parcelas
    };
  }

  if (paymentKey.includes("infinitepay")) {
    return {
      pagamento: "InfinitePay",
      parcelas: 1
    };
  }

  throw new RequestError(400, "Selecione uma forma de pagamento valida.");
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

  await db.collection("usuarios").doc(userId).set(
    {
      nome: cliente.nome,
      email: cliente.email,
      telefone: cliente.telefone,
      endereco: cliente.endereco
    },
    { merge: true }
  );
}

function buildWhatsAppOrderMessage(orderId, pedido) {
  const paymentKey = getPaymentKey(pedido.pagamento);
  const lines = [];
  const orderCode = String(orderId).slice(0, 6).toUpperCase();
  const customerName = sanitizePlainText(pedido?.cliente?.nome, 80) || "Cliente";
  const paymentLabel = sanitizePlainText(pedido?.pagamento, 60) || "A combinar";
  const postalCode = formatPostalCode(pedido?.cliente?.endereco?.cep);

  lines.push(`*Novo pedido #${orderCode}*`);
  lines.push(`Cliente: ${customerName}`);

  let paymentLine = `Pagamento: ${paymentLabel}`;
  if (paymentKey.includes("cartao")) {
    paymentLine += ` (${pedido.parcelas}x)`;
  }
  lines.push(paymentLine);

  if (pedido.frete?.serviceId === "manual-pendente") {
    lines.push("Frete: a combinar apos confirmacao");
    if (postalCode) {
      lines.push(`CEP: ${postalCode}`);
    }
  } else {
    const freightCompany = sanitizePlainText(pedido?.frete?.company, 60);
    const freightName = sanitizePlainText(pedido?.frete?.name, 80);
    const freightLabel = [freightCompany, freightName].filter(Boolean).join(" - ") || "Frete selecionado";

    lines.push(`Frete: ${freightLabel}`);
    lines.push(`Prazo estimado: ${Number(pedido?.frete?.deliveryTime || 0)} dia(s) uteis`);
    lines.push(`Valor do frete: ${formatCurrency(pedido?.frete?.price)}`);
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

  lines.push("*Resumo financeiro*");
  lines.push(`Subtotal: ${formatCurrency(pedido.subtotal)}`);
  if (pedido.ajustes.pixDiscount > 0) lines.push(`Desconto PIX: -${formatCurrency(pedido.ajustes.pixDiscount)}`);
  if (pedido.ajustes.cardFee > 0) lines.push(`Taxa do cartao: +${formatCurrency(pedido.ajustes.cardFee)}`);
  if (pedido.ajustes.freeShipping) lines.push(`Desconto no frete: -${formatCurrency(pedido.frete.originalPrice)}`);
  lines.push(`Total final: ${formatCurrency(pedido.total)}`);

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
      cep: normalizePostalCode(cliente?.endereco?.cep)
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
  const { pagamento, parcelas } = normalizePagamento(body?.pagamento, body?.parcelas);
  const paymentKey = getPaymentKey(pagamento);
  const submittedCart = Array.isArray(body?.cart) ? body.cart : [];
  const hasExpectedTotal = body?.expectedTotal !== undefined && body?.expectedTotal !== null && String(body.expectedTotal).trim() !== "";
  const expectedTotal = hasExpectedTotal ? roundCurrency(Number(body.expectedTotal)) : null;

  if (submittedCart.length === 0) {
    throw new RequestError(400, "Sua sacola esta vazia.");
  }

  if (paymentKey === "infinitepay") {
    if (!isInfinitePayConfigured()) {
      throw new RequestError(503, "A InfinitePay ainda nao esta configurada neste ambiente.");
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

  const frete = await resolveOrderShippingSelection(cliente, canonicalCart, body?.shipping);
  const totals = calculateCheckoutTotals(canonicalCart, pagamento, parcelas, cliente.endereco.cep, frete);
  const sourceSignature = buildComparableCartSignature(submittedCart);
  const canonicalSignature = buildComparableCartSignature(canonicalCart);

  if (sourceSignature !== canonicalSignature || (expectedTotal != null && Math.abs(expectedTotal - totals.final) > 0.01)) {
    throw new RequestError(409, "Pedido precisa de revisao.", buildReviewResponse(canonicalCart, totals));
  }

  const fingerprint = buildOrderFingerprint(cliente, pagamento, parcelas, canonicalCart, totals);
  const duplicatedOrder = await findRecentDuplicateOrder(db, fingerprint);
  if (duplicatedOrder) {
    const existingCheckoutUrl = normalizeUrl(duplicatedOrder?.payment?.checkoutUrl);
    if (paymentKey === "infinitepay" && existingCheckoutUrl) {
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

    throw new RequestError(409, "Ja recebemos um pedido igual ha pouco tempo. Se precisar, fale com a loja antes de tentar novamente.", {
      code: "DUPLICATE_ORDER",
      duplicatedOrderId: duplicatedOrder.id
    });
  }

  const pedido = {
    cliente,
    pagamento,
    parcelas,
    produtos: canonicalCart,
    subtotal: totals.subtotal,
    total: totals.final,
    frete,
    ajustes: {
      pixDiscount: totals.pixDiscount,
      cardFee: totals.cardFee,
      freeShipping: false
    },
    data: FieldValue.serverTimestamp(),
    status: "pendente",
    paymentGateway: paymentKey === "infinitepay" ? "infinitepay" : "manual",
    paymentStatus: "pending",
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

  if (paymentKey === "infinitepay") {
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
      await ref.delete().catch(() => {});
      throw new RequestError(Number(error?.status) || 502, String(error?.message || "Nao foi possivel iniciar o checkout InfinitePay."));
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

