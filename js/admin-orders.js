const ordersFirebaseConfig = {
    apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U",
    authDomain: "site-lamed.firebaseapp.com",
    projectId: "site-lamed",
    storageBucket: "site-lamed.firebasestorage.app",
    messagingSenderId: "862756160215",
    appId: "1:862756160215:web:d0fded233682bf93eaa692"
};

const ADMIN_UIDS = ["NoGsCqiKc0VJwWb6rppk7QVLV1B2"];
const STATUS_META = {
    pendente: { label: "Pendente", className: "status-pendente", icon: "fa-solid fa-hourglass-half" },
    processando: { label: "Processando", className: "status-processando", icon: "fa-solid fa-scissors" },
    enviado: { label: "Enviado", className: "status-enviado", icon: "fa-solid fa-truck-fast" },
    entregue: { label: "Entregue", className: "status-entregue", icon: "fa-solid fa-house-circle-check" },
    cancelado: { label: "Cancelado", className: "status-cancelado", icon: "fa-solid fa-ban" }
};
const STATUS_ORDER = ["pendente", "processando", "enviado", "entregue", "cancelado"];
const ADMIN_OPERATIONAL_SHIPPING_ENABLED = false;
const ADMIN_OPERATIONAL_SHIPPING_PAUSE_MESSAGE = "Cotacao automatica pausada temporariamente. Use esta area apenas para organizar a expedicao manual.";
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
const PACKAGE_PRESETS = {
    envelope: { label: "Envelope", formato: "envelope", peso: 0.25, largura: 20, altura: 3, comprimento: 26 },
    caixa_p: { label: "Caixa P", formato: "box", peso: 0.8, largura: 24, altura: 8, comprimento: 30 },
    caixa_m: { label: "Caixa M", formato: "box", peso: 1.6, largura: 30, altura: 10, comprimento: 36 },
    caixa_g: { label: "Caixa G", formato: "box", peso: 3.2, largura: 38, altura: 15, comprimento: 45 },
    personalizado: { label: "Personalizado", formato: "box", peso: null, largura: null, altura: null, comprimento: null }
};
const BRAZIL_STATES = [
    "", "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
    "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP",
    "SE", "TO"
];

let ordersApp;
try {
    ordersApp = firebase.app();
} catch (error) {
    ordersApp = firebase.initializeApp(ordersFirebaseConfig);
}

const ordersDb = firebase.firestore();
const ordersAuth = firebase.auth();
const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const state = {
    orders: [],
    filteredStatus: "todos",
    searchTerm: "",
    onlyCustom: false,
    activeOrderId: "",
    compatibleSelection: new Set(),
    activePackagePreset: "personalizado",
    quoteMode: "catalogo",
    quote: createEmptyQuoteState(),
    unsubscribeOrders: null
};

const elements = {};

function createEmptyQuoteState() {
    return {
        loading: false,
        requested: false,
        error: "",
        options: [],
        selectedId: ""
    };
}

function cacheElements() {
    [
        "orders-refresh-btn",
        "orders-open-pending-btn",
        "orders-open-remessas-btn",
        "orders-search-input",
        "orders-status-select",
        "orders-toggle-custom-btn",
        "orders-filter-chips",
        "orders-feedback",
        "orders-loading",
        "orders-empty",
        "orders-list",
        "orders-count-total",
        "orders-count-pending",
        "orders-count-processing",
        "orders-count-remessas",
        "orders-count-ready",
        "orders-count-custom",
        "orders-modal",
        "orders-modal-title",
        "orders-modal-subtitle",
        "orders-modal-status",
        "orders-modal-total",
        "orders-modal-payment",
        "orders-modal-store-shipping",
        "orders-modal-store-delivery",
        "orders-modal-item-count",
        "orders-modal-remessa",
        "orders-modal-updated",
        "orders-modal-tracking",
        "orders-modal-feedback",
        "orders-modal-client",
        "orders-modal-address",
        "orders-status-actions",
        "orders-modal-custom-chip",
        "orders-modal-items",
        "orders-modal-financial",
        "orders-modal-whatsapp",
        "orders-apply-suggestion-btn",
        "orders-package-hint",
        "orders-quote-mode-group",
        "exp-nome",
        "exp-telefone",
        "exp-email",
        "exp-documento",
        "exp-cep",
        "exp-estado",
        "exp-rua",
        "exp-numero",
        "exp-complemento",
        "exp-bairro",
        "exp-cidade",
        "orders-package-presets",
        "exp-peso",
        "exp-largura",
        "exp-altura",
        "exp-comprimento",
        "exp-insurance",
        "orders-compatible-count",
        "orders-compatible-note",
        "orders-compatible-list",
        "orders-quote-btn",
        "orders-clear-quote-btn",
        "orders-quote-feedback",
        "orders-quote-options",
        "exp-observacoes",
        "exp-tracking",
        "orders-copy-manifest-btn",
        "orders-download-manifest-btn",
        "orders-download-json-btn",
        "orders-clear-remessa-btn",
        "orders-delete-btn",
        "orders-save-expedition-btn",
        "orders-modal-close"
    ].forEach((id) => {
        elements[toCamel(id)] = document.getElementById(id);
    });
}

function toCamel(value) {
    return String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function bindEvents() {
    elements.ordersRefreshBtn?.addEventListener("click", () => startOrdersListener(true));
    elements.ordersOpenPendingBtn?.addEventListener("click", () => applyStatusFilter("pendente"));
    elements.ordersOpenRemessasBtn?.addEventListener("click", () => {
        applyStatusFilter("todos");
        state.searchTerm = "";
        if (elements.ordersSearchInput) elements.ordersSearchInput.value = "";
        renderOrdersPage();
        const firstGrouped = getFilteredOrders().find((order) => getRemessaId(order));
        if (firstGrouped) openOrderModal(firstGrouped.id);
    });

    const scheduleSearch = debounce(() => {
        state.searchTerm = sanitizePlainText(elements.ordersSearchInput?.value, 120).toLowerCase();
        renderOrdersPage();
    }, 140);

    elements.ordersSearchInput?.addEventListener("input", scheduleSearch);
    elements.ordersStatusSelect?.addEventListener("change", (event) => applyStatusFilter(event.target.value));
    elements.ordersToggleCustomBtn?.addEventListener("click", () => {
        state.onlyCustom = !state.onlyCustom;
        elements.ordersToggleCustomBtn.classList.toggle("active", state.onlyCustom);
        renderOrdersPage();
    });

    elements.ordersFilterChips?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-status]");
        if (!button) return;
        applyStatusFilter(button.dataset.status || "todos");
    });

    elements.ordersList?.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-open-order]");
        if (!trigger) return;
        openOrderModal(trigger.dataset.openOrder || "");
    });

    elements.ordersModalClose?.addEventListener("click", closeOrderModal);
    elements.ordersModal?.addEventListener("click", (event) => {
        if (event.target === elements.ordersModal) closeOrderModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isModalOpen()) closeOrderModal();
    });

    elements.ordersStatusActions?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-next-status]");
        if (!button) return;
        updateOrderStatus(button.dataset.nextStatus || "pendente");
    });

    elements.ordersQuoteModeGroup?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-quote-mode]");
        if (!button) return;
        setQuoteMode(button.dataset.quoteMode || "catalogo");
    });

    elements.ordersPackagePresets?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-package-preset]");
        if (!button) return;
        setPackagePreset(button.dataset.packagePreset || "personalizado", true);
    });

    elements.ordersCompatibleList?.addEventListener("change", (event) => {
        const input = event.target.closest("[data-compatible-order]");
        if (!input) return;
        const targetId = input.dataset.compatibleOrder || "";
        if (!targetId) return;

        if (input.checked) state.compatibleSelection.add(targetId);
        else state.compatibleSelection.delete(targetId);

        renderCompatibleSelectionSummary();
    });

    elements.ordersQuoteOptions?.addEventListener("click", (event) => {
        const option = event.target.closest("[data-quote-option]");
        if (!option) return;
        state.quote.selectedId = option.dataset.quoteOption || "";
        renderQuoteOptions();
    });

    elements.expCep?.addEventListener("input", (event) => {
        event.target.value = formatPostalCode(event.target.value);
    });

    [elements.expPeso, elements.expLargura, elements.expAltura, elements.expComprimento].forEach((field) => {
        field?.addEventListener("input", () => setPackagePreset(inferPackagePreset(readPackageForm()), false));
    });

    elements.ordersApplySuggestionBtn?.addEventListener("click", applySuggestedPackageToForm);
    elements.ordersQuoteBtn?.addEventListener("click", quoteOperationalShipping);
    elements.ordersClearQuoteBtn?.addEventListener("click", () => {
        state.quote = createEmptyQuoteState();
        renderQuoteOptions();
    });

    if (elements.ordersQuoteBtn && !ADMIN_OPERATIONAL_SHIPPING_ENABLED) {
        elements.ordersQuoteBtn.disabled = true;
        elements.ordersQuoteBtn.title = ADMIN_OPERATIONAL_SHIPPING_PAUSE_MESSAGE;
    }
    elements.ordersSaveExpeditionBtn?.addEventListener("click", saveExpedition);
    elements.ordersClearRemessaBtn?.addEventListener("click", clearRemessa);
    elements.ordersDeleteBtn?.addEventListener("click", archiveOrder);
    elements.ordersCopyManifestBtn?.addEventListener("click", async () => {
        const manifest = buildManifestText();
        try {
            await navigator.clipboard.writeText(manifest);
            setModalFeedback("Ficha de expedicao copiada.", "info");
        } catch (error) {
            setModalFeedback("Nao foi possivel copiar a ficha agora.", "error");
        }
    });
    elements.ordersDownloadManifestBtn?.addEventListener("click", () => {
        const activeOrder = getActiveOrder();
        if (!activeOrder) return;
        downloadFile(`expedicao-${getOrderDisplayId(activeOrder)}.txt`, buildManifestText(), "text/plain;charset=utf-8");
    });
    elements.ordersDownloadJsonBtn?.addEventListener("click", () => {
        const activeOrder = getActiveOrder();
        if (!activeOrder) return;
        downloadFile(`expedicao-${getOrderDisplayId(activeOrder)}.json`, JSON.stringify(buildManifestPayload(), null, 2), "application/json;charset=utf-8");
    });
}

