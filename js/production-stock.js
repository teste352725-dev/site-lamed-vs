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

const MESA_CATEGORIES = [
    { id: 'all', label: 'Todas' },
    { id: 'lugar_americano', label: 'Lugar Americano' },
    { id: 'guardanapo', label: 'Guardanapo' },
    { id: 'porta_guardanapo', label: 'Porta Guardanapo' },
    { id: 'anel_guardanapo', label: 'Porta Guardanapo' },
    { id: 'caminho_mesa', label: 'Caminho de Mesa' },
    { id: 'trilho_velas', label: 'Trilho para Velas' },
    { id: 'sousplat', label: 'Sousplat' },
    { id: 'jogos_americanos', label: 'Jogos Americanos' },
    { id: 'colecoes_especiais', label: 'Coleções Especiais' },
    { id: 'mesa_posta', label: 'Mesa Posta' }
];

const TECH_SHEETS = {
    lugar_americano: [{ item: 'Linho Cru', qty: 0.35, unit: 'm' }, { item: 'Linha Bege', qty: 2, unit: 'm' }, { item: 'Etiqueta', qty: 1, unit: 'un' }, { item: 'Embalagem', qty: 1, unit: 'un' }],
    guardanapo: [{ item: 'Linho', qty: 0.45, unit: 'm' }, { item: 'Linha', qty: 1.5, unit: 'm' }, { item: 'Etiqueta', qty: 1, unit: 'un' }],
    porta_guardanapo: [{ item: 'Argola/Base', qty: 1, unit: 'un' }, { item: 'Linha', qty: 1, unit: 'm' }, { item: 'Embalagem', qty: 1, unit: 'un' }],
    anel_guardanapo: [{ item: 'Argola/Base', qty: 1, unit: 'un' }, { item: 'Linha', qty: 1, unit: 'm' }, { item: 'Embalagem', qty: 1, unit: 'un' }],
    caminho_mesa: [{ item: 'Linho', qty: 1.4, unit: 'm' }, { item: 'Linha', qty: 4, unit: 'm' }, { item: 'Etiqueta', qty: 1, unit: 'un' }],
    trilho_velas: [{ item: 'Linho', qty: 0.75, unit: 'm' }, { item: 'Linha', qty: 2.5, unit: 'm' }],
    sousplat: [{ item: 'Base de Sousplat', qty: 1, unit: 'un' }, { item: 'Tecido', qty: 0.45, unit: 'm' }, { item: 'Embalagem', qty: 1, unit: 'un' }],
    jogos_americanos: [{ item: 'Linho Cru', qty: 0.35, unit: 'm' }, { item: 'Linha Bege', qty: 2, unit: 'm' }, { item: 'Etiqueta', qty: 1, unit: 'un' }, { item: 'Embalagem', qty: 1, unit: 'un' }],
    mesa_posta: [{ item: 'Linho Cru', qty: 0.35, unit: 'm' }, { item: 'Linha', qty: 2, unit: 'm' }, { item: 'Etiqueta', qty: 1, unit: 'un' }]
};

const state = {
    products: [],
    collections: [],
    orders: [],
    colorBank: [],
    filtered: [],
    selectedCategory: 'all',
    view: localStorage.getItem('lamed_stock_view') || 'grid',
    deferredPrompt: null,
    db: null,
    auth: null,
    user: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value.seconds) return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isMesaProduct(product) {
    const category = String(product.categoria || '');
    return product.segmento === 'mesa' || MESA_CATEGORIES.some((item) => item.id === category && item.id !== 'all');
}

function formatCategory(category) {
    const found = MESA_CATEGORIES.find((item) => item.id === category);
    return found?.label || String(category || 'Sem categoria').replace(/_/g, ' ');
}

function getCollectionName(id) {
    return state.collections.find((collection) => collection.id === id)?.nome || 'Sem coleção';
}

function productCode(product) {
    return product.codigo || product.sku || product.ref || product.id;
}

function productColors(product) {
    return Array.isArray(product.cores) ? product.cores : [];
}

function colorStock(color) {
    return toNumber(color?.estoque ?? color?.quantidade ?? color?.stock, 0);
}

function colorProduce(color) {
    return toNumber(color?.produzir ?? color?.producao ?? color?.production, 0);
}

function totalStock(product) {
    const colors = productColors(product);
    const colorTotal = colors.reduce((sum, color) => sum + colorStock(color), 0);
    const productTotal = toNumber(product.estoque ?? product.quantidade ?? product.stock, 0);
    return Math.max(colorTotal, productTotal);
}

function getMinStock(product) {
    return toNumber(product.estoqueMinimo ?? product.minimo ?? product.minStock, 0);
}

function totalProduction(product) {
    const explicit = toNumber(product.produzir ?? product.producao ?? product.production, NaN);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);
    const colors = productColors(product);
    if (colors.length) return colors.reduce((sum, color) => sum + Math.max(0, colorProduce(color)), 0);
    return 0;
}

function statusFor(product) {
    if (totalStock(product) <= 0) return { key: 'out', label: 'Sem estoque', className: 'status-out' };
    if (getMinStock(product) > 0 && totalStock(product) <= getMinStock(product)) return { key: 'low', label: 'Estoque baixo', className: 'status-low' };
    if (totalProduction(product) <= 0) return { key: 'done', label: 'Concluído', className: 'status-ok' };
    return { key: 'production', label: 'Em produção', className: 'status-low' };
}

function imageFor(product) {
    return (Array.isArray(product.imagens) && product.imagens[0]) || product.imagem || 'https://i.ibb.co/mr93jDHT/JM.png';
}

