// Configurações e Init do Firebase
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

let app;
try { app = firebase.app(); } catch (e) { app = firebase.initializeApp(firebaseConfig); }
const db = firebase.firestore();
const auth = firebase.auth();

// Variáveis Globais
let products = [];
let activeCollections = []; 
let cart = [];
let currentProduct = null;
let selectedSize = null;
let selectedColor = null;
let currentUser = null;
const TAXA_JUROS = 0.0549;

// Elementos do DOM
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
    selectedSizeDisplay: document.getElementById('selected-size-display'),
    menuButton: document.getElementById('menu-button'),
    mobileMenu: document.getElementById('mobile-menu'),
    finalizarPedidoBtn: document.getElementById('finalizar-pedido-btn'),
    checkoutModal: document.getElementById('checkout-modal'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutSummary: document.getElementById('checkout-summary'),
    checkoutTotal: document.getElementById('checkout-total'),
    collectionsContainer: document.getElementById('collections-container'),
    userIconLink: document.getElementById('header-user-icon-link'),
    favoriteBtn: document.getElementById('btn-favorite')
};

// --- INIT ---
function init() {
    console.log('Inicializando...');
    
    // Autenticação
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        atualizarIconeUsuario(user);
        if(currentUser && currentProduct) checkFavoriteStatus(currentProduct.id); 
    });

    // Carrinho e Dados
    validarELimparCarrinho();
    updateCartUI(); 
    carregarDadosLoja(); 
    setupEventListeners();

    // Animação de Scroll (Filosofia e Mensagem)
    const observerOptions = { threshold: 0.1 };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target.classList.add('is-visible');
        });
    }, observerOptions);

    document.querySelectorAll('.scroll-animate').forEach((el) => observer.observe(el));
}

// Atualizar Ícone do Usuário no Header
async function atualizarIconeUsuario(user) {
    const link = document.getElementById('header-user-icon-link');
    if (!link) return;
    if (user) {
        let photoURL = user.photoURL;
        if (!photoURL) {
            try {
                const doc = await db.collection('usuarios').doc(user.uid).get();
                if (doc.exists && doc.data().fotoUrl) photoURL = doc.data().fotoUrl;
            } catch(e) {}
        }
        if (!photoURL) photoURL = `https://ui-avatars.com/api/?name=${user.displayName||'U'}&background=A58A5C&color=fff`;
        link.innerHTML = `<img src="${photoURL}" class="w-7 h-7 rounded-full border border-[#45301F] object-cover">`;
        link.href = "minha-conta.html";
    } else {
        link.innerHTML = `<i class="fa-regular fa-user text-xl"></i>`;
        link.href = "minha-conta.html";
    }
}

// Carrinho: Validação Inicial
function validarELimparCarrinho() {
    const savedCart = localStorage.getItem('lamedCart');
    if (savedCart) {
        try {
            let tempCart = JSON.parse(savedCart);
            if (!Array.isArray(tempCart)) tempCart = [];
            cart = tempCart.filter(item => item && item.cartId && item.nome && typeof item.preco === 'number');
        } catch (e) { cart = []; }
    } else { cart = []; }
}

// Event Listeners
function setupEventListeners() {
    window.addEventListener('hashchange', handleRouting);
    
    document.querySelectorAll('.nav-collection-link').forEach(link => {
        link.addEventListener('click', (e) => { e.preventDefault(); navegarParaColecoes(); });
    });
    
    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => { window.history.back(); });
    
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
        elements.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); finalizarPedido(new FormData(elements.checkoutForm)); });
    }
    
    document.querySelectorAll('.size-option').forEach(option => { option.addEventListener('click', () => selectSize(option)); });
    
    if (elements.addToCartBtn) elements.addToCartBtn.addEventListener('click', addToCart);
    if (elements.cartItemsContainer) elements.cartItemsContainer.addEventListener('click', handleCartItemClick);
    
    if (elements.favoriteBtn) elements.favoriteBtn.addEventListener('click', toggleFavorite);

    document.querySelectorAll('.accordion-toggle').forEach(btn => { btn.addEventListener('click', toggleAccordion); });
    
    setupPaymentOptions();
}

