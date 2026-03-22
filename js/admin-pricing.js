import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    getFirestore,
    limit,
    onSnapshot,
    orderBy,
    query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U",
    authDomain: "site-lamed.firebaseapp.com",
    databaseURL: "https://site-lamed-default-rtdb.firebaseio.com",
    projectId: "site-lamed",
    storageBucket: "site-lamed.firebasestorage.app",
    messagingSenderId: "862756160215",
    appId: "1:862756160215:web:d0fded233682bf93eaa692",
    measurementId: "G-BL1G961PGT"
};

const PRECO_BASE = {
    aviamentos: {
        entretela: 25,
        botao: 2,
        etiqueta: 1.31,
        ziper: 8
    },
    embalagem: 3.07
};

const PRESETS = {
    camisa: {
        group: "Alfaiataria",
        label: "Camisa",
        hint: "Botoes e entretela",
        categoria: "camisa",
        values: { tecido: "linho", quantidade: 1, metragem: 1.5, tempo: 2, entretela: 0.3, botoes: 10, linha: 2.5, bordado: 35, ziper: 0, outros: 0, peso: 0.45, largura: 26, altura: 5, comprimento: 33 }
    },
    calca: {
        group: "Alfaiataria",
        label: "Calca",
        hint: "Mais metragem",
        categoria: "calca",
        values: { tecido: "linho", quantidade: 1, metragem: 2.6, tempo: 1.5, entretela: 0.1, botoes: 2, linha: 2.5, bordado: 0, ziper: 1, outros: 0, peso: 0.65, largura: 28, altura: 6, comprimento: 34 }
    },
    vestido: {
        group: "Alfaiataria",
        label: "Vestido",
        hint: "Bordado opcional",
        categoria: "vestido",
        values: { tecido: "linho", quantidade: 1, metragem: 3, tempo: 3.5, entretela: 0.2, botoes: 8, linha: 3, bordado: 50, ziper: 1, outros: 5, peso: 0.7, largura: 28, altura: 6, comprimento: 35 }
    },
    saia: {
        group: "Alfaiataria",
        label: "Saia",
        hint: "Leve e rapida",
        categoria: "saia",
        values: { tecido: "linho", quantidade: 1, metragem: 1.8, tempo: 1.4, entretela: 0.1, botoes: 2, linha: 2, bordado: 0, ziper: 1, outros: 0, peso: 0.45, largura: 26, altura: 5, comprimento: 32 }
    },
    conjunto: {
        group: "Alfaiataria",
        label: "Conjunto",
        hint: "Parte de cima + baixo",
        categoria: "conjunto",
        values: { tecido: "linho", quantidade: 1, metragem: 3.6, tempo: 4.2, entretela: 0.4, botoes: 12, linha: 3.5, bordado: 35, ziper: 1, outros: 8, peso: 0.95, largura: 30, altura: 8, comprimento: 36 }
    },
    blusa: {
        group: "Alfaiataria",
        label: "Blusa",
        hint: "Linha leve",
        categoria: "blusa",
        values: { tecido: "viscose", quantidade: 1, metragem: 1.2, tempo: 1.3, entretela: 0.1, botoes: 0, linha: 1.8, bordado: 0, ziper: 0, outros: 0, peso: 0.35, largura: 24, altura: 4, comprimento: 30 }
    },
    mesa_posta: {
        group: "Mesa posta",
        label: "Mesa posta",
        hint: "Composicao geral",
        categoria: "mesa_posta",
        values: { tecido: "algodao", quantidade: 1, metragem: 1.8, tempo: 1.4, entretela: 0, botoes: 0, linha: 2.2, bordado: 0, ziper: 0, outros: 4, peso: 0.5, largura: 28, altura: 4, comprimento: 30 }
    },
    lugar_americano: {
        group: "Mesa posta",
        label: "Lugar americano",
        hint: "Acabamento reto",
        categoria: "lugar_americano",
        values: { tecido: "algodao", quantidade: 1, metragem: 0.45, tempo: 0.45, entretela: 0, botoes: 0, linha: 1.2, bordado: 0, ziper: 0, outros: 1.5, peso: 0.42, largura: 28, altura: 3, comprimento: 30 }
    },
    guardanapo: {
        group: "Mesa posta",
        label: "Guardanapo",
        hint: "Peca unitaria",
        categoria: "guardanapo",
        values: { tecido: "algodao", quantidade: 1, metragem: 0.18, tempo: 0.2, entretela: 0, botoes: 0, linha: 0.65, bordado: 0, ziper: 0, outros: 0.8, peso: 0.12, largura: 16, altura: 2, comprimento: 16 }
    },
    anel_guardanapo: {
        group: "Mesa posta",
        label: "Anel de guardanapo",
        hint: "Acabamento pequeno",
        categoria: "anel_guardanapo",
        values: { tecido: "personalizado", quantidade: 1, metragem: 0.05, tempo: 0.15, entretela: 0, botoes: 0, linha: 0.4, bordado: 0, ziper: 0, outros: 5.5, peso: 0.08, largura: 12, altura: 4, comprimento: 12 }
    },
    trilho_velas: {
        group: "Mesa posta",
        label: "Trilho para velas",
        hint: "Faixa central",
        categoria: "trilho_velas",
        values: { tecido: "algodao", quantidade: 1, metragem: 0.85, tempo: 0.75, entretela: 0, botoes: 0, linha: 1.5, bordado: 0, ziper: 0, outros: 2.5, peso: 0.3, largura: 16, altura: 3, comprimento: 25 }
    },
    caminho_mesa: {
        group: "Mesa posta",
        label: "Caminho de mesa",
        hint: "Comprimento maior",
        categoria: "caminho_mesa",
        values: { tecido: "algodao", quantidade: 1, metragem: 1.4, tempo: 1.1, entretela: 0, botoes: 0, linha: 2.2, bordado: 0, ziper: 0, outros: 3, peso: 0.62, largura: 20, altura: 5, comprimento: 38 }
    },
    capa_de_matza: {
        group: "Mesa posta",
        label: "Capa de matza",
        hint: "Bordado frequente",
        categoria: "capa_de_matza",
        values: { tecido: "linho", quantidade: 1, metragem: 0.7, tempo: 1.4, entretela: 0, botoes: 0, linha: 1.6, bordado: 18, ziper: 0, outros: 2, peso: 0.18, largura: 18, altura: 3, comprimento: 22 }
    },
    personalizado: {
        group: "Flexivel",
        label: "Modelo livre",
        hint: "Do zero",
        categoria: "outros",
        values: { tecido: "linho", quantidade: 1, metragem: 0, tempo: 0, entretela: 0, botoes: 0, linha: 0, bordado: 0, ziper: 0, outros: 0, peso: 0.4, largura: 24, altura: 5, comprimento: 28 }
    }
};