function initStateOptions() {
    if (!elements.expEstado) return;
    elements.expEstado.innerHTML = BRAZIL_STATES.map((stateCode) => `<option value="${stateCode}">${stateCode || "Selecione"}</option>`).join("");
}

function debounce(callback, wait = 120) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = window.setTimeout(() => callback(...args), wait);
    };
}

function sanitizePlainText(value, maxLength = 160) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stripAccents(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOrderStatus(value) {
    const aliases = { pago: "processando", concluido: "entregue" };
    const normalized = stripAccents(sanitizePlainText(value, 40)).toLowerCase();
    const canonical = aliases[normalized] || normalized;
    return STATUS_ORDER.includes(canonical) ? canonical : "pendente";
}

function normalizePostalCode(value) {
    return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function formatPostalCode(value) {
    const digits = normalizePostalCode(value);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function roundCurrency(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function roundNumber(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value) {
    return currencyFormatter.format(Number(value || 0));
}

function formatDateTime(value) {
    if (!value) return "-";
    if (typeof value.toDate === "function") return value.toDate().toLocaleString("pt-BR");
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toLocaleString("pt-BR");

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

function normalizeCategoryKey(value) {
    return stripAccents(sanitizePlainText(value, 40))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function resolveApiBaseUrl() {
    const configured = document.querySelector('meta[name="lamed-api-base-url"]')?.getAttribute("content")?.trim();
    if (configured) return configured.replace(/\/+$/, "");

    try {
        const stored = window.localStorage.getItem("lamed_api_base_url")?.trim();
        if (stored) return stored.replace(/\/+$/, "");
    } catch (error) {}

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return "http://localhost:3001";
    }

    return "";
}

const API_BASE_URL = resolveApiBaseUrl();

function buildBackendUrl(pathname) {
    const safePath = String(pathname || "").startsWith("/") ? pathname : `/${pathname || ""}`;
    return API_BASE_URL ? `${API_BASE_URL}${safePath}` : safePath;
}

function extractShippingErrorMessage(payload, response = null) {
    if (typeof payload?.error === "string" && payload.error.trim()) return sanitizePlainText(payload.error, 220);
    if (typeof payload?.message === "string" && payload.message.trim()) return sanitizePlainText(payload.message, 220);
    if (response?.status === 404) {
        return API_BASE_URL
            ? "A API de frete configurada nao respondeu a rota esperada."
            : "O backend de frete nao esta publicado neste dominio.";
    }
    if (response?.status >= 500) return "O servidor de frete respondeu com erro. Tente novamente em instantes.";
    return "Nao foi possivel calcular a cotacao operacional.";
}

function normalizeQuoteOption(raw) {
    const option = raw && typeof raw === "object" ? raw : null;
    if (!option) return null;

    const id = sanitizePlainText(option.id || option.serviceCode || option.serviceId, 120);
    const serviceId = sanitizePlainText(option.serviceId || option.id, 120);
    const serviceCode = sanitizePlainText(option.serviceCode || option.id, 120);
    const name = sanitizePlainText(option.name, 120);
    const company = sanitizePlainText(option.company, 80);
    const price = roundCurrency(option.price);
    const originalPrice = roundCurrency(option.originalPrice ?? option.price);
    const deliveryTime = Math.max(1, parseInt(option.deliveryTime, 10) || 0);
    const fromPostalCode = normalizePostalCode(option.fromPostalCode);
    const toPostalCode = normalizePostalCode(option.toPostalCode);

    if (!id || !serviceId || !serviceCode || !name || !company || deliveryTime < 1) return null;

    return {
        id,
        serviceId,
        serviceCode,
        name,
        company,
        price,
        originalPrice: originalPrice >= 0 ? originalPrice : price,
        deliveryTime,
        fromPostalCode,
        toPostalCode,
        quotedAt: sanitizePlainText(option.quotedAt, 60) || new Date().toISOString()
    };
}

function getQuoteFromStateOrOrder(order) {
    if (state.quote.options.length > 0 && state.quote.selectedId) {
        return state.quote.options.find((option) => option.id === state.quote.selectedId) || null;
    }
    return normalizeQuoteOption(order?.expedicao?.quote);
}

function normalizeDestination(order) {
    const source = order?.expedicao?.destinatario || {};
    const client = order?.cliente || {};
    const address = client.endereco || {};

    return {
        nome: sanitizePlainText(source.nome || client.nome, 120),
        telefone: sanitizePlainText(source.telefone || client.telefone, 30),
        email: sanitizePlainText(source.email || client.email, 120),
        documento: sanitizePlainText(source.documento, 30),
        cep: normalizePostalCode(source.cep || address.cep || order?.frete?.toPostalCode || ""),
        rua: sanitizePlainText(source.rua || address.rua, 140),
        numero: sanitizePlainText(source.numero || address.numero, 40),
        complemento: sanitizePlainText(source.complemento, 80),
        bairro: sanitizePlainText(source.bairro, 80),
        cidade: sanitizePlainText(source.cidade || address.cidade, 120),
        estado: sanitizePlainText(source.estado, 2).toUpperCase()
    };
}

function getPackageProfileFromItem(item) {
    const profile = item?.frete;
    if (
        profile &&
        typeof profile === "object" &&
        Number(profile.peso) > 0 &&
        Number(profile.largura) > 0 &&
        Number(profile.altura) > 0 &&
        Number(profile.comprimento) > 0
    ) {
        return {
            peso: roundNumber(profile.peso, 3),
            largura: Math.max(1, parseInt(profile.largura, 10) || 1),
            altura: Math.max(1, parseInt(profile.altura, 10) || 1),
            comprimento: Math.max(1, parseInt(profile.comprimento, 10) || 1)
        };
    }

    const categoryKey = item?.isCombo === true ? "combo" : normalizeCategoryKey(item?.categoria || "outros");
    return DEFAULT_SHIPPING_PROFILES[categoryKey] || DEFAULT_SHIPPING_PROFILES.outros;
}

function buildSuggestedPackage(ordersForShipment) {
    const ordersList = Array.isArray(ordersForShipment) ? ordersForShipment : [];
    let peso = 0;
    let largura = 12;
    let altura = 2;
    let comprimento = 16;
    let insuranceValue = 0;
    let itemCount = 0;

    ordersList.forEach((order) => {
        (Array.isArray(order?.produtos) ? order.produtos : []).forEach((item) => {
            const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
            const profile = getPackageProfileFromItem(item);
            peso += Number(profile.peso || 0) * quantity;
            largura = Math.max(largura, Number(profile.largura || 0));
            comprimento = Math.max(comprimento, Number(profile.comprimento || 0));
            altura += Math.max(1, Number(profile.altura || 0)) * quantity;
            insuranceValue += Number(item?.preco || 0) * quantity;
            itemCount += quantity;
        });
    });

    if (itemCount > 1) {
        largura += 2;
        comprimento += 2;
    }

    return {
        formato: "box",
        peso: roundNumber(Math.max(0.1, peso), 3),
        largura: Math.max(12, Math.round(largura)),
        altura: Math.max(2, Math.min(40, Math.round(altura))),
        comprimento: Math.max(16, Math.round(comprimento)),
        insuranceValue: roundCurrency(Math.max(1, insuranceValue))
    };
}

function inferPackagePreset(packageData) {
    const pacote = packageData || {};
    if (!isPackageReady(pacote)) return "personalizado";
    const presets = ["envelope", "caixa_p", "caixa_m", "caixa_g"];

    for (const key of presets) {
        const preset = PACKAGE_PRESETS[key];
        const matchesWeight = Number(pacote.peso || 0) <= Number(preset.peso || 0);
        const matchesWidth = Number(pacote.largura || 0) <= Number(preset.largura || 0);
        const matchesHeight = Number(pacote.altura || 0) <= Number(preset.altura || 0);
        const matchesLength = Number(pacote.comprimento || 0) <= Number(preset.comprimento || 0);
        if (matchesWeight && matchesWidth && matchesHeight && matchesLength) return key;
    }

    return "personalizado";
}

function normalizePackageData(packageData, fallbackOrders) {
    const raw = packageData && typeof packageData === "object" ? packageData : {};
    const fallback = buildSuggestedPackage(fallbackOrders);

    return {
        formato: sanitizePlainText(raw.formato || fallback.formato, 30) || "box",
        peso: roundNumber(raw.peso || fallback.peso, 3),
        largura: Math.max(1, parseInt(raw.largura, 10) || fallback.largura),
        altura: Math.max(1, parseInt(raw.altura, 10) || fallback.altura),
        comprimento: Math.max(1, parseInt(raw.comprimento, 10) || fallback.comprimento),
        insuranceValue: roundCurrency(raw.insuranceValue ?? fallback.insuranceValue)
    };
}

function getRemessaId(order) {
    return sanitizePlainText(order?.expedicao?.remessaId, 60);
}

function getOrdersByRemessa(remessaId) {
    const safeRemessaId = sanitizePlainText(remessaId, 60);
    if (!safeRemessaId) return [];
    return state.orders.filter((order) => getRemessaId(order) === safeRemessaId);
}

function getOrderDisplayId(order) {
    return sanitizePlainText(order?.id, 40).slice(0, 6).toUpperCase() || "PEDIDO";
}

function getOrderItemsCount(order) {
    return (Array.isArray(order?.produtos) ? order.produtos : []).reduce((acc, item) => {
        return acc + Math.max(1, parseInt(item?.quantity, 10) || 1);
    }, 0);
}

function hasCustomWork(order) {
    return (Array.isArray(order?.produtos) ? order.produtos : []).some((item) => {
        return item?.isCombo === true || Boolean(item?.personalizacao?.texto) || Boolean(item?.personalizacao?.observacoes);
    });
}

function buildDestinationSignature(destination) {
    const data = destination || {};
    return [
        normalizePostalCode(data.cep),
        stripAccents(sanitizePlainText(data.rua, 140)).toLowerCase(),
        stripAccents(sanitizePlainText(data.numero, 40)).toLowerCase(),
        stripAccents(sanitizePlainText(data.cidade, 120)).toLowerCase()
    ].join("|");
}

function getCompatibleOrders(order) {
    const activeOrder = order || getActiveOrder();
    if (!activeOrder) return [];

    const signature = buildDestinationSignature(normalizeDestination(activeOrder));
    if (!signature.replace(/\|/g, "")) return [];

    return state.orders.filter((candidate) => {
        if (candidate.id === activeOrder.id) return false;
        if (normalizeOrderStatus(candidate.status) === "cancelado") return false;
        return buildDestinationSignature(normalizeDestination(candidate)) === signature;
    });
}

function getSelectedRelatedOrders(order) {
    const activeOrder = order || getActiveOrder();
    if (!activeOrder) return [];

    const ids = new Set([activeOrder.id]);
    state.compatibleSelection.forEach((id) => ids.add(id));

    return state.orders.filter((candidate) => ids.has(candidate.id));
}

function getFilteredOrders() {
    const search = state.searchTerm;
    return state.orders.filter((order) => {
        const status = normalizeOrderStatus(order.status);
        if (state.filteredStatus !== "todos" && status !== state.filteredStatus) return false;
        if (state.onlyCustom && !hasCustomWork(order)) return false;
        if (!search) return true;

        const haystack = [
            order.id,
            order.cliente?.nome,
            order.cliente?.email,
            order.cliente?.telefone,
            normalizeDestination(order).cidade,
            normalizeDestination(order).rua,
            getRemessaId(order),
            ...(Array.isArray(order?.produtos) ? order.produtos.map((item) => item?.nome) : [])
        ].map((value) => stripAccents(sanitizePlainText(value, 180)).toLowerCase()).join(" ");

        return haystack.includes(stripAccents(search).toLowerCase());
    });
}

function isDestinationReady(destination) {
    const data = destination || {};
    return Boolean(data.nome && data.telefone && normalizePostalCode(data.cep).length === 8 && data.rua && data.numero && data.cidade);
}

function isPackageReady(packageData) {
    const pacote = packageData || {};
    return Number(pacote.peso || 0) > 0 &&
        Number(pacote.largura || 0) > 0 &&
        Number(pacote.altura || 0) > 0 &&
        Number(pacote.comprimento || 0) > 0;
}

function isExpeditionReady(order) {
    const destination = normalizeDestination(order);
    const relatedOrders = getRemessaId(order) ? getOrdersByRemessa(getRemessaId(order)) : [order];
    const packageData = normalizePackageData(order?.expedicao?.pacote, relatedOrders);
    return isDestinationReady(destination) && isPackageReady(packageData);
}

function applyStatusFilter(status) {
    state.filteredStatus = STATUS_ORDER.includes(status) || status === "todos" ? status : "todos";
    if (elements.ordersStatusSelect) elements.ordersStatusSelect.value = state.filteredStatus;
    elements.ordersFilterChips?.querySelectorAll("[data-status]").forEach((button) => {
        button.classList.toggle("active", button.dataset.status === state.filteredStatus);
    });
    renderOrdersPage();
}

function setPageFeedback(message, type = "info") {
    const element = elements.ordersFeedback;
    if (!element) return;

    if (!message) {
        element.classList.add("orders-hidden");
        element.textContent = "";
        return;
    }

    element.className = `orders-feedback ${type === "error" ? "orders-feedback-error" : ""}`;
    element.textContent = message;
}

function setModalFeedback(message, type = "info") {
    const element = elements.ordersModalFeedback;
    if (!element) return;

    if (!message) {
        element.classList.add("orders-hidden");
        element.textContent = "";
        return;
    }

    element.className = `orders-feedback ${type === "error" ? "orders-feedback-error" : ""}`;
    element.textContent = message;
}

function renderOverviewStats() {
    const remessas = new Set();
    let pending = 0;
    let processing = 0;
    let ready = 0;
    let custom = 0;

    state.orders.forEach((order) => {
        const status = normalizeOrderStatus(order.status);
        if (status === "pendente") pending += 1;
        if (status === "processando") processing += 1;
        if (hasCustomWork(order)) custom += 1;
        if (isExpeditionReady(order)) ready += 1;
        if (getRemessaId(order)) remessas.add(getRemessaId(order));
    });

    if (elements.ordersCountTotal) elements.ordersCountTotal.textContent = String(state.orders.length);
    if (elements.ordersCountPending) elements.ordersCountPending.textContent = String(pending);
    if (elements.ordersCountProcessing) elements.ordersCountProcessing.textContent = String(processing);
    if (elements.ordersCountRemessas) elements.ordersCountRemessas.textContent = String(remessas.size);
    if (elements.ordersCountReady) elements.ordersCountReady.textContent = String(ready);
    if (elements.ordersCountCustom) elements.ordersCountCustom.textContent = String(custom);
}

function renderOrdersList() {
    const filteredOrders = getFilteredOrders();
    const list = elements.ordersList;
    if (!list) return;

    if (elements.ordersLoading) elements.ordersLoading.classList.add("orders-hidden");

    if (filteredOrders.length === 0) {
        list.innerHTML = "";
        elements.ordersEmpty?.classList.remove("orders-hidden");
        return;
    }

    elements.ordersEmpty?.classList.add("orders-hidden");

    list.innerHTML = filteredOrders.map((order) => {
        const status = normalizeOrderStatus(order.status);
        const meta = STATUS_META[status] || STATUS_META.pendente;
        const destination = normalizeDestination(order);
        const storeQuote = normalizeQuoteOption(order.frete);
        const adminQuote = normalizeQuoteOption(order?.expedicao?.quote);
        const remessaId = getRemessaId(order);
        const chips = [
            hasCustomWork(order) ? '<span class="chip-soft">Personalizado</span>' : "",
            remessaId ? `<span class="chip-soft">Remessa ${escapeHtml(remessaId)}</span>` : "",
            adminQuote ? '<span class="chip-soft">Cotacao operacional</span>' : ""
        ].filter(Boolean).join("");

        return `
            <article class="orders-card orders-list-card">
                <button type="button" class="orders-order-trigger" data-open-order="${escapeHtml(order.id)}">
                    <div class="orders-order-head">
                        <div class="orders-order-copy">
                            <div class="orders-order-title-row">
                                <strong>#${escapeHtml(getOrderDisplayId(order))}</strong>
                                <span class="status-pill ${meta.className}">
                                    <i class="${meta.icon}"></i>
                                    ${meta.label}
                                </span>
                            </div>
                            <p class="orders-order-subtitle">${escapeHtml(sanitizePlainText(order?.cliente?.nome, 120) || "Cliente sem nome")}</p>
                            <p class="orders-order-meta">
                                ${escapeHtml(formatDateTime(order?.data))}
                                <span>&bull;</span>
                                ${escapeHtml(destination.cidade || "Cidade nao informada")}
                            </p>
                        </div>
                        <div class="orders-order-value">
                            <strong>${escapeHtml(formatCurrency(order?.total || 0))}</strong>
                            <span>${escapeHtml(`${getOrderItemsCount(order)} item(ns)`)}</span>
                        </div>
                    </div>
                    <div class="orders-order-body">
                        <div class="orders-chip-row">${chips || '<span class="chip-soft">Pedido sob demanda</span>'}</div>
                        <div class="orders-order-grid">
                            <div>
                                <span class="orders-field-label">Frete da loja</span>
                                <p>${escapeHtml(storeQuote ? `${storeQuote.company} - ${storeQuote.name}` : "Nao informado")}</p>
                            </div>
                            <div>
                                <span class="orders-field-label">Rastreio</span>
                                <p>${escapeHtml(sanitizePlainText(order?.expedicao?.trackingCode, 80) || "Ainda nao preenchido")}</p>
                            </div>
                            <div>
                                <span class="orders-field-label">Expedicao</span>
                                <p>${escapeHtml(isExpeditionReady(order) ? "Pronta para envio" : "Ainda incompleta")}</p>
                            </div>
                        </div>
                    </div>
                </button>
            </article>
        `;
    }).join("");
}

function renderOrdersPage() {
    renderOverviewStats();
    renderOrdersList();

    const activeOrder = getActiveOrder();
    const focusInsideModal = elements.ordersModal?.contains(document.activeElement);
    if (activeOrder && isModalOpen() && !focusInsideModal) renderOrderModal(activeOrder);
}

function getActiveOrder() {
    if (!state.activeOrderId) return null;
    return state.orders.find((order) => order.id === state.activeOrderId) || null;
}

function setQuoteMode(mode) {
    state.quoteMode = mode === "manual" ? "manual" : "catalogo";
    elements.ordersQuoteModeGroup?.querySelectorAll("[data-quote-mode]").forEach((button) => {
        button.classList.toggle("active", button.dataset.quoteMode === state.quoteMode);
    });

    if (elements.ordersPackageHint) {
        elements.ordersPackageHint.textContent = state.quoteMode === "manual"
            ? "A cotacao vai usar o pacote manual desta remessa."
            : "A cotacao vai somar os perfis de frete do cadastro das pecas.";
    }
}

function setPackagePreset(presetKey, applyValues) {
    const nextPreset = PACKAGE_PRESETS[presetKey] ? presetKey : "personalizado";
    state.activePackagePreset = nextPreset;
    elements.ordersPackagePresets?.querySelectorAll("[data-package-preset]").forEach((button) => {
        button.classList.toggle("active", button.dataset.packagePreset === nextPreset);
    });

    if (!applyValues || nextPreset === "personalizado") return;

    const preset = PACKAGE_PRESETS[nextPreset];
    setPackageFields({
        formato: preset.formato,
        peso: preset.peso,
        largura: preset.largura,
        altura: preset.altura,
        comprimento: preset.comprimento,
        insuranceValue: Number(elements.expInsurance?.value || 0)
    });
}

function setPackageFields(packageData) {
    const pacote = packageData || {};
    if (elements.expPeso) elements.expPeso.value = pacote.peso != null ? String(pacote.peso) : "";
    if (elements.expLargura) elements.expLargura.value = pacote.largura != null ? String(pacote.largura) : "";
    if (elements.expAltura) elements.expAltura.value = pacote.altura != null ? String(pacote.altura) : "";
    if (elements.expComprimento) elements.expComprimento.value = pacote.comprimento != null ? String(pacote.comprimento) : "";
    if (elements.expInsurance) elements.expInsurance.value = pacote.insuranceValue != null ? String(roundCurrency(pacote.insuranceValue)) : "";
}

function readPackageForm() {
    return {
        formato: state.activePackagePreset === "envelope" ? "envelope" : "box",
        peso: roundNumber(elements.expPeso?.value, 3),
        largura: Math.max(1, parseInt(elements.expLargura?.value, 10) || 0),
        altura: Math.max(1, parseInt(elements.expAltura?.value, 10) || 0),
        comprimento: Math.max(1, parseInt(elements.expComprimento?.value, 10) || 0),
        insuranceValue: roundCurrency(elements.expInsurance?.value)
    };
}

function applySuggestedPackageToForm() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;

    const suggested = buildSuggestedPackage(getSelectedRelatedOrders(activeOrder));
    const inferred = inferPackagePreset(suggested);
    setPackageFields(suggested);
    setPackagePreset(inferred, false);
    setModalFeedback("Sugestao de pacote atualizada com base nos pedidos selecionados.", "info");
}

function fillExpeditionForm(order) {
    const relatedOrders = getSelectedRelatedOrders(order);
    const destination = normalizeDestination(order);
    const packageData = normalizePackageData(order?.expedicao?.pacote, relatedOrders);
    const inferredPreset = sanitizePlainText(order?.expedicao?.packagePreset, 40) || inferPackagePreset(packageData);

    if (elements.expNome) elements.expNome.value = destination.nome;
    if (elements.expTelefone) elements.expTelefone.value = destination.telefone;
    if (elements.expEmail) elements.expEmail.value = destination.email;
    if (elements.expDocumento) elements.expDocumento.value = destination.documento;
    if (elements.expCep) elements.expCep.value = formatPostalCode(destination.cep);
    if (elements.expRua) elements.expRua.value = destination.rua;
    if (elements.expNumero) elements.expNumero.value = destination.numero;
    if (elements.expComplemento) elements.expComplemento.value = destination.complemento;
    if (elements.expBairro) elements.expBairro.value = destination.bairro;
    if (elements.expCidade) elements.expCidade.value = destination.cidade;
    if (elements.expEstado) elements.expEstado.value = destination.estado;
    if (elements.expObservacoes) elements.expObservacoes.value = sanitizePlainText(order?.expedicao?.observacoes, 600);
    if (elements.expTracking) elements.expTracking.value = sanitizePlainText(order?.expedicao?.trackingCode, 80);

    setPackageFields(packageData);
    setPackagePreset(inferredPreset, false);
    setQuoteMode(order?.expedicao?.quoteMode === "manual" ? "manual" : "catalogo");
}

function renderCompatibleSelectionSummary() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;

    const selectedOrders = getSelectedRelatedOrders(activeOrder);
    const extraCount = Math.max(0, selectedOrders.length - 1);
    if (elements.ordersCompatibleCount) {
        elements.ordersCompatibleCount.textContent = extraCount > 0
            ? `${extraCount} pedido(s) junto(s)`
            : "Sem agrupamento";
    }

    if (elements.ordersModalRemessa) {
        const remessaId = sanitizePlainText(activeOrder?.expedicao?.remessaId, 60);
        elements.ordersModalRemessa.textContent = remessaId
            ? `Remessa ${remessaId}`
            : (extraCount > 0 ? "Nova remessa em montagem" : "Sem remessa");
    }
}

function renderCompatibleOrders(order) {
    const compatibleOrders = getCompatibleOrders(order);
    const currentRemessaId = getRemessaId(order);

    if (currentRemessaId && state.compatibleSelection.size === 0) {
        getOrdersByRemessa(currentRemessaId)
            .filter((candidate) => candidate.id !== order.id)
            .forEach((candidate) => state.compatibleSelection.add(candidate.id));
    }

    if (!elements.ordersCompatibleList || !elements.ordersCompatibleNote) return;

    if (compatibleOrders.length === 0) {
        elements.ordersCompatibleList.innerHTML = "";
        elements.ordersCompatibleNote.classList.remove("orders-hidden");
        elements.ordersCompatibleNote.textContent = "Nao ha outros pedidos com o mesmo endereco base para agrupar agora.";
        renderCompatibleSelectionSummary();
        return;
    }

    elements.ordersCompatibleNote.classList.add("orders-hidden");
    elements.ordersCompatibleList.innerHTML = compatibleOrders.map((candidate) => {
        const checked = state.compatibleSelection.has(candidate.id);
        const status = normalizeOrderStatus(candidate.status);
        const meta = STATUS_META[status] || STATUS_META.pendente;
        return `
            <label class="compatible-order">
                <input type="checkbox" data-compatible-order="${escapeHtml(candidate.id)}" ${checked ? "checked" : ""}>
                <div class="min-w-0">
                    <div class="orders-order-title-row">
                        <strong>#${escapeHtml(getOrderDisplayId(candidate))}</strong>
                        <span class="status-pill ${meta.className}">${meta.label}</span>
                    </div>
                    <p>${escapeHtml(sanitizePlainText(candidate?.cliente?.nome, 120) || "Cliente sem nome")}</p>
                    <p class="orders-page-note">${escapeHtml(formatCurrency(candidate?.total || 0))} &bull; ${escapeHtml(`${getOrderItemsCount(candidate)} item(ns)`)}</p>
                </div>
            </label>
        `;
    }).join("");

    renderCompatibleSelectionSummary();
}

function renderStatusButtons(order) {
    if (!elements.ordersStatusActions) return;
    const activeStatus = normalizeOrderStatus(order?.status);
    elements.ordersStatusActions.innerHTML = STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status];
        const isActive = status === activeStatus;
        return `
            <button type="button" class="orders-btn ${isActive ? "orders-btn-primary" : "orders-btn-secondary"}" data-next-status="${status}">
                <i class="${meta.icon}"></i>
                ${meta.label}
            </button>
        `;
    }).join("");
}

