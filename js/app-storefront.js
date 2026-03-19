function handleRouting() {
    const hash = window.location.hash;
    
    if(elements.sidebarMenu && elements.sidebarMenu.classList.contains('open')) toggleSidebar();

    if (hash.startsWith('#/produto/')) {
        const prodId = hash.split('/')[2];
        showPage('page-product-detail', prodId);
    }
    else if (hash.startsWith('#/colecao/')) showPage('page-single-collection', null, hash.split('/')[2]);
    else if (hash.startsWith('#/categoria/')) showPage('page-category-view', null, hash.split('/')[2]);
    else if (hash === '#colecoes') showPage('page-collections-list');
    else showPage('page-home');
}

function showPage(pageId, param1 = null, param2 = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('product-detail-view').classList.add('hidden');
    document.getElementById('collection-gallery').classList.add('hidden');

    if (pageId === 'page-home') {
        document.getElementById('page-home').classList.add('active');
    }
    else if (pageId === 'page-single-collection') {
        document.getElementById('page-collection').classList.add('active');
        document.getElementById('collection-gallery').classList.remove('hidden');
        renderizarGridColecao(param2);
    }
    else if (pageId === 'page-category-view') {
        document.getElementById('page-collection').classList.add('active');
        document.getElementById('collection-gallery').classList.remove('hidden');
        renderizarGridCategoria(param2);
    }
    else if (pageId === 'page-product-detail') {
        document.getElementById('page-collection').classList.add('active');
        if (products.length === 0) {
            carregarDadosLoja().then(() => showProductDetail(param1));
        } else {
            showProductDetail(param1);
        }
    } 
    else if (pageId === 'page-collections-list') {
        document.getElementById('page-collections-list').classList.add('active');
        renderizarListaDeColecoes(); 
    }
    window.scrollTo(0, 0);
}

let homeShopFiltersBound = false;
let collectionCarouselObserver = null;
const mountedCollectionCarousels = new Set();
const canUseHoverPreviews = window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;

function scheduleNonCriticalStorefrontTask(task, delay = 80) {
    if (typeof task !== 'function') return;

    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => task(), { timeout: 1500 });
        return;
    }

    window.setTimeout(task, delay);
}

function resetCollectionCarouselObserver() {
    if (collectionCarouselObserver) {
        collectionCarouselObserver.disconnect();
    }
    collectionCarouselObserver = null;
    mountedCollectionCarousels.clear();
}

function mountCollectionCarousel(splideId) {
    if (!splideId || mountedCollectionCarousels.has(splideId) || typeof Splide === 'undefined') return;

    mountedCollectionCarousels.add(splideId);
    new Splide(`#${splideId}`, {
        type: 'slide',
        perPage: 4,
        gap: '20px',
        pagination: false,
        arrows: true,
        breakpoints: { 1024: { perPage: 3 }, 768: { perPage: 2 }, 640: { perPage: 1, padding: '20px' } }
    }).mount();
}

function observeCollectionCarousel(section, splideId) {
    if (!section || !splideId) return;

    if (!('IntersectionObserver' in window)) {
        mountCollectionCarousel(splideId);
        return;
    }

    if (!collectionCarouselObserver) {
        collectionCarouselObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                mountCollectionCarousel(entry.target.dataset.splideId);
                collectionCarouselObserver.unobserve(entry.target);
            });
        }, { rootMargin: '220px 0px' });
    }

    section.dataset.splideId = splideId;
    collectionCarouselObserver.observe(section);
}

// --- CARREGAMENTO DE DADOS ---
async function carregarDadosLoja() {
    try {
        const [colecoesSnap, produtosSnap] = await Promise.all([
            db.collection("colecoes").where("ativa", "==", true).get(),
            db.collection("pecas").where("status", "==", "active").get()
        ]);

        activeCollections = colecoesSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

        products = produtosSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data(), preco: parseFloat(doc.data().preco || 0) }));

        setupHomeShopFilters();
        renderHomeShopGrid();

        // Garante que a rota correta seja carregada apÃ³s ter os dados
        handleRouting();

        scheduleNonCriticalStorefrontTask(() => {
            renderizarSecoesColecoes();
            popularPreviewColecao();
        });
    } catch (err) { console.error("Erro dados:", err); }
}

