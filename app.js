// Configuração do Firebase
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

// Inicializar Firebase
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) {
    console.error("Erro ao inicializar Firebase:", e);
}
const db = firebase.firestore();
const auth = firebase.auth();

// HABILITAR PERSISTÊNCIA (CRUCIAL PARA OFFLINE/REDE RUIM)
db.enablePersistence().catch(err => {
    if (err.code == 'failed-precondition') {
        console.log('Persistência falhou: múltiplas abas abertas');
    } else if (err.code == 'unimplemented') {
        console.log('Persistência não suportada');
    }
});

// ... (Resto das variáveis e seletores DOM mantidos iguais) ...
// Copiar o resto do código do arquivo anterior, pois a lógica de negócio não mudou.
// Apenas a inicialização da persistência foi adicionada acima.
// ...

// Variáveis Globais
let products = [];
let activeCollections = []; 
let cart = [];
let currentProduct = null;
let selectedSize = null;
let selectedColor = null;
let isTransitioning = false;
let productDetailOrigin = 'page-collection';
let splideMain = null;
let splideThumbnails = null;
let homeSplideInstances = []; 
let homeMainSplide = null; 
let currentUser = null; // Utilizador logado
const TAXA_JUROS = 0.0549;

// Elementos DOM
const elements = {
    cartOverlay: document.getElementById('cart-overlay'),
    cartDrawer: document.getElementById('cart-drawer'),
    cartButton: document.getElementById('cart-btn'),
    closeCartButton: document.getElementById('close-cart-btn'),
    cartItemsContainer: document.getElementById('cart-items-container'),
    cartEmptyMsg: document.getElementById('cart-empty-msg'),
    cartSubtotalEl: document.getElementById('cart-subtotal'),
    cartCountBadge: document.getElementById('cart-count'),
    addToCartBtn: document.getElementById('add-to-cart-button'),
    addToCartFeedbackEl: document.getElementById('add-to-cart-feedback'),
    selectedSizeDisplay: document.getElementById('selected-size-display'),
    menuButton: document.getElementById('menu-button'),
    mobileMenu: document.getElementById('mobile-menu'),
    finalizarPedidoBtn: document.getElementById('finalizar-pedido-btn'),
    checkoutModal: document.getElementById('checkout-modal'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutSummary: document.getElementById('checkout-summary'),
    checkoutTotal: document.getElementById('checkout-total'),
    collectionsContainer: document.getElementById('collections-container'),
    // Botão de favorito (pode não existir no DOM inicial, verificado dinamicamente)
    // btnFavorite: document.getElementById('btn-favorite') 
};

// --- Inicialização ---

function init() {
    console.log('Inicializando Laméd vs...');
    
    // Auth Listener
    auth.onAuthStateChanged(user => {
        currentUser = user;
        if(currentUser) {
            checkFavoriteStatus(currentProduct?.id); 
        }
    });

    validarELimparCarrinho();
    updateCartUI(); 

    // Carrega dados da loja
    carregarDadosLoja(); 
    
    setupEventListeners();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(console.error);
    }

    setTimeout(() => registrarVisita(window.location.pathname), 2000);
}

function validarELimparCarrinho() {
    const savedCart = localStorage.getItem('lamedCart');
    if (savedCart) {
        try {
            let tempCart = JSON.parse(savedCart);
            if (!Array.isArray(tempCart)) tempCart = [];
            
            cart = tempCart.filter(item => {
                return item && item.cartId && item.nome && typeof item.preco === 'number';
            });
            
            if (cart.length !== tempCart.length) {
                localStorage.setItem('lamedCart', JSON.stringify(cart));
            }
        } catch (e) {
            cart = [];
            localStorage.removeItem('lamedCart');
        }
    } else {
        cart = [];
    }
}

