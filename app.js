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
let kitSelections = {};
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
    favoriteBtn: document.getElementById('btn-favorite'),
    authPromptModal: document.getElementById('auth-prompt-modal'),
    closeAuthPromptBtn: document.getElementById('close-auth-prompt'),
    dismissAuthPromptBtn: document.getElementById('auth-prompt-dismiss'),
    checkoutCepInput: document.getElementById('checkout-cep')
};

// --- INIT ---
function init() {
    console.log('Inicializando...');
    
    // Autenticação
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        atualizarIconeUsuario(user);
        if(currentUser && currentProduct) checkFavoriteStatus(currentProduct.id);
        checkAuthPrompt(user);
    });

    // Carrinho e Dados
    validarELimparCarrinho();
    updateCartUI(); 
    carregarDadosLoja(); 
    setupEventListeners();

    // Animação de Scroll
    const observerOptions = { threshold: 0.1 };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target.classList.add('is-visible');
        });
    }, observerOptions);

    document.querySelectorAll('.scroll-animate').forEach((el) => observer.observe(el));
}

// --- PROMPT DE LOGIN ---
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

function setupEventListeners() {
    window.addEventListener('hashchange', handleRouting);
    document.querySelectorAll('.nav-collection-link').forEach(link => {
        link.addEventListener('click', (e) => { e.preventDefault(); navegarParaColecoes(); });
    });
    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => { window.history.back(); });
    
    if(elements.menuButton) elements.menuButton.addEventListener('click', () => {
        elements.mobileMenu.classList.toggle('active');
        elements.menuButton.textContent = elements.mobileMenu.classList.contains('active') ? '✕' : '☰';
    });
    
    if (elements.cartButton) elements.cartButton.addEventListener('click', openCart);
    if (elements.closeCartButton) elements.closeCartButton.addEventListener('click', closeCart);
    if (elements.cartOverlay) elements.cartOverlay.addEventListener('click', closeCart);
    
    if (elements.finalizarPedidoBtn) elements.finalizarPedidoBtn.addEventListener('click', openCheckoutModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeCheckoutModal));
    
    if (elements.checkoutForm) elements.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); finalizarPedido(new FormData(elements.checkoutForm)); });
    
    document.querySelectorAll('.size-option').forEach(option => { option.addEventListener('click', () => selectSize(option)); });
    
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

async function toggleFavorite() {
    if (!currentUser) return alert("Por favor, faça login ou cadastre-se para favoritar produtos.");
    if (!currentProduct) return;
    const icon = elements.favoriteBtn.querySelector('i');
    const isFav = icon.classList.contains('fa-solid'); 
    
    if (isFav) icon.className = "fa-regular fa-heart";
    else icon.className = "fa-solid fa-heart text-red-500";

    try {
        const userRef = db.collection('usuarios').doc(currentUser.uid);
        const doc = await userRef.get();
        let favs = doc.exists && doc.data().favoritos ? doc.data().favoritos : [];
        if (isFav) favs = favs.filter(id => id !== currentProduct.id);
        else if (!favs.includes(currentProduct.id)) favs.push(currentProduct.id);
        await userRef.set({ favoritos: favs }, { merge: true });
    } catch (e) { console.error("Erro ao favoritar:", e); }
}

async function checkFavoriteStatus(productId) {
    if (!currentUser || !productId) return;
    const icon = elements.favoriteBtn ? elements.favoriteBtn.querySelector('i') : null;
    if(!icon) return;
    icon.className = "fa-regular fa-heart";
    try { 
        const doc = await db.collection('usuarios').doc(currentUser.uid).get(); 
        const favs = doc.data()?.favoritos || []; 
        if (favs.includes(productId)) icon.className = "fa-solid fa-heart text-red-500";
    } catch (e) { console.error(e); }
}

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
        document.getElementById('page-collections-list').classList.add('active');
        renderizarListaDeColecoes(); 
    }
    window.scrollTo(0, 0);
}

