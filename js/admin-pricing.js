import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

const ADMIN_UIDS = new Set(["NoGsCqiKc0VJwWb6rppk7QVLV1B2"]);
const AREA_LABELS = {
    roupa: "Roupas",
    mesa_posta: "Mesa posta",
    sob_medida: "Sob medida"
};
const MESA_CATEGORIES = new Set([
    "mesa_posta", "lugar_americano", "jogos_americanos", "sousplat", "guardanapo",
    "caminho_mesa", "anel_guardanapo", "porta_guardanapo", "trilho_velas", "capa_de_matza"
]);
const UNIT_OPTIONS = [
    ["m", "metro"], ["cm", "centímetro"], ["un", "unidade"], ["kg", "quilo"],
    ["g", "grama"], ["rolo", "rolo"], ["pacote", "pacote"], ["servico", "serviço"]
];
const MEASURE_UNIT_OPTIONS = [["cm", "cm"], ["m", "m"], ["mm", "mm"], ["un", "un"]];
const DEFAULT_CHECKOUT_RATES = { cardFeePercent: 5.49, pixDiscountPercent: 5 };

let TEMPLATES = {
    roupa: [{ id: "roupa_livre", label: "Modelo livre", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "m", scope: "peca" }] }],
    mesa_posta: [{ id: "mesa_livre", label: "Modelo livre", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "m", scope: "peca" }] }],
    sob_medida: [{ id: "projeto_especial", label: "Projeto especial", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "un", scope: "peca" }], measurements: [] }]
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
    user: null,
    isAdmin: false,
    area: "roupa",
    template: "roupa_livre",
    materials: [],
    measurements: [],
    products: [],
    productsLoaded: false,
    productsLoading: false,
    selectedProduct: null,
    records: [],
    currentRecordId: null,
    loaded: false,
    dirty: false,
    saving: false,
    totals: null,
    checkoutRates: { ...DEFAULT_CHECKOUT_RATES }
};

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

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function formatCurrencyCents(value) {
    return (Number(value || 0) / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2
    });
}

function formatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "Data antiga";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function numberFrom(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
    return Math.max(0, numberFrom(value, fallback));
}

function moneyToCents(value) {
    return Math.round(nonNegative(value) * 100);
}

function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value ?? "";
}

function areaForProduct(product) {
    if (String(product?.segmento || "") === "mesa" || MESA_CATEGORIES.has(String(product?.categoria || ""))) {
        return "mesa_posta";
    }
    return "roupa";
}