function setupEventListeners() {
    window.addEventListener('hashchange', handleRouting);
    
    // Scroll suave para âncoras
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if(href.startsWith('#/') || href === '#colecao' || href === '#home' || this.classList.contains('nav-collection-link')) return; 
            
            if (document.querySelector(href)) {
                 e.preventDefault();
                 document.querySelector(href).scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Intercepta clique no link "COLEÇÃO" do menu
    document.querySelectorAll('.nav-collection-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navegarParaColecoes();
        });
    });

    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => {
        window.location.hash = productDetailOrigin || '#colecao';
    });

    if(elements.menuButton) {
        elements.menuButton.addEventListener('click', () => {
            elements.mobileMenu.classList.toggle('active');
            elements.menuButton.textContent = elements.mobileMenu.classList.contains('active') ? '✕' : '☰';
        });
    }

    if (elements.cartButton) elements.cartButton.addEventListener('click', openCart);
    if (elements.closeCartButton) elements.closeCartButton.addEventListener('click', closeCart);
    if (elements.cartOverlay) elements.cartOverlay.addEventListener('click', closeCart);
    
    if (elements.finalizarPedidoBtn) elements.finalizarPedidoBtn.addEventListener('click', openCheckoutModal);
    
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeCheckoutModal));
    
    if (elements.checkoutForm) {
        elements.checkoutForm.addEventListener('submit', (e) => {
            e.preventDefault();
            finalizarPedido(new FormData(elements.checkoutForm));
        });
    }

    document.querySelectorAll('.size-option').forEach(option => {
        option.addEventListener('click', () => selectSize(option));
    });

    if (elements.addToCartBtn) elements.addToCartBtn.addEventListener('click', addToCart);

    // Delegação de eventos para itens do carrinho (botões +, -, remover)
    if (elements.cartItemsContainer) elements.cartItemsContainer.addEventListener('click', handleCartItemClick);

    document.querySelectorAll('.accordion-toggle').forEach(btn => {
        btn.addEventListener('click', toggleAccordion);
    });

    setupPaymentOptions();
}

// --- LÓGICA DE NAVEGAÇÃO INTELIGENTE ---

function navegarParaColecoes() {
    if (elements.mobileMenu && elements.mobileMenu.classList.contains('active')) {
        elements.mobileMenu.classList.remove('active');
        if(elements.menuButton) elements.menuButton.textContent = '☰';
    }

    if (activeCollections.length === 1) {
        window.location.hash = `#/colecao/${activeCollections[0].id}`;
    } else {
        window.location.hash = '#colecoes';
    }
}

function handleRouting() {
    const hash = window.location.hash;
    
    // Fecha menu mobile ao navegar
    if (elements.mobileMenu && elements.mobileMenu.classList.contains('active')) {
        elements.mobileMenu.classList.remove('active');
        if(elements.menuButton) elements.menuButton.textContent = '☰';
    }

    if (hash.startsWith('#/produto/')) {
        const productId = hash.split('/')[2];
        showPage('page-product-detail', productId);
    } 
    else if (hash.startsWith('#/colecao/')) {
        const collectionId = hash.split('/')[2];
        showPage('page-single-collection', null, collectionId);
    }
    else if (hash === '#colecoes') {
        showPage('page-collections-list');
    } 
    else if (hash === '#home' || hash === '' || hash === '#') {
        showPage('page-home');
    }
}

function showPage(pageId, param1 = null, param2 = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    document.getElementById('product-detail-view').classList.add('hidden');
    document.getElementById('collection-gallery').classList.add('hidden');

    if (pageId === 'page-home') {
        document.getElementById('page-home').classList.add('active');
        window.scrollTo(0, 0);
        initScrollObserver();
    } 
    else if (pageId === 'page-collections-list') {
        document.getElementById('page-collections-list').classList.add('active');
        renderizarListaColecoes();
        window.scrollTo(0, 0);
    }
    else if (pageId === 'page-single-collection') {
        const collectionId = param2;
        document.getElementById('page-collection').classList.add('active');
        document.getElementById('collection-gallery').classList.remove('hidden');
        renderizarGridColecao(collectionId);
        window.scrollTo(0, 0);
    }
    else if (pageId === 'page-product-detail') {
        const productId = param1;
        document.getElementById('page-collection').classList.add('active');
        if (products.length === 0) {
            carregarDadosLoja().then(() => showProductDetail(productId));
        } else {
            showProductDetail(productId);
        }
        window.scrollTo(0, 0);
    }
}

// --- CARREGAMENTO DE DADOS ---

async function carregarDadosLoja() {
    const container = elements.collectionsContainer;
    
    // Feedback visual na home apenas se necessário
    if(container && !products.length && document.getElementById('page-home').classList.contains('active')) {
        container.innerHTML = `<div class="col-span-full text-center mt-8 py-12"><div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-400 border-r-transparent"></div><p class="mt-2 text-gray-500">Carregando...</p></div>`;
    }

    try {
        // 1. Buscar coleções
        const colecoesSnap = await db.collection("colecoes").where("ativa", "==", true).get();
        activeCollections = colecoesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        activeCollections.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        
        const idsColecoesAtivas = activeCollections.map(c => c.id);
        
        // 2. Buscar produtos
        // Usamos filtro simples para evitar erros de índice composto no Firestore
        const produtosSnap = await db.collection("pecas").where("status", "==", "active").get();

        products = [];
        produtosSnap.forEach(doc => {
            const d = doc.data();
            
            // Filtragem manual: Só mostra se pertencer a coleção ativa OU se não tiver coleção definida (opcional)
            // Aqui assumimos que produtos sem coleção aparecem em "Geral" se quisermos, mas a regra diz para filtrar.
            if (d.colecaoId && !idsColecoesAtivas.includes(d.colecaoId)) return;

            let imgs = d.imagens || [];
            if (imgs.length === 0 && d.imagem) imgs = [d.imagem];
            if (imgs.length === 0) imgs = ['https://placehold.co/600x800/eee/ccc?text=Laméd'];

            products.push({
                id: doc.id,
                ...d,
                imagens: imgs,
                preco: parseFloat(d.preco || 0),
                desconto: d.desconto || 0,
                cores: d.cores || [],
                createdAt: d.createdAt // Para ordenação de lançamentos
            });
        });

        products.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

        // 3. Renderizar
        renderizarSecoesColecoes(); 
        popularPreviewColecao(); 
        
        handleRouting(); // Verifica rota inicial após carregar dados
        initScrollObserver();

    } catch (err) {
        console.error("Erro crítico ao carregar:", err);
        if(container) container.innerHTML = `<p class="text-center col-span-full text-red-500 py-8">Erro de conexão.</p>`;
    }
}

