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
    // Limpeza campo customizável
    const customInputContainer = document.getElementById('custom-input-container');
    if (customInputContainer) customInputContainer.remove();

    if (isCombo) {
        if(sizeSection) sizeSection.classList.add('hidden');
        renderComboSelectors(); // Nova Interface de Combo
    } else if (isMesaPosta) {
        if(sizeSection) {
            sizeSection.classList.remove('hidden'); 
            sizeSection.querySelector('.size-selector')?.classList.add('hidden');
            sizeSection.querySelector('.flex.justify-between')?.classList.add('hidden');
        }
        selectedSize = 'Único';
        renderColors();
        const warningDiv = document.createElement('div');
        warningDiv.id = 'mesa-posta-warning';
        warningDiv.className = 'bg-orange-50 border border-orange-100 text-[#643f21] text-xs p-3 rounded mb-4 mt-2 flex gap-2 items-start';
        warningDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation mt-0.5 text-[#A58A5C]"></i><span><strong>Atenção:</strong> Valor referente a <strong>1 unidade</strong> (peça avulsa).</span>`;
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

    // --- Lógica de Personalização (Nova) ---
    // Verifica se o nome contém "letra" ou "personaliz"
    const nomeLower = currentProduct.nome.toLowerCase();
    const needsCustomization = nomeLower.includes('letra') || nomeLower.includes('personaliz');
    
    if (needsCustomization) {
        const customDiv = document.createElement('div');
        customDiv.id = 'custom-input-container';
        customDiv.className = 'mb-6 mt-4 p-4 bg-gray-50 border border-gray-200 rounded';
        customDiv.innerHTML = `
            <label class="block text-xs font-bold uppercase tracking-widest text-[--cor-texto] mb-2">
                Personalização (Qual Letra/Nome?) <span class="text-red-500">*</span>
            </label>
            <input type="text" id="product-custom-text" class="w-full border border-gray-300 p-2 rounded text-sm focus:border-[#A58A5C] focus:ring-1 focus:ring-[#A58A5C] outline-none" placeholder="Ex: Letra A, Família Silva...">
            <p class="text-[10px] text-gray-500 mt-1">Digite exatamente como deseja a personalização.</p>
        `;
        const btn = document.getElementById('add-to-cart-button');
        if(btn) btn.parentElement.insertBefore(customDiv, btn);
    }
    
    // --- LÓGICA DO GUIA DE MEDIDAS (DINÂMICO) ---
    const buttons = document.querySelectorAll('.accordion-button');
    let sizeGuideContainer = null;
    buttons.forEach(btn => {
        if(btn.textContent.includes('Guia de Medidas')) {
            sizeGuideContainer = btn.nextElementSibling;
        }
    });

    if (sizeGuideContainer) {
        // Salva o original (Roupas) se ainda não salvou
        if (!window.originalSizeGuideHTML) {
            window.originalSizeGuideHTML = sizeGuideContainer.innerHTML;
        }

        const mesaPostaGuideHTML = `
            <div class="space-y-4 text-sm text-[--cor-texto]">
                <div class="border-b pb-2">
                    <h4 class="font-bold text-[--cor-marrom-cta] flex items-center gap-2">
                        <i class="fa-solid fa-leaf"></i> Guia de Medidas – Mesa Posta
                    </h4>
                    <p class="text-xs text-gray-500 mt-1">Produção artesanal em algodão ou linho (variação 1–2 cm).</p>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">🧵 Guardanapos</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Tamanho:</strong> 41 cm x 41 cm</li>
                        <li><strong>Material:</strong> 100% algodão</li>
                        <li><em>Ideal para mesas formais e dobras.</em></li>
                    </ul>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">🟦 Lugares Americanos</h5>
                    <div class="space-y-2 text-xs">
                        <div>
                            <p class="font-bold">Modelo Padrão (44 x 32 cm)</p>
                            <p class="text-gray-500">Shabat Shalom, Muralhas de Jerusalém</p>
                        </div>
                        <div>
                            <p class="font-bold">Modelo Grande (47 x 33 cm)</p>
                            <p class="text-gray-500">Chanukiá Grande, Chanukiá Pequena</p>
                        </div>
                        <div>
                            <p class="font-bold">Modelo Frase (46 x 34 cm)</p>
                            <p class="text-gray-500">Chegou um Tempo Novo, Na Terra Como no Céu</p>
                        </div>
                    </div>
                </div>

                <div>
                    <h5 class="font-bold text-xs uppercase tracking-wider mb-1">🕯 Caminho de Mesa</h5>
                    <ul class="text-xs space-y-1">
                        <li><strong>Chanukiá Sameach:</strong> 140 cm x 33 cm</li>
                        <li><em>Ideal para mesas retangulares (4-6 lugares).</em></li>
                    </ul>
                </div>
                
                <div class="bg-gray-50 p-2 rounded text-[10px] text-gray-500">
                    <p><strong>Nota:</strong> Bordados variam (dourado, branco, ocre). Medidas pensadas para pratos de 26-32cm.</p>
                </div>
            </div>
        `;

        if (isMesaPosta) {
            sizeGuideContainer.innerHTML = mesaPostaGuideHTML;
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

// --- LÓGICA DE INTERFACE RICA PARA COMBO ---
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
                btn.className = `combo-color-btn cursor-pointer border border-gray-200 p-1.5 rounded-md flex items-center gap-2 hover:bg-gray-50 transition min-w-[100px]`;
                btn.innerHTML = `
                    <div class="w-5 h-5 rounded-full border border-gray-300 shadow-sm" style="background-color:${cor.hex}"></div>
                    <div class="flex flex-col">
                        <span class="text-xs font-medium text-gray-700">${cor.nome}</span>
                        <span class="text-[9px] text-gray-400">${cor.quantidade} un.</span>
                    </div>
                `;
                btn.onclick = () => selectComboColor(idx, cor.nome, cor.hex, btn);
                colorsGrid.appendChild(btn);
            });
            colorSection.appendChild(colorsGrid);
        } else {
            colorSection.innerHTML = `<p class="text-xs text-gray-400 italic">Cor única / Padrão</p>`;
            if (!comboSelections[idx]) comboSelections[idx] = {};
            comboSelections[idx].cor = { nome: 'Padrão', hex: '#000' };
        }
        compDiv.appendChild(colorSection);

        const isRoupa = ['vestido','conjunto','calca','camisa','saia'].includes(comp.categoria);
        
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
             comboSelections[idx].tamanho = 'Único';
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
    if (cores.length === 0) { selectedColor = null; return; }

    const div = document.createElement('div');
    div.className = 'color-selector-container mb-6';
    div.innerHTML = `<p class="text-xs font-bold uppercase tracking-widest text-[--cor-texto] mb-2">Cor</p><div class="flex gap-3 flex-wrap">${cores.map((c, i) => {
        const stockBadge = `<span class="text-[10px] text-gray-500 font-medium ml-1 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">${c.quantidade} un</span>`;
        return `<div class="color-option group relative" data-idx="${i}"><div class="w-4 h-4 rounded-full border border-gray-300 shadow-sm" style="background-color:${c.hex}"></div><span class="text-xs font-medium text-gray-700">${c.nome}</span>${stockBadge}</div>`;
    }).join('')}</div>`;
    
    const sizeSelector = document.querySelector('.size-selector');
    if (sizeSelector && sizeSelector.parentElement) sizeSelector.parentElement.after(div);
    else document.getElementById('detail-price').after(div);

    if (cores.length === 1) { selectedColor = 0; div.querySelector('.color-option').classList.add('selected'); } else { selectedColor = null; }

    div.querySelectorAll('.color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            div.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = parseInt(btn.dataset.idx);
            updateAddToCartButton();
        });
    });
}