async function carregarDadosLoja() {
    try {
        const colecoesSnap = await db.collection("colecoes").where("ativa", "==", true).get();
        activeCollections = colecoesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.ordem||0) - (b.ordem||0));
        
        const produtosSnap = await db.collection("pecas").where("status", "==", "active").get();
        products = produtosSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), preco: parseFloat(doc.data().preco || 0) }));
        
        renderizarSecoesColecoes(); 
        popularPreviewColecao();    
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

    const badge = peca.categoria === 'kit' 
        ? '<div class="absolute top-2 left-2 bg-purple-600 text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide shadow">KIT</div>' 
        : (peca.desconto > 0 ? `<div class="badge-discount">-${peca.desconto}%</div>` : '');

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
            <p class="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">${peca.categoria === 'mesa_posta' ? 'Mesa Posta' : (peca.categoria === 'kit' ? 'Kit Pronto' : (peca.categoria || 'Coleção'))}</p>
        </div>
    `;
    card.addEventListener('click', () => window.location.hash = `#/produto/${peca.id}`);
    return card;
}

function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;
    
    selectedSize = null; selectedColor = null; 
    kitSelections = {};
    
    document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
    document.getElementById('detail-title').textContent = currentProduct.nome;
    
    let descHtml = currentProduct.descricao || '';
    if (currentProduct.categoria === 'kit' && currentProduct.componentes && currentProduct.componentes.length > 0) {
        descHtml += `<div class="mt-4 bg-[#F8F6F0] p-4 rounded-md border border-[#E5E0D8]"><h4 class="font-bold text-sm text-[--cor-marrom-cta] mb-2 uppercase tracking-wide">O que vem neste Kit:</h4><ul class="text-sm space-y-1 text-gray-700 list-disc pl-4">${currentProduct.componentes.map(comp => `<li>${comp.quantidade}x ${comp.nome}</li>`).join('')}</ul></div>`;
    }
    document.getElementById('detail-description').innerHTML = descHtml;
    
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;
    
    setupSplideCarousel(); 
    
    const isKit = currentProduct.categoria === 'kit';
    const isMesaPosta = currentProduct.categoria === 'mesa_posta';
    
    const sizeSection = document.querySelector('.size-selector')?.parentElement;
    const accordionDesc = document.querySelector('.accordion-content'); 
    if (accordionDesc) { accordionDesc.classList.remove('hidden'); accordionDesc.previousElementSibling.querySelector('.accordion-icon')?.classList.add('rotate'); }

    const existingWarning = document.getElementById('mesa-posta-warning');
    if (existingWarning) existingWarning.remove();
    const existingKitSelector = document.getElementById('kit-selector-container');
    if (existingKitSelector) existingKitSelector.remove();

    if (isKit) {
        if(sizeSection) sizeSection.classList.add('hidden');
        renderKitSelectors();
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
    
    renderRecommendations(currentProduct);
    updateAddToCartButton();
    if(currentUser) checkFavoriteStatus(currentProduct.id);
    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
}

function renderKitSelectors() {
    if (!currentProduct.componentes || currentProduct.componentes.length === 0) return;

    const container = document.createElement('div');
    container.id = 'kit-selector-container';
    container.className = 'space-y-6 mb-8 mt-4';
    container.innerHTML = `<h4 class="font-bold text-sm text-[--cor-marrom-cta] uppercase tracking-wide border-b border-[#E5E0D8] pb-2 mb-4">Monte seu Kit:</h4>`;

    currentProduct.componentes.forEach((comp, idx) => {
        const productOriginal = products.find(p => p.id === comp.id);
        const coresDisponiveis = productOriginal ? (productOriginal.cores || []) : [];

        const compDiv = document.createElement('div');
        compDiv.className = 'kit-component-block';
        
        let coresHtml = '';
        if (coresDisponiveis.length > 0) {
            coresHtml = `<div class="flex gap-2 flex-wrap mt-2">
                ${coresDisponiveis.map((cor, cIdx) => `
                    <div class="color-option-kit cursor-pointer border border-gray-200 p-1 rounded flex items-center gap-2 hover:bg-gray-50" 
                         onclick="selectKitColor(${idx}, '${cor.nome}', '${cor.hex}', this)">
                        <div class="w-4 h-4 rounded-full border border-gray-300" style="background-color:${cor.hex}"></div>
                        <span class="text-xs text-gray-600">${cor.nome}</span>
                    </div>
                `).join('')}
            </div>`;
        } else {
            coresHtml = `<p class="text-xs text-gray-400 mt-1">Cor única / Padrão</p>`;
            kitSelections[idx] = { nome: 'Padrão', hex: '#000' };
        }

        compDiv.innerHTML = `<div class="mb-1 flex justify-between items-center"><span class="font-medium text-sm text-gray-800">${comp.quantidade}x ${comp.nome}</span></div>${coresHtml}`;
        container.appendChild(compDiv);
    });

    const target = document.getElementById('detail-price');
    target.after(container);
}

