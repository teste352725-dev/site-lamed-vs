// Configurações e Init do Firebase
const appFirebaseConfig = {
    apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U",
    authDomain: "site-lamed.firebaseapp.com",
    databaseURL: "https://site-lamed-default-rtdb.firebaseio.com",
    projectId: "site-lamed",
    storageBucket: "site-lamed.firebasestorage.app",
    messagingSenderId: "862756160215",
    appId: "1:862756160215:web:d0fded233682bf93eaa692",
    measurementId: "G-BL1G961PGT"
};

let app;
try { 
    app = firebase.app(); 
} catch (e) { 
    app = firebase.initializeApp(appFirebaseConfig); 
}

const db = firebase.firestore();
const auth = firebase.auth();

// --- GOOGLE ANALYTICS EVENTS ---
function trackEvent(eventName, params = {}) {
    if (typeof gtag === "function") {
        gtag("event", eventName, params);
    }
}

// Variáveis Globais
let products = [];
let activeCollections = []; 
let cart = [];
let currentProduct = null;
let selectedSize = null;
let selectedColor = null;
let comboSelections = {};
let currentUser = null;
const TAXA_JUROS = 0.0549;

// Controle Carrossel
let mainSplideInstance = null;
let thumbSplideInstance = null;

// Elementos DOM
const elements = {
    // Sidebar
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebarMenu: document.getElementById('sidebar-menu'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    closeSidebarBtn: document.getElementById('close-sidebar'),
    sidebarUserArea: document.getElementById('sidebar-user-area'),
    sidebarCollectionsToggle: document.getElementById('sidebar-collections-toggle'),
    sidebarSubmenu: document.getElementById('sidebar-submenu'),
    sidebarArrow: document.getElementById('sidebar-arrow'),

    // Carrinho
    cartOverlay: document.getElementById('cart-overlay'),
    cartDrawer: document.getElementById('cart-drawer'),
    cartButton: document.getElementById('cart-btn'),
    closeCartButton: document.getElementById('close-cart-btn'),
    cartItemsContainer: document.getElementById('cart-items-container'),
    cartEmptyMsg: document.getElementById('cart-empty-msg'),
    cartSubtotalEl: document.getElementById('cart-subtotal'),
    cartCountBadge: document.getElementById('cart-count'),
    addToCartBtn: document.getElementById('add-to-cart-button'),
    selectedSizeDisplay: document.getElementById('selected-size-display'),
    menuButton: document.getElementById('menu-button'),
    mobileMenu: document.getElementById('mobile-menu'),
    
    // Checkout
    finalizarPedidoBtn: document.getElementById('finalizar-pedido-btn'),
    checkoutModal: document.getElementById('checkout-modal'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutSummary: document.getElementById('checkout-summary'),
    checkoutTotal: document.getElementById('checkout-total'),
    checkoutCepInput: document.getElementById('checkout-cep'),

    // Páginas
    collectionsContainer: document.getElementById('collections-container'),
    favoriteBtn: document.getElementById('btn-favorite'),
    userIconLink: document.getElementById('header-user-icon-link'),
    
    // Auth Modal
    authPromptModal: document.getElementById('auth-prompt-modal'),
    closeAuthPromptBtn: document.getElementById('close-auth-prompt'),
    dismissAuthPromptBtn: document.getElementById('auth-prompt-dismiss')
};

// --- INIT ---
function init() {
    console.log('Inicializando...');
    
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        atualizarInterfaceUsuario(user);
        if(currentUser && currentProduct) checkFavoriteStatus(currentProduct.id);
        checkAuthPrompt(user);
    });

    validarELimparCarrinho();
    updateCartUI(); 
    carregarDadosLoja(); 
    setupEventListeners();

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.scroll-animate').forEach((el) => observer.observe(el));
}