function renderizarSecoesColecoes() {
    const container = elements.collectionsContainer;
    if (!container) return;
    container.innerHTML = '';
    resetCollectionCarouselObserver();
    if (activeCollections.length === 0) return;

    activeCollections.forEach((colecao, index) => {
        const prods = products.filter(p => p.colecaoId === colecao.id);
        if (prods.length === 0) return; 

        const section = document.createElement('section');
        section.className = "py-16 px-4 border-b border-[#E5E0D8] last:border-0 collection-preview-section";
        section.style.contentVisibility = 'auto';
        section.style.containIntrinsicSize = '1px 760px';
        const splideId = `splide-collection-${index}`;
        section.innerHTML = `
            <div class="container mx-auto max-w-7xl text-center">
                <h3 class="serif text-3xl md:text-4xl font-light mb-2 text-[--cor-texto]">${colecao.nome}</h3>
                ${colecao.descricao ? `<p class="text-[--cor-texto] mb-8 max-w-2xl mx-auto text-sm italic">${colecao.descricao}</p>` : '<div class="mb-8"></div>'}
                <div id="${splideId}" class="splide mb-12"><div class="splide__track"><ul class="splide__list"></ul></div></div>
                <button class="main-button py-3 px-8 rounded-full uppercase text-xs tracking-widest" onclick="location.hash='#/colecao/${colecao.id}'">Ver Tudo</button>
            </div>
        `;
        container.appendChild(section);
        
        const list = section.querySelector('.splide__list');
        prods.slice(0, 8).forEach(peca => {
            const slide = document.createElement('li');
            slide.className = 'splide__slide';
            slide.appendChild(criarCardProduto(peca));
            list.appendChild(slide);
        });
        
        if (prods.length > 0) {
            if (index === 0) {
                mountCollectionCarousel(splideId);
            } else {
                observeCollectionCarousel(section, splideId);
            }
        }
    });
}

function popularPreviewColecao() {
    const grid = document.getElementById('home-featured-grid');
    if (!grid) return;

    const destaques = products
        .filter(p => checkIsMesaPosta(p.categoria))
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
        .slice(0, 4);
    grid.innerHTML = '';

    if (destaques.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">Nenhuma peÃ§a em destaque no momento.</div>';
        return;
    }

    destaques.forEach(peca => {
        grid.appendChild(criarCardProduto(peca));
    });
}

function setupHomeShopFilters() {
    const filterButtons = document.querySelectorAll('.home-filter-btn');
    if (filterButtons.length === 0 || homeShopFiltersBound) return;
    homeShopFiltersBound = true;

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            currentHomeFilter = btn.dataset.filter || 'all';
            currentHomePage = 1;
            filterButtons.forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            renderHomeShopGrid();
        });
    });

    const prevBtn = document.getElementById('home-shop-prev');
    const nextBtn = document.getElementById('home-shop-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentHomePage > 1) {
                currentHomePage -= 1;
                renderHomeShopGrid();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = getHomeShopTotalPages();
            if (currentHomePage < totalPages) {
                currentHomePage += 1;
                renderHomeShopGrid();
            }
        });
    }
}

function getHomeShopProducts() {
    const mesaProducts = products
        .filter(p => checkIsMesaPosta(p.categoria))
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    if (currentHomeFilter === 'all') return mesaProducts;
    if (currentHomeFilter === 'anel_guardanapo') {
        return mesaProducts.filter(p => p.categoria === 'anel_guardanapo' || p.categoria === 'porta_guardanapo');
    }
    return mesaProducts.filter(p => p.categoria === currentHomeFilter);
}

function getHomeShopTotalPages() {
    const total = getHomeShopProducts().length;
    return Math.max(1, Math.ceil(total / HOME_PAGE_SIZE));
}