// --- RENDERIZAÇÃO HOME ---

function renderizarSecoesColecoes() {
    const container = elements.collectionsContainer;
    if (!container) return;
    
    container.innerHTML = ''; 

    // Limpar sliders antigos para libertar memória
    homeSplideInstances.forEach(splide => splide.destroy());
    homeSplideInstances = [];

    if (activeCollections.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-12">Nenhuma coleção disponível no momento.</p>';
        return;
    }

    activeCollections.forEach((colecao, index) => {
        const produtosDaColecao = products.filter(p => p.colecaoId === colecao.id);

        if (produtosDaColecao.length === 0) return;

        const section = document.createElement('section');
        section.className = "py-16 px-4 scroll-animate border-b border-gray-100 last:border-0";
        section.id = `collection-${colecao.id}`;

        const splideId = `splide-collection-${index}`;

        section.innerHTML = `
            <div class="container mx-auto max-w-7xl text-center">
                <h3 class="serif text-3xl md:text-4xl font-light mb-2 text-gray-800">${colecao.nome}</h3>
                ${colecao.descricao ? `<p class="text-gray-500 mb-8 max-w-2xl mx-auto text-sm">${colecao.descricao}</p>` : '<div class="mb-8"></div>'}
                
                <div id="${splideId}" class="splide mb-12">
                    <div class="splide__track">
                        <ul class="splide__list"></ul>
                    </div>
                </div>

                <button class="main-button text-white font-semibold py-3 px-8 rounded-full uppercase text-sm tracking-wider" onclick="location.hash='#/colecao/${colecao.id}'">Ver Coleção Completa</button>
            </div>
        `;

        container.appendChild(section);

        const splideList = section.querySelector('.splide__list');
        
        // Mostra até 8 produtos no preview
        produtosDaColecao.slice(0, 8).forEach(peca => {
            const slide = document.createElement('li');
            slide.className = 'splide__slide';
            const card = criarCardProduto(peca, '#home');
            slide.appendChild(card);
            splideList.appendChild(slide);
        });

        const splide = new Splide(`#${splideId}`, {
            type: 'slide', perPage: 4, perMove: 1, gap: '20px', pagination: false, arrows: true,
            breakpoints: { 1024: { perPage: 3 }, 768: { perPage: 2 }, 640: { perPage: 1, gap: '15px', padding: '20px' } }
        }).mount();

        homeSplideInstances.push(splide);
    });
    
    initScrollObserver();
}

// Lançamentos (Últimas 5 peças)
function popularPreviewColecao() {
    const splideList = document.getElementById('home-splide-list');
    if (!splideList) return;

    // Ordena por data de criação (mais recente primeiro) e pega 5
    const lancamentos = [...products].sort((a, b) => {
        const dateA = a.createdAt ? (a.createdAt.seconds || 0) : 0;
        const dateB = b.createdAt ? (b.createdAt.seconds || 0) : 0;
        return dateB - dateA; 
    }).slice(0, 5); 
    
    splideList.innerHTML = '';

    if (lancamentos.length === 0) {
        splideList.innerHTML = '<li class="splide__slide flex justify-center items-center h-40"><p class="text-gray-500">Em breve novidades.</p></li>';
        return;
    }

    lancamentos.forEach(peca => {
        const slide = document.createElement('li');
        slide.className = 'splide__slide';
        const card = criarCardProduto(peca, '#home');
        slide.appendChild(card);
        splideList.appendChild(slide);
    });

    if (homeMainSplide) homeMainSplide.destroy();
    homeMainSplide = new Splide('#home-splide', {
        type: 'slide', perPage: 4, perMove: 1, gap: '20px', pagination: false,
        breakpoints: { 640: { perPage: 2 }, 1024: { perPage: 3 } }
    }).mount();
}