function renderRecommendations(current) {
    const container = document.getElementById('related-products-container');
    if (!container) return;
    container.innerHTML = '';
    const suggestions = products.filter(p => p.id !== current.id).sort(() => 0.5 - Math.random()).slice(0, 4);
    if (suggestions.length > 0) {
        const title = document.createElement('h3');
        title.className = "serif text-2xl text-center mt-12 mb-6 text-[--cor-texto]";
        title.textContent = "Você também pode gostar";
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
    
    const images = currentProduct.imagens.length > 0 ? currentProduct.imagens : ['https://placehold.co/600x800/eee/ccc?text=Sem+imagem'];
    images.forEach((img) => {
        mainList.innerHTML += `<li class="splide__slide flex items-center justify-center bg-transparent h-[50vh] md:h-[60vh]"><img src="${img}" class="h-full w-auto object-contain"></li>`;
        thumbList.innerHTML += `<li class="splide__slide thumbnail-slide opacity-60"><img src="${img}" class="w-full h-full object-cover rounded cursor-pointer"></li>`;
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
    
    const stockTotal = currentProduct.cores ? currentProduct.cores.reduce((acc, c) => acc + (parseInt(c.quantidade) || 0), 0) : 0;
    
    if (stockTotal <= 0 && currentProduct.tipo !== 'combo') {
        btn.disabled = true;
        btn.textContent = "ESGOTADO";
        btn.classList.add('bg-gray-400');
        btn.classList.remove('hover:bg-[#4a2e18]');
        return;
    } else {
        btn.classList.remove('bg-gray-400');
        btn.classList.add('hover:bg-[#4a2e18]');
    }

    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    const hasSize = selectedSize !== null;
    const hasColor = !currentProduct.cores?.length || selectedColor !== null;

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
        btn.disabled = false; btn.textContent = "ADICIONAR À SACOLA";
    } else {
        btn.disabled = true; 
        btn.textContent = isCombo ? "Selecione opções de TODOS os itens" : "Selecione Opções";
        btn.classList.add('bg-gray-400');
        btn.classList.remove('hover:bg-[#4a2e18]');
    }
}

function addToCart() {
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    const tamanhoFinal = (isMesaPosta || isCombo) ? (isCombo ? 'Combo' : 'Único') : selectedSize;
    
    // Captura do input de customização
    const customInput = document.getElementById('product-custom-text');
    const customNotes = customInput ? customInput.value.trim() : null;
    
    // Validação opcional (se quiser obrigar a digitar)
    const nomeLower = currentProduct.nome.toLowerCase();
    const needsCustomization = nomeLower.includes('letra') || nomeLower.includes('personaliz');
    if (needsCustomization && (!customNotes || customNotes === '')) {
        alert("Por favor, digite a personalização desejada (Ex: Qual letra?).");
        return;
    }

    const cartId = isCombo ? `${currentProduct.id}-combo-${Date.now()}` : `${currentProduct.id}-${tamanhoFinal}-${corObj?.nome || 'unico'}-${customNotes ? customNotes.replace(/\s+/g, '-') : ''}`;
    const existing = cart.find(i => i.cartId === cartId);
    
    if (existing) existing.quantity++;
    else cart.push({ 
        cartId, 
        id: currentProduct.id, 
        nome: currentProduct.nome, 
        preco: precoFinal, 
        imagem: currentProduct.imagens[0], 
        tamanho: tamanhoFinal, 
        cor: corObj, 
        quantity: 1,
        isCombo: isCombo,
        componentes: isCombo ? currentProduct.componentes : null,
        comboSelections: isCombo ? comboSelections : null,
        customNotes: customNotes // Armazena a nota
    });
    
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI(); openCart();
}

function updateCartUI() {
    const container = elements.cartItemsContainer;
    let total = 0, count = 0;
    container.innerHTML = '';
    if (cart.length === 0) { elements.cartEmptyMsg.classList.remove('hidden'); elements.cartCountBadge.style.display = 'none'; elements.cartSubtotalEl.textContent = 'R$ 0,00'; return; }
    elements.cartEmptyMsg.classList.add('hidden');
    
    cart.forEach(item => {
        total += item.preco * item.quantity; count += item.quantity;
        
        let detailsHtml = '';
        if (item.isCombo && item.comboSelections) {
            detailsHtml = `<div class="text-[10px] text-gray-500 mt-1 pl-2 border-l-2 border-purple-200">`;
            item.componentes.forEach((comp, idx) => {
                const sel = item.comboSelections[idx];
                const cor = sel?.cor?.nome || '-';
                const tam = sel?.tamanho !== 'Único' ? `(${sel.tamanho})` : '';
                detailsHtml += `<div>${comp.quantidade}x ${comp.nome} <strong>${cor}</strong> ${tam}</div>`;
            });
            detailsHtml += `</div>`;
        } else {
            detailsHtml = `<p class="text-xs text-gray-500 mb-1">${item.tamanho} ${item.cor ? `| ${item.cor.nome}` : ''}</p>`;
        }

        // Mostra a personalização no carrinho
        if (item.customNotes) {
            detailsHtml += `<div class="text-[10px] text-[--cor-marrom-cta] font-bold mt-1 bg-yellow-50 p-1 rounded border border-yellow-100"><i class="fa-solid fa-pen-nib mr-1"></i>${item.customNotes}</div>`;
        }

        container.innerHTML += `
            <div class="flex gap-4 mb-4 border-b border-[#E5E0D8] pb-4 last:border-0">
                <img src="${item.imagem}" class="w-16 h-20 object-cover rounded-sm border border-[#E5E0D8]">
                <div class="flex-grow">
                    <h4 class="font-medium text-sm text-[--cor-texto]">${item.nome}</h4>
                    ${detailsHtml}
                    <div class="flex justify-between items-center mt-1">
                        <span class="font-semibold text-sm">${formatarReal(item.preco)}</span>
                        <div class="flex items-center border border-[#dcdcdc] rounded bg-white">
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="dec" data-id="${item.cartId}">-</button>
                            <span class="px-2 text-xs">${item.quantity}</span>
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="inc" data-id="${item.cartId}">+</button>
                        </div>
                    </div>
                </div>
            </div>`;
    });
    elements.cartSubtotalEl.textContent = formatarReal(total);
    elements.cartCountBadge.textContent = count;
    elements.cartCountBadge.style.display = 'flex';
}

function handleCartItemClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const item = cart.find(i => i.cartId === id);
    if (!item) return;
    if (action === 'inc') item.quantity++;
    if (action === 'dec') { item.quantity--; if (item.quantity <= 0) cart = cart.filter(i => i.cartId !== id); }
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
}

function openCart() { elements.cartOverlay.classList.add('visivel'); elements.cartDrawer.classList.add('open'); }
function closeCart() { elements.cartDrawer.classList.remove('open'); elements.cartOverlay.classList.remove('visivel'); }
function toggleAccordion(e) { e.currentTarget.nextElementSibling.classList.toggle('hidden'); e.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate'); }

function setupPaymentOptions() {
    document.querySelectorAll('input[name="pagamento"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('parcelamento-container').classList.toggle('hidden', r.value !== 'Cartão de Crédito');
            if(r.value === 'Cartão de Crédito') preencherParcelas();
            updateCheckoutSummary();
        });
    });
}

