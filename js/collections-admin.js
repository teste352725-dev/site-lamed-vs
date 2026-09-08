(() => {
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

    const ADMIN_UIDS = ["NoGsCqiKc0VJwWb6rppk7QVLV1B2"];
    const CATALOG_SETTINGS_DOC_ID = '__catalog_settings';
    const VALID_STATUSES = new Set(['draft', 'active', 'ended']);
    const state = {
        collections: [],
        products: [],
        editingId: null,
        endingId: null,
        pendingDeleteId: null,
        pendingDeleteTimer: null
    };

    let app;
    try {
        app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    } catch (error) {
        app = firebase.app();
    }
    const auth = firebase.auth(app);
    const db = firebase.firestore(app);

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));

    function sanitize(value, max = 220) {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    }

    function escapeHtml(value) {
        return sanitize(value, 500)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function slugify(value) {
        return sanitize(value, 120)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 100);
    }

    function normalizeStatus(collection) {
        const raw = sanitize(collection?.status, 20).toLowerCase();
        if (VALID_STATUSES.has(raw)) return raw;
        return collection?.ativa === true ? 'active' : 'draft';
    }

    function normalizeSegments(collection) {
        const segments = Array.isArray(collection?.segmentos)
            ? collection.segmentos.filter((segment) => segment === 'moda' || segment === 'mesa')
            : [];
        if (segments.length) return [...new Set(segments)];
        if (collection?.segmento === 'moda' || collection?.segmento === 'mesa') return [collection.segmento];
        return ['moda', 'mesa'];
    }

    function productSegment(product) {
        if (product?.segmento === 'mesa') return 'mesa';
        if (product?.segmento === 'moda') return 'moda';
        const category = String(product?.categoria || '').toLowerCase();
        return ['mesa_posta', 'lugar_americano', 'guardanapo', 'anel_guardanapo', 'trilho_velas', 'caminho_mesa', 'capa_de_matza'].includes(category) ? 'mesa' : 'moda';
    }

    function productImage(product) {
        if (Array.isArray(product?.imagens) && product.imagens[0]) return product.imagens[0];
        return product?.imagem || product?.imagemPrincipal || '';
    }

    function toDate(value) {
        if (!value) return null;
        if (typeof value.toDate === 'function') return value.toDate();
        if (value?.seconds) return new Date(value.seconds * 1000);
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function toDateInput(value) {
        const date = toDate(value);
        if (!date) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function toTimestamp(value) {
        if (!value) return null;
        const date = new Date(`${value}T12:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return firebase.firestore.Timestamp.fromDate(date);
    }

    function formatDate(value) {
        const date = toDate(value);
        return date ? date.toLocaleDateString('pt-BR') : 'Sem data';
    }

    function statusLabel(status) {
        return status === 'active' ? 'Ativa' : status === 'ended' ? 'Encerrada' : 'Rascunho';
    }

    function showToast(message, type = 'info') {
        const toast = $('#collections-toast');
        if (!toast) return;
        toast.textContent = sanitize(message, 260);
        toast.className = `toast is-visible${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => { toast.className = 'toast'; }, 3200);
    }

    async function isAuthorizedAdmin(user) {
        if (!user) return false;
        if (ADMIN_UIDS.includes(user.uid)) return true;
        try {
            const token = await user.getIdTokenResult();
            return token?.claims?.admin === true;
        } catch (error) {
            return false;
        }
    }

    function collectionProducts(collectionId) {
        return state.products.filter((product) => product.colecaoId === collectionId);
    }

    function getCollection(collectionId) {
        return state.collections.find((collection) => collection.id === collectionId) || null;
    }

    function renderMetrics() {
        const normalized = state.collections.map((collection) => ({ ...collection, normalizedStatus: normalizeStatus(collection), normalizedSegments: normalizeSegments(collection) }));
        $('#metric-total').textContent = normalized.length;
        $('#metric-active').textContent = normalized.filter((item) => item.normalizedStatus === 'active').length;
        $('#metric-moda').textContent = normalized.filter((item) => item.normalizedSegments.includes('moda')).length;
        $('#metric-mesa').textContent = normalized.filter((item) => item.normalizedSegments.includes('mesa')).length;
        $('#metric-ended').textContent = normalized.filter((item) => item.normalizedStatus === 'ended').length;
    }

    function filteredCollections() {
        const term = sanitize($('#collection-search')?.value, 120).toLowerCase();
        const status = $('#collection-status-filter')?.value || 'all';
        const segment = $('#collection-segment-filter')?.value || 'all';
        const sort = $('#collection-sort')?.value || 'priority';

        const rows = state.collections.filter((collection) => {
            const normalizedStatus = normalizeStatus(collection);
            const segments = normalizeSegments(collection);
            const haystack = [collection.nome, collection.slug, collection.descricao, collection.chamadaHome].join(' ').toLowerCase();
            const matchesTerm = !term || haystack.includes(term);
            const matchesStatus = status === 'all' || normalizedStatus === status;
            const matchesSegment = segment === 'all' || segments.includes(segment);
            return matchesTerm && matchesStatus && matchesSegment;
        });

        rows.sort((a, b) => {
            if (sort === 'newest') return Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0);
            if (sort === 'name') return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            if (sort === 'ending') {
                const aDate = toDate(a.dataFim)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                const bDate = toDate(b.dataFim)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                return aDate - bDate;
            }
            return Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        return rows;
    }

    function cardMarkup(collection) {
        const status = normalizeStatus(collection);
        const segments = normalizeSegments(collection);
        const count = collectionProducts(collection.id).length;
        const image = sanitize(collection.imagemDestaque, 500);
        const description = sanitize(collection.descricao || 'Sem descrição.', 170);
        const featured = collection.destaqueHome === true;
        const start = collection.dataInicio || collection.dataLancamento;
        const end = collection.dataFim;
        const action = status === 'active' ? 'Encerrar' : status === 'ended' ? 'Reabrir' : 'Ativar';
        const actionIcon = status === 'active' ? 'fa-box-archive' : status === 'ended' ? 'fa-rotate-left' : 'fa-play';

        return `
            <article class="collection-card" data-collection-id="${escapeHtml(collection.id)}">
                <div class="collection-cover">
                    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(collection.nome || 'Coleção')}" loading="lazy">` : '<div class="collection-cover-placeholder"><i class="fa-solid fa-layer-group"></i></div>'}
                    <span class="collection-status status-${status}">${statusLabel(status)}</span>
                    ${featured ? '<span class="featured-flag" title="Destaque da Home"><i class="fa-solid fa-star"></i></span>' : ''}
                </div>
                <div class="collection-body">
                    <div class="collection-title-row"><h3>${escapeHtml(collection.nome || 'Coleção sem nome')}</h3><span class="count">${count} peça${count === 1 ? '' : 's'}</span></div>
                    <p class="collection-description">${escapeHtml(description)}</p>
                    <div class="chips">
                        ${segments.includes('moda') ? '<span class="chip chip-moda"><i class="fa-solid fa-shirt"></i> Roupas</span>' : ''}
                        ${segments.includes('mesa') ? '<span class="chip chip-mesa"><i class="fa-solid fa-utensils"></i> Mesa Posta</span>' : ''}
                        ${featured ? '<span class="chip"><i class="fa-solid fa-star"></i> Destaque</span>' : ''}
                    </div>
                    <div class="collection-meta">
                        <div class="meta-item"><span>Início</span><strong>${formatDate(start)}</strong></div>
                        <div class="meta-item"><span>Fim</span><strong>${formatDate(end)}</strong></div>
                    </div>
                    <div class="collection-actions">
                        <a class="button button-secondary" href="produtos.html?collection=${encodeURIComponent(collection.id)}"><i class="fa-solid fa-shirt"></i> Produtos</a>
                        <button type="button" class="button button-secondary" data-edit-collection="${escapeHtml(collection.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
                        <button type="button" class="button button-primary" data-status-collection="${escapeHtml(collection.id)}"><i class="fa-solid ${actionIcon}"></i> ${action}</button>
                    </div>
                </div>
            </article>`;
    }

    function renderCollections() {
        renderMetrics();
        const rows = filteredCollections();
        $('#collections-result-count').textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'}`;

        const active = state.collections
            .filter((collection) => normalizeStatus(collection) === 'active')
            .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
        const activeSection = $('#active-collections-section');
        const activeGrid = $('#active-collections-grid');
        activeSection?.classList.toggle('hidden', active.length === 0);
        if (activeGrid) activeGrid.innerHTML = active.map(cardMarkup).join('');

        $('#collections-loading')?.classList.add('hidden');
        const empty = $('#collections-empty');
        const grid = $('#collections-grid');
        empty?.classList.toggle('hidden', rows.length > 0);
        grid?.classList.toggle('hidden', rows.length === 0);
        if (grid) grid.innerHTML = rows.map(cardMarkup).join('');
        bindCardActions();
    }

    function bindCardActions() {
        $$('[data-edit-collection]').forEach((button) => {
            button.onclick = () => openCollectionModal(getCollection(button.dataset.editCollection));
        });
        $$('[data-status-collection]').forEach((button) => {
            button.onclick = () => handleStatusAction(button.dataset.statusCollection);
        });
    }

    function setModalOpen(modal, open) {
        if (!modal) return;
        modal.classList.toggle('is-open', open);
        modal.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.style.overflow = open ? 'hidden' : '';
    }

    function resetCollectionForm() {
        $('#collection-form')?.reset();
        $('#collection-id').value = '';
        $('#collection-status').value = 'draft';
        $('#collection-order').value = '0';
        $('#collection-segment-moda').checked = true;
        $('#collection-segment-mesa').checked = false;
        $('#collection-featured').checked = false;
        $('#delete-collection-btn')?.classList.add('hidden');
        $('#linked-products-section')?.classList.add('hidden');
        $('#collection-image-preview')?.classList.add('hidden');
        state.editingId = null;
        state.pendingDeleteId = null;
        if (state.pendingDeleteTimer) window.clearTimeout(state.pendingDeleteTimer);
    }

    function renderLinkedProducts(collectionId) {
        const products = collectionProducts(collectionId);
        $('#linked-products-section')?.classList.remove('hidden');
        $('#linked-products-copy').textContent = `${products.length} peça${products.length === 1 ? '' : 's'} vinculada${products.length === 1 ? '' : 's'} a esta coleção.`;
        $('#open-products-filtered').href = `produtos.html?collection=${encodeURIComponent(collectionId)}`;
        const container = $('#linked-products-list');
        if (!container) return;
        if (!products.length) {
            container.innerHTML = '<div class="notice"><i class="fa-solid fa-circle-info"></i><p>Nenhuma peça vinculada ainda. Abra Produtos e escolha esta coleção no cadastro das peças.</p></div>';
            return;
        }
        container.innerHTML = products.slice(0, 30).map((product) => {
            const image = productImage(product);
            return `<div class="linked-product">
                ${image ? `<img class="product-thumb" src="${escapeHtml(image)}" alt="">` : '<div class="product-thumb-placeholder"><i class="fa-solid fa-shirt"></i></div>'}
                <div class="product-copy"><strong>${escapeHtml(product.nome || product.id)}</strong><small>${productSegment(product) === 'mesa' ? 'Mesa Posta' : 'Roupas'} · ${escapeHtml(product.categoria || 'sem categoria')}</small></div>
                <span class="chip">${product.status === 'active' ? 'Ativa' : 'Pausada'}</span>
            </div>`;
        }).join('') + (products.length > 30 ? `<div class="notice"><i class="fa-solid fa-circle-info"></i><p>Mostrando 30 de ${products.length}. Use a página Produtos para ver todas.</p></div>` : '');
    }

    function openCollectionModal(collection = null) {
        resetCollectionForm();
        if (collection) {
            state.editingId = collection.id;
            $('#collection-id').value = collection.id;
            $('#collection-name').value = collection.nome || '';
            $('#collection-slug').value = collection.slug || '';
            $('#collection-description').value = collection.descricao || '';
            $('#collection-home-copy').value = collection.chamadaHome || '';
            const segments = normalizeSegments(collection);
            $('#collection-segment-moda').checked = segments.includes('moda');
            $('#collection-segment-mesa').checked = segments.includes('mesa');
            $('#collection-status').value = normalizeStatus(collection);
            $('#collection-start-date').value = toDateInput(collection.dataInicio || collection.dataLancamento);
            $('#collection-end-date').value = toDateInput(collection.dataFim);
            $('#collection-order').value = Number(collection.ordem || 0);
            $('#collection-featured').checked = collection.destaqueHome === true;
            $('#collection-image').value = collection.imagemDestaque || '';
            $('#collection-modal-badge').textContent = 'Editar coleção';
            $('#collection-modal-title').textContent = collection.nome || 'Editar coleção';
            $('#delete-collection-btn')?.classList.remove('hidden');
            updateImagePreview();
            renderLinkedProducts(collection.id);
        } else {
            $('#collection-modal-badge').textContent = 'Nova coleção';
            $('#collection-modal-title').textContent = 'Criar coleção sazonal';
        }
        setModalOpen($('#collection-modal'), true);
    }

    function closeCollectionModal() {
        setModalOpen($('#collection-modal'), false);
        resetCollectionForm();
    }

    function updateImagePreview() {
        const url = sanitize($('#collection-image')?.value, 500);
        const preview = $('#collection-image-preview');
        const image = preview?.querySelector('img');
        if (!preview || !image) return;
        if (!url) {
            preview.classList.add('hidden');
            image.removeAttribute('src');
            return;
        }
        image.src = url;
        preview.classList.remove('hidden');
    }

    function selectedSegments() {
        const segments = [];
        if ($('#collection-segment-moda')?.checked) segments.push('moda');
        if ($('#collection-segment-mesa')?.checked) segments.push('mesa');
        return segments;
    }

    async function saveCollection(event) {
        event.preventDefault();
        const segments = selectedSegments();
        if (!segments.length) {
            showToast('Escolha Roupas, Mesa Posta ou as duas áreas.', 'error');
            return;
        }
        const name = sanitize($('#collection-name').value, 120);
        const slug = slugify($('#collection-slug').value || name);
        const status = VALID_STATUSES.has($('#collection-status').value) ? $('#collection-status').value : 'draft';
        const startDate = toTimestamp($('#collection-start-date').value);
        const endDate = toTimestamp($('#collection-end-date').value);
        if (startDate && endDate && endDate.toMillis() < startDate.toMillis()) {
            showToast('A data de fim não pode ser anterior ao início.', 'error');
            return;
        }

        const payload = {
            nome: name,
            slug,
            descricao: sanitize($('#collection-description').value, 900),
            chamadaHome: sanitize($('#collection-home-copy').value, 120),
            segmentos: segments,
            status,
            ativa: status === 'active',
            dataInicio: startDate,
            dataFim: endDate,
            dataLancamento: startDate,
            ordem: Math.max(0, Number.parseInt($('#collection-order').value, 10) || 0),
            destaqueHome: $('#collection-featured').checked === true,
            imagemDestaque: sanitize($('#collection-image').value, 500),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const saveButton = $('#save-collection-btn');
        if (saveButton) saveButton.disabled = true;
        try {
            if (state.editingId) {
                await db.collection('colecoes').doc(state.editingId).update(payload);
                showToast('Coleção atualizada.', 'success');
            } else {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('colecoes').add(payload);
                showToast('Coleção criada.', 'success');
            }
            closeCollectionModal();
        } catch (error) {
            console.error('[collections.save]', error);
            showToast(`Não foi possível salvar: ${error.message}`, 'error');
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    }

    async function activateCollection(collectionId) {
        try {
            await db.collection('colecoes').doc(collectionId).update({
                status: 'active',
                ativa: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Coleção ativada no site.', 'success');
        } catch (error) {
            showToast(`Erro ao ativar: ${error.message}`, 'error');
        }
    }

    async function reopenCollection(collectionId) {
        try {
            await db.collection('colecoes').doc(collectionId).update({
                status: 'draft',
                ativa: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Coleção reaberta como rascunho.', 'success');
        } catch (error) {
            showToast(`Erro ao reabrir: ${error.message}`, 'error');
        }
    }

    function openEndModal(collectionId) {
        const collection = getCollection(collectionId);
        if (!collection) return;
        state.endingId = collectionId;
        $('#end-modal-title').textContent = `Encerrar ${collection.nome || 'coleção'}`;
        const products = collectionProducts(collectionId);
        const container = $('#end-products-list');
        if (container) {
            container.innerHTML = products.length ? products.map((product) => {
                const image = productImage(product);
                const checked = product.status === 'active' ? 'checked' : '';
                return `<div class="end-product" data-product-id="${escapeHtml(product.id)}">
                    ${image ? `<img class="product-thumb" src="${escapeHtml(image)}" alt="">` : '<div class="product-thumb-placeholder"><i class="fa-solid fa-shirt"></i></div>'}
                    <div class="product-copy"><strong>${escapeHtml(product.nome || product.id)}</strong><small>${productSegment(product) === 'mesa' ? 'Mesa Posta' : 'Roupas'} · ${escapeHtml(product.categoria || 'sem categoria')}</small></div>
                    <label><input type="checkbox" data-keep-active ${checked}> Continuar ativa</label>
                </div>`;
            }).join('') : '<div class="notice"><i class="fa-solid fa-circle-info"></i><p>Esta coleção não possui peças vinculadas. Apenas a coleção será encerrada.</p></div>';
        }
        setModalOpen($('#end-collection-modal'), true);
    }

    function closeEndModal() {
        setModalOpen($('#end-collection-modal'), false);
        state.endingId = null;
    }

    async function commitProductStatusChanges(products) {
        const chunkSize = 400;
        for (let index = 0; index < products.length; index += chunkSize) {
            const batch = db.batch();
            products.slice(index, index + chunkSize).forEach(({ id, status }) => {
                batch.update(db.collection('pecas').doc(id), {
                    status,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
    }

    async function confirmEndCollection() {
        const collectionId = state.endingId;
        if (!collectionId) return;
        const choices = $$('#end-products-list [data-product-id]').map((row) => ({
            id: row.dataset.productId,
            status: row.querySelector('[data-keep-active]')?.checked ? 'active' : 'inactive'
        }));
        const button = $('#confirm-end-btn');
        if (button) button.disabled = true;
        try {
            await commitProductStatusChanges(choices);
            await db.collection('colecoes').doc(collectionId).update({
                status: 'ended',
                ativa: false,
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Coleção encerrada e catálogo ajustado.', 'success');
            closeEndModal();
        } catch (error) {
            console.error('[collections.end]', error);
            showToast(`Não foi possível encerrar: ${error.message}`, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function handleStatusAction(collectionId) {
        const collection = getCollection(collectionId);
        if (!collection) return;
        const status = normalizeStatus(collection);
        if (status === 'active') return openEndModal(collectionId);
        if (status === 'ended') return reopenCollection(collectionId);
        return activateCollection(collectionId);
    }

    function requestDeleteCollection() {
        const collectionId = state.editingId;
        if (!collectionId) return;
        const linkedCount = collectionProducts(collectionId).length;
        if (linkedCount > 0) {
            showToast(`Esta coleção tem ${linkedCount} peça(s). Remova ou troque a coleção dessas peças antes de excluir.`, 'error');
            return;
        }
        const button = $('#delete-collection-btn');
        if (state.pendingDeleteId !== collectionId) {
            state.pendingDeleteId = collectionId;
            if (button) button.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Confirmar exclusão';
            state.pendingDeleteTimer = window.setTimeout(() => {
                state.pendingDeleteId = null;
                if (button) button.innerHTML = '<i class="fa-solid fa-trash"></i> Excluir';
            }, 8000);
            showToast('Toque novamente em Confirmar exclusão para apagar esta coleção.');
            return;
        }
        deleteCollection(collectionId);
    }

    async function deleteCollection(collectionId) {
        try {
            await db.collection('colecoes').doc(collectionId).delete();
            showToast('Coleção excluída.', 'success');
            closeCollectionModal();
        } catch (error) {
            showToast(`Erro ao excluir: ${error.message}`, 'error');
        }
    }

    function subscribeData() {
        db.collection('colecoes').onSnapshot((snapshot) => {
            state.collections = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .filter((collection) => collection.id !== CATALOG_SETTINGS_DOC_ID && collection.kind !== 'catalog_settings');
            renderCollections();
            if (state.editingId) renderLinkedProducts(state.editingId);
        }, (error) => {
            console.error('[collections.listen]', error);
            $('#collections-loading').innerHTML = '<p>Não foi possível carregar as coleções.</p>';
            showToast(`Erro ao carregar coleções: ${error.message}`, 'error');
        });

        db.collection('pecas').onSnapshot((snapshot) => {
            state.products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            renderCollections();
            if (state.editingId) renderLinkedProducts(state.editingId);
        }, (error) => console.warn('[collections.products]', error));
    }

    function setupEvents() {
        $('#add-collection-btn')?.addEventListener('click', () => openCollectionModal());
        $('#close-collection-modal')?.addEventListener('click', closeCollectionModal);
        $('#cancel-collection-btn')?.addEventListener('click', closeCollectionModal);
        $('#collection-form')?.addEventListener('submit', saveCollection);
        $('#collection-name')?.addEventListener('input', (event) => {
            if (!state.editingId || !$('#collection-slug').value.trim()) $('#collection-slug').value = slugify(event.target.value);
        });
        $('#collection-image')?.addEventListener('input', updateImagePreview);
        $('#delete-collection-btn')?.addEventListener('click', requestDeleteCollection);
        ['#collection-search', '#collection-status-filter', '#collection-segment-filter', '#collection-sort'].forEach((selector) => {
            $(selector)?.addEventListener(selector === '#collection-search' ? 'input' : 'change', renderCollections);
        });
        $('#close-end-modal')?.addEventListener('click', closeEndModal);
        $('#cancel-end-btn')?.addEventListener('click', closeEndModal);
        $('#confirm-end-btn')?.addEventListener('click', confirmEndCollection);
        $$('.modal').forEach((modal) => {
            modal.addEventListener('click', (event) => {
                if (event.target !== modal) return;
                if (modal.id === 'collection-modal') closeCollectionModal();
                if (modal.id === 'end-collection-modal') closeEndModal();
            });
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if ($('#end-collection-modal')?.classList.contains('is-open')) closeEndModal();
            else if ($('#collection-modal')?.classList.contains('is-open')) closeCollectionModal();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        setupEvents();
        auth.onAuthStateChanged(async (user) => {
            if (!(await isAuthorizedAdmin(user))) {
                auth.signOut().catch(() => {});
                window.location.href = 'login-admin.html';
                return;
            }
            subscribeData();
        });
    });
})();