function criarCardProduto(peca, origin) {
    const card = document.createElement('div');
    card.className = "h-full bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-pointer group transition-all hover:shadow-md";
    
    const precoFinal = peca.preco * (1 - peca.desconto/100);
    const imgPrincipal = peca.imagens[0];
    const imgHover = peca.imagens[1] || peca.imagens[0];
    
    card.innerHTML = `
        <div class="aspect-[3/4] relative overflow-hidden product-image-container bg-gray-100">
             <img src="${imgPrincipal}" class="product-image main w-full h-full object-cover transition-opacity duration-500 absolute inset-0">
             <img src="${imgHover}" class="product-image hover w-full h-full object-cover transition-opacity duration-500 absolute inset-0 opacity-0 group-hover:opacity-100">
             ${peca.desconto > 0 ? `<div class="absolute top-2 left-2 bg-red-800 text-white text-xs px-2 py-1 font-bold z-10">-${peca.desconto}%</div>` : ''}
        </div>
        <div class="p-4 text-center relative z-10 bg-white">
            <h4 class="text-sm font-medium truncate serif text-gray-800">${peca.nome}</h4>
            <div class="mt-1 flex justify-center gap-2 items-baseline">
                <span class="text-sm font-bold text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
                ${peca.desconto > 0 ? `<span class="text-xs line-through text-gray-400">${formatarReal(peca.preco)}</span>` : ''}
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => {
        productDetailOrigin = origin;
        if (origin.startsWith('#/colecao/')) productDetailOrigin = origin;
        window.location.hash = `#/produto/${peca.id}`;
    });
    
    return card;
}

// --- Outras Listas ---

function renderizarListaColecoes() {
    const container = document.getElementById('collections-list-grid');
    if (!container) return;
    container.innerHTML = '';

    if (activeCollections.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma coleção disponível.</p>';
        return;
    }

    activeCollections.forEach(col => {
        const card = document.createElement('div');
        card.className = "relative aspect-[3/4] group cursor-pointer overflow-hidden rounded-lg shadow-md";
        
        let bgImage = col.imagemDestaque;
        if (!bgImage) {
            const firstProd = products.find(p => p.colecaoId === col.id);
            bgImage = (firstProd && firstProd.imagens[0]) ? firstProd.imagens[0] : 'https://placehold.co/600x800/eee/ccc?text=Coleção';
        }

        card.innerHTML = `
            <img src="${bgImage}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105">
            <div class="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <div class="text-center p-4">
                    <h3 class="text-white text-3xl md:text-4xl serif font-light tracking-wider mb-2">${col.nome}</h3>
                    <span class="inline-block border border-white/60 text-white px-6 py-2 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors">Ver Coleção</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            window.location.hash = `#/colecao/${col.id}`;
        });

        container.appendChild(card);
    });
}

function renderizarGridColecao(collectionId) {
    const grid = document.getElementById('collection-grid');
    const title = document.querySelector('#page-collection h3');
    if (!grid) return;
    
    grid.innerHTML = '';

    const colecao = activeCollections.find(c => c.id === collectionId);
    if (colecao && title) title.textContent = colecao.nome;

    const produtosDaColecao = products.filter(p => p.colecaoId === collectionId);

    if (produtosDaColecao.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peça nesta coleção.</p>';
        return;
    }

    produtosDaColecao.forEach(peca => {
        const card = criarCardProduto(peca, `#/colecao/${collectionId}`);
        grid.appendChild(card);
    });
}

// --- Detalhes do Produto (Com Favorito + Recomendações) ---

function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;

    selectedSize = null;
    selectedColor = null;
    document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
    if(elements.selectedSizeDisplay) elements.selectedSizeDisplay.classList.add('hidden');
    if(elements.addToCartFeedbackEl) elements.addToCartFeedbackEl.textContent = '';
    
    document.getElementById('detail-title').textContent = currentProduct.nome;
    document.getElementById('detail-description').textContent = currentProduct.descricao || '';
    
    const precoFinal = currentProduct.preco * (1 - currentProduct.desconto/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;

    setupSplideCarousel();
    renderColors();
    updateAddToCartButton();
    
    // Botão Favorito
    const btnFav = document.getElementById('btn-favorite');
    if(btnFav) {
        const newBtn = btnFav.cloneNode(true);
        btnFav.parentNode.replaceChild(newBtn, btnFav);
        newBtn.addEventListener('click', () => toggleFavorite(currentProduct.id));
        checkFavoriteStatus(currentProduct.id);
    }
    
    // Recomendações
    renderRecommendations(currentProduct);

    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
}