function renderOrderItems(order) {
    if (!elements.ordersModalItems) return;
    const items = Array.isArray(order?.produtos) ? order.produtos : [];

    elements.ordersModalItems.innerHTML = items.map((item) => {
        const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
        const baseDetails = [];
        const size = sanitizePlainText(item?.tamanho, 20);
        const color = sanitizePlainText(item?.cor?.nome, 40);
        if (size) baseDetails.push(`Tam: ${size}`);
        if (color) baseDetails.push(`Cor: ${color}`);
        if (item?.personalizacao?.texto) baseDetails.push(`Personalizacao: ${sanitizePlainText(item.personalizacao.texto, 120)}`);

        let comboHtml = "";
        if (item?.isCombo === true && Array.isArray(item?.componentes)) {
            comboHtml = `
                <div class="orders-item-extra">
                    ${(item.componentes || []).map((component, index) => {
                        const selection = item?.comboSelections?.[index] || {};
                        const componentColor = sanitizePlainText(selection?.cor?.nome, 40);
                        const componentSize = sanitizePlainText(selection?.tamanho, 20);
                        const suffix = [componentColor, componentSize].filter(Boolean).join(" / ");
                        return `<div>&bull; ${escapeHtml(`${component?.quantidade || 1}x ${sanitizePlainText(component?.nome, 120) || "Item"}`)}${suffix ? ` <span>${escapeHtml(suffix)}</span>` : ""}</div>`;
                    }).join("")}
                </div>
            `;
        }

        return `
            <article class="order-item">
                <div class="orders-order-head">
                    <div class="orders-order-copy">
                        <strong>${escapeHtml(`${quantity}x ${sanitizePlainText(item?.nome, 120) || "Item do pedido"}`)}</strong>
                        <p class="orders-page-note">${escapeHtml(baseDetails.join(" | ") || "Sob demanda")}</p>
                    </div>
                    <strong>${escapeHtml(formatCurrency(Number(item?.preco || 0) * quantity))}</strong>
                </div>
                ${item?.personalizacao?.observacoes ? `<p class="orders-page-note">Obs: ${escapeHtml(sanitizePlainText(item.personalizacao.observacoes, 280))}</p>` : ""}
                ${comboHtml}
            </article>
        `;
    }).join("");
}