function preencherParcelas() {
    const total = cart.reduce((s, i) => s + i.preco*i.quantity, 0);
    const select = document.getElementById('parcelas-select');
    select.innerHTML = '';
    
    for(let i=1; i<=12; i++) { 
        let val = total;
        let suffix = '(sem juros)';
        
        if(i > 2) {
            val = total * (1 + TAXA_JUROS);
            suffix = '(c/ juros)';
        }
        
        select.innerHTML += `<option value="${i}">${i}x de ${formatarReal(val/i)} ${suffix}</option>`; 
    }
    select.addEventListener('change', updateCheckoutSummary);
}

function validarELimparCarrinho() {
    const s = localStorage.getItem('lamedCart');
    if(s) { try { let t = JSON.parse(s); cart = Array.isArray(t) ? t.filter(i=>i&&i.cartId&&i.nome&&typeof i.preco==='number') : []; } catch(e){ cart=[]; } } else cart=[];
}

async function toggleFavorite() {
    if(!currentUser) return alert("Faça login para favoritar.");
    if(!currentProduct) return;
    const icon = elements.favoriteBtn.querySelector('i');
    const isFav = icon.classList.contains('fa-solid');
    icon.className = isFav ? "fa-regular fa-heart" : "fa-solid fa-heart text-red-500";
    try {
        const ref = db.collection('usuarios').doc(currentUser.uid);
        const doc = await ref.get();
        let favs = doc.exists && doc.data().favoritos ? doc.data().favoritos : [];
        if(isFav) favs = favs.filter(id=>id!==currentProduct.id); else if(!favs.includes(currentProduct.id)) favs.push(currentProduct.id);
        await ref.set({favoritos:favs}, {merge:true});
    } catch(e){console.error(e);}
}