// Lógica de Recomendação
function renderRecommendations(current) {
    const relatedContainer = document.getElementById('related-products-container');
    if (!relatedContainer) return;
    
    relatedContainer.innerHTML = ''; 
    
    // 1. Outras peças da coleção (Carrossel)
    let collectionProducts = [];
    if (current.colecaoId) {
        collectionProducts = products.filter(p => p.colecaoId === current.colecaoId && p.id !== current.id);
    }
    
    if (collectionProducts.length > 0) {
        renderProductCarousel(relatedContainer, "Outras peças desta coleção", collectionProducts, 'related-collection');
    }
    
    // 2. Você também pode gostar (Grid)
    let youMayLike = products.filter(p => p.id !== current.id && !collectionProducts.includes(p));
    const sameCategory = youMayLike.filter(p => p.categoria === current.categoria);
    const others = youMayLike.filter(p => p.categoria !== current.categoria);
    
    youMayLike = [...sameCategory, ...others].sort(() => 0.5 - Math.random()).slice(0, 4);
    
    if (youMayLike.length > 0) {
        renderProductGridSection(relatedContainer, "Você também pode gostar", youMayLike);
    }
}

function renderProductGridSection(container, title, items) {
    const section = document.createElement('div');
    section.className = "mt-12 border-t border-gray-100 pt-8";
    
    section.innerHTML = `
        <h3 class="serif text-2xl md:text-3xl font-light text-center mb-8 text-gray-800">${title}</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <!-- Grid Items -->
        </div>
    `;
    
    const grid = section.querySelector('.grid');
    
    items.forEach(peca => {
        const card = criarCardProduto(peca, '#colecao');
        grid.appendChild(card);
    });
    
    container.appendChild(section);
}

function renderProductCarousel(container, title, items, uniqueId) {
    const section = document.createElement('div');
    section.className = "mt-12 border-t border-gray-100 pt-8";
    
    section.innerHTML = `
        <h3 class="serif text-2xl md:text-3xl font-light text-center mb-8 text-gray-800">${title}</h3>
        <div id="splide-${uniqueId}" class="splide">
            <div class="splide__track">
                <ul class="splide__list"></ul>
            </div>
        </div>
    `;
    
    container.appendChild(section);
    
    const list = section.querySelector('.splide__list');
    
    items.forEach(peca => {
        const slide = document.createElement('li');
        slide.className = 'splide__slide';
        const card = criarCardProduto(peca, '#colecao'); 
        slide.appendChild(card);
        list.appendChild(slide);
    });
    
    new Splide(`#splide-${uniqueId}`, {
        type: 'slide', perPage: 4, perMove: 1, gap: '20px', pagination: false, arrows: true,
        breakpoints: { 1024: { perPage: 3 }, 768: { perPage: 2 }, 640: { perPage: 1, gap: '15px', padding: '20px' } }
    }).mount();
}

// --- Favoritos ---

async function toggleFavorite(productId) {
    if (!currentUser) {
        alert("Faça login para adicionar aos favoritos.");
        window.location.href = "minha-conta.html";
        return;
    }
    
    const btn = document.getElementById('btn-favorite');
    const icon = btn.querySelector('i');
    const userRef = db.collection('usuarios').doc(currentUser.uid);
    
    try {
        const doc = await userRef.get();
        let favs = doc.data()?.favoritos || [];
        
        if (favs.includes(productId)) {
            await userRef.update({ favoritos: firebase.firestore.FieldValue.arrayRemove(productId) });
            icon.className = "fa-regular fa-heart";
            btn.classList.remove('text-red-500'); btn.classList.add('text-gray-300');
        } else {
            await userRef.set({ favoritos: firebase.firestore.FieldValue.arrayUnion(productId) }, { merge: true });
            icon.className = "fa-solid fa-heart";
            btn.classList.remove('text-gray-300'); btn.classList.add('text-red-500');
        }
    } catch (e) { console.error("Erro fav:", e); }
}

async function checkFavoriteStatus(productId) {
    if (!currentUser || !productId) return;
    const btn = document.getElementById('btn-favorite');
    if(!btn) return;
    const icon = btn.querySelector('i');

    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const favs = doc.data()?.favoritos || [];
        
        if (favs.includes(productId)) {
            icon.className = "fa-solid fa-heart";
            btn.classList.remove('text-gray-300'); btn.classList.add('text-red-500');
        } else {
            icon.className = "fa-regular fa-heart";
            btn.classList.remove('text-red-500'); btn.classList.add('text-gray-300');
        }
    } catch (e) {}
}

