(function initExecutorOperations() {
    'use strict';

    const FIREBASE_CONFIG = {
        apiKey: 'AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U',
        authDomain: 'site-lamed.firebaseapp.com',
        databaseURL: 'https://site-lamed-default-rtdb.firebaseio.com',
        projectId: 'site-lamed',
        storageBucket: 'site-lamed.firebasestorage.app',
        messagingSenderId: '862756160215',
        appId: '1:862756160215:web:d0fded233682bf93eaa692',
        measurementId: 'G-BL1G961PGT'
    };
    const ADMIN_UIDS = new Set(['NoGsCqiKc0VJwWb6rppk7QVLV1B2']);
    const MAX_BATCH_SIZE = 380;

    const state = {
        products: [],
        collections: [],
        selectedIds: new Set(),
        loading: false,
        operationInFlight: false,
        filters: {
            search: '',
            status: 'all',
            collection: 'all',
            category: 'all',
            selectedOnly: false
        }
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function sanitizeText(value, maxLength = 180) {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
    }

    function escapeHtml(value, maxLength = 180) {
        return sanitizeText(value, maxLength)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeHex(value) {
        const raw = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : '#000000';
    }

    function normalizePercent(value, max = 90) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        if (number < 0 || number > max) return null;
        return Math.round(number * 100) / 100;
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function getProductImage(product) {
        if (sanitizeText(product?.imagem, 2000)) return sanitizeText(product.imagem, 2000);
        if (Array.isArray(product?.imagens) && product.imagens.length) return sanitizeText(product.imagens[0], 2000);
        return '';
    }

    function getDiscountedPrice(product) {
        const price = Number(product?.preco || 0);
        const discount = Number(product?.desconto || 0);
        return Math.round((price * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
    }

    function getCollectionName(id) {
        if (!id) return 'Sem coleção';
        return state.collections.find((item) => item.id === id)?.nome || 'Coleção';
    }

    function writeLog(message, type = 'info') {
        const box = $('#console-output');
        if (!box) return;

        const row = document.createElement('div');
        row.className = `log-entry log-${type}`;
        const time = new Date().toLocaleTimeString('pt-BR');
        const content = typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message);
        row.innerHTML = `<span class="log-time">[${escapeHtml(time, 20)}]</span> ${escapeHtml(content, 800)}`;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
    }

    window.log = writeLog;
    window.limparConsole = () => {
        const box = $('#console-output');
        if (!box) return;
        box.innerHTML = '<div class="console-placeholder">// Console limpo</div>';
    };

    function getFirebase() {
        if (!window.firebase?.initializeApp || !window.firebase?.firestore || !window.firebase?.auth) {
            throw new Error('Firebase não foi carregado nesta página.');
        }

        const app = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(FIREBASE_CONFIG);
        return {
            app,
            auth: window.firebase.auth(app),
            db: window.firebase.firestore(app)
        };
    }

    const firebaseServices = getFirebase();
    const auth = firebaseServices.auth;
    const db = firebaseServices.db;

    async function waitForUser(timeoutMs = 12000) {
        if (auth.currentUser) return auth.currentUser;
        return new Promise((resolve, reject) => {
            let done = false;
            const timer = window.setTimeout(() => {
                if (done) return;
                done = true;
                unsubscribe();
                reject(new Error('Sessão administrativa não ficou disponível a tempo.')); 
            }, timeoutMs);
            const unsubscribe = auth.onAuthStateChanged((user) => {
                if (done || !user) return;
                done = true;
                window.clearTimeout(timer);
                unsubscribe();
                resolve(user);
            });
        });
    }

    async function ensureAdmin() {
        const user = await waitForUser();
        if (ADMIN_UIDS.has(user.uid)) return user;
        const token = await user.getIdTokenResult(true);
        if (token?.claims?.admin === true) return user;
        throw new Error('Sua conta não possui permissão administrativa para esta operação.');
    }

    async function bestEffortAudit(action, details = {}) {
        try {
            const user = auth.currentUser;
            await db.collection('operacoes_logs').add({
                action: sanitizeText(action, 120),
                details,
                admin: user?.email || user?.uid || 'admin',
                createdAt: new Date()
            });
        } catch (error) {
            console.warn('[executor.audit]', error);
        }
    }

    function setBusy(busy, label = '') {
        state.operationInFlight = busy;
        document.body.classList.toggle('executor-busy', busy);
        const target = $('#operation-busy-label');
        if (target) target.textContent = busy ? (label || 'Executando operação…') : 'Pronto';
        $$('[data-operation-button]').forEach((button) => {
            button.disabled = busy;
        });
    }

    async function runBusy(label, task) {
        if (state.operationInFlight) {
            writeLog('Já existe uma operação em andamento. Aguarde a conclusão.', 'warning');
            return null;
        }
        setBusy(true, label);
        try {
            return await task();
        } catch (error) {
            writeLog(`Erro: ${error?.message || error}`, 'error');
            console.error(error);
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function commitOperations(operations, progressLabel = 'alterações') {
        if (!operations.length) return 0;
        let committed = 0;
        for (let offset = 0; offset < operations.length; offset += MAX_BATCH_SIZE) {
            const chunk = operations.slice(offset, offset + MAX_BATCH_SIZE);
            const batch = db.batch();
            chunk.forEach((operation) => {
                if (operation.type === 'set') batch.set(operation.ref, operation.data, operation.options || {});
                else if (operation.type === 'delete') batch.delete(operation.ref);
                else batch.update(operation.ref, operation.data);
            });
            await batch.commit();
            committed += chunk.length;
            if (operations.length > MAX_BATCH_SIZE) {
                writeLog(`${progressLabel}: ${committed}/${operations.length} gravações confirmadas.`, 'info');
            }
        }
        return committed;
    }

    function normalizeProductDoc(doc) {
        const data = doc.data() || {};
        return {
            id: doc.id,
            ...data,
            preco: Number(data.preco || 0),
            desconto: Number(data.desconto || 0),
            cores: Array.isArray(data.cores) ? data.cores : []
        };
    }

    async function loadData({ silent = false } = {}) {
        if (state.loading) return;
        state.loading = true;
        const refreshButton = $('#refresh-operations-data');
        if (refreshButton) refreshButton.classList.add('is-spinning');
        try {
            await ensureAdmin();
            const [productsSnap, collectionsSnap] = await Promise.all([
                db.collection('pecas').get({ source: 'server' }).catch(() => db.collection('pecas').get()),
                db.collection('colecoes').get({ source: 'server' }).catch(() => db.collection('colecoes').get())
            ]);

            state.products = productsSnap.docs
                .map(normalizeProductDoc)
                .sort((a, b) => sanitizeText(a.nome || a.id).localeCompare(sanitizeText(b.nome || b.id), 'pt-BR'));
            state.collections = collectionsSnap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

            const validIds = new Set(state.products.map((item) => item.id));
            state.selectedIds = new Set([...state.selectedIds].filter((id) => validIds.has(id)));

            renderAll();
            if (!silent) writeLog(`${state.products.length} produto(s) e ${state.collections.length} coleção(ões) carregados.`, 'success');
        } finally {
            state.loading = false;
            refreshButton?.classList.remove('is-spinning');
        }
    }

    function getFilteredProducts() {
        const term = state.filters.search.toLocaleLowerCase('pt-BR');
        return state.products.filter((product) => {
            if (state.filters.selectedOnly && !state.selectedIds.has(product.id)) return false;
            if (state.filters.status !== 'all' && sanitizeText(product.status || 'inactive') !== state.filters.status) return false;
            if (state.filters.collection !== 'all' && String(product.colecaoId || '') !== state.filters.collection) return false;
            if (state.filters.category !== 'all' && sanitizeText(product.categoria || '') !== state.filters.category) return false;
            if (!term) return true;
            const haystack = [
                product.nome,
                product.id,
                product.categoria,
                product.segmento,
                product.status,
                getCollectionName(product.colecaoId),
                ...(Array.isArray(product.tags) ? product.tags : [product.tags]),
                ...product.cores.map((color) => color?.nome)
            ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
            return haystack.includes(term);
        });
    }

    function renderStats() {
        const total = state.products.length;
        const active = state.products.filter((item) => item.status === 'active').length;
        const discounted = state.products.filter((item) => Number(item.desconto || 0) > 0).length;
        const activeCollections = state.collections.filter((item) => item.ativa !== false).length;
        const map = {
            'stat-products': total,
            'stat-active': active,
            'stat-discounted': discounted,
            'stat-collections': activeCollections
        };
        Object.entries(map).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(value);
        });
    }

    function fillSelect(select, options, value) {
        if (!select) return;
        select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value, 120)}">${escapeHtml(option.label, 140)}</option>`).join('');
        if (options.some((option) => option.value === value)) select.value = value;
    }

    function renderFilters() {
        const collectionOptions = [
            { value: 'all', label: 'Todas as coleções' },
            { value: '', label: 'Sem coleção' },
            ...state.collections.map((item) => ({ value: item.id, label: item.nome || item.id }))
        ];
        fillSelect($('#filter-collection'), collectionOptions, state.filters.collection);

        const categories = [...new Set(state.products.map((item) => sanitizeText(item.categoria || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        fillSelect($('#filter-category'), [{ value: 'all', label: 'Todas as categorias' }, ...categories.map((item) => ({ value: item, label: item }))], state.filters.category);
        fillSelect($('#bulk-category-target'), [{ value: '', label: 'Escolha uma categoria' }, ...categories.map((item) => ({ value: item, label: item }))], $('#bulk-category-target')?.value || '');

        const targetOptions = [{ value: '', label: 'Sem coleção' }, ...state.collections.map((item) => ({ value: item.id, label: `${item.nome || item.id}${item.ativa === false ? ' • oculta' : ''}` }))];
        fillSelect($('#bulk-collection-target'), targetOptions, $('#bulk-collection-target')?.value || '');
        fillSelect($('#launch-collection-target'), state.collections.map((item) => ({ value: item.id, label: `${item.nome || item.id}${item.ativa === false ? ' • oculta' : ''}` })), $('#launch-collection-target')?.value || state.collections[0]?.id || '');
    }

    function renderSelectedSummary() {
        const selected = state.products.filter((item) => state.selectedIds.has(item.id));
        const count = selected.length;
        const el = $('#selected-products-count');
        if (el) el.textContent = `${count} selecionada${count === 1 ? '' : 's'}`;
        const value = $('#selected-products-value');
        if (value) value.textContent = formatMoney(selected.reduce((sum, item) => sum + getDiscountedPrice(item), 0));

        const hiddenSelect = $('#bulk-product-select');
        if (hiddenSelect) {
            hiddenSelect.innerHTML = state.products.map((product) => `<option value="${escapeHtml(product.id, 120)}"${state.selectedIds.has(product.id) ? ' selected' : ''}>${escapeHtml(product.nome || product.id, 120)}</option>`).join('');
        }
    }

    function renderProducts() {
        const container = $('#product-operation-list');
        if (!container) return;
        const products = getFilteredProducts();
        const count = $('#filtered-products-count');
        if (count) count.textContent = `${products.length} resultado${products.length === 1 ? '' : 's'}`;

        if (!products.length) {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i><strong>Nenhuma peça encontrada</strong><span>Ajuste os filtros para continuar.</span></div>';
            return;
        }

        container.innerHTML = products.map((product) => {
            const selected = state.selectedIds.has(product.id);
            const image = getProductImage(product);
            const colors = product.cores.slice(0, 4);
            const discount = Number(product.desconto || 0);
            const status = product.status === 'active' ? 'Ativa' : 'Pausada';
            return `
                <label class="product-operation-row${selected ? ' is-selected' : ''}" data-product-id="${escapeHtml(product.id, 120)}">
                    <input type="checkbox" data-product-check value="${escapeHtml(product.id, 120)}"${selected ? ' checked' : ''}>
                    <span class="product-thumb">${image ? `<img src="${escapeHtml(image, 2000)}" alt="">` : '<i class="fa-regular fa-image"></i>'}</span>
                    <span class="product-main">
                        <span class="product-title">${escapeHtml(product.nome || product.id, 140)}</span>
                        <span class="product-meta">${escapeHtml(product.categoria || 'sem categoria', 60)} · ${escapeHtml(getCollectionName(product.colecaoId), 100)}</span>
                        <span class="product-tags">
                            <span class="status-chip ${product.status === 'active' ? 'is-active' : 'is-inactive'}">${status}</span>
                            ${discount > 0 ? `<span class="discount-chip">-${discount}%</span>` : ''}
                            ${colors.map((color) => `<span class="mini-color" title="${escapeHtml(color?.nome || 'Cor', 60)}" style="--swatch:${normalizeHex(color?.hex)}"></span>`).join('')}
                        </span>
                    </span>
                    <span class="product-price">
                        <strong>${formatMoney(getDiscountedPrice(product))}</strong>
                        ${discount > 0 ? `<small>${formatMoney(product.preco)}</small>` : ''}
                    </span>
                </label>
            `;
        }).join('');
    }

    function renderLaunchSummary() {
        const select = $('#launch-collection-target');
        const box = $('#launch-collection-summary');
        if (!select || !box) return;
        const collection = state.collections.find((item) => item.id === select.value);
        if (!collection) {
            box.innerHTML = '<span>Escolha uma coleção para ver o resumo.</span>';
            return;
        }
        const products = state.products.filter((item) => item.colecaoId === collection.id);
        const active = products.filter((item) => item.status === 'active').length;
        box.innerHTML = `<strong>${escapeHtml(collection.nome || collection.id, 120)}</strong><span>${products.length} peça(s) vinculada(s) · ${active} ativa(s) · coleção ${collection.ativa === false ? 'oculta' : 'visível'}</span>`;
    }

    function renderAll() {
        renderStats();
        renderFilters();
        renderSelectedSummary();
        renderProducts();
        renderLaunchSummary();
    }

    function setSelection(ids, selected) {
        ids.forEach((id) => {
            if (selected) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
        });
        renderSelectedSummary();
        renderProducts();
    }

    async function updateSelected(label, buildData, auditAction) {
        const ids = [...state.selectedIds];
        if (!ids.length) {
            writeLog('Selecione ao menos uma peça antes de executar esta ação.', 'warning');
            return;
        }
        return runBusy(label, async () => {
            await ensureAdmin();
            const operations = [];
            ids.forEach((id) => {
                const product = state.products.find((item) => item.id === id);
                if (!product) return;
                const data = buildData(product);
                if (!data || !Object.keys(data).length) return;
                operations.push({ ref: db.collection('pecas').doc(id), data: { ...data, updatedAt: new Date() } });
            });
            await commitOperations(operations, label);
            await bestEffortAudit(auditAction, { ids, total: operations.length });
            writeLog(`${operations.length} peça(s) atualizada(s): ${label}.`, 'success');
            await loadData({ silent: true });
        });
    }

    async function addColorToSelected() {
        const name = sanitizeText($('#bulk-color-name')?.value, 60);
        const hex = normalizeHex($('#bulk-color-hex-text')?.value || $('#bulk-color-hex')?.value);
        if (!name) return writeLog('Informe o nome da cor.', 'warning');
        await updateSelected(`Adicionando cor ${name}`, (product) => {
            const current = Array.isArray(product.cores) ? product.cores : [];
            if (current.some((color) => sanitizeText(color?.nome, 60).toLowerCase() === name.toLowerCase())) return {};
            return { cores: [...current, { nome: name, hex }] };
        }, 'adicionar_cor_selecionados');
    }

    async function removeColorFromSelected() {
        const name = sanitizeText($('#bulk-color-remove-name')?.value, 60);
        if (!name) return writeLog('Informe o nome da cor que deve ser removida.', 'warning');
        await updateSelected(`Removendo cor ${name}`, (product) => {
            const current = Array.isArray(product.cores) ? product.cores : [];
            const next = current.filter((color) => sanitizeText(color?.nome, 60).toLowerCase() !== name.toLowerCase());
            return next.length === current.length ? {} : { cores: next };
        }, 'remover_cor_selecionados');
    }

    async function applySelectedDiscount() {
        const percent = normalizePercent($('#selected-discount-percent')?.value);
        if (percent === null) return writeLog('Informe um desconto entre 0 e 90%.', 'warning');
        await updateSelected(`Aplicando ${percent}% de desconto`, () => ({ desconto: percent }), 'desconto_selecionados');
    }

    async function assignSelectedCollection() {
        const collectionId = $('#bulk-collection-target')?.value || null;
        await updateSelected(collectionId ? `Vinculando à coleção ${getCollectionName(collectionId)}` : 'Removendo vínculo de coleção', () => ({ colecaoId: collectionId }), 'colecao_selecionados');
    }

    async function applySelectedCategory() {
        const category = sanitizeText($('#bulk-category-target')?.value, 80);
        if (!category) return writeLog('Escolha uma categoria.', 'warning');
        await updateSelected(`Alterando categoria para ${category}`, () => ({ categoria: category }), 'categoria_selecionados');
    }

    async function applySelectedSegment() {
        const segment = $('#bulk-segment-target')?.value;
        if (!['mesa', 'moda'].includes(segment)) return writeLog('Escolha uma vitrine válida.', 'warning');
        await updateSelected(`Movendo para a vitrine ${segment === 'mesa' ? 'Mesa posta' : 'Roupas'}`, () => ({ segmento: segment }), 'segmento_selecionados');
    }

    async function setSelectedStatus(status) {
        const label = status === 'active' ? 'Publicando peças' : 'Pausando peças';
        await updateSelected(label, () => ({ status }), status === 'active' ? 'publicar_selecionados' : 'pausar_selecionados');
    }

    function armButton(button, confirmationText, task) {
        if (!button) return;
        const now = Date.now();
        const armedAt = Number(button.dataset.armedAt || 0);
        if (!armedAt || now - armedAt > 12000) {
            button.dataset.armedAt = String(now);
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(confirmationText, 80)}`;
            button.classList.add('is-armed');
            writeLog(`Confirme tocando novamente em “${confirmationText}”.`, 'warning');
            window.setTimeout(() => {
                if (button.dataset.armedAt !== String(now)) return;
                button.innerHTML = button.dataset.originalText || 'Executar';
                delete button.dataset.armedAt;
                delete button.dataset.originalText;
                button.classList.remove('is-armed');
            }, 12000);
            return;
        }
        button.innerHTML = button.dataset.originalText || button.innerHTML;
        delete button.dataset.armedAt;
        delete button.dataset.originalText;
        button.classList.remove('is-armed');
        task();
    }

    async function publishCollectionWithProducts() {
        const collectionId = $('#launch-collection-target')?.value;
        const collection = state.collections.find((item) => item.id === collectionId);
        if (!collection) return writeLog('Escolha uma coleção para publicar.', 'warning');

        return runBusy(`Publicando ${collection.nome || collection.id}`, async () => {
            await ensureAdmin();
            const productIds = state.products.filter((item) => item.colecaoId === collectionId).map((item) => item.id);
            const operations = [
                { ref: db.collection('colecoes').doc(collectionId), data: { ativa: true, updatedAt: new Date() } },
                ...productIds.map((id) => ({ ref: db.collection('pecas').doc(id), data: { status: 'active', updatedAt: new Date() } }))
            ];
            await commitOperations(operations, 'Publicação da coleção');
            await bestEffortAudit('publicar_colecao_com_produtos', { collectionId, products: productIds.length });
            writeLog(`Coleção ${collection.nome || collection.id} publicada com ${productIds.length} peça(s) ativas.`, 'success');
            await loadData({ silent: true });
        });
    }

    async function hideCollection() {
        const collectionId = $('#launch-collection-target')?.value;
        const collection = state.collections.find((item) => item.id === collectionId);
        if (!collection) return writeLog('Escolha uma coleção para ocultar.', 'warning');
        return runBusy(`Ocultando ${collection.nome || collection.id}`, async () => {
            await ensureAdmin();
            await db.collection('colecoes').doc(collectionId).update({ ativa: false, updatedAt: new Date() });
            await bestEffortAudit('ocultar_colecao', { collectionId });
            writeLog(`Coleção ${collection.nome || collection.id} ocultada. As peças não foram desativadas.`, 'success');
            await loadData({ silent: true });
        });
    }

    async function assignSelectionToLaunchCollection() {
        const target = $('#launch-collection-target')?.value;
        if (!target) return writeLog('Escolha uma coleção.', 'warning');
        const bulkTarget = $('#bulk-collection-target');
        if (bulkTarget) bulkTarget.value = target;
        await assignSelectedCollection();
    }

    async function applyGlobalDiscount() {
        const percent = normalizePercent($('#bulk-discount-percent')?.value);
        if (percent === null) return writeLog('Informe um desconto entre 0 e 90%.', 'warning');
        return runBusy(`Aplicando ${percent}% no catálogo`, async () => {
            await ensureAdmin();
            writeLog('Etapa 1/3: carregando catálogo diretamente do servidor…', 'info');
            const snap = await db.collection('pecas').get({ source: 'server' }).catch(() => db.collection('pecas').get());
            writeLog(`Etapa 2/3: enviando ${snap.size} alteração(ões)…`, 'info');
            const operations = snap.docs.map((doc) => ({
                ref: doc.ref,
                data: { desconto: percent, updatedAt: new Date() }
            }));
            await commitOperations(operations, 'Desconto global');
            writeLog('Etapa 3/3: verificando valores gravados…', 'info');
            const verify = await db.collection('pecas').get({ source: 'server' }).catch(() => db.collection('pecas').get());
            const confirmed = verify.docs.filter((doc) => Number(doc.data()?.desconto || 0) === percent).length;
            await bestEffortAudit('aplicar_desconto_global', { percent, total: operations.length, confirmed });
            if (confirmed !== operations.length) {
                throw new Error(`Firestore confirmou ${confirmed}/${operations.length} peças com ${percent}%.`);
            }
            writeLog(`Desconto de ${percent}% confirmado em ${confirmed} peça(s).`, 'success');
            await loadData({ silent: true });
        });
    }

    async function removeAllDiscounts() {
        return runBusy('Removendo descontos do catálogo', async () => {
            await ensureAdmin();
            const snap = await db.collection('pecas').get({ source: 'server' }).catch(() => db.collection('pecas').get());
            const operations = snap.docs
                .filter((doc) => Number(doc.data()?.desconto || 0) > 0)
                .map((doc) => ({ ref: doc.ref, data: { desconto: 0, updatedAt: new Date() } }));
            await commitOperations(operations, 'Remoção de descontos');
            await bestEffortAudit('remover_descontos_produtos', { total: operations.length });
            writeLog(`${operations.length} peça(s) ficaram sem desconto promocional.`, 'success');
            await loadData({ silent: true });
        });
    }

    async function fixInvalidPrices() {
        return runBusy('Verificando preços', async () => {
            await ensureAdmin();
            const operations = state.products
                .filter((product) => !Number.isFinite(Number(product.preco)) || Number(product.preco) < 0)
                .map((product) => ({ ref: db.collection('pecas').doc(product.id), data: { preco: 0, updatedAt: new Date() } }));
            await commitOperations(operations, 'Correção de preços');
            await bestEffortAudit('corrigir_precos_invalidos', { total: operations.length });
            writeLog(operations.length ? `${operations.length} preço(s) inválido(s) corrigido(s).` : 'Nenhum preço inválido foi encontrado.', 'success');
            await loadData({ silent: true });
        });
    }

    function downloadJson(filename, payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    async function backupComplete() {
        return runBusy('Gerando backup', async () => {
            await ensureAdmin();
            const collections = ['pecas', 'colecoes', 'pedidos', 'usuarios', 'site_config', 'operacoes_logs', 'historico_precos'];
            const payload = { generatedAt: new Date().toISOString(), collections: {} };
            for (const name of collections) {
                const snap = await db.collection(name).get().catch(() => null);
                if (!snap) continue;
                payload.collections[name] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                writeLog(`Backup: ${name} (${snap.size} docs).`, 'info');
            }
            downloadJson(`backup_lamed_${new Date().toISOString().slice(0, 10)}.json`, payload);
            await bestEffortAudit('backup_completo', { collections: Object.keys(payload.collections) });
            writeLog('Backup completo gerado.', 'success');
        });
    }

    function renderResults(rows, emptyMessage) {
        const target = $('#operation-results');
        if (!target) return;
        if (!rows.length) {
            target.innerHTML = `<div class="empty-results">${escapeHtml(emptyMessage || 'Nenhum resultado.', 180)}</div>`;
            return;
        }
        target.innerHTML = rows.map((row) => `
            <div class="result-row">
                <strong>${escapeHtml(row.title, 140)}</strong>
                <span>${escapeHtml(row.description, 300)}</span>
            </div>
        `).join('');
    }

    async function detectDuplicates() {
        const map = new Map();
        state.products.forEach((product) => {
            const key = sanitizeText(product.nome, 160).toLocaleLowerCase('pt-BR');
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(product);
        });
        const groups = [...map.values()].filter((items) => items.length > 1);
        const rows = groups.flatMap((items) => items.map((item) => ({
            title: item.nome || item.id,
            description: `Possível duplicado · ${item.categoria || 'sem categoria'} · ID ${item.id}`
        })));
        renderResults(rows, 'Nenhum possível duplicado por nome foi encontrado.');
        writeLog(`${groups.length} grupo(s) de possível duplicidade encontrado(s).`, groups.length ? 'warning' : 'success');
    }

    async function showRecentCollection(collectionName, mapper, emptyMessage) {
        return runBusy(`Carregando ${collectionName}`, async () => {
            await ensureAdmin();
            let snap;
            try {
                snap = await db.collection(collectionName).orderBy('createdAt', 'desc').limit(40).get();
            } catch (error) {
                snap = await db.collection(collectionName).get();
            }
            const docs = snap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0))
                .slice(0, 40);
            renderResults(docs.map(mapper), emptyMessage);
            writeLog(`${docs.length} registro(s) exibido(s).`, 'success');
        });
    }

    window.runScript = async function runScript(scriptName) {
        switch (scriptName) {
            case 'aplicarDescontoGlobal': return applyGlobalDiscount();
            case 'removerDescontosProdutos': return removeAllDiscounts();
            case 'syncContadores': return loadData();
            case 'corrigirPrecos': return fixInvalidPrices();
            case 'backupCompleto':
            case 'backupDados': return backupComplete();
            case 'detectarDuplicados': return detectDuplicates();
            case 'logsAlteracoes':
                return showRecentCollection('operacoes_logs', (entry) => ({
                    title: entry.action || entry.id,
                    description: `${entry.admin || 'admin'} · ${entry.createdAt?.seconds ? new Date(entry.createdAt.seconds * 1000).toLocaleString('pt-BR') : 'sem data'}`
                }), 'Nenhum log de operação encontrado.');
            case 'historicoPrecos':
                return showRecentCollection('historico_precos', (entry) => ({
                    title: entry.produtoNome || entry.produtoId || entry.id,
                    description: `Preço ${entry.precoAnterior ?? '-'} → ${entry.precoNovo ?? '-'} · desconto ${entry.descontoAnterior ?? 0}% → ${entry.descontoNovo ?? 0}%`
                }), 'Nenhum histórico de preço encontrado.');
            default:
                writeLog(`Rotina “${scriptName}” não reconhecida.`, 'error');
                return null;
        }
    };

    function bindEvents() {
        $('#refresh-operations-data')?.addEventListener('click', () => loadData());
        $('#product-search')?.addEventListener('input', (event) => {
            state.filters.search = sanitizeText(event.target.value, 120);
            renderProducts();
        });
        $('#filter-status')?.addEventListener('change', (event) => {
            state.filters.status = event.target.value;
            renderProducts();
        });
        $('#filter-collection')?.addEventListener('change', (event) => {
            state.filters.collection = event.target.value;
            renderProducts();
        });
        $('#filter-category')?.addEventListener('change', (event) => {
            state.filters.category = event.target.value;
            renderProducts();
        });
        $('#filter-selected-only')?.addEventListener('change', (event) => {
            state.filters.selectedOnly = event.target.checked;
            renderProducts();
        });
        $('#product-operation-list')?.addEventListener('change', (event) => {
            const checkbox = event.target.closest('[data-product-check]');
            if (!checkbox) return;
            setSelection([checkbox.value], checkbox.checked);
        });
        $('#select-filtered-products')?.addEventListener('click', () => setSelection(getFilteredProducts().map((item) => item.id), true));
        $('#clear-product-selection')?.addEventListener('click', () => {
            state.selectedIds.clear();
            renderSelectedSummary();
            renderProducts();
        });
        $('#publish-selected')?.addEventListener('click', () => setSelectedStatus('active'));
        $('#pause-selected')?.addEventListener('click', () => setSelectedStatus('inactive'));
        $('#apply-selected-discount')?.addEventListener('click', applySelectedDiscount);
        $('#assign-selected-collection')?.addEventListener('click', assignSelectedCollection);
        $('#apply-selected-category')?.addEventListener('click', applySelectedCategory);
        $('#apply-selected-segment')?.addEventListener('click', applySelectedSegment);
        $('#add-color-selected')?.addEventListener('click', addColorToSelected);
        $('#remove-color-selected')?.addEventListener('click', removeColorFromSelected);
        $('#bulk-color-hex')?.addEventListener('input', (event) => {
            const text = $('#bulk-color-hex-text');
            if (text) text.value = event.target.value.toUpperCase();
            const preview = $('#color-preview');
            if (preview) preview.style.setProperty('--swatch', event.target.value);
        });
        $('#bulk-color-hex-text')?.addEventListener('input', (event) => {
            const hex = normalizeHex(event.target.value);
            const picker = $('#bulk-color-hex');
            if (/^#[0-9a-f]{6}$/i.test(event.target.value) && picker) picker.value = hex;
            const preview = $('#color-preview');
            if (preview) preview.style.setProperty('--swatch', hex);
        });
        $('#launch-collection-target')?.addEventListener('change', renderLaunchSummary);
        $('#assign-selection-launch')?.addEventListener('click', assignSelectionToLaunchCollection);
        $('#publish-launch-collection')?.addEventListener('click', (event) => armButton(event.currentTarget, 'Confirmar publicação', publishCollectionWithProducts));
        $('#hide-launch-collection')?.addEventListener('click', (event) => armButton(event.currentTarget, 'Confirmar ocultação', hideCollection));
        $('#remove-all-discounts')?.addEventListener('click', (event) => armButton(event.currentTarget, 'Confirmar remoção', removeAllDiscounts));
        $('#open-results-panel')?.addEventListener('click', () => $('#operation-results-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }

    function initialize() {
        bindEvents();
        auth.onAuthStateChanged(async (user) => {
            if (!user) return;
            try {
                await ensureAdmin();
                writeLog('Autenticado como Admin. Central de Operações pronta.', 'success');
                await loadData({ silent: true });
            } catch (error) {
                writeLog(error.message, 'error');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