function renderOrderFinancial(order) {
    if (!elements.ordersModalFinancial) return;

    const adjustments = order?.ajustes || {};
    const rows = [
        ["Subtotal", formatCurrency(order?.subtotal || 0)],
        ["Frete cobrado", formatCurrency(order?.frete?.price || 0)],
        adjustments?.pixDiscount > 0 ? ["Desconto PIX", `-${formatCurrency(adjustments.pixDiscount)}`] : null,
        adjustments?.cardFee > 0 ? ["Taxa cartao", `+${formatCurrency(adjustments.cardFee)}`] : null,
        adjustments?.freeShipping ? ["Frete promocional", "Sim"] : null,
        ["Total final", formatCurrency(order?.total || 0)]
    ].filter(Boolean);

    elements.ordersModalFinancial.innerHTML = rows.map(([label, value]) => `
        <div class="orders-info-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `).join("");
}

function renderOrderClient(order) {
    if (!elements.ordersModalClient) return;
    const destination = normalizeDestination(order);

    elements.ordersModalClient.innerHTML = `
        <div class="orders-info-row"><span>Nome</span><strong>${escapeHtml(destination.nome || "Nao informado")}</strong></div>
        <div class="orders-info-row"><span>Telefone</span><strong>${escapeHtml(destination.telefone || "Nao informado")}</strong></div>
        <div class="orders-info-row"><span>E-mail</span><strong>${escapeHtml(destination.email || "Nao informado")}</strong></div>
        <div class="orders-info-row"><span>Documento</span><strong>${escapeHtml(destination.documento || "Nao preenchido")}</strong></div>
    `;
}