async function checkFavoriteStatus(pid) {
    if(!currentUser||!pid) return;
    const icon = elements.favoriteBtn?.querySelector('i');
    if(!icon) return;
    icon.className = "fa-regular fa-heart";
    try { const doc = await db.collection('usuarios').doc(currentUser.uid).get(); if(doc.data()?.favoritos?.includes(pid)) icon.className = "fa-solid fa-heart text-red-500"; } catch(e){}
}

async function openCheckoutModal() {
    if (cart.length === 0) return alert("Sua sacola está vazia.");
    updateCheckoutSummary();
    if (currentUser) {
        try {
            const doc = await db.collection('usuarios').doc(currentUser.uid).get();
            if (doc.exists) {
                const data = doc.data();
                const f = elements.checkoutForm;
                if(data.nome) f.nome.value = data.nome;
                if(data.email) f.email.value = data.email;
                if(data.telefone) f.telefone.value = data.telefone;
                if(data.endereco) { 
                    f.rua.value = data.endereco.rua || ''; 
                    f.numero.value = data.endereco.numero || ''; 
                    f.cep.value = data.endereco.cep || ''; 
                    f.cidade.value = data.endereco.cidade || ''; 
                    if (data.endereco.cep) updateCheckoutSummary();
                }
            } else { elements.checkoutForm.email.value = currentUser.email; if(currentUser.displayName) elements.checkoutForm.nome.value = currentUser.displayName; }
        } catch(e) {}
    }
    elements.checkoutModal.classList.remove('hidden'); elements.checkoutModal.classList.add('flex');
    closeCart();
}