function isEditorLoggedIn() {
    return Boolean(state.user);
}

function requireEditorLogin() {
    if (isEditorLoggedIn()) return true;
    setAuthFeedback('Entre com e-mail/senha ou Google antes de salvar no Firebase.', 'error');
    document.getElementById('stock-login-email')?.focus();
    return false;
}

function setAuthFeedback(message, type = 'info') {
    const feedback = $('#auth-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.style.color = type === 'error' ? 'var(--stock-red)' : type === 'success' ? 'var(--stock-green)' : 'var(--stock-muted)';
}

function updateAuthUi(user) {
    const status = $('#auth-status');
    const logout = $('#stock-logout');
    if (status) {
        status.className = `sync-pill ${user ? 'online' : 'offline'}`;
        status.innerHTML = `<i class="fa-solid ${user ? 'fa-unlock' : 'fa-lock'}"></i>${user ? escapeHtml(user.email || 'Logado') : 'Sem login'}`;
    }
    logout?.classList.toggle('hidden', !user);
    document.body.classList.toggle('edit-locked', !user);
}

async function signInWithEmailPassword(event) {
    event.preventDefault();
    const email = $('#stock-login-email')?.value.trim();
    const password = $('#stock-login-password')?.value;
    if (!email || !password) return setAuthFeedback('Informe e-mail e senha.', 'error');
    try {
        await state.auth.signInWithEmailAndPassword(email, password);
        setAuthFeedback('Login realizado. Edição liberada.', 'success');
    } catch (error) {
        console.error('[estoque.auth.email]', error);
        setAuthFeedback(`Não foi possível entrar: ${error.message}`, 'error');
    }
}

async function signInWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await state.auth.signInWithPopup(provider);
        setAuthFeedback('Login Google realizado. Edição liberada.', 'success');
    } catch (error) {
        console.error('[estoque.auth.google]', error);
        setAuthFeedback(`Google não entrou aqui: ${error.message}`, 'error');
    }
}

async function loadData() {
    setSyncStatus('online', 'Carregando');
    const [productsSnap, collectionsSnap, ordersSnap, colorsSnap] = await Promise.all([
        state.db.collection('pecas').get(),
        state.db.collection('colecoes').get().catch(() => ({ docs: [] })),
        state.db.collection('pedidos').get().catch(() => ({ docs: [] })),
        state.db.collection('cores_estoque').get().catch(() => ({ docs: [] }))
    ]);

    state.collections = collectionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.colorBank = colorsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.products = productsSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((product) => String(product.status || 'active').toLowerCase() !== 'inactive')
        .filter(isMesaProduct);

    hydrateColorBankFromProducts();
    hydrateFilters();
    hydrateMovementControls();
    applyFilters();
    setSyncStatus('online', 'Sincronizado');
}