// --- SETUP EVENT LISTENERS (Restaurada) ---
function setupEventListeners() {
    window.addEventListener('hashchange', handleRouting);
    
    // Sidebar Toggles
    if (elements.sidebarToggle) elements.sidebarToggle.addEventListener('click', toggleSidebar);
    if (elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', toggleSidebar);
    if (elements.sidebarOverlay) elements.sidebarOverlay.addEventListener('click', toggleSidebar);
    if (elements.sidebarCollectionsToggle) elements.sidebarCollectionsToggle.addEventListener('click', toggleSidebarCollections);

    // Links da Sidebar para fechar ao clicar
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', toggleSidebar);
    });

    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => { window.history.back(); });
    
    if (elements.cartButton) elements.cartButton.addEventListener('click', openCart);
    if (elements.closeCartButton) elements.closeCartButton.addEventListener('click', closeCart);
    if (elements.cartOverlay) elements.cartOverlay.addEventListener('click', closeCart);
    
    if (elements.finalizarPedidoBtn) elements.finalizarPedidoBtn.addEventListener('click', openCheckoutModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeCheckoutModal));
    if (elements.checkoutForm) elements.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); finalizarPedido(new FormData(elements.checkoutForm)); });
    
    // Delegação de eventos para opções dinâmicas
    document.body.addEventListener('click', (e) => {
        if(e.target.classList.contains('size-option')) selectSize(e.target);
    });

    if (elements.addToCartBtn) elements.addToCartBtn.addEventListener('click', addToCart);
    if (elements.cartItemsContainer) elements.cartItemsContainer.addEventListener('click', handleCartItemClick);
    if (elements.favoriteBtn) elements.favoriteBtn.addEventListener('click', toggleFavorite);
    
    document.querySelectorAll('.accordion-toggle').forEach(btn => { btn.addEventListener('click', toggleAccordion); });
    
    if (elements.closeAuthPromptBtn) elements.closeAuthPromptBtn.addEventListener('click', () => {
        elements.authPromptModal.classList.add('hidden');
        elements.authPromptModal.classList.remove('flex');
    });
    if (elements.dismissAuthPromptBtn) elements.dismissAuthPromptBtn.addEventListener('click', () => {
        elements.authPromptModal.classList.add('hidden');
        elements.authPromptModal.classList.remove('flex');
    });

    if(elements.checkoutCepInput) {
        elements.checkoutCepInput.addEventListener('blur', updateCheckoutSummary);
    }
    
    setupPaymentOptions();
}

// --- UTILITÁRIOS ---
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function isSudeste(cep) {
    if (!cep) return false;
    const cepClean = cep.replace(/\D/g, '');
    if (cepClean.length !== 8) return false;
    const prefix = parseInt(cepClean.substring(0, 2)); 
    return (prefix >= 1 && prefix <= 39);
}

function isHanukahProduct(item) {
    if (!item || !item.nome) return false;
    const term = item.nome.toLowerCase();
    return term.includes('hanukah') || term.includes('chanukiá') || term.includes('chanuká') || term.includes('judaica');
}

function checkIsMesaPosta(categoria) {
    const catsMesa = ['mesa_posta', 'lugar_americano', 'guardanapo', 'caminho_mesa', 'porta_guardanapo'];
    return catsMesa.includes(categoria);
}

function checkAuthPrompt(user) {
    if (user) {
        if (elements.authPromptModal) elements.authPromptModal.classList.add('hidden');
        if (elements.authPromptModal) elements.authPromptModal.classList.remove('flex');
        return;
    }
    const promptShown = sessionStorage.getItem('authPromptShown');
    if (!promptShown && elements.authPromptModal) {
        setTimeout(() => {
            if (!auth.currentUser) {
                elements.authPromptModal.classList.remove('hidden');
                elements.authPromptModal.classList.add('flex');
                sessionStorage.setItem('authPromptShown', 'true');
            }
        }, 8000);
    }
}