function closeCheckoutModal() { elements.checkoutModal.classList.add('hidden'); elements.checkoutModal.classList.remove('flex'); }

function updateCheckoutSummary() {
    const summary = elements.checkoutSummary;
    summary.innerHTML = ''; let total = 0;
    let hanukahSubtotal = 0;
    
    cart.forEach(item => { 
        const itemTotal = item.preco * item.quantity;
        total += itemTotal; 
        if (isHanukahProduct(item)) hanukahSubtotal += itemTotal;

        let desc = item.nome;
        if (item.isCombo) desc += " (Combo)";
        
        // Inclui a personalização no resumo do checkout visual
        let customHtml = '';
        if (item.customNotes) {
            customHtml = `<div class="text-[10px] text-gray-500 italic ml-4">↳ Personalização: ${item.customNotes}</div>`;
        }
        
        summary.innerHTML += `<div class="flex justify-between text-sm mb-1 pb-1 border-b border-dashed border-[#dcdcdc]">
            <div><span class="font-medium text-[--cor-texto]">${item.quantity}x ${desc}</span>${customHtml}</div>
            <span>${formatarReal(itemTotal)}</span>
        </div>`; 
    });
    
    const pgto = document.querySelector('input[name="pagamento"]:checked')?.value;
    let final = total;
    
    if (pgto === 'PIX') { 
        const desc = total * 0.05; 
        final -= desc; 
        summary.innerHTML += `<div class="flex justify-between text-sm text-green-600 font-medium mt-1"><span>Desconto PIX</span><span>-${formatarReal(desc)}</span></div>`; 
    } else if (pgto === 'Cartão de Crédito') {
        const parcelas = parseInt(document.getElementById('parcelas-select').value) || 1;
        if(parcelas > 2) { 
            const taxa = total * TAXA_JUROS;
            final += taxa;
            summary.innerHTML += `<div class="flex justify-between text-sm text-gray-500 font-medium mt-1"><span>Taxa Cartão (>2x)</span><span>+${formatarReal(taxa)}</span></div>`;
        }
    }
    
    const cepInput = document.getElementById('checkout-cep');
    const cepValue = cepInput ? cepInput.value : '';
    const isSudesteRegion = isSudeste(cepValue);
    const msgBox = document.getElementById('shipping-cost-msg');
    
    if (isSudesteRegion && hanukahSubtotal >= 500) {
        summary.innerHTML += `<div class="flex justify-between text-sm text-green-700 font-bold mt-2 pt-2 border-t border-gray-200"><span>Frete (Hanukah Sudeste)</span><span>GRÁTIS</span></div>`;
        if (msgBox) msgBox.innerHTML = `<i class="fa-solid fa-gift text-green-600"></i> <span class="text-green-700 font-bold">Parabéns! Frete Grátis disponível para sua região.</span>`;
    } else {
        summary.innerHTML += `<div class="flex justify-between text-sm text-gray-500 mt-2 pt-2 border-t border-gray-200"><span>Frete</span><span class="text-xs">A calcular (WhatsApp)</span></div>`;
        if (msgBox) msgBox.innerHTML = `<i class="fa-solid fa-truck-fast"></i> O frete é calculado e pago diretamente no WhatsApp.`;
    }

    elements.checkoutTotal.textContent = formatarReal(final);
}