function hydrateColorBankFromProducts() {
    const byName = new Map(state.colorBank.map((color) => [normalize(color.nome || color.name), color]));
    state.products.flatMap(productColors).forEach((color) => {
        const key = normalize(color?.nome);
        if (!key || byName.has(key)) return;
        byName.set(key, { id: key, nome: color.nome, hex: color.hex || '#000000', fromProduct: true });
    });
    state.colorBank = Array.from(byName.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

function allColorsForProduct(product) {
    const byName = new Map();
    state.colorBank.forEach((color) => {
        if (color?.nome) byName.set(normalize(color.nome), { nome: color.nome, hex: color.hex || '#000000' });
    });
    productColors(product).forEach((color) => {
        if (color?.nome) byName.set(normalize(color.nome), { nome: color.nome, hex: color.hex || '#000000', quantidade: colorStock(color), produzir: colorProduce(color) });
    });
    return Array.from(byName.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

function hydrateMovementControls() {
    const productSelect = $('#movement-product');
    if (productSelect) {
        productSelect.innerHTML = '<option value="">Selecione uma peça</option>' + state.products
            .slice()
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
            .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.nome || product.id)}</option>`)
            .join('');
    }
    hydrateMovementColors();
}

function hydrateMovementColors() {
    const colorSelect = $('#movement-color');
    if (!colorSelect) return;
    const product = state.products.find((item) => item.id === $('#movement-product')?.value);
    const colors = product ? allColorsForProduct(product) : state.colorBank;
    colorSelect.innerHTML = '<option value="">Selecione uma cor</option>' + colors.map((color) => `<option value="${escapeHtml(color.nome)}" data-hex="${escapeHtml(color.hex || '#000000')}">${escapeHtml(color.nome)}</option>`).join('');
}

async function createBankColor() {
    if (!requireEditorLogin()) return;
    const nome = $('#bank-color-name')?.value.trim();
    const hex = $('#bank-color-hex')?.value || '#000000';
    if (!nome) return setAuthFeedback('Digite o nome da cor para cadastrar.', 'error');
    const exists = state.colorBank.some((color) => normalize(color.nome) === normalize(nome));
    if (exists) return setAuthFeedback('Essa cor já existe no banco de cores.', 'error');
    try {
        const docRef = await state.db.collection('cores_estoque').add({ nome, hex, createdAt: new Date(), updatedAt: new Date() });
        state.colorBank.push({ id: docRef.id, nome, hex });
        hydrateColorBankFromProducts();
        hydrateFilters();
        hydrateMovementColors();
        $('#bank-color-name').value = '';
        setAuthFeedback(`Cor ${nome} criada no banco de cores.`, 'success');
    } catch (error) {
        console.error('[estoque.colors.create]', error);
        setAuthFeedback(`Não consegui criar a cor: ${error.message}`, 'error');
    }
}

async function deleteSelectedBankColor() {
    if (!requireEditorLogin()) return;
    const colorName = $('#movement-color')?.value;
    const color = state.colorBank.find((item) => normalize(item.nome) === normalize(colorName));
    if (!color || color.fromProduct) return setAuthFeedback('Selecione uma cor cadastrada no banco para apagar.', 'error');
    if (!confirm(`Apagar a cor "${color.nome}" do banco de cores? Ela não será removida das peças que já usam essa cor.`)) return;
    try {
        await state.db.collection('cores_estoque').doc(color.id).delete();
        state.colorBank = state.colorBank.filter((item) => item.id !== color.id);
        hydrateMovementColors();
        setAuthFeedback(`Cor ${color.nome} apagada do banco.`, 'success');
    } catch (error) {
        console.error('[estoque.colors.delete]', error);
        setAuthFeedback(`Não consegui apagar a cor: ${error.message}`, 'error');
    }
}

async function applyStockMovement() {
    if (!requireEditorLogin()) return;
    const productId = $('#movement-product')?.value;
    const colorName = $('#movement-color')?.value;
    const quantity = Math.max(1, toNumber($('#movement-quantity')?.value, 1));
    const type = $('#movement-type')?.value || 'stock';
    const product = state.products.find((item) => item.id === productId);
    if (!product) return setAuthFeedback('Selecione a peça que vai receber estoque.', 'error');
    if (!colorName) return setAuthFeedback('Selecione a cor da peça.', 'error');

    const selectedOption = $('#movement-color')?.selectedOptions?.[0];
    const hex = selectedOption?.dataset?.hex || '#000000';
    const cores = productColors(product).map((color) => ({ ...color }));
    let target = cores.find((color) => normalize(color.nome) === normalize(colorName));
    if (!target) {
        target = { nome: colorName, hex, quantidade: 0, estoque: 0, produzir: 0 };
        cores.push(target);
    }
    if (type === 'production') target.produzir = colorProduce(target) + quantity;
    else {
        const nextStock = colorStock(target) + quantity;
        target.quantidade = nextStock;
        target.estoque = nextStock;
    }

    const nextStockTotal = cores.reduce((sum, color) => sum + colorStock(color), 0);
    const nextProductionTotal = cores.reduce((sum, color) => sum + colorProduce(color), 0);
    await updateProduct(productId, {
        cores,
        estoque: nextStockTotal,
        produzir: nextProductionTotal,
        updatedAt: new Date()
    }, `${type === 'production' ? 'Produção adicionada' : 'Estoque adicionado'}: ${quantity} un. na cor ${colorName}`);
    hydrateMovementControls();
    setAuthFeedback(`${quantity} un. adicionada(s) em ${product.nome} / ${colorName}.`, 'success');
}

function setSyncStatus(type, label) {
    const el = $('#sync-status');
    if (!el) return;
    el.className = `sync-pill ${type || ''}`;
    el.innerHTML = `<i class="fa-solid ${type === 'offline' ? 'fa-cloud-arrow-up' : 'fa-cloud'}"></i>${escapeHtml(label)}`;
}

function hydrateFilters() {
    const tabs = $('#category-tabs');
    tabs.innerHTML = MESA_CATEGORIES.map((category) => `<button type="button" data-category="${category.id}" class="${state.selectedCategory === category.id ? 'active' : ''}">${escapeHtml(category.label)}</button>`).join('');

    const collectionSelect = $('#filter-collection');
    const usedCollections = [...new Set(state.products.map((product) => product.colecaoId).filter(Boolean))];
    collectionSelect.innerHTML = '<option value="all">Todas</option>' + usedCollections.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(getCollectionName(id))}</option>`).join('');

    const colorSelect = $('#filter-color');
    const colors = [...new Set([
        ...state.colorBank.map((color) => color?.nome).filter(Boolean),
        ...state.products.flatMap((product) => productColors(product).map((color) => color?.nome).filter(Boolean))
    ])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    colorSelect.innerHTML = '<option value="all">Todas</option>' + colors.map((color) => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`).join('');
}

function applyFilters() {
    const term = normalize($('#stock-search')?.value || '');
    const collection = $('#filter-collection')?.value || 'all';
    const color = $('#filter-color')?.value || 'all';
    const status = $('#filter-status')?.value || 'all';
    const sort = $('#sort-products')?.value || 'updated';

    state.filtered = state.products.filter((product) => {
        const categoryMatch = state.selectedCategory === 'all' || product.categoria === state.selectedCategory;
        const collectionMatch = collection === 'all' || product.colecaoId === collection;
        const colorMatch = color === 'all' || productColors(product).some((item) => item?.nome === color);
        const statusMeta = statusFor(product);
        const statusMatch = status === 'all'
            || statusMeta.key === status
            || (status === 'missing' && materialsForProduct(product).some((item) => item.missing > 0));
        const haystack = normalize([
            product.nome,
            productCode(product),
            product.categoria,
            formatCategory(product.categoria),
            getCollectionName(product.colecaoId),
            product.tags,
            product.descricao,
            productColors(product).map((item) => item?.nome).join(' ')
        ].join(' '));
        return categoryMatch && collectionMatch && colorMatch && statusMatch && (!term || haystack.includes(term));
    });

    state.filtered.sort((a, b) => compareProducts(a, b, sort));
    renderAll();
}

function compareProducts(a, b, sort) {
    const text = (left, right) => String(left || '').localeCompare(String(right || ''), 'pt-BR');
    if (sort === 'name') return text(a.nome, b.nome);
    if (sort === 'code') return text(productCode(a), productCode(b));
    if (sort === 'stock') return totalStock(a) - totalStock(b);
    if (sort === 'production') return totalProduction(b) - totalProduction(a);
    if (sort === 'category') return text(formatCategory(a.categoria), formatCategory(b.categoria));
    if (sort === 'collection') return text(getCollectionName(a.colecaoId), getCollectionName(b.colecaoId));
    if (sort === 'color') return text(productColors(a)[0]?.nome, productColors(b)[0]?.nome);
    return timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt);
}

function renderAll() {
    renderStats();
    renderCharts();
    renderProducts();
    renderProduction();
    renderMaterials();
    renderAlerts();
    renderReports();
}

function renderStats() {
    const total = state.products.length;
    const inStock = state.products.filter((product) => totalStock(product) > 0).length;
    const out = state.products.filter((product) => totalStock(product) <= 0).length;
    const low = state.products.filter((product) => getMinStock(product) > 0 && totalStock(product) > 0 && totalStock(product) <= getMinStock(product)).length;
    const production = state.products.reduce((sum, product) => sum + totalProduction(product), 0);
    const materials = aggregateMaterials(state.products).reduce((sum, item) => sum + item.qty, 0);
    const colors = state.products.reduce((sum, product) => sum + productColors(product).length, 0);
    const weekProduction = productionEvents().reduce((sum, event) => sum + event.qty, 0);

    $('#stat-total-products').textContent = total;
    $('#stat-in-stock').textContent = inStock;
    $('#stat-out-stock').textContent = out;
    $('#stat-low-stock').textContent = low;
    $('#stat-produce-today').textContent = production;
    $('#stat-materials').textContent = formatQty(materials);
    $('#stat-colors').textContent = colors;
    $('#stat-week-production').textContent = weekProduction;
    $('#hero-production-total').textContent = `${production} peças`;
}

function renderCharts() {
    const byCategory = new Map();
    state.products.forEach((product) => byCategory.set(formatCategory(product.categoria), (byCategory.get(formatCategory(product.categoria)) || 0) + totalStock(product)));
    renderBarChart('#category-chart', Array.from(byCategory.entries()).map(([label, value]) => ({ label, value })));

    const days = lastSevenDays().map((day) => ({ label: day.label, value: productionEvents().filter((event) => event.key === day.key).reduce((sum, item) => sum + item.qty, 0) }));
    renderBarChart('#week-chart', days);

    renderMiniList('#most-produced-list', state.products.slice().sort((a, b) => totalProduction(b) - totalProduction(a)).slice(0, 5).map((product) => ({ label: product.nome, value: `${totalProduction(product)} un.` })), 'Sem produção pendente.');
    renderMiniList('#most-sold-list', soldRanking().slice(0, 5).map((item) => ({ label: item.name, value: `${item.qty} vendas` })), 'Sem pedidos lidos.');
}

function renderBarChart(selector, rows) {
    const container = $(selector);
    const max = Math.max(1, ...rows.map((row) => row.value));
    container.innerHTML = rows.length ? rows.map((row) => `
        <div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (row.value / max) * 100)}%"></div></div><strong>${formatQty(row.value)}</strong></div>
    `).join('') : '<p class="muted">Sem dados ainda.</p>';
}

function renderMiniList(selector, rows, empty) {
    const container = $(selector);
    container.innerHTML = rows.length ? rows.map((row) => `<div class="mini-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`).join('') : `<p class="muted">${escapeHtml(empty)}</p>`;
}

function renderProducts() {
    $('#results-count').textContent = `${state.filtered.length} peça(s) encontrada(s)`;
    $('#products-grid').classList.toggle('hidden', state.view !== 'grid');
    $('#products-table-wrap').classList.toggle('hidden', state.view !== 'table');
    $$('.view-toggle button').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));

    $('#products-grid').innerHTML = state.filtered.length ? state.filtered.map(productCardHtml).join('') : '<p class="muted">Nenhuma peça encontrada com esses filtros.</p>';
    $('#products-table-body').innerHTML = state.filtered.map((product) => {
        const status = statusFor(product);
        return `<tr data-product-id="${escapeHtml(product.id)}"><td>${escapeHtml(productCode(product))}</td><td>${escapeHtml(product.nome)}</td><td>${totalStock(product)}</td><td>${totalProduction(product)}</td><td>${escapeHtml(getCollectionName(product.colecaoId))}</td><td>${escapeHtml(formatCategory(product.categoria))}</td><td><span class="status-pill ${status.className}">${status.label}</span></td></tr>`;
    }).join('');
}