function categoryLabel(value) {
    return String(value || "Sem categoria")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unitOptions(selected) {
    return UNIT_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function measureUnitOptions(selected) {
    return MEASURE_UNIT_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function cloneTemplateMaterial(material, previousCosts = new Map()) {
    const knownCost = previousCosts.get(normalizeText(material.name));
    return {
        name: material.name,
        quantity: material.quantity,
        unit: material.unit,
        scope: material.scope,
        unitCost: Number.isFinite(knownCost) ? knownCost : 0
    };
}

function renderTemplateChips() {
    const container = $("template-chips");
    container.innerHTML = (TEMPLATES[state.area] || []).map((template) => `
        <button type="button" class="template-chip ${template.id === state.template ? "is-active" : ""}" data-template="${escapeHtml(template.id)}">
            ${escapeHtml(template.label)}
        </button>
    `).join("");
}

function renderArea() {
    document.querySelectorAll("[data-area]").forEach((button) => {
        const active = button.dataset.area === state.area;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", active ? "true" : "false");
    });
    $("result-area").textContent = AREA_LABELS[state.area] || "Peça";
    renderTemplateChips();
    if (state.area === "sob_medida") $("technical-details").open = true;
}

function materialRow(material, index) {
    return `
        <div class="material-row" data-material-row="${index}">
            <label class="material-name">
                <span class="row-field-label">Material ou serviço</span>
                <input class="pricing-control" type="text" maxlength="100" value="${escapeHtml(material.name)}" placeholder="Ex.: Linho" data-material-field="name" aria-label="Nome do material ${index + 1}" required aria-required="true">
            </label>
            <label>
                <span class="row-field-label">Consumo</span>
                <input class="pricing-control" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" value="${escapeHtml(material.quantity)}" data-material-field="quantity" aria-label="Consumo do material ${index + 1}">
            </label>
            <label>
                <span class="row-field-label">Unidade</span>
                <select class="pricing-control" data-material-field="unit" aria-label="Unidade do material ${index + 1}">${unitOptions(material.unit)}</select>
            </label>
            <label>
                <span class="row-field-label">Custo unitário (R$)</span>
                <input class="pricing-control" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" value="${escapeHtml(material.unitCost)}" data-material-field="unitCost" aria-label="Custo unitário do material ${index + 1}">
            </label>
            <label>
                <span class="row-field-label">Aplicar</span>
                <select class="pricing-control" data-material-field="scope" aria-label="Aplicação do material ${index + 1}">
                    <option value="peca" ${material.scope === "peca" ? "selected" : ""}>por peça</option>
                    <option value="lote" ${material.scope === "lote" ? "selected" : ""}>uma vez no lote</option>
                </select>
            </label>
            <button type="button" class="remove-row" data-remove-material="${index}" aria-label="Remover ${escapeHtml(material.name || `material ${index + 1}`)}"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `;
}

function renderMaterials() {
    if (!state.materials.length) {
        state.materials = [{ name: "", quantity: 0, unit: "un", scope: "peca", unitCost: 0 }];
    }
    $("materials-list").innerHTML = state.materials.map(materialRow).join("");
}

function measurementRow(measurement, index) {
    return `
        <div class="measurement-row" data-measurement-row="${index}">
            <label>
                <span class="row-field-label">Medida</span>
                <input class="pricing-control" type="text" maxlength="80" value="${escapeHtml(measurement.name)}" placeholder="Ex.: Cintura" data-measurement-field="name" aria-label="Nome da medida ${index + 1}">
            </label>
            <label>
                <span class="row-field-label">Valor</span>
                <input class="pricing-control" type="text" maxlength="40" value="${escapeHtml(measurement.value)}" placeholder="Ex.: 78" data-measurement-field="value" aria-label="Valor da medida ${index + 1}">
            </label>
            <label>
                <span class="row-field-label">Unidade</span>
                <select class="pricing-control" data-measurement-field="unit" aria-label="Unidade da medida ${index + 1}">${measureUnitOptions(measurement.unit)}</select>
            </label>
            <button type="button" class="remove-row" data-remove-measurement="${index}" aria-label="Remover medida ${index + 1}"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `;
}

function renderMeasurements() {
    const list = $("measurements-list");
    if (!state.measurements.length) {
        list.innerHTML = '<p class="history-empty">Nenhuma medida adicionada. Use “Adicionar medida” se esta peça precisar de uma ficha.</p>';
        return;
    }
    list.innerHTML = state.measurements.map(measurementRow).join("");
}

function templateWouldReplaceWork(template) {
    const currentMaterials = state.materials.map((material) => ({
        name: normalizeText(material.name),
        quantity: nonNegative(material.quantity),
        unit: String(material.unit || "un"),
        scope: material.scope === "lote" ? "lote" : "peca"
    }));
    const targetMaterials = template.materials.map((material) => ({
        name: normalizeText(material.name),
        quantity: nonNegative(material.quantity),
        unit: String(material.unit || "un"),
        scope: material.scope === "lote" ? "lote" : "peca"
    }));
    const materialStructureChanged = JSON.stringify(currentMaterials) !== JSON.stringify(targetMaterials);
    const hasMaterialWork = state.materials.some((material) => (
        String(material.name || "").trim()
        || nonNegative(material.quantity) > 0
        || nonNegative(material.unitCost) > 0
    ));
    const currentMeasurements = state.measurements.map((measurement) => ({
        name: normalizeText(measurement.name),
        value: String(measurement.value || "").trim(),
        unit: String(measurement.unit || "cm")
    }));
    const targetMeasurements = (template.measurements || []).map((name) => ({
        name: normalizeText(name),
        value: "",
        unit: "cm"
    }));
    const measurementsChanged = JSON.stringify(currentMeasurements) !== JSON.stringify(targetMeasurements);
    const hasMeasurementWork = state.measurements.some((measurement) => (
        String(measurement.name || "").trim() || String(measurement.value || "").trim()
    ));
    const laborMinutesChanged = nonNegative($("labor-minutes")?.value) !== nonNegative(template.minutes);
    return (materialStructureChanged && hasMaterialWork)
        || (measurementsChanged && hasMeasurementWork)
        || laborMinutesChanged;
}

function applyTemplate(templateId, { initial = false } = {}) {
    const template = (TEMPLATES[state.area] || []).find((candidate) => candidate.id === templateId);
    if (!template) return;
    const replacesEnteredWork = !initial && state.dirty && templateWouldReplaceWork(template);
    if (replacesEnteredWork && !window.confirm("Aplicar este modelo substituirá materiais, medidas ou tempo de trabalho atuais. Deseja continuar?")) return;
    const previousCosts = new Map(state.materials.map((material) => [normalizeText(material.name), numberFrom(material.unitCost)]));
    state.template = template.id;
    state.materials = template.materials.map((material) => cloneTemplateMaterial(material, previousCosts));
    state.measurements = (template.measurements || []).map((name) => ({ name, value: "", unit: "cm" }));
    setValue("labor-minutes", template.minutes || 0);
    if (template.measurements?.length) $("technical-details").open = true;
    renderTemplateChips();
    renderMaterials();
    renderMeasurements();
    state.dirty = !initial;
    recalculate();
    if (!initial) showToast("Modelo carregado. Confira os consumos e informe os custos de compra.", "info");
}

function setArea(area, { preserveMaterials = true } = {}) {
    if (!(area in AREA_LABELS) || area === state.area) return;
    state.area = area;
    const firstTemplate = TEMPLATES[area]?.[0];
    state.template = preserveMaterials ? "" : (firstTemplate?.id || "");
    renderArea();
    if (!preserveMaterials && firstTemplate) applyTemplate(firstTemplate.id);
    state.dirty = true;
    recalculate();
}

function addMaterial() {
    if (state.materials.length >= 50) {
        showToast("A ficha aceita no máximo 50 materiais.", "error");
        return;
    }
    state.materials.push({ name: "", quantity: 0, unit: "un", scope: "peca", unitCost: 0 });
    renderMaterials();
    state.dirty = true;
    $("materials-list").lastElementChild?.querySelector("input")?.focus();
    recalculate();
}

function removeMaterial(index) {
    state.materials.splice(index, 1);
    renderMaterials();
    state.dirty = true;
    recalculate();
}

function addMeasurement() {
    if (state.measurements.length >= 40) {
        showToast("A ficha aceita no máximo 40 medidas.", "error");
        return;
    }
    state.measurements.push({ name: "", value: "", unit: "cm" });
    renderMeasurements();
    state.dirty = true;
    $("measurements-list").lastElementChild?.querySelector("input")?.focus();
}

function removeMeasurement(index) {
    state.measurements.splice(index, 1);
    renderMeasurements();
    state.dirty = true;
}

function updateMaterial(event) {
    const field = event.target.dataset.materialField;
    if (!field) return;
    const row = event.target.closest("[data-material-row]");
    const material = state.materials[Number(row?.dataset.materialRow)];
    if (!material) return;
    material[field] = ["quantity", "unitCost"].includes(field) ? numberFrom(event.target.value) : event.target.value;
    state.dirty = true;
    recalculate();
}

function updateMeasurement(event) {
    const field = event.target.dataset.measurementField;
    if (!field) return;
    const row = event.target.closest("[data-measurement-row]");
    const measurement = state.measurements[Number(row?.dataset.measurementRow)];
    if (!measurement) return;
    measurement[field] = event.target.value;
    state.dirty = true;
}

function readCalculatorData() {
    const quantity = Math.max(1, Math.round(nonNegative($("piece-quantity").value, 1)));
    return {
        name: $("piece-name").value.trim(),
        reference: $("piece-reference").value.trim(),
        area: state.area,
        template: state.template,
        source: state.selectedProduct ? {
            mode: "produto",
            productId: state.selectedProduct.id,
            productName: String(state.selectedProduct.nome || ""),
            currentPriceCents: moneyToCents(state.selectedProduct.preco)
        } : { mode: "novo", productId: null, productName: "", currentPriceCents: 0 },
        quantity,
        materials: state.materials.map((material) => ({
            name: String(material.name || "").trim(),
            quantity: nonNegative(material.quantity),
            unit: UNIT_OPTIONS.some(([unit]) => unit === material.unit) ? material.unit : "un",
            scope: material.scope === "lote" ? "lote" : "peca",
            unitCostCents: moneyToCents(material.unitCost)
        })),
        labor: {
            minutesPerPiece: nonNegative($("labor-minutes").value),
            hourlyRateCents: moneyToCents($("hourly-rate").value)
        },
        extras: {
            perPieceCents: moneyToCents($("extra-per-piece").value),
            batchCents: moneyToCents($("batch-fixed-cost").value),
            wastePercent: nonNegative($("waste-percent").value),
            overheadPercent: nonNegative($("overhead-percent").value)
        },
        pricing: {
            method: $("pricing-method").value === "margem" ? "margem" : "acrescimo",
            percentage: nonNegative($("pricing-percentage").value),
            cardFeePercent: nonNegative($("card-fee").value),
            pixDiscountPercent: nonNegative($("pix-discount").value)
        },
        measurements: state.measurements.map((measurement) => ({
            name: String(measurement.name || "").trim(),
            value: String(measurement.value || "").trim(),
            unit: MEASURE_UNIT_OPTIONS.some(([unit]) => unit === measurement.unit) ? measurement.unit : "cm"
        })).filter((measurement) => measurement.name && measurement.value),
        notes: $("production-notes").value.trim(),
        sharedWithProduction: state.isAdmin && $("share-team").checked
    };
}

function calculateTotals(data) {
    if (data.pricing.method === "margem" && data.pricing.percentage >= 100) {
        return { error: "A margem desejada precisa ser menor que 100%." };
    }
    if (data.pricing.cardFeePercent >= 100) {
        return { error: "A taxa do cartão precisa ser menor que 100%." };
    }

    const materialBatchCents = Math.round(data.materials.reduce((sum, material) => {
        const multiplier = material.scope === "lote" ? 1 : data.quantity;
        return sum + (material.quantity * material.unitCostCents * multiplier);
    }, 0));
    const wasteCents = Math.round(materialBatchCents * (data.extras.wastePercent / 100));
    const laborBatchCents = Math.round((data.labor.minutesPerPiece / 60) * data.labor.hourlyRateCents * data.quantity);
    const extrasBatchCents = (data.extras.perPieceCents * data.quantity) + data.extras.batchCents;
    const directBatchCents = materialBatchCents + wasteCents + laborBatchCents + extrasBatchCents;
    const overheadCents = Math.round(directBatchCents * (data.extras.overheadPercent / 100));
    const batchCostCents = directBatchCents + overheadCents;
    const unitCostCents = Math.ceil(batchCostCents / data.quantity);
    const baseBatchPriceCents = data.pricing.method === "margem"
        ? Math.ceil(batchCostCents / (1 - (data.pricing.percentage / 100)))
        : Math.ceil(batchCostCents * (1 + (data.pricing.percentage / 100)));
    const baseUnitPriceCents = Math.ceil(baseBatchPriceCents / data.quantity);
    const registeredBatchPriceCents = baseUnitPriceCents * data.quantity;
    const cardUnitPriceCents = Math.round(baseUnitPriceCents * (1 + (data.pricing.cardFeePercent / 100)));
    const pixUnitPriceCents = Math.round(baseUnitPriceCents * (1 - (data.pricing.pixDiscountPercent / 100)));
    const cardBatchPriceCents = Math.round(registeredBatchPriceCents * (1 + (data.pricing.cardFeePercent / 100)));
    const pixBatchPriceCents = Math.round(registeredBatchPriceCents * (1 - (data.pricing.pixDiscountPercent / 100)));

    return {
        materialBatchCents,
        wasteCents,
        laborBatchCents,
        extrasBatchCents,
        overheadCents,
        batchCostCents,
        unitCostCents,
        baseUnitPriceCents,
        baseBatchPriceCents: registeredBatchPriceCents,
        cardUnitPriceCents,
        pixUnitPriceCents,
        cardBatchPriceCents,
        pixBatchPriceCents,
        baseProfitBatchCents: registeredBatchPriceCents - batchCostCents,
        cardProfitBatchCents: cardBatchPriceCents - batchCostCents,
        pixProfitBatchCents: pixBatchPriceCents - batchCostCents
    };
}

function updateFeedback(data, totals) {
    const feedback = $("calculation-feedback");
    feedback.className = "calculation-feedback";
    if (totals.error) {
        feedback.classList.add("is-error");
        feedback.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(totals.error)}`;
        return;
    }
    const hasCost = totals.batchCostCents > 0;
    if (!data.name) {
        feedback.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Informe o nome da peça para poder salvar a ficha.';
    } else if (!hasCost) {
        feedback.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Informe pelo menos um custo de material, trabalho ou serviço.';
    } else if (totals.pixProfitBatchCents < 0) {
        feedback.classList.add("is-error");
        feedback.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Atenção: o Pix está ${escapeHtml(formatCurrencyCents(Math.abs(totals.pixProfitBatchCents)))} abaixo do custo. Reduza o desconto ou aumente o preço.`;
    } else {
        feedback.classList.add("is-ready");
        feedback.innerHTML = '<i class="fa-solid fa-circle-check"></i> Cálculo pronto. Confira o resumo e salve a ficha.';
    }
}

function renderComparison(totals) {
    const comparison = $("current-price-comparison");
    if (!state.selectedProduct || !numberFrom(state.selectedProduct.preco)) {
        comparison.classList.add("hidden");
        comparison.innerHTML = "";
        return;
    }
    const currentCents = moneyToCents(state.selectedProduct.preco);
    const difference = totals.baseUnitPriceCents - currentCents;
    const relation = difference === 0 ? "igual ao" : difference > 0 ? "acima do" : "abaixo do";
    comparison.innerHTML = `O preço atual no site é <strong>${formatCurrencyCents(currentCents)}</strong>. A sugestão ficou <strong>${formatCurrencyCents(Math.abs(difference))}</strong> ${relation} preço atual.`;
    comparison.classList.remove("hidden");
}

function recalculate() {
    const data = readCalculatorData();
    const totals = calculateTotals(data);
    state.totals = totals;
    const safeTotals = totals.error ? {
        materialBatchCents: 0, wasteCents: 0, laborBatchCents: 0, extrasBatchCents: 0,
        overheadCents: 0, batchCostCents: 0, unitCostCents: 0, cardUnitPriceCents: 0,
        baseUnitPriceCents: 0, baseBatchPriceCents: 0, pixUnitPriceCents: 0,
        cardBatchPriceCents: 0, baseProfitBatchCents: 0, cardProfitBatchCents: 0, pixProfitBatchCents: 0
    } : totals;

    $("result-unit-cost").textContent = formatCurrencyCents(safeTotals.unitCostCents);
    $("result-base-unit").textContent = formatCurrencyCents(safeTotals.baseUnitPriceCents);
    $("result-pix-unit").textContent = formatCurrencyCents(safeTotals.pixUnitPriceCents);
    $("result-base-batch").textContent = formatCurrencyCents(safeTotals.baseBatchPriceCents);
    $("result-batch-label").textContent = `Lote de ${data.quantity} ${data.quantity === 1 ? "peça" : "peças"} no preço cadastrado`;
    $("result-batch-cost").textContent = `Custo total: ${formatCurrencyCents(safeTotals.batchCostCents)}`;
    $("breakdown-materials").textContent = formatCurrencyCents(safeTotals.materialBatchCents);
    $("breakdown-waste").textContent = formatCurrencyCents(safeTotals.wasteCents);
    $("breakdown-labor").textContent = formatCurrencyCents(safeTotals.laborBatchCents);
    $("breakdown-extras").textContent = formatCurrencyCents(safeTotals.extrasBatchCents);
    $("breakdown-overhead").textContent = formatCurrencyCents(safeTotals.overheadCents);
    $("breakdown-total-cost").textContent = formatCurrencyCents(safeTotals.batchCostCents);
    $("breakdown-card-total").textContent = formatCurrencyCents(safeTotals.cardBatchPriceCents);
    $("breakdown-profit").textContent = formatCurrencyCents(safeTotals.baseProfitBatchCents);
    $("breakdown-profit").style.color = safeTotals.baseProfitBatchCents < 0 ? "var(--pricing-red)" : "";
    $("breakdown-pix-profit").textContent = formatCurrencyCents(safeTotals.pixProfitBatchCents);
    $("breakdown-pix-profit").style.color = safeTotals.pixProfitBatchCents < 0 ? "var(--pricing-red)" : "";
    $("mobile-result-value").textContent = formatCurrencyCents(safeTotals.baseUnitPriceCents);
    updateFeedback(data, totals);
    if (!totals.error) renderComparison(totals);
}

function updatePricingMethod() {
    const marginMode = $("pricing-method").value === "margem";
    $("pricing-percentage-label").textContent = marginMode ? "Margem desejada no preço" : "Acréscimo sobre o custo";
    $("pricing-percentage").max = marginMode ? "95" : "1000";
    $("pricing-percentage-help").textContent = marginMode
        ? "Ex.: 40% significa que 40% do preço líquido será lucro bruto."
        : "100% dobra o custo antes das taxas.";
    $("formula-explanation-text").innerHTML = marginMode
        ? "<strong>Margem desejada:</strong> calcula o preço de cadastro para que o lucro represente a porcentagem escolhida. O checkout aplica Pix e cartão depois."
        : "<strong>Acréscimo:</strong> soma todos os custos e aplica o percentual para chegar ao preço de cadastro. O checkout calcula Pix e cartão depois.";
    recalculate();
}

function renderLoadedProduct() {
    const card = $("loaded-product-card");
    if (!state.selectedProduct) {
        card.classList.add("hidden");
        card.innerHTML = "";
        return;
    }
    card.innerHTML = `
        <strong><i class="fa-solid fa-circle-check"></i> ${escapeHtml(state.selectedProduct.nome || "Peça carregada")}</strong>
        <span>${escapeHtml(categoryLabel(state.selectedProduct.categoria))} • preço atual ${escapeHtml(formatCurrencyCents(moneyToCents(state.selectedProduct.preco)))}</span>
    `;
    card.classList.remove("hidden");
}

function renderProductFilters() {
    const search = normalizeText($("site-product-search").value);
    const categories = [...new Set(state.products.map((product) => String(product.categoria || "outros")))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR"));
    const filter = $("site-category-filter");
    const previous = filter.value || "all";
    filter.innerHTML = '<option value="all">Todas as categorias</option>' + categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(categoryLabel(value))}</option>`).join("");
    filter.value = categories.includes(previous) ? previous : "all";
    const category = filter.value;

    const visible = state.products
        .filter((product) => category === "all" || String(product.categoria || "outros") === category)
        .filter((product) => !search || normalizeText([product.nome, product.categoria, product.tags].join(" ")).includes(search))
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    const select = $("site-product-select");
    select.innerHTML = '<option value="">Selecione uma peça...</option>' + visible.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.nome || "Produto")} • ${escapeHtml(categoryLabel(product.categoria))}</option>`).join("");
    if (state.selectedProduct && visible.some((product) => product.id === state.selectedProduct.id)) select.value = state.selectedProduct.id;
    $("site-product-feedback").textContent = `${visible.length} peça(s) encontrada(s). O cadastro será usado apenas como ponto de partida.`;
}

async function loadProducts() {
    if (state.productsLoaded || state.productsLoading) return;
    state.productsLoading = true;
    try {
        const snapshot = await getDocs(collection(db, "pecas"));
        state.products = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        state.productsLoaded = true;
        renderProductFilters();
    } catch (error) {
        console.error("[pricing.products]", error);
        $("site-product-select").innerHTML = '<option value="">Não foi possível carregar as peças</option>';
        $("site-product-feedback").textContent = "A calculadora continua funcionando para uma ficha nova.";
    } finally {
        state.productsLoading = false;
    }
}

function loadSelectedProduct() {
    const productId = $("site-product-select").value;
    const product = state.products.find((candidate) => candidate.id === productId);
    if (!product) {
        showToast("Escolha uma peça cadastrada.", "error");
        return;
    }

    const technicalSheet = Array.isArray(product.fichaTecnica) ? product.fichaTecnica : [];
    if (state.dirty && !window.confirm("Usar esta peça substituirá materiais, medidas, custos, tempo e observações atuais. Deseja continuar?")) return;

    state.selectedProduct = product;
    state.area = areaForProduct(product);
    state.template = "";
    state.measurements = [];
    $("piece-name").value = String(product.nome || "");
    $("piece-reference").value = String(product.codigo || product.sku || product.ref || "");
    setValue("labor-minutes", 0);
    setValue("extra-per-piece", 0);
    setValue("batch-fixed-cost", 0);
    setValue("waste-percent", 0);
    setValue("production-notes", "");
    $("notes-count").textContent = "0";
    $("technical-details").open = false;
    if (technicalSheet.length) {
        state.materials = technicalSheet.slice(0, 50).map((item) => {
            const unit = String(item?.unit || item?.unidade || "m");
            return {
                name: String(item?.nome || item?.item || "Material"),
                quantity: nonNegative(item?.qty ?? item?.metragem),
                unit: UNIT_OPTIONS.some(([allowed]) => allowed === unit) ? unit : "un",
                scope: "peca",
                unitCost: 0
            };
        });
    } else {
        const category = String(product.categoria || "");
        const templateId = state.area === "mesa_posta"
            ? ({ guardanapo: "guardanapo", lugar_americano: "lugar_americano", jogos_americanos: "lugar_americano", sousplat: "lugar_americano", caminho_mesa: "caminho_mesa" }[category] || "mesa_livre")
            : ({ camisa: "camisa", vestido: "vestido", saia: "saia_calca", calca: "saia_calca" }[category] || "roupa_livre");
        const template = (TEMPLATES[state.area] || []).find((candidate) => candidate.id === templateId);
        state.template = template?.id || "";
        state.materials = (template?.materials || [{ name: "Material principal", quantity: 0, unit: "un", scope: "peca" }])
            .map((material) => ({ ...material, unitCost: 0 }));
        setValue("labor-minutes", template?.minutes || 0);
    }
    renderArea();
    renderMaterials();
    renderMeasurements();
    renderLoadedProduct();
    state.dirty = true;
    recalculate();
    showToast("Peça carregada. Agora informe os custos dos materiais.", "info");
}

async function pricingApi(action, payload = {}) {
    if (!auth.currentUser) throw new Error("Sua sessão terminou. Entre novamente.");
    const token = await auth.currentUser.getIdToken();
    let apiBaseUrl = "";
    const configuredApi = document.querySelector('meta[name="lamed-api-base-url"]')?.getAttribute("content")?.trim();
    if (configuredApi) {
        apiBaseUrl = configuredApi.replace(/\/+$/, "");
    } else if (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "3001") {
        apiBaseUrl = "http://localhost:3001";
    }
    const response = await fetch(`${apiBaseUrl}/api/admin/storefront/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: `pricing.${action}`, payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Não foi possível concluir esta operação.");
    return data.result || {};
}

async function loadPricingConfig() {
    try {
        const result = await pricingApi("config");
        const templates = result?.templates;
        const valid = templates && Object.keys(AREA_LABELS).every((area) => (
            Array.isArray(templates[area])
            && templates[area].length > 0
            && templates[area].every((template) => template?.id && template?.label && Array.isArray(template?.materials))
        ));
        if (valid) TEMPLATES = templates;
        const cardFeePercent = numberFrom(result?.checkout?.cardFeePercent, DEFAULT_CHECKOUT_RATES.cardFeePercent);
        const pixDiscountPercent = numberFrom(result?.checkout?.pixDiscountPercent, DEFAULT_CHECKOUT_RATES.pixDiscountPercent);
        state.checkoutRates = {
            cardFeePercent: Math.min(50, Math.max(0, cardFeePercent)),
            pixDiscountPercent: Math.min(50, Math.max(0, pixDiscountPercent))
        };
    } catch (error) {
        console.error("[pricing.config]", error);
        showToast("Os atalhos internos não carregaram. A ficha livre continua disponível.", "info");
    }
}

function historyPrice(record) {
    if (record.schemaVersion === 2) return formatCurrencyCents(record.totals?.baseUnitPriceCents || 0);
    return record.resultLabel || "Registro antigo";
}

function renderHistory() {
    const container = $("pricing-history");
    if (!state.records.length) {
        container.innerHTML = '<p class="history-empty">Nenhuma ficha salva ainda. Quando você salvar um cálculo, ele aparecerá aqui.</p>';
        return;
    }
    container.innerHTML = state.records.map((record) => `
        <article class="history-item" data-history-id="${escapeHtml(record.id)}">
            <div class="history-item-main">
                <div>
                    <strong>${escapeHtml(record.name || "Ficha sem nome")}</strong>
                    <small>${escapeHtml(record.schemaVersion === 1 ? "Cálculo antigo" : AREA_LABELS[record.area] || "Peça")} • ${escapeHtml(formatDate(record.updatedAt || record.createdAt))}${record.sharedWithProduction ? " • compartilhada" : ""}</small>
                </div>
                <span class="history-price">${escapeHtml(historyPrice(record))}</span>
            </div>
            <div class="history-actions">
                ${record.schemaVersion === 2 ? `<button type="button" data-open-history="${escapeHtml(record.id)}"><i class="fa-solid fa-folder-open"></i> Abrir</button>` : '<button type="button" disabled title="Registro criado pela calculadora antiga">Somente consulta</button>'}
                ${record.schemaVersion === 2 ? `<button type="button" data-copy-history="${escapeHtml(record.id)}"><i class="fa-regular fa-copy"></i> Copiar</button>` : ""}
                ${record.canManage ? `<button type="button" class="archive-history" data-archive-history="${escapeHtml(record.id)}"><i class="fa-solid fa-box-archive"></i> Arquivar</button>` : ""}
            </div>
        </article>
    `).join("");
}

async function loadHistory() {
    const refresh = $("refresh-history");
    refresh.disabled = true;
    refresh.querySelector("i")?.classList.add("fa-spin");
    try {
        const result = await pricingApi("list");
        state.records = Array.isArray(result.records) ? result.records : [];
        renderHistory();
        $("history-context").textContent = state.isAdmin
            ? "Você vê fichas administrativas, fichas da equipe e registros antigos."
            : "Você vê suas fichas e os modelos compartilhados pela administração.";
    } catch (error) {
        console.error("[pricing.history]", error);
        $("history-context").textContent = error.message;
        $("pricing-history").innerHTML = '<p class="history-empty">Não foi possível carregar o histórico agora. Você ainda pode fazer o cálculo e tentar salvar novamente.</p>';
    } finally {
        refresh.disabled = false;
        refresh.querySelector("i")?.classList.remove("fa-spin");
    }
}

function loadRecord(record, { copy = false } = {}) {
    if (!record || record.schemaVersion !== 2) {
        showToast("Este registro foi criado pela calculadora antiga e está disponível apenas para consulta.", "info");
        return;
    }
    state.currentRecordId = copy || !record.canManage ? null : record.id;
    state.area = record.area in AREA_LABELS ? record.area : "sob_medida";
    state.template = String(record.template || "");
    state.materials = (record.materials || []).map((material) => ({
        name: String(material.name || ""),
        quantity: nonNegative(material.quantity),
        unit: String(material.unit || "un"),
        scope: material.scope === "lote" ? "lote" : "peca",
        unitCost: nonNegative(material.unitCostCents) / 100
    }));
    state.measurements = (record.measurements || []).map((measurement) => ({
        name: String(measurement.name || ""), value: String(measurement.value || ""), unit: String(measurement.unit || "cm")
    }));
    state.selectedProduct = record.source?.productId
        ? state.products.find((product) => product.id === record.source.productId) || {
            id: record.source.productId,
            nome: record.source.productName || record.name,
            preco: nonNegative(record.source.currentPriceCents) / 100,
            categoria: ""
        }
        : null;

    setValue("piece-name", copy ? `${record.name} (cópia)` : record.name);
    setValue("piece-reference", record.reference || "");
    setValue("piece-quantity", record.quantity || 1);
    setValue("labor-minutes", record.labor?.minutesPerPiece || 0);
    setValue("hourly-rate", nonNegative(record.labor?.hourlyRateCents) / 100);
    setValue("extra-per-piece", nonNegative(record.extras?.perPieceCents) / 100);
    setValue("batch-fixed-cost", nonNegative(record.extras?.batchCents) / 100);
    setValue("waste-percent", record.extras?.wastePercent || 0);
    setValue("overhead-percent", record.extras?.overheadPercent || 0);
    setValue("pricing-method", record.pricing?.method || "acrescimo");
    setValue("pricing-percentage", record.pricing?.percentage ?? 100);
    setValue("card-fee", state.checkoutRates.cardFeePercent);
    setValue("pix-discount", state.checkoutRates.pixDiscountPercent);
    setValue("production-notes", record.notes || "");
    $("notes-count").textContent = String((record.notes || "").length);
    $("share-team").checked = state.isAdmin && record.sharedWithProduction === true;
    if (state.measurements.length || state.area === "sob_medida") $("technical-details").open = true;
    renderArea();
    renderMaterials();
    renderMeasurements();
    renderLoadedProduct();
    updatePricingMethod();
    updateSaveMode();
    state.dirty = false;
    $("pricing-result").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(copy || !record.canManage ? "Cópia aberta. Ao salvar, uma nova ficha será criada." : "Ficha aberta para edição.", "info");
}

function duplicateCurrent() {
    if (!state.currentRecordId) return;
    state.currentRecordId = null;
    const name = $("piece-name").value.trim();
    if (name && !name.endsWith("(cópia)")) $("piece-name").value = `${name} (cópia)`;
    $("share-team").checked = false;
    state.dirty = true;
    updateSaveMode();
    showToast("A próxima gravação criará uma nova ficha.", "info");
}

function updateSaveMode() {
    const label = $("save-pricing").querySelector("span");
    label.textContent = state.currentRecordId ? "Atualizar ficha" : "Salvar ficha";
    $("duplicate-pricing").classList.toggle("hidden", !state.currentRecordId);
}

function validateBeforeSave(data) {
    const numericInputs = Array.from(document.querySelectorAll('#pricing-app input[type="number"]'));
    const invalidInput = numericInputs.find((input) => !input.checkValidity());
    if (invalidInput) {
        invalidInput.reportValidity();
        return "Revise o campo destacado antes de salvar.";
    }
    if (!data.name) {
        $("piece-name").focus();
        return "Informe o nome da peça.";
    }
    if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 10000) return "Informe uma quantidade válida entre 1 e 10.000.";
    if (!data.materials.length || data.materials.some((material) => !material.name)) return "Preencha o nome de todos os materiais.";
    if (state.materials.some((material) => numberFrom(material.quantity) < 0 || numberFrom(material.unitCost) < 0)) return "Custos e quantidades não podem ser negativos.";
    if (data.pricing.method === "margem" && data.pricing.percentage > 95) return "A margem desejada deve ficar entre 0% e 95%.";
    if (data.pricing.method === "acrescimo" && data.pricing.percentage > 1000) return "O acréscimo deve ficar entre 0% e 1.000%.";
    if (data.pricing.cardFeePercent > 50 || data.pricing.pixDiscountPercent > 50) return "Taxa do cartão e desconto Pix devem ficar entre 0% e 50%.";
    if (state.measurements.some((measurement) => Boolean(String(measurement.name || "").trim()) !== Boolean(String(measurement.value || "").trim()))) {
        return "Preencha o nome e o valor de cada medida, ou remova a linha incompleta.";
    }
    const totals = calculateTotals(data);
    if (totals.error) return totals.error;
    if (totals.batchCostCents <= 0) return "Informe pelo menos um custo de material, trabalho ou serviço.";
    if (totals.pixProfitBatchCents < 0) {
        return `O preço no Pix fica ${formatCurrencyCents(Math.abs(totals.pixProfitBatchCents))} abaixo do custo. Reduza o desconto ou aumente o preço.`;
    }
    return "";
}

async function savePricing() {
    if (state.saving) return;
    const data = readCalculatorData();
    const validationError = validateBeforeSave(data);
    if (validationError) {
        showToast(validationError, "error");
        return;
    }
    state.saving = true;
    const button = $("save-pricing");
    const previousHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Salvando...</span>';
    try {
        const result = await pricingApi("save", {
            ...data,
            id: state.currentRecordId,
            sharedWithProduction: state.isAdmin && $("share-team").checked
        });
        state.currentRecordId = result.record?.id || state.currentRecordId;
        state.dirty = false;
        updateSaveMode();
        await loadHistory();
        showToast("Ficha salva com segurança no histórico privado.");
    } catch (error) {
        console.error("[pricing.save]", error);
        showToast(error.message || "Não foi possível salvar a ficha.", "error");
    } finally {
        state.saving = false;
        button.disabled = false;
        button.innerHTML = previousHtml;
        updateSaveMode();
    }
}

async function archiveRecord(recordId) {
    const record = state.records.find((candidate) => candidate.id === recordId);
    if (!record?.canManage || !window.confirm(`Arquivar a ficha “${record.name}”? Ela sairá da lista, mas não será apagada definitivamente.`)) return;
    try {
        await pricingApi("archive", { id: recordId });
        if (state.currentRecordId === recordId) state.currentRecordId = null;
        updateSaveMode();
        await loadHistory();
        showToast("Ficha arquivada.", "info");
    } catch (error) {
        showToast(error.message || "Não foi possível arquivar a ficha.", "error");
    }
}

function resetCalculator({ ask = true, scroll = true } = {}) {
    if (ask && state.dirty && !window.confirm("Começar uma nova ficha? As alterações que ainda não foram salvas serão descartadas.")) return;
    state.area = "roupa";
    state.template = TEMPLATES.roupa?.[0]?.id || "roupa_livre";
    state.materials = [];
    state.selectedProduct = null;
    state.currentRecordId = null;
    state.measurements = [];
    setValue("piece-name", "");
    setValue("piece-reference", "");
    setValue("piece-quantity", 1);
    setValue("labor-minutes", 0);
    setValue("hourly-rate", 0);
    setValue("extra-per-piece", 0);
    setValue("batch-fixed-cost", 0);
    setValue("waste-percent", 0);
    setValue("overhead-percent", 0);
    setValue("pricing-method", "acrescimo");
    setValue("pricing-percentage", 100);
    setValue("card-fee", state.checkoutRates.cardFeePercent);
    setValue("pix-discount", state.checkoutRates.pixDiscountPercent);
    setValue("production-notes", "");
    $("notes-count").textContent = "0";
    $("share-team").checked = false;
    $("technical-details").open = false;
    renderArea();
    applyTemplate(state.template, { initial: true });
    renderMeasurements();
    renderLoadedProduct();
    updatePricingMethod();
    updateSaveMode();
    state.dirty = false;
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message, type = "success") {
    const toast = $("pricing-toast");
    toast.textContent = message;
    toast.className = `pricing-toast ${type}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3500);
}

function markDirtyAndRecalculate(event) {
    if (event.target.closest("#pricing-history") || event.target.closest("#site-product-disclosure")) return;
    state.dirty = true;
    if (event.target.id === "production-notes") $("notes-count").textContent = String(event.target.value.length);
    recalculate();
}

function bindEvents() {
    document.querySelectorAll("[data-area]").forEach((button) => button.addEventListener("click", () => setArea(button.dataset.area)));
    document.querySelector(".area-selector").addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(document.querySelectorAll("[data-area]"));
        const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const next = buttons[(currentIndex + direction + buttons.length) % buttons.length];
        next.focus();
        next.click();
    });
    $("template-chips").addEventListener("click", (event) => {
        const button = event.target.closest("[data-template]");
        if (button) applyTemplate(button.dataset.template);
    });
    $("materials-list").addEventListener("input", updateMaterial);
    $("materials-list").addEventListener("change", updateMaterial);
    $("materials-list").addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-material]");
        if (button) removeMaterial(Number(button.dataset.removeMaterial));
    });
    $("measurements-list").addEventListener("input", updateMeasurement);
    $("measurements-list").addEventListener("change", updateMeasurement);
    $("measurements-list").addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-measurement]");
        if (button) removeMeasurement(Number(button.dataset.removeMeasurement));
    });
    ["add-material", "add-material-mobile"].forEach((id) => $(id).addEventListener("click", addMaterial));
    ["add-measurement", "add-measurement-mobile"].forEach((id) => $(id).addEventListener("click", addMeasurement));
    $("site-category-filter").addEventListener("change", renderProductFilters);
    $("site-product-search").addEventListener("input", renderProductFilters);
    $("site-product-disclosure").addEventListener("toggle", () => {
        if ($("site-product-disclosure").open) loadProducts();
    });
    $("load-site-product").addEventListener("click", loadSelectedProduct);
    $("pricing-method").addEventListener("change", () => {
        state.dirty = true;
        updatePricingMethod();
    });
    $("pricing-app").addEventListener("input", markDirtyAndRecalculate);
    $("pricing-app").addEventListener("change", markDirtyAndRecalculate);
    $("save-pricing").addEventListener("click", savePricing);
    $("duplicate-pricing").addEventListener("click", duplicateCurrent);
    ["clear-calculator", "clear-calculator-mobile"].forEach((id) => $(id).addEventListener("click", () => resetCalculator()));
    $("refresh-history").addEventListener("click", loadHistory);
    $("show-result").addEventListener("click", () => $("pricing-result").scrollIntoView({ behavior: "smooth", block: "start" }));
    $("pricing-history").addEventListener("click", (event) => {
        const open = event.target.closest("[data-open-history]");
        const copy = event.target.closest("[data-copy-history]");
        const archive = event.target.closest("[data-archive-history]");
        if (open) loadRecord(state.records.find((record) => record.id === open.dataset.openHistory));
        else if (copy) loadRecord(state.records.find((record) => record.id === copy.dataset.copyHistory), { copy: true });
        else if (archive) archiveRecord(archive.dataset.archiveHistory);
    });
}