window.selectKitColor = (compIndex, corNome, corHex, element) => {
    const parent = element.parentElement;
    parent.querySelectorAll('.color-option-kit').forEach(el => {
        el.classList.remove('bg-[#F8F6F0]', 'border-[--cor-marrom-cta]');
        el.classList.add('border-gray-200');
    });
    element.classList.remove('border-gray-200');
    element.classList.add('bg-[#F8F6F0]', 'border-[--cor-marrom-cta]');
    kitSelections[compIndex] = { nome: corNome, hex: corHex };
    updateAddToCartButton();
};

function renderColors() {
    const container = document.querySelector('.color-selector-container');
    if (container) container.remove();
    
    const cores = currentProduct.cores || [];
    if (cores.length === 0) { selectedColor = null; return; }

    const div = document.createElement('div');
    div.className = 'color-selector-container mb-6';
    const isMesaPosta = currentProduct.categoria === 'mesa_posta';
    const isKit = currentProduct.categoria === 'kit';

    div.innerHTML = `<p class="text-xs font-bold uppercase tracking-widest text-[--cor-texto] mb-2">Cor ${isKit ? 'do Conjunto' : ''}</p><div class="flex gap-3 flex-wrap">${cores.map((c, i) => {
        let stockBadge = '';
        if ((isMesaPosta || isKit) && c.quantidade !== undefined) {
            stockBadge = `<span class="text-[10px] text-gray-500 font-medium ml-1 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">${c.quantidade} un</span>`;
        }
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
        
        if (isHanukahProduct(item)) {
            hanukahSubtotal += itemTotal;
        }

        let desc = item.nome;
        if (item.isKit) desc += " (Kit)";
        
        summary.innerHTML += `<div class="flex justify-between text-sm mb-1 pb-1 border-b border-dashed border-[#dcdcdc]">
            <div><span class="font-medium text-[--cor-texto]">${item.quantity}x ${desc}</span></div>
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

// --- FINALIZAR PEDIDO (ATUALIZADO) ---
async function finalizarPedido(formData) {
    const cliente = { 
        nome: formData.get('nome'), 
        telefone: formData.get('telefone'), 
        email: formData.get('email'), 
        endereco: { 
            rua: formData.get('rua'), 
            numero: formData.get('numero'), 
            cep: formData.get('cep'), 
            cidade: formData.get('cidade') 
        } 
    };

    if(currentUser) {
        db.collection('usuarios').doc(currentUser.uid).set({ 
            nome: cliente.nome, 
            telefone: cliente.telefone, 
            endereco: cliente.endereco 
        }, { merge: true });
    }

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
        
        // --- CONSTRUÇÃO DA MENSAGEM WHATSAPP MELHORADA ---
        let msg = `*Novo Pedido #${ref.id.slice(0,6).toUpperCase()}*\n`;
        msg += `*Cliente:* ${cliente.nome}\n`;
        msg += `*Pagamento:* ${pedido.pagamento}`;
        if (pedido.pagamento === 'Cartão de Crédito') msg += ` (${pedido.parcelas}x)`;
        msg += `\n\n*Itens do Pedido:*\n`;
        
        cart.forEach(item => {
            msg += `------------------------------\n`;
            msg += `• *${item.quantity}x ${item.nome}*\n`;
            
            if (item.isKit && item.kitSelections) {
                msg += `  _Kit Personalizado:_\n`;
                item.componentes.forEach((comp, idx) => {
                    const corEscolhida = item.kitSelections[idx]?.nome || 'Padrão';
                    msg += `  - ${comp.quantidade}x ${comp.nome} (${corEscolhida})\n`;
                });
            } else {
                const tam = item.tamanho && item.tamanho !== 'Único' ? `Tam: ${item.tamanho}` : '';
                const cor = item.cor ? `Cor: ${item.cor.nome}` : '';
                const details = [tam, cor].filter(Boolean).join(' | ');
                if (details) msg += `  (${details})\n`;
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

// Utilitários
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function openCart() { elements.cartOverlay.classList.add('visivel'); elements.cartDrawer.classList.add('open'); }
function closeCart() { elements.cartDrawer.classList.remove('open'); elements.cartOverlay.classList.remove('visivel'); }
function toggleAccordion(e) { e.currentTarget.nextElementSibling.classList.toggle('hidden'); e.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate'); }

// Inicializar
document.addEventListener('DOMContentLoaded', init);