function productCardHtml(product) {
    const status = statusFor(product);
    return `<article class="product-card" data-product-id="${escapeHtml(product.id)}">
        <img src="${escapeHtml(imageFor(product))}" alt="${escapeHtml(product.nome)}" loading="lazy">
        <div class="product-card__body">
            <div class="product-meta">${escapeHtml(productCode(product))} • ${escapeHtml(formatCategory(product.categoria))}</div>
            <h3>${escapeHtml(product.nome)}</h3>
            <span class="status-pill ${status.className}">${status.label}</span>
            <div class="product-numbers"><span>Estoque<strong>${totalStock(product)}</strong></span><span>Produzir<strong>${totalProduction(product)}</strong></span><span>Mínimo<strong>${getMinStock(product)}</strong></span></div>
            <div class="color-chips">${productColors(product).slice(0, 4).map(colorChipHtml).join('') || '<span class="color-chip">Sem cores</span>'}</div>
        </div>
    </article>`;
}

function colorChipHtml(color) {
    return `<span class="color-chip"><span class="color-dot" style="background:${escapeHtml(color?.hex || '#ddd')}"></span>${escapeHtml(color?.nome || 'Cor')} ${colorStock(color)}</span>`;
}

function renderProduction() {
    const rows = state.products.filter((product) => totalProduction(product) > 0).sort((a, b) => totalProduction(b) - totalProduction(a));
    $('#production-list').innerHTML = rows.length ? rows.map((product) => `<div class="production-row"><span>✔ ${escapeHtml(product.nome)}<small> ${escapeHtml(formatCategory(product.categoria))}</small></span><strong>${totalProduction(product)}</strong></div>`).join('') : '<p class="muted">Nenhuma peça pendente para hoje.</p>';
}

