(() => {
    const state = {
        collections: [],
        installed: false,
        queryCollection: new URLSearchParams(window.location.search).get('collection') || '',
        querySegment: new URLSearchParams(window.location.search).get('segment') || '',
        lastProductsSignature: ''
    };

    const $ = (selector) => document.querySelector(selector);
    const sanitize = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

    function normalizeCollectionStatus(collection) {
        const raw = sanitize(collection?.status, 20).toLowerCase();
        if (['draft', 'active', 'ended'].includes(raw)) return raw;
        return collection?.ativa === true ? 'active' : 'draft';
    }

    function normalizeCollectionSegments(collection) {
        const segments = Array.isArray(collection?.segmentos)
            ? collection.segmentos.filter((item) => item === 'moda' || item === 'mesa')
            : [];
        if (segments.length) return [...new Set(segments)];
        if (collection?.segmento === 'moda' || collection?.segmento === 'mesa') return [collection.segmento];
        return ['moda', 'mesa'];
    }

    function segmentForProduct(product) {
        if (product?.segmento === 'mesa') return 'mesa';
        if (product?.segmento === 'moda') return 'moda';
        if (typeof isMesaPostaCategory === 'function' && isMesaPostaCategory(product?.categoria)) return 'mesa';
        return 'moda';
    }

    function collectionName(collectionId) {
        if (!collectionId) return 'Sem coleção';
        const metadata = state.collections.find((item) => item.id === collectionId);
        return metadata?.nome || (typeof collectionsMap !== 'undefined' ? collectionsMap?.[collectionId] : '') || 'Coleção';
    }

    function categoryLabel(slug) {
        if (!slug) return 'Sem categoria';
        if (typeof categoryDefinitions !== 'undefined' && Array.isArray(categoryDefinitions)) {
            const match = categoryDefinitions.find((item) => item.slug === slug);
            if (match?.nome) return match.nome;
        }
        return String(slug).replace(/_/g, ' ');
    }

    async function loadCollectionsMetadata() {
        try {
            const snapshot = await db.collection('colecoes').get();
            state.collections = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .filter((collection) => collection.id !== '__catalog_settings' && collection.kind !== 'catalog_settings')
                .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        } catch (error) {
            console.warn('[products.collections] Não foi possível carregar metadados das coleções.', error);
            state.collections = [];
        }
    }

    function injectExtensionStyles() {
        if ($('#products-collections-extension-style')) return;
        const style = document.createElement('style');
        style.id = 'products-collections-extension-style';
        style.textContent = `
            #open-collections-admin { text-decoration: none; }
            @media (min-width: 960px) {
                .filters-grid { grid-template-columns: minmax(220px, 1.7fr) repeat(4, minmax(150px, 1fr)) !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function buildFilterControls() {
        const categorySelect = $('#filter-category');
        const filtersGrid = categorySelect?.closest('.filters-grid');
        if (!categorySelect || !filtersGrid || $('#filter-segment')) return;

        const segmentLabel = document.createElement('label');
        segmentLabel.className = 'field-shell';
        segmentLabel.innerHTML = `
            <i class="fa-solid fa-table-columns"></i>
            <select id="filter-segment" aria-label="Filtrar por área">
                <option value="all">Roupas + Mesa Posta</option>
                <option value="moda">Roupas</option>
                <option value="mesa">Mesa Posta</option>
            </select>`;

        const collectionLabel = document.createElement('label');
        collectionLabel.className = 'field-shell';
        collectionLabel.innerHTML = `
            <i class="fa-solid fa-layer-group"></i>
            <select id="filter-collection" aria-label="Filtrar por coleção">
                <option value="all">Todas as coleções</option>
                <option value="none">Sem coleção</option>
            </select>`;

        categorySelect.closest('.field-shell')?.insertAdjacentElement('beforebegin', segmentLabel);
        categorySelect.closest('.field-shell')?.insertAdjacentElement('afterend', collectionLabel);

        const resultsLine = $('.results-line .chip-row');
        if (resultsLine && !$('#open-collections-admin')) {
            const link = document.createElement('a');
            link.id = 'open-collections-admin';
            link.className = 'chip-button';
            link.href = 'colecoes.html';
            link.innerHTML = '<i class="fa-solid fa-layer-group"></i> Gerenciar coleções';
            resultsLine.prepend(link);
        }

        $('#filter-segment')?.addEventListener('change', () => {
            applyCategoryScope();
            renderCollectionFilter();
            window.filtrarProdutos?.();
        });
        $('#filter-collection')?.addEventListener('change', () => window.filtrarProdutos?.());
    }

    function applyCategoryScope() {
        const segment = $('#filter-segment')?.value || 'all';
        const category = $('#filter-category');
        if (!category || typeof produtos === 'undefined') return;

        const available = new Set(
            produtos
                .filter((product) => segment === 'all' || segmentForProduct(product) === segment)
                .map((product) => String(product.categoria || ''))
                .filter(Boolean)
        );

        Array.from(category.options).forEach((option) => {
            if (option.value === 'all') {
                option.hidden = false;
                return;
            }
            if (option.value === 'combo') {
                option.hidden = !produtos.some((product) => (segment === 'all' || segmentForProduct(product) === segment) && product.tipo === 'combo');
                return;
            }
            option.hidden = segment !== 'all' && !available.has(option.value);
        });

        const selected = category.selectedOptions?.[0];
        if (selected?.hidden) category.value = 'all';
    }

    function renderCollectionFilter() {
        const select = $('#filter-collection');
        if (!select) return;
        const segment = $('#filter-segment')?.value || 'all';
        const current = select.value || 'all';
        const collections = state.collections.filter((collection) => {
            if (segment === 'all') return true;
            return normalizeCollectionSegments(collection).includes(segment);
        });

        select.innerHTML = '<option value="all">Todas as coleções</option><option value="none">Sem coleção</option>' + collections.map((collection) => {
            const status = normalizeCollectionStatus(collection);
            const suffix = status === 'active' ? ' · ativa' : status === 'ended' ? ' · encerrada' : ' · rascunho';
            return `<option value="${String(collection.id).replace(/"/g, '&quot;')}">${sanitize(collection.nome || 'Coleção', 90)}${suffix}</option>`;
        }).join('');

        if (Array.from(select.options).some((option) => option.value === current)) select.value = current;
        else select.value = 'all';
    }

    function productMatchesFilters(product) {
        const term = ($('#search-input')?.value || '').toLowerCase().trim();
        const category = $('#filter-category')?.value || 'all';
        const segment = $('#filter-segment')?.value || 'all';
        const collection = $('#filter-collection')?.value || 'all';
        const colors = Array.isArray(product?.cores) ? product.cores.map((color) => color?.nome || '').join(' ') : '';
        const haystack = [
            product?.nome,
            product?.categoria,
            categoryLabel(product?.categoria),
            product?.tags,
            colors,
            collectionName(product?.colecaoId),
            segmentForProduct(product) === 'mesa' ? 'mesa posta profético profetico' : 'roupas moda'
        ].join(' ').toLowerCase();

        const matchTerm = !term || haystack.includes(term);
        const matchCategory = category === 'all' || (category === 'combo' ? product?.tipo === 'combo' : product?.categoria === category);
        const matchSegment = segment === 'all' || segmentForProduct(product) === segment;
        const matchCollection = collection === 'all' || (collection === 'none' ? !product?.colecaoId : product?.colecaoId === collection);
        return matchTerm && matchCategory && matchSegment && matchCollection;
    }

    function installFilterOverride() {
        if (typeof window.filtrarProdutos !== 'function' || typeof renderizarGrid !== 'function' || typeof produtos === 'undefined') return false;
        if (window.filtrarProdutos.__collectionsExtension) return true;

        const enhancedFilter = function() {
            const filtered = produtos.filter(productMatchesFilters);
            renderizarGrid(filtered);
        };
        enhancedFilter.__collectionsExtension = true;
        window.filtrarProdutos = enhancedFilter;

        $('#search-input')?.addEventListener('input', enhancedFilter);
        $('#filter-category')?.addEventListener('change', enhancedFilter);
        return true;
    }

    function renderProductCollectionOptions(selectedValue = null) {
        const select = $('#product-collection');
        const segmentSelect = $('#product-segment');
        if (!select || !segmentSelect) return;
        const segment = segmentSelect.value === 'mesa' ? 'mesa' : 'moda';
        const current = selectedValue !== null ? selectedValue : select.value;
        const relevant = state.collections.filter((collection) => normalizeCollectionSegments(collection).includes(segment));

        select.innerHTML = '<option value="">Sem coleção</option>' + relevant.map((collection) => {
            const status = normalizeCollectionStatus(collection);
            const suffix = status === 'active' ? ' · ativa' : status === 'ended' ? ' · encerrada' : ' · rascunho';
            return `<option value="${String(collection.id).replace(/"/g, '&quot;')}">${sanitize(collection.nome || 'Coleção', 90)}${suffix}</option>`;
        }).join('');

        if (current && !Array.from(select.options).some((option) => option.value === current)) {
            const legacy = state.collections.find((collection) => collection.id === current);
            if (legacy) {
                const option = document.createElement('option');
                option.value = current;
                option.textContent = `${legacy.nome || 'Coleção'} · fora desta área`;
                select.appendChild(option);
            }
        }
        select.value = current || '';
    }

    function enhanceProductForm() {
        const segmentSelect = $('#product-segment');
        const collectionSelect = $('#product-collection');
        if (!segmentSelect || !collectionSelect) return;
        if (!$('#product-collection-helper')) {
            const helper = document.createElement('small');
            helper.id = 'product-collection-helper';
            helper.style.display = 'block';
            helper.style.marginTop = '6px';
            helper.style.color = 'rgba(32,24,20,.58)';
            helper.style.fontSize = '11px';
            helper.textContent = 'A lista de coleções acompanha a área escolhida: Roupas ou Mesa Posta.';
            collectionSelect.insertAdjacentElement('afterend', helper);
        }
        segmentSelect.addEventListener('change', () => renderProductCollectionOptions(''));
        renderProductCollectionOptions(collectionSelect.value || '');
    }

    function installModalHook() {
        if (typeof window.abrirModalProduto !== 'function' || window.abrirModalProduto.__collectionsExtension) return false;
        const original = window.abrirModalProduto;
        const wrapped = function(...args) {
            const result = original.apply(this, args);
            window.setTimeout(() => {
                renderProductCollectionOptions($('#product-collection')?.value || '');
            }, 0);
            return result;
        };
        wrapped.__collectionsExtension = true;
        window.abrirModalProduto = wrapped;
        return true;
    }

    function applyQueryFilters() {
        if (state.querySegment && ['moda', 'mesa'].includes(state.querySegment) && $('#filter-segment')) {
            $('#filter-segment').value = state.querySegment;
        }
        if (state.queryCollection && $('#filter-collection')) {
            const collection = state.collections.find((item) => item.id === state.queryCollection);
            if (collection && !state.querySegment) {
                const segments = normalizeCollectionSegments(collection);
                if (segments.length === 1 && $('#filter-segment')) $('#filter-segment').value = segments[0];
            }
            applyCategoryScope();
            renderCollectionFilter();
            if (Array.from($('#filter-collection').options).some((option) => option.value === state.queryCollection)) {
                $('#filter-collection').value = state.queryCollection;
            }
        }
        window.filtrarProdutos?.();
    }

    function startProductsWatcher() {
        window.setInterval(() => {
            if (typeof produtos === 'undefined' || !Array.isArray(produtos)) return;
            const signature = produtos.map((product) => `${product.id}:${product.segmento || ''}:${product.categoria || ''}:${product.colecaoId || ''}:${product.status || ''}`).sort().join('|');
            if (signature === state.lastProductsSignature) return;
            state.lastProductsSignature = signature;
            applyCategoryScope();
            if (state.queryCollection || state.querySegment || $('#filter-collection')?.value !== 'all' || $('#filter-segment')?.value !== 'all') {
                window.filtrarProdutos?.();
            }
        }, 500);
    }

    async function install() {
        if (state.installed) return;
        if (typeof db === 'undefined' || typeof produtos === 'undefined') return;
        state.installed = true;
        injectExtensionStyles();
        await loadCollectionsMetadata();
        buildFilterControls();
        applyCategoryScope();
        renderCollectionFilter();
        enhanceProductForm();
        installFilterOverride();
        installModalHook();
        applyQueryFilters();
        startProductsWatcher();

        try {
            db.collection('colecoes').onSnapshot((snapshot) => {
                state.collections = snapshot.docs
                    .map((doc) => ({ id: doc.id, ...doc.data() }))
                    .filter((collection) => collection.id !== '__catalog_settings' && collection.kind !== 'catalog_settings')
                    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
                renderCollectionFilter();
                renderProductCollectionOptions($('#product-collection')?.value || '');
            });
        } catch (error) {
            console.warn('[products.collections.listen]', error);
        }
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        if (typeof db !== 'undefined' && typeof produtos !== 'undefined' && typeof window.filtrarProdutos === 'function') {
            window.clearInterval(timer);
            install().catch((error) => console.warn('[products.collections.install]', error));
            return;
        }
        if (attempts > 160) window.clearInterval(timer);
    }, 50);
})();