const CATEGORY_TO_PRESET = {
    camisa: "camisa",
    calca: "calca",
    vestido: "vestido",
    saia: "saia",
    conjunto: "conjunto",
    blusa: "blusa",
    mesa_posta: "mesa_posta",
    lugar_americano: "lugar_americano",
    guardanapo: "guardanapo",
    anel_guardanapo: "anel_guardanapo",
    porta_guardanapo: "anel_guardanapo",
    trilho_velas: "trilho_velas",
    caminho_mesa: "caminho_mesa",
    capa_de_matza: "capa_de_matza",
    combo: "personalizado",
    outros: "personalizado"
};

const ADMIN_UIDS = ["NoGsCqiKc0VJwWb6rppk7QVLV1B2"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let simulationItems = [];
let siteProducts = [];
let currentMode = "novo";
let currentPreset = "camisa";
let selectedSiteProductId = "";

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
    if (!value) return "-";
    const date = value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("pt-BR");
}

function slugToLabel(slug) {
    const preset = PRESETS[slug];
    if (preset) return preset.label;
    return String(slug || "Outros")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
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

function getInputNumber(id, fallback = 0) {
    const numeric = Number($(id)?.value || fallback);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function getInputText(id, fallback = "") {
    return String($(id)?.value || fallback).trim();
}

function setInputValue(id, value) {
    const element = $(id);
    if (!element) return;
    element.value = value ?? "";
}

function toggleCustomFabricPrice() {
    const customContainer = $("div-preco-custom");
    if (!customContainer) return;
    customContainer.classList.toggle("hidden", $("tecido").value !== "personalizado");
}

function renderPresetGroups() {
    const container = $("preset-groups");
    if (!container) return;

    const groups = Object.entries(PRESETS).reduce((acc, [slug, preset]) => {
        acc[preset.group] = acc[preset.group] || [];
        acc[preset.group].push({ slug, ...preset });
        return acc;
    }, {});

    container.innerHTML = Object.entries(groups).map(([groupName, presets]) => `
        <div class="preset-group">
            <p class="section-title mb-3">${escapeHtml(groupName)}</p>
            <div class="preset-grid">
                ${presets.map((preset) => `
                    <button type="button" class="preset-chip ${preset.slug === currentPreset ? "active" : ""}" data-preset="${preset.slug}">
                        <span class="font-semibold text-sm">${escapeHtml(preset.label)}</span>
                        <small>${escapeHtml(preset.hint)}</small>
                    </button>
                `).join("")}
            </div>
        </div>
    `).join("");

    container.querySelectorAll("[data-preset]").forEach((button) => {
        button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });
}

function setMode(mode) {
    currentMode = mode;
    $("modo-novo")?.classList.toggle("hidden", mode !== "novo");
    $("modo-existente")?.classList.toggle("hidden", mode !== "existente");
    $("btn-modo-novo")?.classList.toggle("active", mode === "novo");
    $("btn-modo-existente")?.classList.toggle("active", mode === "existente");
}

function applyPreset(presetSlug, options = {}) {
    const { preserveName = true, product = null } = options;
    const preset = PRESETS[presetSlug] || PRESETS.personalizado;
    currentPreset = presetSlug;

    Object.entries(preset.values).forEach(([key, value]) => {
        const mapping = {
            quantidade: "quantidadePecas",
            peso: "pesoEstimado",
            largura: "larguraVolume",
            altura: "alturaVolume",
            comprimento: "comprimentoVolume"
        };
        setInputValue(mapping[key] || key, value);
    });

    if (!preserveName) {
        setInputValue("nomePeca", product?.nome || preset.label);
    }

    toggleCustomFabricPrice();
    renderPresetGroups();
    recalculateTotals();
}

function resolvePresetForProduct(product) {
    const categoria = String(product?.categoria || "").trim();
    return CATEGORY_TO_PRESET[categoria] || "personalizado";
}

function getSelectedSiteProduct() {
    return siteProducts.find((product) => product.id === selectedSiteProductId) || null;
}

function renderCategoryFilter() {
    const filter = $("filtro-categoria-site");
    if (!filter) return;

    const currentValue = filter.value || "all";
    const categories = Array.from(new Set(siteProducts.map((product) => String(product.categoria || "outros")))).sort();
    filter.innerHTML = `<option value="all">Todas as categorias</option>${categories.map((slug) => `
        <option value="${slug}">${escapeHtml(slugToLabel(slug))}</option>
    `).join("")}`;
    filter.value = categories.includes(currentValue) ? currentValue : "all";
}

function renderSiteProductOptions() {
    const select = $("select-produto-site");
    const summary = $("site-product-summary");
    if (!select) return;

    const categoryFilter = $("filtro-categoria-site")?.value || "all";
    const searchTerm = getInputText("busca-produto-site").toLowerCase();

    const filteredProducts = siteProducts
        .filter((product) => categoryFilter === "all" || String(product.categoria || "outros") === categoryFilter)
        .filter((product) => {
            if (!searchTerm) return true;
            return [product.nome, product.categoria, product.tags]
                .some((value) => String(value || "").toLowerCase().includes(searchTerm));
        })
        .sort((a, b) => {
            const categoryDiff = slugToLabel(a.categoria).localeCompare(slugToLabel(b.categoria), "pt-BR");
            if (categoryDiff !== 0) return categoryDiff;
            return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
        });

    select.innerHTML = `<option value="">Selecione um produto...</option>${filteredProducts.map((product) => `
        <option value="${product.id}" ${product.id === selectedSiteProductId ? "selected" : ""}>
            [${escapeHtml(slugToLabel(product.categoria || "outros"))}] ${escapeHtml(product.nome || "Produto")}
        </option>
    `).join("")}`;

    if (summary) {
        summary.textContent = `${filteredProducts.length} produto(s) exibidos`;
    }
}

async function loadSiteProducts() {
    try {
        const snapshot = await getDocs(collection(db, "pecas"));
        siteProducts = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        renderCategoryFilter();
        renderSiteProductOptions();
    } catch (error) {
        console.error(error);
        $("site-product-summary").textContent = "Nao foi possivel carregar os produtos.";
    }
}

function loadSelectedProduct() {
    selectedSiteProductId = $("select-produto-site").value;
    const product = getSelectedSiteProduct();
    const infoBox = $("produto-info-box");

    if (!product || !infoBox) {
        infoBox?.classList.add("hidden");
        showToast("Selecione um produto para carregar os dados.", "error");
        return;
    }

    const presetSlug = resolvePresetForProduct(product);
    applyPreset(presetSlug, { preserveName: false, product });

    setInputValue("notasTecnicas", product.descricao || "");
    if (product.frete) {
        setInputValue("pesoEstimado", product.frete.peso || PRESETS[presetSlug].values.peso);
        setInputValue("larguraVolume", product.frete.largura || PRESETS[presetSlug].values.largura);
        setInputValue("alturaVolume", product.frete.altura || PRESETS[presetSlug].values.altura);
        setInputValue("comprimentoVolume", product.frete.comprimento || PRESETS[presetSlug].values.comprimento);
    }

    $("preco-venda-atual").textContent = formatCurrency(product.preco);
    $("produto-site-categoria").textContent = slugToLabel(product.categoria || "outros");
    $("produto-site-preset").textContent = PRESETS[presetSlug]?.label || "Modelo livre";
    infoBox.classList.remove("hidden");
    recalculateTotals();
}

function buildCurrentItem() {
    const quantity = Math.max(1, parseInt(getInputNumber("quantidadePecas", 1), 10) || 1);
    const fabricType = getInputText("tecido", "linho");
    const fabricPrice = fabricType === "personalizado"
        ? getInputNumber("precoTecidoCustom")
        : Number($("tecido")?.selectedOptions?.[0]?.dataset.price || 0);
    const fabricMeters = getInputNumber("metragem");
    const laborHours = getInputNumber("tempoProducao");
    const laborRate = getInputNumber("valorHora", 30);

    const unitFabricCost = fabricMeters * fabricPrice;
    const unitLaborCost = laborHours * laborRate;
    const unitTrimCost =
        (getInputNumber("entretela") * PRECO_BASE.aviamentos.entretela) +
        (getInputNumber("botoes") * PRECO_BASE.aviamentos.botao) +
        (getInputNumber("ziper") * PRECO_BASE.aviamentos.ziper) +
        PRECO_BASE.aviamentos.etiqueta +
        PRECO_BASE.embalagem +
        getInputNumber("linha") +
        getInputNumber("bordado") +
        getInputNumber("outros");

    const unitCost = unitFabricCost + unitLaborCost + unitTrimCost;
    const totalCost = unitCost * quantity;

    return {
        id: Date.now(),
        productId: currentMode === "existente" ? selectedSiteProductId : null,
        nome: getInputText("nomePeca", "Peca sem nome"),
        categoria: getSelectedSiteProduct()?.categoria || PRESETS[currentPreset]?.categoria || "outros",
        preset: currentPreset,
        tecido: fabricType,
        quantity,
        unitCost,
        totalCost,
        fabricMeters,
        laborHours,
        notes: getInputText("notasTecnicas"),
        frete: {
            peso: getInputNumber("pesoEstimado"),
            largura: getInputNumber("larguraVolume"),
            altura: getInputNumber("alturaVolume"),
            comprimento: getInputNumber("comprimentoVolume")
        }
    };
}

function addCurrentItem() {
    const item = buildCurrentItem();
    simulationItems.push(item);
    renderSimulationList();
    recalculateTotals();
    showToast("Item adicionado a simulacao.");
}

function renderSimulationList() {
    const list = $("lista-simulacao");
    if (!list) return;

    if (!simulationItems.length) {
        list.innerHTML = `<p class="text-center text-gray-400 text-sm py-5">Nenhum item calculado ainda.</p>`;
        return;
    }

    list.innerHTML = simulationItems.map((item, index) => `
        <div class="simulation-item">
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <p class="font-semibold text-gray-900">${escapeHtml(item.nome)}</p>
                    <span class="tag-soft">${escapeHtml(slugToLabel(item.categoria))}</span>
                    <span class="tag-soft">${escapeHtml(item.quantity)} un.</span>
                </div>
                <p class="mt-2 text-xs text-gray-500">
                    ${escapeHtml(PRESETS[item.preset]?.label || "Modelo livre")} • ${escapeHtml(item.tecido)} • custo unitario ${escapeHtml(formatCurrency(item.unitCost))}
                </p>
                ${item.notes ? `<p class="mt-2 text-xs text-gray-500">${escapeHtml(item.notes)}</p>` : ""}
            </div>
            <div class="text-right shrink-0">
                <p class="font-semibold text-[--pricing-brown]">${escapeHtml(formatCurrency(item.totalCost))}</p>
                <button type="button" class="mt-3 text-sm text-red-500 hover:text-red-700" data-remove-item="${index}">
                    Remover
                </button>
            </div>
        </div>
    `).join("");

    list.querySelectorAll("[data-remove-item]").forEach((button) => {
        button.addEventListener("click", () => {
            simulationItems.splice(Number(button.dataset.removeItem), 1);
            renderSimulationList();
            recalculateTotals();
        });
    });
}

function recalculateTotals() {
    const productionCost = simulationItems.reduce((sum, item) => sum + item.totalCost, 0);
    const piecesCount = simulationItems.reduce((sum, item) => sum + item.quantity, 0);
    const marginPercent = getInputNumber("margem", 100);
    const cardFeePercent = getInputNumber("taxaCartao", 5.49);
    const pixDiscountPercent = getInputNumber("descPix", 5);

    const basePrice = productionCost * (1 + (marginPercent / 100));
    const cardPrice = basePrice > 0 ? basePrice / (1 - (cardFeePercent / 100)) : 0;
    const netValue = cardPrice * (1 - (cardFeePercent / 100));
    const grossProfit = netValue - productionCost;
    const pixPrice = cardPrice * (1 - (pixDiscountPercent / 100));

    $("res-custo").textContent = formatCurrency(productionCost);
    $("res-lucro").textContent = formatCurrency(grossProfit);
    $("res-preco-final").textContent = formatCurrency(cardPrice);
    $("res-preco-pix").textContent = formatCurrency(pixPrice);
    $("res-itens-simulacao").textContent = `${simulationItems.length} item(ns) • ${piecesCount} peca(s)`;
}

function calculateReverse() {
    const salePrice = getInputNumber("rev-preco-venda");
    const currentCost = simulationItems.reduce((sum, item) => sum + item.totalCost, 0);
    const cardFeePercent = getInputNumber("taxaCartao", 5.49) / 100;

    if (!salePrice || !currentCost) {
        showToast("Calcule pelo menos um item antes do calculo reverso.", "error");
        return;
    }

    const netValue = salePrice * (1 - cardFeePercent);
    const profit = netValue - currentCost;
    const margin = currentCost > 0 ? (profit / currentCost) * 100 : 0;

    $("rev-resultado").classList.remove("hidden");
    $("rev-lucro").textContent = formatCurrency(profit);
    $("rev-margem").textContent = `${margin.toFixed(1)}%`;
    $("rev-margem").className = margin < 30
        ? "font-bold text-red-500"
        : margin < 100
            ? "font-bold text-amber-600"
            : "font-bold text-green-600";
}

async function saveSimulation() {
    if (!simulationItems.length) {
        showToast("Nada para salvar.", "error");
        return;
    }

    const defaultName = getInputText("nomePeca", simulationItems[0]?.nome || "Simulacao");
    const nome = window.prompt("Nome para salvar:", defaultName);
    if (!nome) return;

    const payload = {
        nome,
        data: new Date(),
        itens: simulationItems,
        modo: currentMode,
        produtoId: currentMode === "existente" ? selectedSiteProductId : null,
        configuracao: {
            margem: getInputNumber("margem", 100),
            taxaCartao: getInputNumber("taxaCartao", 5.49),
            descontoPix: getInputNumber("descPix", 5),
            notas: getInputText("notasTecnicas")
        },
        resultadoFinal: $("res-preco-final").textContent,
        resultadoPix: $("res-preco-pix").textContent
    };

    try {
        await addDoc(collection(db, "precificacoes"), payload);
        showToast("Simulacao salva no historico.");
    } catch (error) {
        console.error(error);
        showToast("Nao foi possivel salvar.", "error");
    }
}

function monitorHistory() {
    const historyList = $("historico-lista");
    const historyQuery = query(collection(db, "precificacoes"), orderBy("data", "desc"), limit(10));

    onSnapshot(historyQuery, (snapshot) => {
        if (snapshot.empty) {
            historyList.innerHTML = `<p class="text-center text-gray-400 py-3 text-sm">Historico vazio.</p>`;
            return;
        }

        historyList.innerHTML = snapshot.docs.map((historyDoc) => {
            const data = historyDoc.data();
            return `
                <div class="history-item">
                    <div class="min-w-0">
                        <p class="font-medium text-gray-800 truncate">${escapeHtml(data.nome || "Simulacao")}</p>
                        <p class="mt-1 text-xs text-gray-500">${escapeHtml(formatDate(data.data))} • ${escapeHtml(data.resultadoFinal || "-")}</p>
                    </div>
                    <button type="button" class="text-red-400 hover:text-red-600 text-sm" data-delete-history="${historyDoc.id}">
                        Excluir
                    </button>
                </div>
            `;
        }).join("");

        historyList.querySelectorAll("[data-delete-history]").forEach((button) => {
            button.addEventListener("click", async () => {
                if (!window.confirm("Apagar este registro?")) return;
                await deleteDoc(doc(db, "precificacoes", button.dataset.deleteHistory));
            });
        });
    });
}

function clearSimulation() {
    if (!window.confirm("Limpar todos os dados da simulacao atual?")) return;
    simulationItems = [];
    selectedSiteProductId = "";
    $("select-produto-site").value = "";
    $("produto-info-box").classList.add("hidden");
    setInputValue("nomePeca", "");
    setInputValue("notasTecnicas", "");
    applyPreset(currentPreset, { preserveName: false });
    renderSimulationList();
    recalculateTotals();
}

function showToast(message, type = "success") {
    const toast = $("toast");
    const label = $("toast-message");
    if (!toast || !label) return;

    label.textContent = message;
    toast.className = `pricing-toast ${type}`;
    toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2800);
}

function bindEvents() {
    $("btn-modo-novo")?.addEventListener("click", () => setMode("novo"));
    $("btn-modo-existente")?.addEventListener("click", () => setMode("existente"));
    $("tecido")?.addEventListener("change", toggleCustomFabricPrice);
    $("quote-add-btn")?.addEventListener("click", addCurrentItem);
    $("clear-simulation-btn")?.addEventListener("click", clearSimulation);
    $("reverse-calc-btn")?.addEventListener("click", calculateReverse);
    $("save-simulation-btn")?.addEventListener("click", saveSimulation);
    $("load-site-product-btn")?.addEventListener("click", loadSelectedProduct);
    $("filtro-categoria-site")?.addEventListener("change", renderSiteProductOptions);
    $("busca-produto-site")?.addEventListener("input", renderSiteProductOptions);

    ["margem", "taxaCartao", "descPix"].forEach((id) => {
        $(id)?.addEventListener("input", recalculateTotals);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    renderPresetGroups();
    setMode("novo");
    bindEvents();
    applyPreset(currentPreset, { preserveName: false });
    renderSimulationList();
    recalculateTotals();

    onAuthStateChanged(auth, async (user) => {
        if (!(await isAuthorizedAdmin(user))) {
            signOut(auth).catch(() => {});
            window.location.href = "login-admin.html";
            return;
        }

        await loadSiteProducts();
        monitorHistory();
    });
});

window.mudarModo = setMode;
window.selecionarModelo = applyPreset;
window.carregarDadosProduto = loadSelectedProduct;
window.limparTudo = clearSimulation;
window.adicionarALista = addCurrentItem;
window.recalcularTotal = recalculateTotals;
window.calcularReverso = calculateReverse;
window.salvarSimulacao = saveSimulation;