function aggregateMaterials(products) {
    const totals = new Map();
    products.forEach((product) => materialsForProduct(product).forEach((material) => {
        const key = `${material.item}|${material.unit}`;
        const current = totals.get(key) || { item: material.item, unit: material.unit, qty: 0, missing: 0 };
        current.qty += material.qty;
        current.missing += material.missing;
        totals.set(key, current);
    }));
    return Array.from(totals.values()).sort((a, b) => b.qty - a.qty);
}

function materialsForProduct(product) {
    const production = totalProduction(product);
    if (!production) return [];
    const sheet = Array.isArray(product.fichaTecnica) && product.fichaTecnica.length ? product.fichaTecnica : (TECH_SHEETS[product.categoria] || TECH_SHEETS.mesa_posta);
    return sheet.map((item) => {
        const qty = toNumber(item.qty ?? item.quantidade, 0) * production;
        const available = toNumber(item.disponivel ?? item.estoque, qty);
        return { item: item.item || item.nome || 'Material', unit: item.unit || item.unidade || 'un', qty, missing: Math.max(0, qty - available) };
    });
}

function renderMaterials() {
    const rows = aggregateMaterials(state.products);
    $('#materials-list').innerHTML = rows.length ? rows.map((item) => `<div class="material-row"><span>${escapeHtml(item.item)}<small> ${item.missing > 0 ? `⚠ Falta ${formatQty(item.missing)} ${escapeHtml(item.unit)}` : 'OK'}</small></span><strong>${formatQty(item.qty)} ${escapeHtml(item.unit)}</strong></div>`).join('') : '<p class="muted">Sem matéria-prima pendente.</p>';
}

function renderAlerts() {
    const alerts = [];
    state.products.forEach((product) => {
        if (totalStock(product) <= 0) alerts.push({ type: '🔴', text: `${product.nome} sem estoque` });
        else if (getMinStock(product) > 0 && totalStock(product) <= getMinStock(product)) alerts.push({ type: '🟡', text: `${product.nome} abaixo do mínimo` });
        materialsForProduct(product).filter((item) => item.missing > 0).forEach((item) => alerts.push({ type: '🔴', text: `${item.item} insuficiente para ${product.nome}` }));
    });
    $('#alerts-list').innerHTML = alerts.length ? alerts.slice(0, 18).map((alert) => `<div class="alert-row"><span>${alert.type} ${escapeHtml(alert.text)}</span></div>`).join('') : '<p class="muted">Nenhum alerta crítico agora.</p>';
}