function renderOrderAddress(order) {
    if (!elements.ordersModalAddress) return;
    const destination = normalizeDestination(order);
    const addressLines = [
        destination.rua ? `${destination.rua}, ${destination.numero || "s/n"}` : "",
        [destination.bairro, destination.cidade, destination.estado].filter(Boolean).join(" - "),
        destination.complemento || "",
        destination.cep ? formatPostalCode(destination.cep) : ""
    ].filter(Boolean);

    elements.ordersModalAddress.innerHTML = addressLines.length
        ? addressLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
        : "<p>Endereco ainda incompleto.</p>";
}

function renderQuoteOptions() {
    if (!elements.ordersQuoteOptions || !elements.ordersQuoteFeedback) return;

    const feedback = elements.ordersQuoteFeedback;
    const list = elements.ordersQuoteOptions;
    feedback.classList.add("orders-hidden");
    list.innerHTML = "";

    if (!ADMIN_OPERATIONAL_SHIPPING_ENABLED) {
        feedback.className = "orders-feedback";
        feedback.textContent = ADMIN_OPERATIONAL_SHIPPING_PAUSE_MESSAGE;

        const activeOrder = getActiveOrder();
        const savedQuote = normalizeQuoteOption(activeOrder?.expedicao?.quote);
        if (!savedQuote) {
            list.innerHTML = '<p class="orders-page-note">Sem cotacao automatica no momento. Salve observacoes, pacote e rastreio manualmente.</p>';
            return;
        }

        state.quote = {
            loading: false,
            requested: true,
            error: "",
            options: [savedQuote],
            selectedId: savedQuote.id
        };
    }

    if (state.quote.loading) {
        list.innerHTML = `
            <div class="orders-loading-shell compact">
                <div class="orders-loading-spinner"></div>
                <p>Recotando frete operacional...</p>
            </div>
        `;
        return;
    }

    if (state.quote.error) {
        feedback.className = "orders-feedback orders-feedback-error";
        feedback.textContent = state.quote.error;
        return;
    }

    if (!state.quote.options.length) {
        const activeOrder = getActiveOrder();
        const savedQuote = normalizeQuoteOption(activeOrder?.expedicao?.quote);
        if (!savedQuote) {
            list.innerHTML = '<p class="orders-page-note">Ainda nao existe cotacao operacional salva para esta remessa.</p>';
            return;
        }

        state.quote = {
            loading: false,
            requested: true,
            error: "",
            options: [savedQuote],
            selectedId: savedQuote.id
        };
    }

    list.innerHTML = state.quote.options.map((option) => {
        const checked = option.id === state.quote.selectedId;
        const helper = option.originalPrice > option.price
            ? `${formatCurrency(option.originalPrice)} antes do desconto operacional`
            : `${option.deliveryTime} dia(s) uteis`;
        return `
            <button type="button" class="orders-quote-option ${checked ? "active" : ""}" data-quote-option="${escapeHtml(option.id)}">
                <div>
                    <strong>${escapeHtml(`${option.company} - ${option.name}`)}</strong>
                    <p>${escapeHtml(helper)}</p>
                </div>
                <div class="text-right">
                    <strong>${escapeHtml(formatCurrency(option.price))}</strong>
                    <p>${escapeHtml(`${option.deliveryTime} dia(s)`)}</p>
                </div>
            </button>
        `;
    }).join("");
}