// --- LÓGICA DE FAVORITOS ---
async function toggleFavorite() {
    if (!currentUser) {
        alert("Por favor, faça login ou cadastre-se para favoritar produtos.");
        return;
    }
    if (!currentProduct) return;

    const icon = elements.favoriteBtn.querySelector('i');
    const isFav = icon.classList.contains('fa-solid'); 
    
    if (isFav) {
        icon.className = "fa-regular fa-heart";
    } else {
        icon.className = "fa-solid fa-heart text-red-500";
    }

    try {
        const userRef = db.collection('usuarios').doc(currentUser.uid);
        const doc = await userRef.get();
        let favs = doc.exists && doc.data().favoritos ? doc.data().favoritos : [];

        if (isFav) {
            favs = favs.filter(id => id !== currentProduct.id);
        } else {
            if (!favs.includes(currentProduct.id)) favs.push(currentProduct.id);
        }

        await userRef.set({ favoritos: favs }, { merge: true });
        
    } catch (e) {
        console.error("Erro ao favoritar:", e);
        if (isFav) icon.className = "fa-solid fa-heart text-red-500";
        else icon.className = "fa-regular fa-heart";
        alert("Não foi possível atualizar os favoritos.");
    }
}

async function checkFavoriteStatus(productId) {
    if (!currentUser || !productId) return;
    const icon = elements.favoriteBtn ? elements.favoriteBtn.querySelector('i') : null;
    if(!icon) return;
    
    icon.className = "fa-regular fa-heart";

    try { 
        const doc = await db.collection('usuarios').doc(currentUser.uid).get(); 
        const favs = doc.data()?.favoritos || []; 
        if (favs.includes(productId)) {
            icon.className = "fa-solid fa-heart text-red-500";
        }
    } catch (e) { console.error(e); }
}

// Navegação
function navegarParaColecoes() {
    if (elements.mobileMenu && elements.mobileMenu.classList.contains('active')) elements.mobileMenu.classList.remove('active');
    if (activeCollections.length === 1) window.location.hash = `#/colecao/${activeCollections[0].id}`;
    else window.location.hash = '#colecoes';
}

function handleRouting() {
    const hash = window.location.hash;
    if (hash.startsWith('#/produto/')) showPage('page-product-detail', hash.split('/')[2]);
    else if (hash.startsWith('#/colecao/')) showPage('page-single-collection', null, hash.split('/')[2]);
    else if (hash === '#colecoes') showPage('page-collections-list');
    else showPage('page-home');
}

function showPage(pageId, param1 = null, param2 = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('product-detail-view').classList.add('hidden');
    document.getElementById('collection-gallery').classList.add('hidden');

    if (pageId === 'page-home') document.getElementById('page-home').classList.add('active');
    else if (pageId === 'page-single-collection') {
        document.getElementById('page-collection').classList.add('active');
        document.getElementById('collection-gallery').classList.remove('hidden');
        renderizarGridColecao(param2);
    } else if (pageId === 'page-product-detail') {
        document.getElementById('page-collection').classList.add('active');
        if (products.length === 0) carregarDadosLoja().then(() => showProductDetail(param1));
        else showProductDetail(param1);
    } else if (pageId === 'page-collections-list') {
        // Garante que a página de lista de coleções apareça
        document.getElementById('page-collections-list').classList.add('active');
        renderizarListaDeColecoes(); // Nova função para preencher o grid de coleções
    }
    window.scrollTo(0, 0);
}

// --- DADOS ---
async function carregarDadosLoja() {
    try {
        const colecoesSnap = await db.collection("colecoes").where("ativa", "==", true).get();
        activeCollections = colecoesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.ordem||0) - (b.ordem||0));
        
        const produtosSnap = await db.collection("pecas").where("status", "==", "active").get();
        products = produtosSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), preco: parseFloat(doc.data().preco || 0) }));
        
        renderizarSecoesColecoes(); // Renderiza na HOME
        popularPreviewColecao();    // Renderiza o carrossel na HOME
        handleRouting();            // Verifica a rota atual
    } catch (err) { console.error("Erro dados:", err); }
}