function renderHomeShopGrid() {
    const grid = document.getElementById('home-shop-grid');
    const pageInfo = document.getElementById('home-shop-page-info');
    const prevBtn = document.getElementById('home-shop-prev');
    const nextBtn = document.getElementById('home-shop-next');
    if (!grid) return;

    const filtered = getHomeShopProducts();
    const totalPages = getHomeShopTotalPages();
    if (currentHomePage > totalPages) currentHomePage = totalPages;

    const start = (currentHomePage - 1) * HOME_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + HOME_PAGE_SIZE);

    grid.innerHTML = '';
    if (pageItems.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">Nenhuma peÃ§a encontrada para este filtro.</div>';
    } else {
        pageItems.forEach(peca => grid.appendChild(criarCardProduto(peca)));
    }

    if (pageInfo) pageInfo.textContent = `PÃ¡gina ${currentHomePage} de ${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentHomePage <= 1;
    if (nextBtn) nextBtn.disabled = currentHomePage >= totalPages;
}

function renderizarListaDeColecoes() {
    const grid = document.getElementById('collections-list-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (activeCollections.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-20">Nenhuma coleÃ§Ã£o ativa no momento.</p>';
        return;
    }
    activeCollections.forEach(col => {
        const count = products.filter(p => p.colecaoId === col.id).length;
        const img = col.imagemDestaque || 'https://placehold.co/600x400/eee/ccc?text=Sem+Imagem';
        const card = document.createElement('div');
        card.className = "group cursor-pointer";
        card.innerHTML = `
            <div class="relative overflow-hidden aspect-[4/3] mb-4 bg-gray-100">
                <img src="${img}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" decoding="async">
                <div class="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors"></div>
                <div class="absolute bottom-6 left-6 text-white">
                    <h3 class="serif text-3xl mb-1">${col.nome}</h3>
                    <p class="text-xs uppercase tracking-widest opacity-90">${count} PeÃ§as</p>
                </div>
            </div>
        `;
        card.onclick = () => window.location.hash = `#/colecao/${col.id}`;
        grid.appendChild(card);
    });
}

