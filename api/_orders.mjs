import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";

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

  throw new RequestError(400, "Selecione uma forma de pagamento valida.");
}

async function resolveAuthenticatedUserId(authorizationHeader) {
  const rawHeader = String(authorizationHeader || "").trim();
  if (!rawHeader) return null;

  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new RequestError(401, "Token de autenticacao invalido.");
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    return decoded?.uid || null;
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
  let message = `*Novo Pedido #${String(orderId).slice(0, 6).toUpperCase()}*\\n`;
  message += `*Cliente:* ${pedido.cliente.nome}\\n`;
  message += `*Pagamento:* ${pedido.pagamento}`;
  if (paymentKey.includes("cartao")) message += ` (${pedido.parcelas}x)`;
  message += "\\n";

  if (pedido.frete?.serviceId === "manual-pendente") {
    message += "*Frete:* A combinar apos confirmacao\\n";
    message += `*CEP:* ${formatPostalCode(pedido.cliente.endereco.cep)}\\n\\n`;
  } else {
    message += `*Frete:* ${pedido.frete.company} - ${pedido.frete.name}\\n`;
    message += `*Entrega estimada:* ${pedido.frete.deliveryTime} dia(s) uteis\\n`;
    message += `*Valor do frete:* ${formatCurrency(pedido.frete.price)}\\n\\n`;
  }

  message += "*Itens do Pedido:*\\n";

  pedido.produtos.forEach((item) => {
    message += "------------------------------\\n";
    message += `- *${item.quantity}x ${item.nome}*\\n`;

    if (item.isCombo && item.comboSelections) {
      message += "  _Combo personalizado:_\\n";
      item.componentes.forEach((comp, idx) => {
        const selection = item.comboSelections[idx] || item.comboSelections[String(idx)];
        const color = sanitizePlainText(selection?.cor?.nome, 40) || "Padrao";
        const size = normalizeSizeLabel(selection?.tamanho);
        const detailParts = [color];
        if (size && size !== "Unico") detailParts.push(`(${size})`);
        message += `  - ${comp.quantidade}x ${comp.nome} [${detailParts.join(" ")}]\\n`;
      });
    } else {
      const detailParts = [];
      const size = normalizeSizeLabel(item.tamanho);
      if (size && size !== "Unico") detailParts.push(`Tam: ${size}`);
      if (item.cor?.nome) detailParts.push(`Cor: ${sanitizePlainText(item.cor.nome, 40)}`);
      if (item.personalizacao?.texto) detailParts.push(`Personalizacao: ${sanitizePlainText(item.personalizacao.texto, 120)}`);
      if (detailParts.length > 0) message += `  (${detailParts.join(" | ")})\\n`;
      if (item.personalizacao?.observacoes) {
        message += `  Obs: ${sanitizePlainText(item.personalizacao.observacoes, 240)}\\n`;
      }
    }

    message += `  Valor: ${formatCurrency(item.preco * item.quantity)}\\n`;
  });

  message += "------------------------------\\n";
  message += `*Subtotal:* ${formatCurrency(pedido.subtotal)}\\n`;
  if (pedido.ajustes.pixDiscount > 0) message += `*Desconto PIX:* -${formatCurrency(pedido.ajustes.pixDiscount)}\\n`;
  if (pedido.ajustes.cardFee > 0) message += `*Taxa Cartao:* +${formatCurrency(pedido.ajustes.cardFee)}\\n`;
  if (pedido.ajustes.freeShipping) message += `*Desconto no frete:* -${formatCurrency(pedido.frete.originalPrice)}\\n`;
  message += `*Total Final:* ${formatCurrency(pedido.total)}\\n`;

  return message;
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

export async function createOrderFromBody(body, authorizationHeader) {
  const db = getAdminDb();
  const userId = await resolveAuthenticatedUserId(authorizationHeader);

  const cliente = buildCliente(body?.cliente);
  const { pagamento, parcelas } = normalizePagamento(body?.pagamento, body?.parcelas);
  const submittedCart = Array.isArray(body?.cart) ? body.cart : [];
  const hasExpectedTotal = body?.expectedTotal !== undefined && body?.expectedTotal !== null && String(body.expectedTotal).trim() !== "";
  const expectedTotal = hasExpectedTotal ? roundCurrency(Number(body.expectedTotal)) : null;

  if (submittedCart.length === 0) {
    throw new RequestError(400, "Sua sacola esta vazia.");
  }

  const canonicalCart = await buildCanonicalCartSnapshot(db, submittedCart);
  if (!canonicalCart.length) {
    throw new RequestError(400, "Os itens do carrinho nao estao mais disponiveis.");
  }

  const frete = buildManualShippingSelection(cliente.endereco.cep);
  const totals = calculateCheckoutTotals(canonicalCart, pagamento, parcelas, cliente.endereco.cep, null);
  const sourceSignature = buildComparableCartSignature(submittedCart);
  const canonicalSignature = buildComparableCartSignature(canonicalCart);

  if (sourceSignature !== canonicalSignature || (expectedTotal != null && Math.abs(expectedTotal - totals.final) > 0.01)) {
    throw new RequestError(409, "Pedido precisa de revisao.", buildReviewResponse(canonicalCart, totals));
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
    userId,
    estoque_baixado: false
  };

  await saveUserProfileIfNeeded(db, userId, cliente);

  const ref = await db.collection("pedidos").add(pedido);
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