function renderizarSecoesColecoes() {
    const container = elements.collectionsContainer;
    if (!container) return;
    container.innerHTML = ''; 
    
    // Se não houver coleções ativas, não faz nada
    if (activeCollections.length === 0) return;

    activeCollections.forEach((colecao, index) => {
        const prods = products.filter(p => p.colecaoId === colecao.id);
        
        // CORREÇÃO: Não usar 'return' aqui, pois para o loop inteiro se a primeira coleção estiver vazia.
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
        
        // Inicializa o Splide apenas se houver itens
        if (prods.length > 0) {
            new Splide(`#${splideId}`, { 
                type: 'slide', 
                perPage: 4, 
                gap: '20px', 
                pagination: false, 
                arrows: true, 
                breakpoints: { 
                    1024: { perPage: 3 }, 
                    768: { perPage: 2 }, 
                    640: { perPage: 1, padding: '20px' } 
                } 
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

// NOVA FUNÇÃO: Renderizar a página de lista de todas as coleções
function renderizarListaDeColecoes() {
    const grid = document.getElementById('collections-list-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (activeCollections.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-20">Nenhuma coleção ativa no momento.</p>';
        return;
    }

    activeCollections.forEach(col => {
        // Conta produtos nesta coleção
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

    card.innerHTML = `
        <div class="aspect-[3/4] relative overflow-hidden bg-gray-100 mb-3 rounded-sm card-img-wrapper">
             <img src="${imgPrincipal}" class="card-img-main w-full h-full object-cover">
             <img src="${imgHover}" class="card-img-hover w-full h-full object-cover">
             ${peca.desconto > 0 ? `<div class="badge-discount">-${peca.desconto}%</div>` : ''}
             <div class="quick-view-btn text-center py-2 bg-white/90 text-[--cor-texto] text-xs font-bold uppercase tracking-widest absolute bottom-0 w-full translate-y-full group-hover:translate-y-0 transition-transform">Ver Detalhes</div>
        </div>
        <div class="text-center px-2">
            <h4 class="text-sm font-medium serif text-[--cor-texto] truncate tracking-wide">${peca.nome}</h4>
            ${priceHtml}
            <p class="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">${peca.categoria === 'mesa_posta' ? 'Mesa Posta' : (peca.categoria || 'Coleção')}</p>
        </div>
    `;
    card.addEventListener('click', () => window.location.hash = `#/produto/${peca.id}`);
    return card;
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

// --- Detalhes do Produto ---
function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;
    
    selectedSize = null; selectedColor = null;
    document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
    
    document.getElementById('detail-title').textContent = currentProduct.nome;
    document.getElementById('detail-description').textContent = currentProduct.descricao || '';
    
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;
    
    setupSplideCarousel(); 
    renderColors(); 
    renderRecommendations(currentProduct);
    
    // --- Lógica: Mesa Posta & Aviso ---
    const sizeSection = document.querySelector('.size-selector')?.parentElement;
    
    // Elementos de tamanho
    const sizeHeader = sizeSection?.querySelector('.flex.justify-between'); 
    const sizeOptions = sizeSection?.querySelector('.size-selector');
    const sizeDisplay = sizeSection?.querySelector('#selected-size-display');

    // Acordeões
    const accordions = document.querySelectorAll('.accordion-button');
    let measureAccordionWrapper = null;

    accordions.forEach(btn => {
        if(btn.textContent.includes('Guia de Medidas')) {
            measureAccordionWrapper = btn.parentElement;
        }
        // Descrição aberta
        if(btn.textContent.includes('Descrição')) {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector('.accordion-icon');
            content.classList.remove('hidden');
            if(icon) icon.classList.add('rotate');
        }
    });

    // Remove aviso antigo
    const existingWarning = document.getElementById('mesa-posta-warning');
    if (existingWarning) existingWarning.remove();

    if (currentProduct.categoria === 'mesa_posta') {
        // Esconde só os tamanhos, mantém container visível para as Cores (se houver)
        if(sizeHeader) sizeHeader.classList.add('hidden');
        if(sizeOptions) sizeOptions.classList.add('hidden');
        if(sizeDisplay) sizeDisplay.classList.add('hidden');
        if(sizeSection) sizeSection.classList.remove('hidden');

        if(measureAccordionWrapper) measureAccordionWrapper.classList.add('hidden');
        selectedSize = 'Único'; 
        
        const warningDiv = document.createElement('div');
        warningDiv.id = 'mesa-posta-warning';
        warningDiv.className = 'bg-orange-50 border border-orange-100 text-[#643f21] text-xs p-3 rounded mb-4 mt-2 flex gap-2 items-start';
        warningDiv.innerHTML = `
            <i class="fa-solid fa-circle-exclamation mt-0.5 text-[#A58A5C]"></i>
            <span><strong>Atenção:</strong> Valor referente a <strong>1 unidade</strong> (peça avulsa). Não acompanha acessórios ou jogo completo.</span>
        `;
        const btnContainer = document.getElementById('add-to-cart-button').parentElement;
        btnContainer.insertBefore(warningDiv, document.getElementById('add-to-cart-button'));

    } else {
        // Restaura
        if(sizeHeader) sizeHeader.classList.remove('hidden');
        if(sizeOptions) sizeOptions.classList.remove('hidden');
        if(sizeSection) sizeSection.classList.remove('hidden');
        if(measureAccordionWrapper) measureAccordionWrapper.classList.remove('hidden');
        selectedSize = null; 
    }
    
    updateAddToCartButton();

    if(currentUser) checkFavoriteStatus(currentProduct.id);

    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
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
    const mainList = document.getElementById('main-carousel-list');
    const thumbList = document.getElementById('thumbnail-carousel-list');
    mainList.innerHTML = ''; thumbList.innerHTML = '';
    const images = currentProduct.imagens.length > 0 ? currentProduct.imagens : ['https://placehold.co/600x800/eee/ccc?text=Sem+imagem'];
    images.forEach((img) => {
        mainList.innerHTML += `<li class="splide__slide flex items-center justify-center bg-transparent h-[50vh] md:h-[60vh]"><img src="${img}" class="h-full w-auto object-contain"></li>`;
        thumbList.innerHTML += `<li class="splide__slide thumbnail-slide opacity-60"><img src="${img}" class="w-full h-full object-cover rounded cursor-pointer"></li>`;
    });
    const main = new Splide('#main-carousel', { type: 'fade', rewind: true, pagination: false, arrows: true }).mount();
    const thumbs = new Splide('#thumbnail-carousel', { fixedWidth: 60, fixedHeight: 60, gap: 10, rewind: true, pagination: false, isNavigation: true, arrows: false }).mount();
    main.sync(thumbs);
}

function renderColors() {
    const container = document.querySelector('.color-selector-container');
    if (container) container.remove();
    
    const cores = currentProduct.cores || [];
    if (cores.length === 0) {
        selectedColor = null;
        return;
    }

    const div = document.createElement('div');
    div.className = 'color-selector-container mb-6';
    const isMesaPosta = currentProduct.categoria === 'mesa_posta';

    div.innerHTML = `<p class="text-xs font-bold uppercase tracking-widest text-[--cor-texto] mb-2">Cor</p><div class="flex gap-3 flex-wrap">${cores.map((c, i) => {
        let stockBadge = '';
        if (isMesaPosta && c.quantidade !== undefined) {
            stockBadge = `<span class="text-[10px] text-gray-500 font-medium ml-1 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">${c.quantidade} un</span>`;
        }
        return `
        <div class="color-option group relative" data-idx="${i}">
            <div class="w-4 h-4 rounded-full border border-gray-300 shadow-sm" style="background-color:${c.hex}"></div>
            <span class="text-xs font-medium text-gray-700">${c.nome}</span>
            ${stockBadge}
        </div>`;
    }).join('')}</div>`;
    
    // Inserção CORRETA: Fora do .size-selector, mas próximo a ele
    const sizeSelector = document.querySelector('.size-selector');
    if (sizeSelector && sizeSelector.parentElement) {
        // Insere após o container pai do tamanho (a div mb-8)
        // Isso garante que se o tamanho for oculto (add class hidden no parent), a cor ainda fica visível fora dele
        sizeSelector.parentElement.after(div);
    } else {
        document.getElementById('detail-price').after(div);
    }

    // Auto-seleção se houver apenas 1 cor
    if (cores.length === 1) {
        selectedColor = 0;
        div.querySelector('.color-option').classList.add('selected');
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
    
    // --- Lógica: Estoque Total (Se 0, desabilita) ---
    const stockTotal = currentProduct.cores ? currentProduct.cores.reduce((acc, c) => acc + (parseInt(c.quantidade) || 0), 0) : 0;
    
    if (stockTotal <= 0) {
        btn.disabled = true;
        btn.textContent = "ESGOTADO";
        btn.classList.add('bg-gray-400');
        btn.classList.remove('hover:bg-[#4a2e18]');
        return;
    } else {
        btn.classList.remove('bg-gray-400');
        btn.classList.add('hover:bg-[#4a2e18]');
    }

    const isMesaPosta = currentProduct.categoria === 'mesa_posta';
    const hasSize = selectedSize !== null;
    const hasColor = !currentProduct.cores?.length || selectedColor !== null;

    if ((isMesaPosta || hasSize) && hasColor) {
        btn.disabled = false; btn.textContent = "ADICIONAR À SACOLA";
    } else {
        btn.disabled = true; btn.textContent = "Selecione Opções";
    }
}

function addToCart() {
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    const tamanhoFinal = currentProduct.categoria === 'mesa_posta' ? 'Único' : selectedSize;
    
    const cartId = `${currentProduct.id}-${tamanhoFinal}-${corObj?.nome || 'unico'}`;
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
        quantity: 1 
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
        container.innerHTML += `<div class="flex gap-4 mb-4 border-b border-[#E5E0D8] pb-4 last:border-0"><img src="${item.imagem}" class="w-16 h-20 object-cover rounded-sm border border-[#E5E0D8]"><div class="flex-grow"><h4 class="font-medium text-sm text-[--cor-texto]">${item.nome}</h4><p class="text-xs text-gray-500 mb-1">${item.tamanho} ${item.cor ? `| ${item.cor.nome}` : ''}</p><div class="flex justify-between items-center"><span class="font-semibold text-sm">${formatarReal(item.preco)}</span><div class="flex items-center border border-[#dcdcdc] rounded bg-white"><button class="px-2 text-gray-500 hover:bg-gray-100" data-action="dec" data-id="${item.cartId}">-</button><span class="px-2 text-xs">${item.quantity}</span><button class="px-2 text-gray-500 hover:bg-gray-100" data-action="inc" data-id="${item.cartId}">+</button></div></div></div></div>`;
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

// --- Checkout ---
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
                if(data.endereco) { f.rua.value = data.endereco.rua || ''; f.numero.value = data.endereco.numero || ''; f.cep.value = data.endereco.cep || ''; f.cidade.value = data.endereco.cidade || ''; }
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
    cart.forEach(item => { total += item.preco * item.quantity; summary.innerHTML += `<div class="flex justify-between text-sm mb-1 pb-1 border-b border-dashed border-[#dcdcdc]"><div><span class="font-medium text-[--cor-texto]">${item.quantity}x ${item.nome}</span></div><span>${formatarReal(item.preco * item.quantity)}</span></div>`; });
    const pgto = document.querySelector('input[name="pagamento"]:checked')?.value;
    let final = total;
    if (pgto === 'PIX') { const desc = total * 0.05; final -= desc; summary.innerHTML += `<div class="flex justify-between text-sm text-green-600 font-medium mt-1"><span>Desconto PIX</span><span>-${formatarReal(desc)}</span></div>`; }
    elements.checkoutTotal.textContent = formatarReal(final);
}

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
    for(let i=1; i<=12; i++) { let val = total; if(i > 2) val = total * (1 + TAXA_JUROS); select.innerHTML += `<option value="${i}">${i}x de ${formatarReal(val/i)} ${i>2 ?'(c/ juros)':'(sem juros)'}</option>`; }
}

async function finalizarPedido(formData) {
    const cliente = { nome: formData.get('nome'), telefone: formData.get('telefone'), email: formData.get('email'), endereco: { rua: formData.get('rua'), numero: formData.get('numero'), cep: formData.get('cep'), cidade: formData.get('cidade') } };
    if(currentUser) db.collection('usuarios').doc(currentUser.uid).set({ nome: cliente.nome, telefone: cliente.telefone, endereco: cliente.endereco }, { merge: true });
    const pedido = { cliente, pagamento: formData.get('pagamento'), parcelas: formData.get('pagamento') === 'Cartão de Crédito' ? document.getElementById('parcelas-select').value : 1, produtos: cart, total: parseFloat(elements.checkoutTotal.textContent.replace(/[^\d,]/g,'').replace(',','.')), data: firebase.firestore.FieldValue.serverTimestamp(), status: 'pendente', userId: currentUser ? currentUser.uid : null };
    try {
        const ref = await db.collection('pedidos').add(pedido);
        const msg = `Olá! Fiz um pedido no site (ID #${ref.id.slice(0,6).toUpperCase()}).\nCliente: ${cliente.nome}\nTotal: ${formatarReal(pedido.total)}`;
        window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`, '_blank');
        cart = []; localStorage.setItem('lamedCart', '[]'); updateCartUI(); closeCheckoutModal();
    } catch (e) { alert("Erro ao enviar pedido: " + e.message); }
}

// Utilitários
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function openCart() { elements.cartOverlay.classList.add('visivel'); elements.cartDrawer.classList.add('open'); }
function closeCart() { elements.cartDrawer.classList.remove('open'); elements.cartOverlay.classList.remove('visivel'); }
function toggleAccordion(e) { e.currentTarget.nextElementSibling.classList.toggle('hidden'); e.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate'); }

// Inicializar
document.addEventListener('DOMContentLoaded', init);