function buildWhatsappLink(order) {
    const phone = String(order?.cliente?.telefone || "").replace(/\D/g, "");
    if (!phone) return "#";
    return `https://wa.me/55${phone.startsWith("55") ? phone.slice(2) : phone}`;
}

function renderOrderModal(order) {
    const status = normalizeOrderStatus(order?.status);
    const meta = STATUS_META[status] || STATUS_META.pendente;
    const storeQuote = normalizeQuoteOption(order?.frete);
    const relatedOrders = getSelectedRelatedOrders(order);
    const remessaId = getRemessaId(order);
    const activeQuote = getQuoteFromStateOrOrder(order);

    if (elements.ordersModalTitle) elements.ordersModalTitle.textContent = `Pedido #${getOrderDisplayId(order)}`;
    if (elements.ordersModalSubtitle) {
        elements.ordersModalSubtitle.textContent = `${formatDateTime(order?.data)} • ${sanitizePlainText(order?.cliente?.nome, 120) || "Cliente sem nome"}`;
    }
    if (elements.ordersModalStatus) {
        elements.ordersModalStatus.className = `status-pill ${meta.className}`;
        elements.ordersModalStatus.innerHTML = `<i class="${meta.icon}"></i>${meta.label}`;
    }
    if (elements.ordersModalTotal) elements.ordersModalTotal.textContent = formatCurrency(order?.total || 0);
    if (elements.ordersModalPayment) {
        const payment = sanitizePlainText(order?.pagamento, 80) || "Pagamento nao informado";
        const parcelas = Math.max(1, parseInt(order?.parcelas, 10) || 1);
        elements.ordersModalPayment.textContent = payment.includes("Cartao") ? `${payment} • ${parcelas}x` : payment;
    }
    if (elements.ordersModalStoreShipping) {
        elements.ordersModalStoreShipping.textContent = storeQuote ? `${storeQuote.company} - ${storeQuote.name}` : "Nao informado";
    }
    if (elements.ordersModalStoreDelivery) {
        elements.ordersModalStoreDelivery.textContent = storeQuote ? `${storeQuote.deliveryTime} dia(s) uteis` : "Sem prazo salvo";
    }
    if (elements.ordersModalItemCount) elements.ordersModalItemCount.textContent = `${getOrderItemsCount(order)} item(ns)`;
    if (elements.ordersModalRemessa) {
        elements.ordersModalRemessa.textContent = remessaId
            ? `Remessa ${remessaId}`
            : (relatedOrders.length > 1 ? "Nova remessa em montagem" : "Sem remessa");
    }
    if (elements.ordersModalUpdated) elements.ordersModalUpdated.textContent = formatDateTime(order?.updatedAtAdmin || order?.data);
    if (elements.ordersModalTracking) {
        elements.ordersModalTracking.textContent = sanitizePlainText(order?.expedicao?.trackingCode, 80) || "Sem rastreio";
    }
    if (elements.ordersModalCustomChip) {
        elements.ordersModalCustomChip.textContent = hasCustomWork(order) ? "Com personalizacao" : "Sem personalizacao";
    }
    if (elements.ordersModalWhatsapp) {
        elements.ordersModalWhatsapp.href = buildWhatsappLink(order);
        elements.ordersModalWhatsapp.classList.toggle("disabled", elements.ordersModalWhatsapp.href === "#");
    }

    renderOrderClient(order);
    renderOrderAddress(order);
    renderStatusButtons(order);
    renderOrderItems(order);
    renderOrderFinancial(order);
    fillExpeditionForm(order);
    renderCompatibleOrders(order);
    renderQuoteOptions();

    if (elements.ordersQuoteFeedback && activeQuote && !state.quote.error) {
        elements.ordersQuoteFeedback.className = "orders-feedback";
        elements.ordersQuoteFeedback.textContent = `Cotacao ativa: ${activeQuote.company} - ${activeQuote.name} por ${formatCurrency(activeQuote.price)}.`;
    }
}

function isModalOpen() {
    return elements.ordersModal?.classList.contains("visible");
}

function openOrderModal(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return;

    state.activeOrderId = order.id;
    state.compatibleSelection = new Set();
    state.quote = createEmptyQuoteState();

    if (getRemessaId(order)) {
        getOrdersByRemessa(getRemessaId(order))
            .filter((candidate) => candidate.id !== order.id)
            .forEach((candidate) => state.compatibleSelection.add(candidate.id));
    }

    renderOrderModal(order);
    setModalFeedback("", "info");
    elements.ordersModal?.classList.add("visible");
    if (elements.ordersModal) elements.ordersModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
}