function setupSplideCarousel() {
    if (splideMain) splideMain.destroy();
    if (splideThumbnails) splideThumbnails.destroy();

    const mainList = document.getElementById('main-carousel-list');
    const thumbList = document.getElementById('thumbnail-carousel-list');
    mainList.innerHTML = '';
    thumbList.innerHTML = '';

    const images = currentProduct.imagens.length > 0 ? currentProduct.imagens : ['https://placehold.co/600x800/eee/ccc?text=Sem+imagem'];

    images.forEach((img, index) => {
        const mainSlide = document.createElement('li');
        mainSlide.className = 'splide__slide flex items-center justify-center bg-gray-50 h-[50vh] md:h-[60vh]'; // Altura ajustada
        mainSlide.innerHTML = `<img src="${img}" alt="${currentProduct.nome}" class="w-auto h-full max-w-full object-contain block">`;
        mainList.appendChild(mainSlide);

        const thumbSlide = document.createElement('li');
        thumbSlide.className = 'splide__slide thumbnail-slide opacity-60';
        thumbSlide.innerHTML = `<img src="${img}" alt="Thumb" class="w-full h-full object-cover rounded cursor-pointer">`;
        thumbList.appendChild(thumbSlide);
    });

    splideMain = new Splide('#main-carousel', {
        type: 'fade', rewind: true, pagination: false, arrows: true, width: '100%', height: 'auto'
    });

    splideThumbnails = new Splide('#thumbnail-carousel', {
        fixedWidth: 80, fixedHeight: 80, gap: 10, rewind: true, pagination: false, isNavigation: true, arrows: false
    });

    splideMain.sync(splideThumbnails);
    splideMain.mount();
    splideThumbnails.mount();
}

function renderColors() {
    const container = document.querySelector('.color-selector-container');
    if (container) container.remove();

    const coresValidas = currentProduct.cores.filter(c => c.quantidade > 0);
    if (coresValidas.length === 0) return;

    const html = `
        <div class="color-selector-container mb-6">
            <p class="text-sm font-medium mb-2 text-gray-700">Selecione a cor:</p>
            <div class="flex gap-3 flex-wrap">
                ${coresValidas.map((cor, idx) => `
                    <div class="color-option border border-gray-200 rounded p-2 cursor-pointer hover:border-[--cor-ouro-acento] flex items-center gap-2 transition-all" 
                         data-idx="${currentProduct.cores.indexOf(cor)}">
                        <div class="w-6 h-6 rounded-full border border-gray-300" style="background-color:${cor.hex}"></div>
                        <span class="text-sm font-medium">${cor.nome}</span>
                    </div>
                `).join('')}
            </div>
            <p id="selected-color-display" class="text-green-700 text-sm mt-2 hidden font-medium"></p>
        </div>
    `;
    
    const sizeSelector = document.querySelector('.size-selector');
    if(sizeSelector && sizeSelector.parentElement) {
        sizeSelector.parentElement.insertAdjacentHTML('afterend', html);
    }

    document.querySelectorAll('.color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(b => {
                b.classList.remove('border-[--cor-ouro-acento]', 'bg-amber-50');
                b.classList.add('border-gray-200');
            });
            btn.classList.remove('border-gray-200');
            btn.classList.add('border-[--cor-ouro-acento]', 'bg-amber-50');
            
            const idx = parseInt(btn.dataset.idx);
            selectedColor = idx;
            
            const cor = currentProduct.cores[idx];
            const display = document.getElementById('selected-color-display');
            display.textContent = `Cor selecionada: ${cor.nome}`;
            display.classList.remove('hidden');
            
            updateAddToCartButton();
        });
    });
    
    const firstOption = document.querySelector('.color-option');
    if(firstOption) firstOption.click();
}

// --- CARRINHO E PAGAMENTO ---

function selectSize(el) {
    document.querySelectorAll('.size-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    selectedSize = el.dataset.size;
    
    if(elements.selectedSizeDisplay) {
        elements.selectedSizeDisplay.textContent = `Tamanho selecionado: ${selectedSize}`;
        elements.selectedSizeDisplay.classList.remove('hidden');
    }
    updateAddToCartButton();
}

function updateAddToCartButton() {
    const btn = elements.addToCartBtn;
    if(!btn) return;
    const temCor = currentProduct.cores && currentProduct.cores.length > 0;
    const corOk = !temCor || selectedColor !== null;
    if (selectedSize && corOk) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.textContent = "ADICIONAR À ENCOMENDA";
    } else {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.textContent = "SELECIONE OPÇÕES";
    }
}