function renderizarGridColecao(collectionId) {
    const grid = document.getElementById('collection-grid');
    const title = document.querySelector('#page-collection h3');
    if (!grid) return;
    grid.innerHTML = '';
    const col = activeCollections.find(c => c.id === collectionId);
    if (col && title) title.textContent = col.nome;
    const prods = products.filter(p => p.colecaoId === collectionId);
    if (prods.length === 0) { grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peÃ§a.</p>'; return; }
    prods.forEach(peca => grid.appendChild(criarCardProduto(peca)));
}

function renderizarGridCategoria(catSlug) {
    const grid = document.getElementById('collection-grid');
    const title = document.querySelector('#page-collection h3');
    if (!grid) return;
    grid.innerHTML = '';
    
    const nomesCategorias = {
        'combo': 'Kits de Mesa Posta',
        'mesa_posta': 'Mesa Posta',
        'lugar_americano': 'Lugar Americano',
        'guardanapo': 'Guardanapos',
        'anel_guardanapo': 'Anel de Guardanapo',
        'trilho_velas': 'Trilho para Velas',
        'caminho_mesa': 'Caminho de Mesa',
        'capa_de_matza': 'Capa de MatzÃ¡ Bordada'
    };

    if (title) title.textContent = nomesCategorias[catSlug] || catSlug.toUpperCase();

    const prods = products.filter(p => {
        if (catSlug === 'combo') {
            // Filtro especÃ­fico: Produto Ã© tipo Combo E Ã© da categoria Mesa Posta (ou subcategorias)
            return p.tipo === 'combo' && checkIsMesaPosta(p.categoria);
        }
        return p.categoria === catSlug;
    });

    if (prods.length === 0) { 
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peÃ§a encontrada nesta categoria.</p>'; 
        return; 
    }
    
    prods.forEach(peca => grid.appendChild(criarCardProduto(peca)));
}

function criarCardProduto(peca) {
    const card = document.createElement('div');
    card.className = "h-full bg-[#FDFBF6] group cursor-pointer flex flex-col";
    const precoFinal = peca.preco * (1 - (peca.desconto || 0)/100);
    const images = getProductImages(peca);
    const imgPrincipal = images[0];
    const imgHover = images[1] || images[0];
    const shouldRenderHoverImage = canUseHoverPreviews && imgHover && imgHover !== imgPrincipal;
    
    let priceHtml = '';
    if (peca.desconto > 0) {
        priceHtml = `
            <div class="flex flex-col items-center mt-2">
                <span class="text-xs text-gray-400 line-through">${formatarReal(peca.preco)}</span>
                <span class="text-base font-bold text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
            </div>
        `;
    } else {
        priceHtml = `<div class="mt-2 text-base font-bold text-[--cor-texto]">${formatarReal(peca.preco)}</div>`;
    }

    const badge = peca.tipo === 'combo' 
        ? '<div class="absolute top-2 left-2 bg-purple-600 text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide shadow">COMBO</div>' 
        : (peca.desconto > 0 ? `<div class="absolute top-2 left-2 bg-[--cor-marrom-cta] text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide shadow">-${peca.desconto}%</div>` : '');
    const customBadge = peca.personalizavel
        ? '<div class="absolute top-2 right-2 bg-white/95 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide shadow text-[--cor-marrom-cta]">Personalizavel</div>'
        : '';

    const isMesa = checkIsMesaPosta(peca.categoria);
    const catLabel = isMesa ? 'Mesa Posta' : (peca.tipo === 'combo' ? 'Monte seu Combo' : (peca.categoria || 'ColeÃ§Ã£o'));

    card.innerHTML = `
        <div class="aspect-[3/4] relative overflow-hidden bg-gray-100 mb-3 rounded-sm card-img-wrapper">
             <img src="${imgPrincipal}" class="card-img-main w-full h-full object-cover" loading="lazy" decoding="async">
             ${shouldRenderHoverImage ? `<img src="${imgHover}" class="card-img-hover w-full h-full object-cover" loading="lazy" decoding="async">` : ''}
             ${badge}
             ${customBadge}
             <div class="quick-view-btn text-center py-2 bg-white/90 text-[--cor-texto] text-xs font-bold uppercase tracking-widest absolute bottom-0 w-full translate-y-full group-hover:translate-y-0 transition-transform">Ver Detalhes</div>
        </div>
        <div class="text-center px-2">
            <h4 class="text-sm font-medium serif text-[--cor-texto] truncate tracking-wide">${peca.nome}</h4>
            ${priceHtml}
            <p class="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">${catLabel}</p>
        </div>
    `;
    card.addEventListener('click', () => window.location.hash = `#/produto/${peca.id}`);
    return card;
}

// --- DETALHES DO PRODUTO ---
function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;
    
    selectedSize = null; selectedColor = null; 
    comboSelections = {};
    
    document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
    document.getElementById('detail-title').textContent = currentProduct.nome;
    document.getElementById('detail-description').innerHTML = currentProduct.descricao || '';
    
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;
    
    setupSplideCarousel(); 
    
    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    
    const sizeSection = document.querySelector('.size-selector')?.parentElement;
    const accordionDesc = document.querySelector('.accordion-content'); 
    if (accordionDesc) { accordionDesc.classList.remove('hidden'); accordionDesc.previousElementSibling.querySelector('.accordion-icon')?.classList.add('rotate'); }

    // Limpezas
    const existingWarning = document.getElementById('mesa-posta-warning');
    if (existingWarning) existingWarning.remove();
    const existingComboSelector = document.getElementById('combo-selector-container');
    if (existingComboSelector) existingComboSelector.remove();
    const existingColorContainer = document.querySelector('.color-selector-container');
    if (existingColorContainer) existingColorContainer.remove();
    const existingPersonalization = document.getElementById('product-personalization-section');
    if (existingPersonalization) existingPersonalization.remove();

    if (isCombo) {
        if(sizeSection) sizeSection.classList.add('hidden');
        renderComboSelectors(); // Nova Interface de Combo
    } else if (isMesaPosta) {
        if(sizeSection) {
            sizeSection.classList.remove('hidden'); 
            sizeSection.querySelector('.size-selector')?.classList.add('hidden');
            sizeSection.querySelector('.flex.justify-between')?.classList.add('hidden');
        }
        selectedSize = 'Ãšnico';
        renderColors();
        const warningDiv = document.createElement('div');
        warningDiv.id = 'mesa-posta-warning';
        warningDiv.className = 'bg-orange-50 border border-orange-100 text-[#643f21] text-xs p-3 rounded mb-4 mt-2 flex gap-2 items-start';
        warningDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation mt-0.5 text-[#A58A5C]"></i><span><strong>AtenÃ§Ã£o:</strong> Valor referente a <strong>1 unidade</strong> (peÃ§a avulsa).</span>`;
        document.getElementById('add-to-cart-button').parentElement.insertBefore(warningDiv, document.getElementById('add-to-cart-button'));
    } else {
        if(sizeSection) {
            sizeSection.classList.remove('hidden');
            sizeSection.querySelector('.size-selector')?.classList.remove('hidden');
            sizeSection.querySelector('.flex.justify-between')?.classList.remove('hidden');
        }
        selectedSize = null;
        renderColors();
    }

    renderPersonalizationSection();
    
// --- LÃ“GICA DO GUIA DE MEDIDAS (DINÃ‚MICO) ---
const buttons = document.querySelectorAll('.accordion-button');
let sizeGuideContainer = null;

buttons.forEach(btn => {
    if (btn.textContent.includes('Guia de Medidas')) {
        sizeGuideContainer = btn.nextElementSibling;
    }
});

if (sizeGuideContainer) {
    if (!window.originalSizeGuideHTML) {
        window.originalSizeGuideHTML = sizeGuideContainer.innerHTML;
    }

    const mesaPostaGuides = {
        guardanapo: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Guardanapo
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ§µ Guardanapos</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Tamanho:</strong> 42,5 x 42,5 cm</li>
                        <li><strong>Material:</strong> 100% algodÃ£o</li>
                    </ul>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `,

        lugar_americano: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Lugar Americano
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸŸ¦ Lugares Americanos</h5>
                    <div class="space-y-3 text-xs">
                        <div>
                            <p class="font-bold">Brancos, Pretos e PÃ©rolas</p>
                            <p><strong>Medidas:</strong> 47 x 34 cm</p>
                            <p class="text-gray-500"><strong>ComposiÃ§Ã£o:</strong> 98% algodÃ£o, 2% elastano</p>
                        </div>
                        <div>
                            <p class="font-bold">Rosa</p>
                            <p><strong>Medidas:</strong> 44 x 33 cm</p>
                            <p class="text-gray-500"><strong>ComposiÃ§Ã£o:</strong> 100% algodÃ£o</p>
                        </div>
                    </div>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `,

        trilho_velas: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Trilho de Velas
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ•¯ Trilhos de Velas</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Medidas:</strong> 47 x 23 cm</li>
                        <li><strong>ComposiÃ§Ã£o:</strong> 98% algodÃ£o, 2% elastano</li>
                    </ul>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `,

        caminho_mesa: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Caminho de Mesa
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ•¯ Caminhos de Mesa</h5>
                    <div class="space-y-3 text-xs">
                        <div>
                            <p class="font-bold">Tamanho P</p>
                            <p><strong>Medidas:</strong> 135 x 40 cm</p>
                        </div>
                        <div>
                            <p class="font-bold">Tamanho M</p>
                            <p><strong>Medidas:</strong> 180 x 46 cm</p>
                        </div>
                    </div>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `,

        capa_de_matza: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Capa de MatzÃ¡
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸž Capa de MatzÃ¡</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Medidas:</strong> 21 x 21 cm</li>
                    </ul>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `,

        mesa_posta: `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas â€“ Mesa Posta
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">ProduÃ§Ã£o artesanal. Pequenas variaÃ§Ãµes de 1â€“2 cm podem ocorrer.</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ§µ Guardanapos</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Tamanho:</strong> 42,5 x 42,5 cm</li>
                        <li><strong>Material:</strong> 100% algodÃ£o</li>
                    </ul>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸŸ¦ Lugares Americanos</h5>
                    <div class="space-y-3 text-xs">
                        <div>
                            <p class="font-bold">Brancos, Pretos e PÃ©rolas</p>
                            <p><strong>Medidas:</strong> 47 x 34 cm</p>
                            <p class="text-gray-500"><strong>ComposiÃ§Ã£o:</strong> 98% algodÃ£o, 2% elastano</p>
                        </div>
                        <div>
                            <p class="font-bold">Rosa</p>
                            <p><strong>Medidas:</strong> 44 x 33 cm</p>
                            <p class="text-gray-500"><strong>ComposiÃ§Ã£o:</strong> 100% algodÃ£o</p>
                        </div>
                    </div>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ•¯ Trilhos de Velas</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Medidas:</strong> 47 x 23 cm</li>
                        <li><strong>ComposiÃ§Ã£o:</strong> 98% algodÃ£o, 2% elastano</li>
                    </ul>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸ•¯ Caminhos de Mesa</h5>
                    <div class="space-y-3 text-xs">
                        <div>
                            <p class="font-bold">Tamanho P</p>
                            <p><strong>Medidas:</strong> 135 x 40 cm</p>
                        </div>
                        <div>
                            <p class="font-bold">Tamanho M</p>
                            <p><strong>Medidas:</strong> 180 x 46 cm</p>
                        </div>
                    </div>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">ðŸž Capa de MatzÃ¡</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Medidas:</strong> 21 x 21 cm</li>
                    </ul>
                </div>

                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Por se tratar de produÃ§Ã£o artesanal, as peÃ§as podem apresentar pequenas variaÃ§Ãµes nas medidas.</p>
                </div>
            </div>
        `
    };

    if (isMesaPosta) {
        const categoriaAtual = currentProduct.categoria;
        sizeGuideContainer.innerHTML = mesaPostaGuides[categoriaAtual] || mesaPostaGuides.mesa_posta;
    } else {
        sizeGuideContainer.innerHTML = window.originalSizeGuideHTML;
    }
}

    renderRecommendations(currentProduct);
    updateAddToCartButton();
    if(currentUser) checkFavoriteStatus(currentProduct.id);
    
    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
}

// --- LÃ“GICA DE INTERFACE RICA PARA COMBO ---
function renderComboSelectors() {
    if (!currentProduct.componentes || currentProduct.componentes.length === 0) return;

    const container = document.createElement('div');
    container.id = 'combo-selector-container';
    container.className = 'space-y-6 mb-8 mt-4';
    
    container.innerHTML = `
        <div class="bg-purple-50 p-3 rounded border border-purple-100 mb-4">
            <h4 class="font-bold text-sm text-purple-900 uppercase tracking-wide flex items-center gap-2">
                <i class="fa-solid fa-star"></i> Monte seu Combo:
            </h4>
            <p class="text-xs text-purple-700 mt-1">Selecione as variantes para cada item abaixo.</p>
        </div>
    `;

        currentProduct.componentes.forEach((comp, idx) => {
            const productOriginal = products.find(p => p.id === comp.id);
            const coresDisponiveis = productOriginal ? (productOriginal.cores || []) : [];
            const imagemPeca = productOriginal && productOriginal.imagens && productOriginal.imagens.length > 0 ? productOriginal.imagens[0] : 'https://placehold.co/100x100';
            const categoriaLabel = comp.categoria ? comp.categoria.replace('_', ' ').toUpperCase() : 'ITEM';

        const compDiv = document.createElement('div');
        compDiv.className = 'combo-component-card border border-gray-200 rounded-lg p-4 bg-white shadow-sm';
        
        const header = document.createElement('div');
        header.className = "flex gap-4 mb-4 pb-4 border-b border-gray-100";
        header.innerHTML = `
            <img src="${imagemPeca}" class="w-16 h-20 object-cover rounded-sm border border-gray-100">
            <div>
                <span class="text-[10px] font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-500 uppercase tracking-wider">${categoriaLabel}</span>
                <h5 class="font-medium text-gray-800 mt-1">${comp.quantidade}x ${comp.nome}</h5>
                <p class="text-xs text-gray-400 mt-0.5 line-clamp-2">${productOriginal?.descricao || ''}</p>
            </div>
        `;
        compDiv.appendChild(header);

        const colorSection = document.createElement('div');
        if (coresDisponiveis.length > 0) {
            colorSection.innerHTML = `<p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Selecione a Cor:</p>`;
            const colorsGrid = document.createElement('div');
            colorsGrid.className = "flex gap-2 flex-wrap";
            
            coresDisponiveis.forEach(cor => {
                const btn = document.createElement('div');
                btn.className = "combo-color-btn border border-gray-200 p-1.5 rounded-md flex items-center gap-2 transition min-w-[100px] cursor-pointer hover:bg-gray-50";
                btn.innerHTML = `
                    <div class="w-5 h-5 rounded-full border border-gray-300 shadow-sm" style="background-color:${cor.hex}"></div>
                    <div class="flex flex-col">
                        <span class="text-xs font-medium text-gray-700">${cor.nome}</span>
                        <span class="text-[9px] text-gray-400">Sob demanda</span>
                    </div>
                `;
                btn.onclick = () => selectComboColor(idx, cor.nome, cor.hex, btn);
                colorsGrid.appendChild(btn);
            });
            colorSection.appendChild(colorsGrid);
        } else {
            colorSection.innerHTML = `<p class="text-xs text-gray-400 italic">Cor Ãºnica / PadrÃ£o</p>`;
            if (!comboSelections[idx]) comboSelections[idx] = {};
            comboSelections[idx].cor = { nome: 'PadrÃ£o', hex: '#000' };
        }
        compDiv.appendChild(colorSection);

        const isRoupa = isRoupaCategory(comp.categoria);
        
        if (isRoupa) {
            const sizeSection = document.createElement('div');
            sizeSection.className = "mt-4 pt-3 border-t border-gray-50";
            sizeSection.innerHTML = `<p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Tamanho:</p>`;
            
            const sizesDiv = document.createElement('div');
            sizesDiv.className = "flex gap-2";
            ['PP','P','M','G','GG'].forEach(tam => {
                const btn = document.createElement('div');
                btn.className = "combo-size-btn w-8 h-8 flex items-center justify-center border border-gray-200 rounded text-xs cursor-pointer hover:border-gray-400";
                btn.textContent = tam;
                btn.onclick = () => selectComboSize(idx, tam, btn);
                sizesDiv.appendChild(btn);
            });
            sizeSection.appendChild(sizesDiv);
            compDiv.appendChild(sizeSection);
        } else {
             if (!comboSelections[idx]) comboSelections[idx] = {};
             comboSelections[idx].tamanho = 'Ãšnico';
        }

        container.appendChild(compDiv);
    });

    const target = document.getElementById('detail-price');
    target.after(container);
}

window.selectComboColor = (compIndex, corNome, corHex, element) => {
    const parent = element.parentElement;
    parent.querySelectorAll('.combo-color-btn').forEach(el => {
        el.classList.remove('bg-purple-50', 'border-purple-500', 'ring-1', 'ring-purple-500');
        el.classList.add('border-gray-200');
    });
    element.classList.remove('border-gray-200');
    element.classList.add('bg-purple-50', 'border-purple-500', 'ring-1', 'ring-purple-500');

    if (!comboSelections[compIndex]) comboSelections[compIndex] = {};
    comboSelections[compIndex].cor = { nome: corNome, hex: corHex };
    updateAddToCartButton();
};

window.selectComboSize = (compIndex, tamanho, element) => {
    const parent = element.parentElement;
    parent.querySelectorAll('.combo-size-btn').forEach(el => {
        el.classList.remove('bg-purple-600', 'text-white', 'border-purple-600');
        el.classList.add('border-gray-200', 'text-gray-700');
    });
    element.classList.remove('border-gray-200', 'text-gray-700');
    element.classList.add('bg-purple-600', 'text-white', 'border-purple-600');

    if (!comboSelections[compIndex]) comboSelections[compIndex] = {};
    comboSelections[compIndex].tamanho = tamanho;
    updateAddToCartButton();
};

function renderColors() {
    const cores = currentProduct.cores || [];
    if (cores.length === 0) {
        selectedColor = null;
        updateAddToCartButton();
        return;
    }

    const div = document.createElement('div');
    div.className = 'color-selector-container mb-6';
    div.innerHTML = `<p class="text-xs font-bold uppercase tracking-widest text-[--cor-texto] mb-2">Cor</p><div class="flex gap-3 flex-wrap">${cores.map((c, i) => {
        const madeToOrderBadge = `<span class="text-[10px] text-gray-500 font-medium ml-1 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">sob demanda</span>`;
        return `<div class="color-option group relative" data-idx="${i}"><div class="w-4 h-4 rounded-full border border-gray-300 shadow-sm" style="background-color:${c.hex}"></div><span class="text-xs font-medium text-gray-700">${c.nome}</span>${madeToOrderBadge}</div>`;
    }).join('')}</div>`;
    
    const sizeSelector = document.querySelector('.size-selector');
    if (sizeSelector && sizeSelector.parentElement) sizeSelector.parentElement.after(div);
    else document.getElementById('detail-price').after(div);

    if (cores.length === 1) {
        selectedColor = 0;
        div.querySelector(`.color-option[data-idx="${selectedColor}"]`)?.classList.add('selected');
    } else {
        selectedColor = null;
    }

    div.querySelectorAll('.color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            div.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = parseInt(btn.dataset.idx);
            updateAddToCartButton();
        });
    });

    updateAddToCartButton();
}

function renderPersonalizationSection() {
    const buttonContainer = document.getElementById('add-to-cart-button')?.parentElement;
    if (!buttonContainer) return;

    const existingSection = document.getElementById('product-personalization-section');
    if (existingSection) existingSection.remove();

    if (!currentProduct?.personalizavel || currentProduct?.tipo === 'combo') return;

    const section = document.createElement('div');
    section.id = 'product-personalization-section';
    section.className = 'rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3';
    section.innerHTML = `
        <div>
            <p class="text-xs font-bold uppercase tracking-[0.22em] text-amber-900">Personalizacao da peca</p>
            <p class="mt-1 text-xs leading-5 text-amber-800">Digite nome, iniciais ou instrucoes que precisam acompanhar o pedido.</p>
        </div>
        <div class="space-y-3">
            <input id="personalization-text-input" type="text" maxlength="120" class="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none focus:border-[--cor-marrom-cta]" placeholder="Ex.: iniciais, nome curto ou frase">
            <textarea id="personalization-notes-input" rows="3" maxlength="280" class="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none focus:border-[--cor-marrom-cta]" placeholder="Observacoes extras, medidas ou referencia do acabamento"></textarea>
        </div>
    `;

    buttonContainer.insertBefore(section, document.getElementById('add-to-cart-button'));
}

function getCurrentPersonalization() {
    return normalizePersonalization({
        texto: document.getElementById('personalization-text-input')?.value || '',
        observacoes: document.getElementById('personalization-notes-input')?.value || ''
    });
}

function getProductImages(product) {
    const safeImages = Array.isArray(product?.imagens) ? product.imagens.filter(Boolean) : [];
    return safeImages.length > 0
        ? safeImages
        : ['https://placehold.co/600x800/eee/ccc?text=Sem+imagem'];
}

function renderRecommendations(current) {
    const container = document.getElementById('related-products-container');
    if (!container) return;
    container.innerHTML = '';
    const suggestions = products.filter(p => p.id !== current.id).sort(() => 0.5 - Math.random()).slice(0, 4);
    if (suggestions.length > 0) {
        const title = document.createElement('h3');
        title.className = "serif text-2xl text-center mt-12 mb-6 text-[--cor-texto]";
        title.textContent = "VocÃª tambÃ©m pode gostar";
        container.appendChild(title);
        const grid = document.createElement('div');
        grid.className = "grid grid-cols-2 md:grid-cols-4 gap-4";
        suggestions.forEach(p => grid.appendChild(criarCardProduto(p)));
        container.appendChild(grid);
    }
}

function setupSplideCarousel() {
    if (mainSplideInstance) { mainSplideInstance.destroy(); mainSplideInstance = null; }
    if (thumbSplideInstance) { thumbSplideInstance.destroy(); thumbSplideInstance = null; }

    const mainList = document.getElementById('main-carousel-list');
    const thumbList = document.getElementById('thumbnail-carousel-list');
    mainList.innerHTML = ''; thumbList.innerHTML = '';
    
    const images = getProductImages(currentProduct);
    images.forEach((img, index) => {
        const loadingMode = index === 0 ? 'eager' : 'lazy';
        const fetchPriority = index === 0 ? 'high' : 'low';
        mainList.innerHTML += `<li class="splide__slide flex items-center justify-center bg-transparent h-[50vh] md:h-[60vh]"><img src="${img}" class="h-full w-auto object-contain" loading="${loadingMode}" decoding="async" fetchpriority="${fetchPriority}"></li>`;
        thumbList.innerHTML += `<li class="splide__slide thumbnail-slide opacity-60"><img src="${img}" class="w-full h-full object-cover rounded cursor-pointer" loading="lazy" decoding="async"></li>`;
    });

    mainSplideInstance = new Splide('#main-carousel', { type: 'fade', rewind: true, pagination: false, arrows: true });
    thumbSplideInstance = new Splide('#thumbnail-carousel', { fixedWidth: 60, fixedHeight: 60, gap: 10, rewind: true, pagination: false, isNavigation: true, arrows: false });
    
    mainSplideInstance.sync(thumbSplideInstance);
    mainSplideInstance.mount();
    thumbSplideInstance.mount();
}

function selectSize(el) {
    document.querySelectorAll('.size-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    selectedSize = el.dataset.size;
    updateAddToCartButton();
}

function updateAddToCartButton() {
    const btn = elements.addToCartBtn;
    if(!btn) return;
    
    const hasTrackedColors = Array.isArray(currentProduct.cores) && currentProduct.cores.length > 0;
    btn.classList.remove('bg-gray-400');
    btn.classList.add('hover:bg-[#4a2e18]');

    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    const hasSize = selectedSize !== null;
    const hasColor = !hasTrackedColors || selectedColor !== null;

    let canAdd = false;
    if (isCombo) {
        const totalComponents = currentProduct.componentes ? currentProduct.componentes.length : 0;
        let selectedCount = 0;
        
        for (let i = 0; i < totalComponents; i++) {
            if (comboSelections[i] && comboSelections[i].cor && comboSelections[i].tamanho) {
                selectedCount++;
            }
        }
        canAdd = selectedCount === totalComponents;
    } else {
        canAdd = (isMesaPosta || hasSize) && hasColor;
    }

    if (canAdd) {
        btn.disabled = false;
        btn.classList.remove('bg-gray-400');
        btn.textContent = currentProduct.personalizavel ? "ADICIONAR PECA PERSONALIZADA" : "ADICIONAR A SACOLA";
    } else {
        btn.disabled = true; 
        btn.textContent = isCombo ? "Selecione opÃ§Ãµes de TODOS os itens" : "Selecione OpÃ§Ãµes";
        btn.classList.add('bg-gray-400');
        btn.classList.remove('hover:bg-[#4a2e18]');
    }
}