function renderReports() {
    const stopped = state.products.filter((product) => getMinStock(product) > 0 && totalStock(product) > getMinStock(product) && totalProduction(product) === 0).length;
    const out = state.products.filter((product) => totalStock(product) <= 0).length;
    const avgProduction = state.products.length ? state.products.reduce((sum, product) => sum + totalProduction(product), 0) / state.products.length : 0;
    const rows = [
        ['Produção mensal', `${productionEvents().reduce((sum, event) => sum + event.qty, 0)} peças registradas`],
        ['Produtos parados', `${stopped} com estoque acima do mínimo`],
        ['Produtos sem saída', `${soldRanking().filter((item) => item.qty === 0).length} sem vendas lidas`],
        ['Tempo médio de produção', `${formatQty(avgProduction)} peças pendentes por produto`],
        ['Consumo de matéria-prima', `${aggregateMaterials(state.products).length} tipos de material`]
    ];
    $('#reports-list').innerHTML = rows.map(([label, value]) => `<div class="report-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function productionEvents() {
    const events = [];
    state.products.forEach((product) => {
        const history = Array.isArray(product.historicoEstoque) ? product.historicoEstoque : [];
        history.forEach((entry) => {
            const qty = toNumber(entry.quantidade ?? entry.qty, 0);
            if (qty > 0) {
                const date = new Date(entry.data || entry.createdAt || Date.now());
                events.push({ productId: product.id, name: product.nome, qty, key: date.toISOString().slice(0, 10) });
            }
        });
    });
    return events;
}

function soldRanking() {
    const map = new Map(state.products.map((product) => [product.id, { id: product.id, name: product.nome, qty: 0 }]));
    state.orders.forEach((order) => {
        const items = Array.isArray(order.itens) ? order.itens : Array.isArray(order.items) ? order.items : [];
        items.forEach((item) => {
            const id = item.id || item.produtoId || item.productId;
            const row = map.get(id);
            if (row) row.qty += toNumber(item.quantidade ?? item.qty, 1);
        });
    });
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

function lastSevenDays() {
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString('pt-BR', { weekday: 'short' }) };
    });
}

function formatQty(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function openProduct(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const colors = productColors(product);
    const detail = $('#product-detail-content');
    detail.innerHTML = `<div class="detail-grid">
        <div>
            <img src="${escapeHtml(imageFor(product))}" alt="${escapeHtml(product.nome)}">
            <div class="qr-box"><img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(`${location.origin}${location.pathname}?produto=${product.id}`)}" alt="QR Code"><p>Etiqueta QR Code</p></div>
        </div>
        <div>
            <p class="eyebrow">${escapeHtml(productCode(product))} • ${escapeHtml(formatCategory(product.categoria))}</p>
            <h2>${escapeHtml(product.nome)}</h2>
            <p>${escapeHtml(product.descricao || 'Sem descrição cadastrada.')}</p>
            <div class="detail-section"><h3>Estoque</h3><div class="detail-form-grid">
                <label>Estoque atual<input class="detail-input" id="detail-stock" type="number" min="0" value="${totalStock(product)}"></label>
                <label>Produzir<input class="detail-input" id="detail-production" type="number" min="0" value="${totalProduction(product)}"></label>
                <label>Estoque mínimo<input class="detail-input" id="detail-min" type="number" min="0" value="${getMinStock(product)}"></label>
            </div><button type="button" class="primary-button small" data-save-product="${escapeHtml(product.id)}">Salvar estoque</button></div>
            <div class="detail-section"><h3>Cores</h3><div class="inline-editor" id="color-editor">${colorEditorRows(colors)}</div><button type="button" class="secondary-button small" data-add-color>Adicionar cor</button> <button type="button" class="primary-button small" data-save-colors="${escapeHtml(product.id)}">Salvar cores</button></div>
            <div class="detail-section"><h3>Ficha técnica</h3><div class="inline-editor" id="tech-editor">${techEditorRows(product)}</div><button type="button" class="secondary-button small" data-add-tech>Adicionar linha</button> <button type="button" class="primary-button small" data-save-tech="${escapeHtml(product.id)}">Salvar ficha técnica</button></div>
            <div class="detail-section"><h3>Histórico</h3>${historyHtml(product)}</div>
        </div>
    </div>`;
    const dialog = $('#product-dialog');
    if (!dialog.open) dialog.showModal();
}

function colorEditorRows(colors = []) {
    const rows = colors.length ? colors : [{ nome: '', hex: '#000000', quantidade: 0, produzir: 0 }];
    return rows.map((color, index) => `<div class="color-editor-row" data-color-row>
        <input data-color-name type="text" placeholder="Nome da cor" value="${escapeHtml(color?.nome || '')}">
        <input data-color-hex type="color" value="${escapeHtml(color?.hex || '#000000')}">
        <input data-color-stock type="number" min="0" placeholder="Estoque" value="${colorStock(color)}">
        <input data-color-production type="number" min="0" placeholder="Produzir" value="${colorProduce(color)}">
        <button type="button" class="icon-button" data-remove-row aria-label="Excluir cor"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('');
}