function addToCart() {
    if (!currentProduct) return;
    if(!selectedSize) { alert("Por favor, selecione um tamanho."); return; }
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    if (currentProduct.cores.length > 0 && !corObj) { alert("Por favor, selecione uma cor."); return; }
    
    const precoFinal = currentProduct.preco * (1 - currentProduct.desconto/100);
    const cartId = `${currentProduct.id}-${selectedSize}-${corObj ? corObj.nome : 'unico'}-${Date.now()}`;
    
    const existing = cart.find(i => i.id === currentProduct.id && i.tamanho === selectedSize && ((!i.cor && !corObj) || (i.cor && corObj && i.cor.nome === corObj.nome)));

    if (existing) {
        if (corObj && existing.quantity >= corObj.quantidade) { alert("Limite de estoque atingido."); return; }
        existing.quantity++;
    } else {
        cart.push({ cartId: cartId, id: currentProduct.id, nome: currentProduct.nome, preco: precoFinal, imagem: currentProduct.imagens[0], tamanho: selectedSize, cor: corObj, quantity: 1 });
    }
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
    if(elements.addToCartFeedbackEl) { elements.addToCartFeedbackEl.textContent = "Adicionado à encomenda!"; setTimeout(() => elements.addToCartFeedbackEl.textContent = "", 2000); }
    openCart();
}

function updateCartUI() {
    const container = elements.cartItemsContainer;
    const badge = elements.cartCountBadge;
    const subtotalEl = elements.cartSubtotalEl;
    const emptyMsg = elements.cartEmptyMsg;
    if (!container || !badge || !subtotalEl) return;
    container.innerHTML = ''; 
    let total = 0; let count = 0;
    if (cart.length === 0) { emptyMsg.classList.remove('hidden'); badge.style.display = 'none'; subtotalEl.textContent = 'R$ 0,00'; return; }
    emptyMsg.classList.add('hidden');
    cart.forEach(item => {
        total += item.preco * item.quantity; count += item.quantity;
        const div = document.createElement('div');
        div.className = "flex gap-4 mb-4 border-b pb-4";
        div.innerHTML = `<img src="${item.imagem}" class="w-20 h-24 object-cover rounded"><div class="flex-grow"><h4 class="font-semibold text-sm">${item.nome}</h4><p class="text-xs text-gray-500">Tam: ${item.tamanho} ${item.cor ? `| ${item.cor.nome}` : ''}</p><p class="text-sm font-bold text-[--cor-marrom-cta] mt-1">${formatarReal(item.preco)}</p><div class="flex justify-between items-center mt-2"><div class="flex items-center border rounded bg-gray-50"><button class="px-2 py-1 hover:bg-gray-200" data-action="dec" data-id="${item.cartId}">-</button><span class="px-2 text-sm">${item.quantity}</span><button class="px-2 py-1 hover:bg-gray-200" data-action="inc" data-id="${item.cartId}">+</button></div><button class="text-xs text-red-500 underline" data-action="remove" data-id="${item.cartId}">Remover</button></div></div>`;
        container.appendChild(div);
    });
    subtotalEl.textContent = formatarReal(total); badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none';
}

function handleCartItemClick(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const action = btn.dataset.action; const id = btn.dataset.id; if (!action || !id) return;
    const item = cart.find(i => i.cartId === id);
    if (action === 'remove') cart = cart.filter(i => i.cartId !== id);
    else if (item) {
        if (action === 'inc') { if (item.cor && item.quantity >= item.cor.quantidade) { alert('Limite de estoque atingido.'); return; } item.quantity++; }
        else if (action === 'dec') { item.quantity--; if (item.quantity <= 0) cart = cart.filter(i => i.cartId !== id); }
    }
    localStorage.setItem('lamedCart', JSON.stringify(cart)); updateCartUI();
}