function closeOrderModal() {
    elements.ordersModal?.classList.remove("visible");
    if (elements.ordersModal) elements.ordersModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setModalFeedback("", "info");
}

function buildExpeditionPayload(order, relatedOrderIds, remessaId) {
    const destination = {
        nome: sanitizePlainText(elements.expNome?.value, 120),
        telefone: sanitizePlainText(elements.expTelefone?.value, 30),
        email: sanitizePlainText(elements.expEmail?.value, 120),
        documento: sanitizePlainText(elements.expDocumento?.value, 30),
        cep: normalizePostalCode(elements.expCep?.value),
        rua: sanitizePlainText(elements.expRua?.value, 140),
        numero: sanitizePlainText(elements.expNumero?.value, 40),
        complemento: sanitizePlainText(elements.expComplemento?.value, 80),
        bairro: sanitizePlainText(elements.expBairro?.value, 80),
        cidade: sanitizePlainText(elements.expCidade?.value, 120),
        estado: sanitizePlainText(elements.expEstado?.value, 2).toUpperCase()
    };
    const packageData = readPackageForm();
    const selectedQuote = getQuoteFromStateOrOrder(order);

    return {
        destinatario: destination,
        pacote: packageData,
        packagePreset: state.activePackagePreset,
        quoteMode: state.quoteMode,
        observacoes: sanitizePlainText(elements.expObservacoes?.value, 600),
        trackingCode: sanitizePlainText(elements.expTracking?.value, 80),
        remessaId: remessaId || null,
        linkedOrderIds: relatedOrderIds.filter((id) => id !== order.id),
        quote: selectedQuote ? { ...selectedQuote, quotedAt: selectedQuote.quotedAt || new Date().toISOString() } : null,
        savedAt: new Date().toISOString()
    };
}

