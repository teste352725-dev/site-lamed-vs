(() => {
    let originalPopularPreview = null;
    let selectedCollectionBySegment = { moda: '', mesa: '' };
    let collectionsListenerStarted = false;
    let currentCollectionsSignature = '';

    const sanitize = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const escapeHtml = (value) => sanitize(value, 800)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function toMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeStatus(collection) {
        const status = sanitize(collection?.status, 20).toLowerCase();
        if (status === 'active' || status === 'draft' || status === 'ended') return status;
        return collection?.ativa === true ? 'active' : 'draft';
    }

    function normalizeSegments(collection) {
        const explicit = Array.isArray(collection?.segmentos)
            ? collection.segmentos.filter((item) => item === 'moda' || item === 'mesa')
            : [];
        if (explicit.length) return [...new Set(explicit)];
        if (collection?.segmento === 'moda' || collection?.segmento === 'mesa') return [collection.segmento];
        return ['moda', 'mesa'];
    }

    function isCollectionInsideWindow(collection, now = Date.now()) {
        const start = toMillis(collection?.dataInicio || collection?.dataLancamento);
        const end = toMillis(collection?.dataFim);
        if (start && now < start) return false;
        if (end) {
            const endOfDay = new Date(end);
            endOfDay.setHours(23, 59, 59, 999);
            if (now > endOfDay.getTime()) return false;
        }
        return true;
    }

    function activeSeasonalCollections(segment) {
        const source = Array.isArray(activeCollections) ? activeCollections : [];
        const now = Date.now();
        return source
            .filter((collection) => normalizeStatus(collection) === 'active')
            .filter((collection) => collection?.ativa !== false)
            .filter((collection) => isCollectionInsideWindow(collection, now))
            .filter((collection) => normalizeSegments(collection).includes(segment))
            .sort((a, b) => {
                const featuredDifference = Number(b?.destaqueHome === true) - Number(a?.destaqueHome === true);
                if (featuredDifference) return featuredDifference;
                return Number(a?.ordem || 0) - Number(b?.ordem || 0)
                    || toMillis(b?.dataInicio || b?.createdAt) - toMillis(a?.dataInicio || a?.createdAt)
                    || String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR');
            });
    }

    function segmentForProduct(product) {
        if (typeof getProductSegment === 'function') return getProductSegment(product);
        return product?.segmento === 'mesa' ? 'mesa' : 'moda';
    }

    function collectionProducts(collectionId, segment) {
        return (Array.isArray(products) ? products : [])
            .filter((product) => product?.colecaoId === collectionId)
            .filter((product) => String(product?.status || 'active').toLowerCase() !== 'inactive')
            .filter((product) => segmentForProduct(product) === segment)
            .sort((a, b) => {
                if (typeof sortProductsByNewest === 'function') return sortProductsByNewest(a, b);
                return Number(b?.ordem || 0) - Number(a?.ordem || 0);
            });
    }

    function ensureHeading() {
        const grid = document.getElementById('home-featured-grid');
        if (!grid) return null;
        let heading = document.getElementById('home-seasonal-collection-heading');
        if (heading) return heading;

        heading = document.createElement('div');
        heading.id = 'home-seasonal-collection-heading';
        heading.className = 'home-seasonal-collection-heading hidden';
        grid.insertAdjacentElement('beforebegin', heading);
        return heading;
    }

    function installStyles() {
        if (document.getElementById('home-seasonal-collections-style')) return;
        const style = document.createElement('style');
        style.id = 'home-seasonal-collections-style';
        style.textContent = `
            .home-seasonal-collection-heading {
                position: relative;
                overflow: hidden;
                margin: 0 auto 32px;
                max-width: 1040px;
                border: 1px solid #E5E0D8;
                border-radius: 28px;
                background: linear-gradient(135deg, rgba(253,251,246,.98), rgba(245,237,226,.92));
                text-align: left;
                box-shadow: 0 18px 46px rgba(69,48,31,.08);
            }
            .home-seasonal-collection-heading.hidden { display:none; }
            .home-seasonal-main { display:grid; grid-template-columns:minmax(0,1fr); gap:0; }
            .home-seasonal-copy { padding:28px; }
            .home-seasonal-cover { min-height:220px; background:#eee6db center/cover no-repeat; }
            .home-seasonal-eyebrow { display:block; margin-bottom:8px; color:#9C8564; font-size:10px; font-weight:800; letter-spacing:.24em; text-transform:uppercase; }
            .home-seasonal-title { margin:0; color:var(--cor-texto); font-family:'Cormorant Garamond',serif; font-size:clamp(2rem,5vw,3.3rem); font-weight:400; line-height:1; }
            .home-seasonal-description { max-width:680px; margin:12px 0 0; color:#6b625b; font-size:14px; line-height:1.7; }
            .home-seasonal-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:20px; }
            .home-seasonal-primary { display:inline-flex; align-items:center; gap:8px; border-radius:999px; background:var(--cor-marrom-cta); padding:11px 18px; color:white; font-size:10px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; text-decoration:none; }
            .home-seasonal-selector { display:flex; gap:8px; flex-wrap:wrap; padding:0 28px 24px; }
            .home-seasonal-selector button { border:1px solid #D8C9B6; border-radius:999px; background:white; padding:9px 14px; color:#6B5139; font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; cursor:pointer; }
            .home-seasonal-selector button.is-active { border-color:#643f21; background:#643f21; color:white; }
            @media (min-width: 760px) {
                .home-seasonal-main.has-cover { grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr); }
                .home-seasonal-cover { min-height:100%; }
                .home-seasonal-copy { padding:38px; }
                .home-seasonal-selector { padding:0 38px 30px; }
            }
        `;
        document.head.appendChild(style);
    }

    function renderFallback() {
        const heading = ensureHeading();
        if (heading) {
            heading.classList.add('hidden');
            heading.replaceChildren();
        }
        if (typeof originalPopularPreview === 'function') originalPopularPreview();
    }

    function renderSeasonalHome() {
        const grid = document.getElementById('home-featured-grid');
        if (!grid || typeof products === 'undefined' || typeof activeCollections === 'undefined') return;
        installStyles();
        const heading = ensureHeading();
        const segment = typeof currentCatalogSegment === 'string' && currentCatalogSegment === 'moda' ? 'moda' : 'mesa';
        const collections = activeSeasonalCollections(segment);
        if (!collections.length) {
            renderFallback();
            return;
        }

        const preferredId = selectedCollectionBySegment[segment];
        const selected = collections.find((collection) => collection.id === preferredId)
            || collections.find((collection) => collection.destaqueHome === true)
            || collections[0];
        selectedCollectionBySegment[segment] = selected.id;

        const items = collectionProducts(selected.id, segment);
        const title = sanitize(selected.nome || 'Coleção', 120);
        const description = sanitize(selected.chamadaHome || selected.descricao || 'Conheça as peças desta coleção.', 260);
        const image = sanitize(selected.imagemDestaque, 700);
        const segmentLabel = segment === 'mesa' ? 'Mesa Posta' : 'Roupas';

        heading.classList.remove('hidden');
        heading.innerHTML = `
            <div class="home-seasonal-main ${image ? 'has-cover' : ''}">
                <div class="home-seasonal-copy">
                    <span class="home-seasonal-eyebrow">Coleção em destaque · ${escapeHtml(segmentLabel)}</span>
                    <h3 class="home-seasonal-title">${escapeHtml(title)}</h3>
                    <p class="home-seasonal-description">${escapeHtml(description)}</p>
                    <div class="home-seasonal-actions">
                        <a class="home-seasonal-primary" href="#/colecao/${encodeURIComponent(selected.id)}">Ver coleção <i class="fa-solid fa-arrow-right"></i></a>
                    </div>
                </div>
                ${image ? `<div class="home-seasonal-cover" role="img" aria-label="${escapeHtml(title)}" style="background-image:url('${String(image).replace(/'/g, '%27')}')"></div>` : ''}
            </div>
            ${collections.length > 1 ? `<div class="home-seasonal-selector" aria-label="Coleções disponíveis">
                ${collections.map((collection) => `<button type="button" data-home-seasonal-id="${escapeHtml(collection.id)}" class="${collection.id === selected.id ? 'is-active' : ''}">${escapeHtml(collection.nome || 'Coleção')}</button>`).join('')}
            </div>` : ''}
        `;

        heading.querySelectorAll('[data-home-seasonal-id]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedCollectionBySegment[segment] = button.dataset.homeSeasonalId || '';
                renderSeasonalHome();
            });
        });

        grid.innerHTML = '';
        if (!items.length) {
            grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">As peças desta coleção serão exibidas aqui assim que forem vinculadas e publicadas.</div>';
            return;
        }

        if (typeof renderProductsIntoGrid === 'function') {
            renderProductsIntoGrid(
                grid,
                items.slice(0, 4),
                '<div class="col-span-full text-center text-gray-400 py-8">Nenhuma peça publicada nesta coleção.</div>',
                8
            );
            return;
        }

        items.slice(0, 4).forEach((product) => {
            if (typeof criarCardProduto === 'function') grid.appendChild(criarCardProduto(product));
        });
    }

    function wrapPreviewRenderer() {
        if (typeof window.popularPreviewColecao !== 'function') return false;
        if (window.popularPreviewColecao.__seasonalHome) return true;
        originalPopularPreview = window.popularPreviewColecao;
        const wrapped = function() {
            return renderSeasonalHome();
        };
        wrapped.__seasonalHome = true;
        window.popularPreviewColecao = wrapped;
        return true;
    }

    function collectionsSignature(items) {
        return (Array.isArray(items) ? items : [])
            .map((item) => [
                item?.id || '', item?.status || '', item?.ativa === true ? '1' : '0',
                item?.ordem || 0, item?.destaqueHome === true ? '1' : '0', item?.imagemDestaque || '',
                item?.chamadaHome || '', item?.dataInicio?.seconds || item?.dataInicio || '', item?.dataFim?.seconds || item?.dataFim || '',
                Array.isArray(item?.segmentos) ? item.segmentos.join(',') : item?.segmento || ''
            ].join('|'))
            .sort()
            .join('::');
    }

    function startCollectionsRealtime() {
        if (collectionsListenerStarted || typeof db === 'undefined' || !db?.collection) return;
        collectionsListenerStarted = true;
        currentCollectionsSignature = collectionsSignature(activeCollections);
        db.collection('colecoes').where('ativa', '==', true).onSnapshot((snapshot) => {
            const next = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .filter((collection) => collection.id !== '__catalog_settings')
                .sort((a, b) => Number(a?.ordem || 0) - Number(b?.ordem || 0));
            const signature = collectionsSignature(next);
            if (signature === currentCollectionsSignature) return;
            currentCollectionsSignature = signature;
            activeCollections = next;
            renderSeasonalHome();
            if (typeof renderizarSecoesColecoes === 'function') renderizarSecoesColecoes();
            if (typeof renderSidebarCategoryLinks === 'function') renderSidebarCategoryLinks();
        }, (error) => {
            collectionsListenerStarted = false;
            console.warn('[home.collections.sync]', error);
        });
    }

    function install() {
        if (!wrapPreviewRenderer()) return false;
        window.renderSeasonalHome = renderSeasonalHome;
        startCollectionsRealtime();
        renderSeasonalHome();
        return true;
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        if (typeof window.popularPreviewColecao === 'function' && typeof db !== 'undefined' && typeof products !== 'undefined') {
            window.clearInterval(timer);
            install();
            return;
        }
        if (attempts >= 200) window.clearInterval(timer);
    }, 50);
})();