function openCart() { if(elements.cartOverlay) elements.cartOverlay.classList.add('visivel'); if(elements.cartDrawer) elements.cartDrawer.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeCart() { if(elements.cartDrawer) elements.cartDrawer.classList.remove('open'); if(elements.cartOverlay) elements.cartOverlay.classList.remove('visivel'); document.body.style.overflow = ''; }
function openCheckoutModal() { if (cart.length === 0) { alert("Sua sacola está vazia."); return; } updateCheckoutSummary(); elements.checkoutModal.classList.add('active'); closeCart(); }
function closeCheckoutModal() { elements.checkoutModal.classList.remove('active'); }
function updateCheckoutSummary() {
    const summary = elements.checkoutSummary; if(!summary) return;
    summary.innerHTML = ''; let total = 0;
    cart.forEach(item => {
        const sub = item.preco * item.quantity; total += sub;
        summary.innerHTML += `<div class="flex justify-between text-sm mb-2 border-b border-dashed pb-2"><div><span class="font-medium">${item.quantity}x ${item.nome}</span><br><span class="text-xs text-gray-500">${item.tamanho} ${item.cor ? item.cor.nome : ''}</span></div><span>${formatarReal(sub)}</span></div>`;
    });
    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value;
    let finalTotal = total; let msg = "";
    if (pagamento === 'PIX') { const desc = total * 0.05; finalTotal -= desc; msg = `<div class="text-green-600 text-sm flex justify-between mt-2"><span>Desconto PIX (5%):</span> <span>-${formatarReal(desc)}</span></div>`; }
    elements.checkoutTotal.innerHTML = `${msg}<div class="flex justify-between mt-2 pt-2 border-t border-gray-300"><span>Total:</span><span>${formatarReal(finalTotal)}</span></div>`;
}
function setupPaymentOptions() {
    const radios = document.querySelectorAll('input[name="pagamento"]');
    radios.forEach(r => { r.addEventListener('change', () => { document.querySelectorAll('.payment-label').forEach(l => l.classList.remove('border-[--cor-ouro-acento]', 'bg-amber-50')); if (r.checked) r.nextElementSibling.classList.add('border-[--cor-ouro-acento]', 'bg-amber-50'); const container = document.getElementById('parcelamento-container'); if (r.value === 'Cartão de Crédito') { container.classList.remove('hidden'); preencherParcelas(); } else { container.classList.add('hidden'); } updateCheckoutSummary(); }); });
}
function preencherParcelas() {
    const total = cart.reduce((s, i) => s + i.preco*i.quantity, 0); const select = document.getElementById('parcelas-select'); if(!select) return;
    select.innerHTML = ''; const opts = calcularParcelas(total);
    opts.forEach(p => { const opt = document.createElement('option'); opt.value = p.parcelas; opt.text = `${p.parcelas}x de ${formatarReal(p.valorParcela)} ${p.temJuros ? '(c/ juros)' : '(sem juros)'}`; select.appendChild(opt); });
}
async function finalizarPedido(formData) {
    let valid = true; const required = ['nome', 'telefone', 'email', 'rua', 'numero', 'cep', 'cidade', 'pagamento'];
    required.forEach(f => { if(!formData.get(f)) valid = false; });
    if (!valid) { alert("Por favor, preencha todos os campos obrigatórios."); return; }
    const cliente = { nome: formData.get('nome'), telefone: formData.get('telefone'), email: formData.get('email'), endereco: { rua: formData.get('rua'), numero: formData.get('numero'), cep: formData.get('cep'), cidade: formData.get('cidade') } };
    const pagamento = formData.get('pagamento');
    const totalTexto = elements.checkoutTotal.innerText.split('Total:')[1] || elements.checkoutTotal.innerText; 
    let total = parseFloat(totalTexto.replace(/[^\d,]/g, '').replace(',', '.'));
    let parcelas = 1; if (pagamento === 'Cartão de Crédito') parcelas = document.getElementById('parcelas-select').value;
    const pedido = { cliente, pagamento, parcelas, produtos: cart, total, data: firebase.firestore.FieldValue.serverTimestamp(), status: 'pendente', userId: auth.currentUser ? auth.currentUser.uid : null };
    try {
        const ref = await db.collection('pedidos').add(pedido);
        const msg = `🛍️ *NOVO PEDIDO #${ref.id.slice(0,6).toUpperCase()}*\n\n*Cliente:* ${cliente.nome}\n*Pagamento:* ${pagamento} ${pagamento === 'Cartão de Crédito' ? `(${parcelas}x)` : ''}\n*Total:* ${formatarReal(total)}\n\n*Itens:*\n${cart.map(i => `• ${i.quantity}x ${i.nome} (${i.tamanho}${i.cor ? ' '+i.cor.nome : ''})`).join('\n')}`;
        const url = `https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`;
        cart = []; localStorage.setItem('lamedCart', JSON.stringify(cart)); updateCartUI(); closeCheckoutModal(); window.open(url, '_blank');
    } catch (e) { console.error("Erro pedido:", e); alert("Erro ao processar. Tente novamente."); }
}
function formatarReal(val) { return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function calcularParcelas(v) { let arr = []; arr.push({parcelas:1, valorParcela: v, temJuros: false}); arr.push({parcelas:2, valorParcela: v/2, temJuros: false}); for(let i=3; i<=12; i++) { let comJuros = v * (1 + TAXA_JUROS); arr.push({parcelas:i, valorParcela: comJuros/i, temJuros: true}); } return arr; }
function toggleAccordion(e) { const content = e.currentTarget.nextElementSibling; const icon = e.currentTarget.querySelector('.accordion-icon'); content.classList.toggle('hidden'); icon.classList.toggle('rotate'); icon.textContent = content.classList.contains('hidden') ? '+' : '−'; }
function initScrollObserver() {
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.scroll-animate').forEach(el => observer.observe(el));
    }
}
function registrarVisita(url) { if(!db) return; db.collection('visitas').add({ url, data: firebase.firestore.FieldValue.serverTimestamp(), ua: navigator.userAgent }).catch(e => console.log("Analytics off")); }

document.addEventListener('DOMContentLoaded', init);