function techEditorRows(product) {
    const sheet = Array.isArray(product.fichaTecnica) && product.fichaTecnica.length ? product.fichaTecnica : [];
    const rows = sheet.length ? sheet : [{ tipo: 'tecido', nome: '', numeracaoLinha: '', metragem: 0, unidade: 'm', estoque: 0 }];
    return rows.map((item) => `<div class="tech-editor-row" data-tech-row>
        <select data-tech-type><option value="tecido" ${item.tipo === 'tecido' ? 'selected' : ''}>Tecido</option><option value="linha" ${item.tipo === 'linha' ? 'selected' : ''}>Linha</option><option value="aviamento" ${item.tipo === 'aviamento' ? 'selected' : ''}>Aviamento</option><option value="embalagem" ${item.tipo === 'embalagem' ? 'selected' : ''}>Embalagem</option></select>
        <input data-tech-name type="text" placeholder="Nome do tecido/material" value="${escapeHtml(item.nome || item.item || '')}">
        <input data-tech-line type="text" placeholder="Numeração da linha" value="${escapeHtml(item.numeracaoLinha || item.numeroLinha || '')}">
        <input data-tech-meter type="number" step="0.01" min="0" placeholder="Qtd por peça" value="${toNumber(item.metragem ?? item.qty ?? item.quantidade, 0)}">
        <input data-tech-stock type="number" step="0.01" min="0" placeholder="Metragem atual" value="${toNumber(item.estoque ?? item.disponivel, 0)}">
        <button type="button" class="icon-button" data-remove-row aria-label="Excluir linha"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('');
}

function historyHtml(product) {
    const rows = Array.isArray(product.historicoEstoque) ? product.historicoEstoque.slice(-8).reverse() : [];
    return rows.length ? rows.map((entry) => `<div class="mini-row"><span>${escapeHtml(entry.data || entry.createdAt || 'Sem data')}</span><strong>${escapeHtml(entry.descricao || `${entry.quantidade || 0} un.`)}</strong></div>`).join('') : '<p class="muted">Histórico será registrado conforme as alterações forem salvas.</p>';
}

async function saveProductStock(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const estoque = toNumber($('#detail-stock')?.value, totalStock(product));
    const produzir = toNumber($('#detail-production')?.value, totalProduction(product));
    const minimo = toNumber($('#detail-min')?.value, getMinStock(product));
    await updateProduct(productId, { estoque, produzir, estoqueMinimo: minimo, updatedAt: new Date() }, `Estoque alterado para ${estoque}, produzir ${produzir}, mínimo ${minimo}`);
}

async function saveProductColors(productId) {
    const cores = Array.from(document.querySelectorAll('[data-color-row]')).map((row) => ({
        nome: row.querySelector('[data-color-name]')?.value.trim() || '',
        hex: row.querySelector('[data-color-hex]')?.value || '#000000',
        quantidade: toNumber(row.querySelector('[data-color-stock]')?.value, 0),
        produzir: toNumber(row.querySelector('[data-color-production]')?.value, 0)
    })).filter((color) => color.nome);
    await updateProduct(productId, { cores, updatedAt: new Date() }, 'Cores editadas');
}

async function saveTechSheet(productId) {
    const fichaTecnica = Array.from(document.querySelectorAll('[data-tech-row]')).map((row) => ({
        tipo: row.querySelector('[data-tech-type]')?.value || 'tecido',
        nome: row.querySelector('[data-tech-name]')?.value.trim() || '',
        item: row.querySelector('[data-tech-name]')?.value.trim() || '',
        numeracaoLinha: row.querySelector('[data-tech-line]')?.value.trim() || '',
        metragem: toNumber(row.querySelector('[data-tech-meter]')?.value, 0),
        qty: toNumber(row.querySelector('[data-tech-meter]')?.value, 0),
        unidade: 'm',
        unit: 'm',
        estoque: toNumber(row.querySelector('[data-tech-stock]')?.value, 0),
        disponivel: toNumber(row.querySelector('[data-tech-stock]')?.value, 0)
    })).filter((item) => item.nome);
    await updateProduct(productId, { fichaTecnica, updatedAt: new Date() }, 'Ficha técnica editada');
}

async function updateProduct(productId, payload, description) {
    if (!requireEditorLogin()) return;
    const product = state.products.find((item) => item.id === productId);
    const history = Array.isArray(product?.historicoEstoque) ? product.historicoEstoque.slice(-80) : [];
    history.push({ data: new Date().toLocaleDateString('pt-BR'), descricao: description, createdAt: new Date().toISOString() });
    const finalPayload = { ...payload, historicoEstoque: history };
    try {
        await state.db.collection('pecas').doc(productId).update(finalPayload);
        Object.assign(product, finalPayload);
        hydrateColorBankFromProducts();
        hydrateFilters();
        hydrateMovementControls();
        applyFilters();
        openProduct(productId);
        setSyncStatus('online', 'Salvo');
    } catch (error) {
        queueOfflineChange(productId, finalPayload);
        setSyncStatus('offline', 'Salvo offline');
        alert(`Não consegui gravar no Firestore agora. Salvei uma fila local para sincronizar depois. Erro: ${error.message}`);
    }
}

function queueOfflineChange(productId, payload) {
    const queue = JSON.parse(localStorage.getItem('lamed_stock_offline_queue') || '[]');
    queue.push({ productId, payload, createdAt: new Date().toISOString() });
    localStorage.setItem('lamed_stock_offline_queue', JSON.stringify(queue));
}

async function flushOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem('lamed_stock_offline_queue') || '[]');
    if (!queue.length || !navigator.onLine) return;
    const pending = [];
    for (const item of queue) {
        try { await state.db.collection('pecas').doc(item.productId).update(item.payload); }
        catch { pending.push(item); }
    }
    localStorage.setItem('lamed_stock_offline_queue', JSON.stringify(pending));
}

async function resetAllStockNumbers() {
    if (!requireEditorLogin()) return;
    if (!confirm('Zerar estoque, produzir e estoque mínimo de TODAS as peças de mesa posta?')) return;
    setSyncStatus('online', 'Zerando');
    try {
        const batchLimit = 400;
        let batch = state.db.batch();
        let ops = 0;
        let changed = 0;
        for (const product of state.products) {
            const ref = state.db.collection('pecas').doc(product.id);
            const cores = productColors(product).map((color) => ({ ...color, quantidade: 0, estoque: 0, produzir: 0 }));
            const payload = { estoque: 0, produzir: 0, estoqueMinimo: 0, cores, updatedAt: new Date() };
            batch.update(ref, payload);
            Object.assign(product, payload);
            changed++;
            ops++;
            if (ops >= batchLimit) {
                await batch.commit();
                batch = state.db.batch();
                ops = 0;
            }
        }
        if (ops > 0) await batch.commit();
        hydrateMovementControls();
        applyFilters();
        setSyncStatus('online', 'Zerado');
        alert(`${changed} peça(s) foram zeradas para edição do zero.`);
    } catch (error) {
        console.error('[estoque.reset]', error);
        setSyncStatus('offline', 'Erro ao zerar');
        setAuthFeedback(`Não consegui zerar no Firebase: ${error.message}`, 'error');
    }
}

function exportStockCsv() {
    const headers = ['codigo', 'nome', 'colecao', 'categoria', 'estoque', 'produzir', 'estoque_minimo', 'status', 'cores', 'data_atualizacao'];
    const rows = state.filtered.map((product) => [
        productCode(product), product.nome, getCollectionName(product.colecaoId), formatCategory(product.categoria), totalStock(product), totalProduction(product), getMinStock(product), statusFor(product).label, productColors(product).map((color) => `${color.nome}:${colorStock(color)}`).join(' | '), new Date(timestampMillis(product.updatedAt || product.createdAt)).toLocaleDateString('pt-BR')
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    downloadFile('estoque.csv', `\ufeff${csv}`, 'text/csv;charset=utf-8');
}

function printProduction() {
    const rows = state.products.filter((product) => totalProduction(product) > 0);
    const html = `<section class="print-active print-sheet"><h1>Ordem de Produção</h1><p>${new Date().toLocaleDateString('pt-BR')}</p>${rows.map((product) => `<div class="print-item"><strong>${escapeHtml(product.nome)}</strong><p>${totalProduction(product)} unidade(s)</p><p>Cor: ${escapeHtml(productColors(product).map((color) => color.nome).join(', ') || 'A definir')}</p></div>`).join('')}</section>`;
    const printNode = document.createElement('div');
    printNode.className = 'print-active';
    printNode.innerHTML = html;
    document.body.appendChild(printNode);
    window.print();
    printNode.remove();
}

function printLabels() {
    const html = `<section class="print-active print-sheet"><h1>Etiquetas Laméd</h1>${state.filtered.map((product) => `<div class="print-item"><strong>${escapeHtml(product.nome)}</strong><p>${escapeHtml(productCode(product))} • ${escapeHtml(formatCategory(product.categoria))}</p><img width="96" height="96" src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(`${location.origin}${location.pathname}?produto=${product.id}`)}"></div>`).join('')}</section>`;
    const printNode = document.createElement('div');
    printNode.className = 'print-active';
    printNode.innerHTML = html;
    document.body.appendChild(printNode);
    window.print();
    printNode.remove();
}

function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
}

function bindEvents() {
    $('#category-tabs').addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        state.selectedCategory = button.dataset.category;
        hydrateFilters();
        applyFilters();
    });
    ['#stock-search', '#filter-collection', '#filter-color', '#filter-status', '#sort-products'].forEach((selector) => $(selector).addEventListener('input', applyFilters));
    $$('.view-toggle button').forEach((button) => button.addEventListener('click', () => {
        state.view = button.dataset.view;
        localStorage.setItem('lamed_stock_view', state.view);
        renderProducts();
    }));
    document.body.addEventListener('click', (event) => {
        const card = event.target.closest('[data-product-id]');
        if (card) openProduct(card.dataset.productId);
        const saveProduct = event.target.closest('[data-save-product]');
        if (saveProduct) saveProductStock(saveProduct.dataset.saveProduct);
        const saveColors = event.target.closest('[data-save-colors]');
        if (saveColors) saveProductColors(saveColors.dataset.saveColors);
        const saveTech = event.target.closest('[data-save-tech]');
        if (saveTech) saveTechSheet(saveTech.dataset.saveTech);
        const addColor = event.target.closest('[data-add-color]');
        if (addColor) document.getElementById('color-editor')?.insertAdjacentHTML('beforeend', colorEditorRows([{ nome: '', hex: '#000000', quantidade: 0, produzir: 0 }]));
        const addTech = event.target.closest('[data-add-tech]');
        if (addTech) document.getElementById('tech-editor')?.insertAdjacentHTML('beforeend', techEditorRows({ fichaTecnica: [{ tipo: 'tecido', nome: '', numeracaoLinha: '', metragem: 0, estoque: 0 }] }));
        const removeRow = event.target.closest('[data-remove-row]');
        if (removeRow) removeRow.closest('[data-color-row], [data-tech-row]')?.remove();
    });
    $('#stock-login-form').addEventListener('submit', signInWithEmailPassword);
    $('#stock-google-login').addEventListener('click', signInWithGoogle);
    $('#stock-logout').addEventListener('click', () => state.auth.signOut());
    $('#movement-product').addEventListener('change', hydrateMovementColors);
    $('#apply-movement-btn').addEventListener('click', applyStockMovement);
    $('#create-bank-color').addEventListener('click', createBankColor);
    $('#delete-bank-color').addEventListener('click', deleteSelectedBankColor);
    $('#reset-stock-btn').addEventListener('click', resetAllStockNumbers);
    $('#export-stock-btn').addEventListener('click', exportStockCsv);
    $('#print-production-btn').addEventListener('click', printProduction);
    $('#print-labels-btn').addEventListener('click', printLabels);
    window.addEventListener('online', () => { setSyncStatus('online', 'Online'); flushOfflineQueue(); });
    window.addEventListener('offline', () => setSyncStatus('offline', 'Offline'));
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        state.deferredPrompt = event;
        $('#install-pwa-btn').classList.remove('hidden');
    });
    $('#install-pwa-btn').addEventListener('click', async () => {
        if (!state.deferredPrompt) return;
        state.deferredPrompt.prompt();
        state.deferredPrompt = null;
        $('#install-pwa-btn').classList.add('hidden');
    });
}

function init() {
    if (!window.firebase?.apps?.length) firebase.initializeApp(firebaseConfig);
    else firebase.app();
    state.db = firebase.firestore();
    state.auth = firebase.auth();
    state.auth.onAuthStateChanged((user) => {
        state.user = user;
        updateAuthUi(user);
        if (user) setAuthFeedback(`Logado como ${user.email || user.uid}.`, 'success');
    });
    updateAuthUi(null);
    bindEvents();
    loadData().then(() => {
        flushOfflineQueue();
        const target = new URLSearchParams(location.search).get('produto');
        if (target) openProduct(target);
    }).catch((error) => {
        setSyncStatus('offline', 'Erro ao carregar');
        console.error('[estoque-mesaposta]', error);
        $('#products-grid').innerHTML = `<p class="muted">Não consegui carregar os dados. Confira as regras de leitura do Firestore ou a conexão. ${escapeHtml(error.message)}</p>`;
    });
}

window.addEventListener('DOMContentLoaded', init);