async function resolveAccess(user) {
    if (!user) return null;
    const token = await user.getIdTokenResult(true);
    const isAdmin = ADMIN_UIDS.has(user.uid) || token.claims?.admin === true;
    const isProduction = token.claims?.production === true;
    return isAdmin || isProduction ? { isAdmin, isProduction } : null;
}

function revealApplication(access) {
    state.isAdmin = access.isAdmin;
    const productionOnly = !access.isAdmin && access.isProduction;
    document.body.classList.toggle("production-role", productionOnly);
    $("access-role").innerHTML = access.isAdmin
        ? '<i class="fa-solid fa-shield-halved"></i> Administração'
        : '<i class="fa-solid fa-user-gear"></i> Equipe de produção';
    $("share-team-wrapper").classList.toggle("hidden", !access.isAdmin);
    if (productionOnly) {
        const home = document.querySelector(".admin-native-home");
        if (home) home.href = "estoque-mesaposta.html";
        const back = document.querySelector(".pricing-back");
        if (back) back.href = "estoque-mesaposta.html";
    }
    document.body.classList.remove("admin-auth-pending");
    $("pricing-app").setAttribute("aria-busy", "false");
}

function init() {
    bindEvents();
    renderArea();
    renderMaterials();
    renderMeasurements();
    updatePricingMethod();
    updateSaveMode();
    state.dirty = false;
    window.adminNativeSignOut = () => signOut(auth);

    onAuthStateChanged(auth, async (user) => {
        let access = null;
        try {
            access = await resolveAccess(user);
        } catch (error) {
            console.error("[pricing.auth]", error);
        }
        if (!access) {
            if (user) await signOut(auth).catch(() => {});
            window.location.replace("login-admin.html");
            return;
        }
        state.user = user;
        if (state.loaded) {
            revealApplication(access);
            return;
        }
        await loadPricingConfig();
        resetCalculator({ ask: false, scroll: false });
        revealApplication(access);
        state.loaded = true;
        await loadHistory();
    });
}

document.addEventListener("DOMContentLoaded", init);