// --- SIDEBAR NAVIGATION ---
function toggleSidebar() {
    const isOpen = elements.sidebarMenu.classList.contains('open');
    const overlay = elements.sidebarOverlay;
    
    if(isOpen) {
        // Fechar
        elements.sidebarMenu.classList.remove('open');
        elements.sidebarMenu.classList.add('-translate-x-full'); 
        elements.sidebarMenu.classList.remove('translate-x-0'); 
        
        // Remove classe visual para fade out e espera transição para esconder
        if(overlay) {
            overlay.classList.remove('visivel');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    } else {
        // Abrir
        elements.sidebarMenu.classList.add('open');
        elements.sidebarMenu.classList.remove('-translate-x-full');
        elements.sidebarMenu.classList.add('translate-x-0');
        
        // Remove hidden para renderizar, depois adiciona visivel para fade in
        if(overlay) {
            overlay.classList.remove('hidden');
            requestAnimationFrame(() => overlay.classList.add('visivel'));
        }
    }
}

function toggleSidebarCollections() {
    elements.sidebarSubmenu.classList.toggle('hidden');
    elements.sidebarArrow.classList.toggle('rotate-180');
}

// --- ATUALIZAÇÃO DO USUÁRIO ---
async function atualizarInterfaceUsuario(user) {
    const sidebarUserArea = elements.sidebarUserArea;
    if (!sidebarUserArea) return;

    if (user) {
        let photoURL = user.photoURL;
        let displayName = user.displayName || 'Cliente';
        
        if (!photoURL) {
            try {
                const doc = await db.collection('usuarios').doc(user.uid).get();
                if (doc.exists) {
                    const d = doc.data();
                    if(d.fotoUrl) photoURL = d.fotoUrl;
                    if(d.nome) displayName = d.nome;
                }
            } catch(e) {}
        }
        if (!photoURL) photoURL = `https://ui-avatars.com/api/?name=${displayName}&background=A58A5C&color=fff`;
        
        sidebarUserArea.innerHTML = `
            <img src="${photoURL}" class="w-10 h-10 rounded-full border border-[#45301F] object-cover">
            <div class="flex flex-col">
                <span class="text-xs text-gray-400 uppercase tracking-widest">Olá,</span>
                <span class="font-serif text-lg text-[#45301F] leading-none">${displayName.split(' ')[0]}</span>
            </div>
        `;
    } else {
        sidebarUserArea.innerHTML = `
            <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-400">
                <i class="fa-regular fa-user"></i>
            </div>
            <div class="flex flex-col">
                <span class="text-xs text-gray-400 uppercase tracking-widest">Bem-vindo</span>
                <a href="minha-conta.html" class="font-bold text-[#A58A5C] text-sm hover:underline">Entrar / Cadastrar</a>
            </div>
        `;
    }
}

// --- ROTEAMENTO ---
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

    // --- GA4 PAGE VIEW (SPA) ---
    trackEvent("page_view", {
        page_location: window.location.href,
        page_path: window.location.hash || "/"
    });
}

// --- CARREGAMENTO DE DADOS ---
async function carregarDadosLoja() {
    try {
        const colecoesSnap = await db.collection("colecoes").where("ativa", "==", true).get();
        activeCollections = colecoesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.ordem||0) - (b.ordem||0));
        
        const produtosSnap = await db.collection("pecas").where("status", "==", "active").get();
        products = produtosSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), preco: parseFloat(doc.data().preco || 0) }));
        
        renderizarSecoesColecoes(); 
        popularPreviewColecao();    
        
        // Garante que a rota correta seja carregada após ter os dados
        handleRouting();
    } catch (err) { console.error("Erro dados:", err); }
}

function renderizarSecoesColecoes() {
    const container = elements.collectionsContainer;
    if (!container) return;
    container.innerHTML = ''; 
    if (activeCollections.length === 0) return;

    activeCollections.forEach((colecao, index) => {
        const prods = products.filter(p => p.colecaoId === colecao.id);
        if (prods.length === 0) return; 

        const section = document.createElement('section');
        section.className = "py-16 px-4 border-b border-[#E5E0D8] last:border-0";
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
            new Splide(`#${splideId}`, { 
                type: 'slide', perPage: 4, gap: '20px', pagination: false, arrows: true, 
                breakpoints: { 1024: { perPage: 3 }, 768: { perPage: 2 }, 640: { perPage: 1, padding: '20px' } } 
            }).mount();
        }
    });
}