async function saveExpedition() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;

    const relatedOrders = getSelectedRelatedOrders(activeOrder);
    const relatedIds = relatedOrders.map((order) => order.id);
    const previousRemessaOrders = getRemessaId(activeOrder) ? getOrdersByRemessa(getRemessaId(activeOrder)) : [];
    const shouldGroup = relatedIds.length > 1;
    const remessaId = shouldGroup ? (getRemessaId(activeOrder) || `RMS-${Date.now().toString(36).toUpperCase()}`) : "";
    const expeditionBase = buildExpeditionPayload(activeOrder, relatedIds, remessaId);
    const idsToClear = previousRemessaOrders.filter((candidate) => !relatedIds.includes(candidate.id)).map((candidate) => candidate.id);

    if (!isDestinationReady(expeditionBase.destinatario)) {
        setModalFeedback("Preencha ao menos nome, telefone, CEP, rua, numero e cidade para salvar a expedicao.", "error");
        return;
    }
    if (!isPackageReady(expeditionBase.pacote)) {
        setModalFeedback("Defina peso e medidas validas para salvar a expedicao.", "error");
        return;
    }

    try {
        const batch = ordersDb.batch();

        relatedOrders.forEach((order) => {
            batch.update(ordersDb.collection("pedidos").doc(order.id), {
                expedicao: {
                    ...expeditionBase,
                    linkedOrderIds: relatedIds.filter((candidateId) => candidateId !== order.id)
                },
                updatedAtAdmin: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        idsToClear.forEach((orderId) => {
            const order = state.orders.find((entry) => entry.id === orderId);
            if (!order) return;
            const currentExpedition = order.expedicao && typeof order.expedicao === "object" ? order.expedicao : {};
            batch.update(ordersDb.collection("pedidos").doc(orderId), {
                expedicao: {
                    ...currentExpedition,
                    remessaId: null,
                    linkedOrderIds: [],
                    savedAt: new Date().toISOString()
                },
                updatedAtAdmin: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        setModalFeedback("Expedicao salva com sucesso.", "info");
        scheduleModalRefresh();
    } catch (error) {
        console.error("[admin-orders.saveExpedition]", error);
        setModalFeedback(`Nao foi possivel salvar a expedicao: ${sanitizePlainText(error?.message, 220) || "erro inesperado"}`, "error");
    }
}

async function clearRemessa() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;

    const relatedOrders = getSelectedRelatedOrders(activeOrder);
    if (relatedOrders.length <= 1 && !getRemessaId(activeOrder)) {
        setModalFeedback("Nao existe remessa ativa para desfazer.", "error");
        return;
    }
    if (!window.confirm("Deseja remover o agrupamento desta remessa?")) return;

    try {
        const batch = ordersDb.batch();
        relatedOrders.forEach((order) => {
            const currentExpedition = order.expedicao && typeof order.expedicao === "object" ? order.expedicao : {};
            batch.update(ordersDb.collection("pedidos").doc(order.id), {
                expedicao: {
                    ...currentExpedition,
                    remessaId: null,
                    linkedOrderIds: [],
                    savedAt: new Date().toISOString()
                },
                updatedAtAdmin: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        state.compatibleSelection = new Set();
        setModalFeedback("Remessa desagrupada.", "info");
        scheduleModalRefresh();
    } catch (error) {
        console.error("[admin-orders.clearRemessa]", error);
        setModalFeedback("Nao foi possivel desagrupar a remessa agora.", "error");
    }
}

async function updateOrderStatus(nextStatus) {
    const activeOrder = getActiveOrder();
    if (!activeOrder || !STATUS_ORDER.includes(nextStatus)) return;

    try {
        const adminUser = ordersAuth.currentUser;
        if (!adminUser) {
            throw new Error("Sessao administrativa expirada.");
        }

        const authToken = await adminUser.getIdToken();
        const response = await fetch(buildBackendUrl("/api/admin/orders/status"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({
                orderId: activeOrder.id,
                status: nextStatus
            })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
            throw new Error(sanitizePlainText(payload?.error, 220) || "Nao foi possivel atualizar o status agora.");
        }

        const pushInfo = payload?.push?.sent > 0 ? ` Notificacao enviada para ${payload.push.sent} aparelho(s).` : "";
        setModalFeedback(`Status atualizado para ${STATUS_META[nextStatus].label}.${pushInfo}`, "info");
        scheduleModalRefresh();
    } catch (error) {
        console.error("[admin-orders.updateOrderStatus]", error);
        setModalFeedback(sanitizePlainText(error?.message, 220) || "Nao foi possivel atualizar o status agora.", "error");
    }
}

async function archiveOrder() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;
    if (!window.confirm(`Arquivar o pedido #${getOrderDisplayId(activeOrder)}?`)) return;

    try {
        await ordersDb.collection("pedidos").doc(activeOrder.id).delete();
        closeOrderModal();
        setPageFeedback(`Pedido #${getOrderDisplayId(activeOrder)} arquivado.`, "info");
    } catch (error) {
        console.error("[admin-orders.archiveOrder]", error);
        setModalFeedback("Nao foi possivel arquivar o pedido.", "error");
    }
}

function buildQuoteCart(ordersForShipment) {
    return (Array.isArray(ordersForShipment) ? ordersForShipment : []).flatMap((order) => {
        return (Array.isArray(order?.produtos) ? order.produtos : []).map((item, index) => ({
            cartId: `${order.id}-${index + 1}`,
            id: sanitizePlainText(item?.id || item?.cartId, 120),
            nome: sanitizePlainText(item?.nome, 120),
            categoria: sanitizePlainText(item?.categoria, 40),
            preco: roundCurrency(item?.preco),
            quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
            isCombo: item?.isCombo === true,
            frete: item?.frete && typeof item.frete === "object" ? item.frete : null
        }));
    }).filter((item) => item.id);
}

async function quoteOperationalShipping() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return;

    if (!ADMIN_OPERATIONAL_SHIPPING_ENABLED) {
        state.quote = {
            ...createEmptyQuoteState(),
            requested: true,
            error: ADMIN_OPERATIONAL_SHIPPING_PAUSE_MESSAGE
        };
        renderQuoteOptions();
        setModalFeedback(ADMIN_OPERATIONAL_SHIPPING_PAUSE_MESSAGE, "info");
        return;
    }

    const destinationCep = normalizePostalCode(elements.expCep?.value);
    const relatedOrders = getSelectedRelatedOrders(activeOrder);
    const cart = buildQuoteCart(relatedOrders);

    if (destinationCep.length !== 8) {
        setModalFeedback("Preencha um CEP valido antes de cotar o frete operacional.", "error");
        return;
    }
    if (!cart.length) {
        setModalFeedback("Nao ha itens suficientes para cotar esta remessa.", "error");
        return;
    }

    const payload = { postalCode: destinationCep, cart };
    if (state.quoteMode === "manual") payload.packageOverride = readPackageForm();

    state.quote = { ...createEmptyQuoteState(), loading: true, requested: true };
    renderQuoteOptions();

    try {
        const response = await fetch(buildBackendUrl("/api/shipping/quote"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(extractShippingErrorMessage(data, response));

        const options = Array.isArray(data?.options)
            ? data.options.map((option) => normalizeQuoteOption(option)).filter(Boolean)
            : [];

        state.quote = {
            loading: false,
            requested: true,
            error: options.length ? "" : "Nenhuma opcao apareceu para essa remessa.",
            options,
            selectedId: options[0]?.id || ""
        };

        renderQuoteOptions();
        setModalFeedback("Cotacao operacional atualizada.", "info");
    } catch (error) {
        console.error("[admin-orders.quoteOperationalShipping]", error);
        state.quote = {
            loading: false,
            requested: true,
            error: sanitizePlainText(error?.message, 220) || "Nao foi possivel cotar a remessa.",
            options: [],
            selectedId: ""
        };
        renderQuoteOptions();
    }
}

function buildManifestPayload() {
    const activeOrder = getActiveOrder();
    if (!activeOrder) return {};

    const relatedOrders = getSelectedRelatedOrders(activeOrder);
    const expedition = buildExpeditionPayload(activeOrder, relatedOrders.map((order) => order.id), getRemessaId(activeOrder));
    const quote = getQuoteFromStateOrOrder(activeOrder);

    return {
        generatedAt: new Date().toISOString(),
        remessaId: expedition.remessaId || null,
        quoteMode: expedition.quoteMode,
        destinatario: expedition.destinatario,
        pacote: expedition.pacote,
        observacoes: expedition.observacoes,
        trackingCode: expedition.trackingCode,
        quote,
        pedidos: relatedOrders.map((order) => ({
            id: order.id,
            displayId: getOrderDisplayId(order),
            status: normalizeOrderStatus(order.status),
            total: roundCurrency(order.total),
            pagamento: sanitizePlainText(order.pagamento, 80),
            parcelas: Math.max(1, parseInt(order.parcelas, 10) || 1),
            cliente: sanitizePlainText(order?.cliente?.nome, 120),
            itens: (Array.isArray(order?.produtos) ? order.produtos : []).map((item) => ({
                nome: sanitizePlainText(item?.nome, 120),
                quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
                preco: roundCurrency(item?.preco),
                tamanho: sanitizePlainText(item?.tamanho, 20),
                cor: sanitizePlainText(item?.cor?.nome, 40),
                combo: item?.isCombo === true,
                personalizacao: item?.personalizacao || null
            }))
        }))
    };
}

function buildManifestText() {
    const payload = buildManifestPayload();
    const destinatario = payload.destinatario || {};
    const pacote = payload.pacote || {};
    const quote = payload.quote;

    let text = "LAMED - FICHA DE EXPEDICAO\n";
    text += "========================================\n";
    text += `Gerado em: ${formatDateTime(payload.generatedAt)}\n`;
    text += `Remessa: ${payload.remessaId || "Sem remessa"}\n`;
    text += `Modo de cotacao: ${payload.quoteMode === "manual" ? "Pacote manual" : "Cadastro das pecas"}\n\n`;
    text += "DESTINATARIO\n";
    text += `Nome: ${destinatario.nome || "-"}\n`;
    text += `Telefone: ${destinatario.telefone || "-"}\n`;
    text += `E-mail: ${destinatario.email || "-"}\n`;
    text += `Documento: ${destinatario.documento || "-"}\n`;
    text += `Endereco: ${[destinatario.rua, destinatario.numero].filter(Boolean).join(", ") || "-"}\n`;
    text += `Complemento: ${destinatario.complemento || "-"}\n`;
    text += `Bairro: ${destinatario.bairro || "-"}\n`;
    text += `Cidade/UF: ${[destinatario.cidade, destinatario.estado].filter(Boolean).join(" - ") || "-"}\n`;
    text += `CEP: ${formatPostalCode(destinatario.cep || "") || "-"}\n\n`;
    text += "PACOTE\n";
    text += `Peso: ${pacote.peso || 0} kg\n`;
    text += `Largura: ${pacote.largura || 0} cm\n`;
    text += `Altura: ${pacote.altura || 0} cm\n`;
    text += `Comprimento: ${pacote.comprimento || 0} cm\n`;
    text += `Valor segurado: ${formatCurrency(pacote.insuranceValue || 0)}\n\n`;
    text += "COTACAO OPERACIONAL\n";
    if (quote) {
        text += `Servico: ${quote.company} - ${quote.name}\n`;
        text += `Valor: ${formatCurrency(quote.price)}\n`;
        text += `Prazo: ${quote.deliveryTime} dia(s) uteis\n`;
    } else {
        text += "Sem cotacao operacional salva.\n";
    }
    text += "\nPEDIDOS DA REMESSA\n";
    (payload.pedidos || []).forEach((order) => {
        text += `#${order.displayId} | ${order.cliente} | ${formatCurrency(order.total)} | ${order.status}\n`;
        order.itens.forEach((item) => {
            const details = [item.tamanho, item.cor].filter(Boolean).join(" / ");
            text += `  - ${item.quantity}x ${item.nome}`;
            if (details) text += ` (${details})`;
            if (item.personalizacao?.texto) text += ` | Personalizacao: ${item.personalizacao.texto}`;
            text += "\n";
        });
    });
    text += "\nOBSERVACOES\n";
    text += `${payload.observacoes || "-"}\n`;
    text += `Rastreio: ${payload.trackingCode || "-"}\n`;
    return text;
}

function downloadFile(filename, content, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function scheduleModalRefresh() {
    window.setTimeout(() => {
        const activeOrder = getActiveOrder();
        if (activeOrder && isModalOpen()) renderOrderModal(activeOrder);
    }, 180);
}

async function startOrdersListener(forceRefresh = false) {
    if (forceRefresh) setPageFeedback("Atualizando pedidos...", "info");
    if (typeof state.unsubscribeOrders === "function") state.unsubscribeOrders();

    state.unsubscribeOrders = ordersDb.collection("pedidos")
        .orderBy("data", "desc")
        .onSnapshot((snapshot) => {
            state.orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            setPageFeedback("", "info");
            renderOrdersPage();

            const activeOrder = getActiveOrder();
            if (state.activeOrderId && !activeOrder) {
                closeOrderModal();
                state.activeOrderId = "";
            }
        }, (error) => {
            console.error("[admin-orders.listen]", error);
            setPageFeedback(`Nao foi possivel carregar os pedidos: ${sanitizePlainText(error?.message, 220) || "erro inesperado"}`, "error");
            elements.ordersLoading?.classList.add("orders-hidden");
        });
}

async function isAuthorizedAdmin(user) {
    if (!user) return false;
    if (ADMIN_UIDS.includes(user.uid)) return true;

    try {
        const tokenResult = await user.getIdTokenResult();
        return tokenResult?.claims?.admin === true;
    } catch (error) {
        return false;
    }
}

function init() {
    cacheElements();
    initStateOptions();
    bindEvents();
    applyStatusFilter("todos");
    setQuoteMode("catalogo");
    setPackagePreset("personalizado", false);

    ordersAuth.onAuthStateChanged(async (user) => {
        if (!(await isAuthorizedAdmin(user))) {
            ordersAuth.signOut().catch(() => {});
            window.location.href = "login-admin.html";
            return;
        }

        startOrdersListener();
    });
}

document.addEventListener("DOMContentLoaded", init);