async function finalizarPedido(formData) {
    const cliente = { nome: formData.get('nome'), telefone: formData.get('telefone'), email: formData.get('email'), endereco: { rua: formData.get('rua'), numero: formData.get('numero'), cep: formData.get('cep'), cidade: formData.get('cidade') } };
    if(currentUser) db.collection('usuarios').doc(currentUser.uid).set({ nome: cliente.nome, telefone: cliente.telefone, endereco: cliente.endereco }, { merge: true });
    
    const pedido = { 
        cliente, 
        pagamento: formData.get('pagamento'), 
        parcelas: formData.get('pagamento') === 'Cartão de Crédito' ? document.getElementById('parcelas-select').value : 1, 
        produtos: cart, 
        total: parseFloat(elements.checkoutTotal.textContent.replace(/[^\d,]/g,'').replace(',','.')), 
        data: firebase.firestore.FieldValue.serverTimestamp(), 
        status: 'pendente', 
        userId: currentUser ? currentUser.uid : null,
        estoque_baixado: false 
    };

    try {
        const ref = await db.collection('pedidos').add(pedido);
        
        let msg = `*Novo Pedido #${ref.id.slice(0,6).toUpperCase()}*\n`;
        msg += `*Cliente:* ${cliente.nome}\n`;
        msg += `*Pagamento:* ${pedido.pagamento}`;
        if (pedido.pagamento === 'Cartão de Crédito') msg += ` (${pedido.parcelas}x)`;
        msg += `\n\n*Itens do Pedido:*\n`;
        
        cart.forEach(item => {
            msg += `------------------------------\n`;
            msg += `• *${item.quantity}x ${item.nome}*\n`;
            
            if (item.isCombo && item.comboSelections) {
                msg += `  _Combo Personalizado:_\n`;
                item.componentes.forEach((comp, idx) => {
                    const sel = item.comboSelections[idx];
                    const cor = sel?.cor?.nome || 'Padrão';
                    const tam = sel?.tamanho !== 'Único' ? `(${sel.tamanho})` : '';
                    msg += `  - ${comp.quantidade}x ${comp.nome} [${cor} ${tam}]\n`;
                });
            } else {
                const tam = item.tamanho && item.tamanho !== 'Único' ? `Tam: ${item.tamanho}` : '';
                const cor = item.cor ? `Cor: ${item.cor.nome}` : '';
                const details = [tam, cor].filter(Boolean).join(' | ');
                if (details) msg += `  (${details})\n`;
            }
            
            // Adiciona a nota de personalização na mensagem do WhatsApp
            if (item.customNotes) {
                msg += `  ✍️ *Personalização:* ${item.customNotes}\n`;
            }

            msg += `  Valor: ${formatarReal(item.preco * item.quantity)}\n`;
        });
        
        msg += `------------------------------\n`;
        msg += `*Total Final:* ${formatarReal(pedido.total)}\n`;
        
        if (isSudeste(cliente.endereco.cep) && cart.some(i => isHanukahProduct(i)) && pedido.total >= 500) {
             msg += `\n🎁 *Frete Grátis Aplicado (Promoção Hanukah)*`;
        }

        window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`, '_blank');
        
        cart = []; 
        localStorage.setItem('lamedCart', '[]'); 
        updateCartUI(); 
        closeCheckoutModal();
        
    } catch (e) { 
        console.error(e);
        alert("Erro ao enviar pedido: " + e.message); 
    }
}

document.addEventListener('DOMContentLoaded', init);