function popularPreviewColecao() {
    const list = document.getElementById('home-splide-list');
    if (!list) return;
    const lancamentos = [...products].sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0)).slice(0, 6);
    
    list.innerHTML = '';
    if (lancamentos.length === 0) {
        list.innerHTML = '<li class="w-full text-center text-gray-400 py-8">Nenhum lançamento no momento.</li>';
        return;
    }

    lancamentos.forEach(peca => {
        const slide = document.createElement('li');
        slide.className = 'splide__slide';
        slide.appendChild(criarCardProduto(peca));
        list.appendChild(slide);
    });
    new Splide('#home-splide', { type: 'slide', perPage: 4, gap: '20px', pagination: false, breakpoints: { 640: { perPage: 1, padding: '40px' }, 1024: { perPage: 3 } } }).mount();
}

function renderizarListaDeColecoes() {
    const grid = document.getElementById('collections-list-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (activeCollections.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-20">Nenhuma coleção ativa no momento.</p>';
        return;
    }
    activeCollections.forEach(col => {
        const count = products.filter(p => p.colecaoId === col.id).length;
        const img = col.imagemDestaque || 'https://placehold.co/600x400/eee/ccc?text=Sem+Imagem';
        const card = document.createElement('div');
        card.className = "group cursor-pointer";
        card.innerHTML = `
            <div class="relative overflow-hidden aspect-[4/3] mb-4 bg-gray-100">
                <img src="${img}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105">
                <div class="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors"></div>
                <div class="absolute bottom-6 left-6 text-white">
                    <h3 class="serif text-3xl mb-1">${col.nome}</h3>
                    <p class="text-xs uppercase tracking-widest opacity-90">${count} Peças</p>
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
    if (prods.length === 0) { grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peça.</p>'; return; }
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
        'lugar_americano': 'Lugares Americanos',
        'vestido': 'Vestidos',
        'calca': 'Calças',
        'camisa': 'Camisas',
        'conjunto': 'Conjuntos'
    };

    if (title) title.textContent = nomesCategorias[catSlug] || catSlug.toUpperCase();

    const prods = products.filter(p => {
        if (catSlug === 'combo') {
            // Filtro específico: Produto é tipo Combo E é da categoria Mesa Posta (ou subcategorias)
            return p.tipo === 'combo' && checkIsMesaPosta(p.categoria);
        }
        // Para categorias normais, mostra tudo que pertence àquela categoria
        // (Isso inclui combos de roupas na categoria 'conjunto' ou 'vestido' se assim forem cadastrados)
        return p.categoria === catSlug;
    });

    if (prods.length === 0) { 
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peça encontrada nesta categoria.</p>'; 
        return; 
    }
    
    prods.forEach(peca => grid.appendChild(criarCardProduto(peca)));
}

function criarCardProduto(peca) {
    const card = document.createElement('div');
    card.className = "h-full bg-[#FDFBF6] group cursor-pointer flex flex-col";
    const precoFinal = peca.preco * (1 - (peca.desconto || 0)/100);
    const imgPrincipal = peca.imagens[0];
    const imgHover = peca.imagens[1] || peca.imagens[0];
    
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

    const isMesa = checkIsMesaPosta(peca.categoria);
    const catLabel = isMesa ? 'Mesa Posta' : (peca.tipo === 'combo' ? 'Monte seu Combo' : (peca.categoria || 'Coleção'));

    card.innerHTML = `
        <div class="aspect-[3/4] relative overflow-hidden bg-gray-100 mb-3 rounded-sm card-img-wrapper">
             <img src="${imgPrincipal}" class="card-img-main w-full h-full object-cover">
             <img src="${imgHover}" class="card-img-hover w-full h-full object-cover">
             ${badge}
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

    // --- GA4 VIEW ITEM ---
    trackEvent("view_item", {
        item_id: currentProduct.id,
        item_name: currentProduct.nome,
        item_category: currentProduct.categoria,
        price: currentProduct.preco
    });
    
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
    
...