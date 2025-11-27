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
let app;
try {
    app = firebase.app();
} catch (e) {
    app = firebase.initializeApp(firebaseConfig);
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
let currentUser = null;
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
    selectedSizeDisplay: document.getElementById('selected-size-display'),
    menuButton: document.getElementById('menu-button'),
    mobileMenu: document.getElementById('mobile-menu'),
    finalizarPedidoBtn: document.getElementById('finalizar-pedido-btn'),
    checkoutModal: document.getElementById('checkout-modal'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutSummary: document.getElementById('checkout-summary'),
    checkoutTotal: document.getElementById('checkout-total'),
    collectionsContainer: document.getElementById('collections-container'),
    userIconLink: document.getElementById('header-user-icon-link') 
};

// --- Inicialização ---

function init() {
    console.log('Inicializando Laméd vs...');
    
    // Auth Listener Global (Controla o ícone do header e carrega usuário)
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        atualizarIconeUsuario(user);
        if(currentUser) {
            checkFavoriteStatus(currentProduct?.id); 
        }
    });

    validarELimparCarrinho();
    updateCartUI(); 
    carregarDadosLoja(); 
    setupEventListeners();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
}

// Atualiza o ícone do header (Login/Foto)
async function atualizarIconeUsuario(user) {
    const link = document.getElementById('header-user-icon-link');
    if (!link) return;

    if (user) {
        let photoURL = user.photoURL;
        
        // Se não tiver foto no Auth, tenta buscar no Firestore
        if (!photoURL) {
            try {
                const doc = await db.collection('usuarios').doc(user.uid).get();
                if (doc.exists && doc.data().fotoUrl) {
                    photoURL = doc.data().fotoUrl;
                }
            } catch(e) {}
        }

        // Se ainda não tiver, gera avatar com iniciais
        if (!photoURL) {
            const name = user.displayName || user.email || 'U';
            photoURL = `https://ui-avatars.com/api/?name=${name}&background=A58A5C&color=fff`;
        }

        link.innerHTML = `<img src="${photoURL}" class="w-7 h-7 rounded-full border border-gray-200 object-cover" alt="Perfil" title="Minha Conta">`;
        link.href = "minha-conta.html"; // Vai direto para o painel
    } else {
        link.innerHTML = `<i class="fa-regular fa-user text-xl"></i>`;
        link.href = "minha-conta.html"; // Vai para login
    }
}

function validarELimparCarrinho() {
    const savedCart = localStorage.getItem('lamedCart');
    if (savedCart) {
        try {
            let tempCart = JSON.parse(savedCart);
            if (!Array.isArray(tempCart)) tempCart = [];
            cart = tempCart.filter(item => item && item.cartId && item.nome && typeof item.preco === 'number');
        } catch (e) {
            cart = [];
        }
    } else {
        cart = [];
    }
}

function setupEventListeners() {
    window.addEventListener('hashchange', handleRouting);
    
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

    document.querySelectorAll('.nav-collection-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navegarParaColecoes();
        });
    });

    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => {
        window.history.back();
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
    if (elements.cartItemsContainer) elements.cartItemsContainer.addEventListener('click', handleCartItemClick);

    document.querySelectorAll('.accordion-toggle').forEach(btn => {
        btn.addEventListener('click', toggleAccordion);
    });

    setupPaymentOptions();
}

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
    if (hash.startsWith('#/produto/')) {
        const productId = hash.split('/')[2];
        showPage('page-product-detail', productId);
    } else if (hash.startsWith('#/colecao/')) {
        const collectionId = hash.split('/')[2];
        showPage('page-single-collection', null, collectionId);
    } else if (hash === '#colecoes') {
        showPage('page-collections-list');
    } else {
        showPage('page-home');
    }
}

function showPage(pageId, param1 = null, param2 = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('product-detail-view').classList.add('hidden');
    document.getElementById('collection-gallery').classList.add('hidden');

    if (pageId === 'page-home') {
        document.getElementById('page-home').classList.add('active');
    } else if (pageId === 'page-single-collection') {
        document.getElementById('page-collection').classList.add('active');
        document.getElementById('collection-gallery').classList.remove('hidden');
        renderizarGridColecao(param2);
    } else if (pageId === 'page-product-detail') {
        document.getElementById('page-collection').classList.add('active');
        if (products.length === 0) {
            carregarDadosLoja().then(() => showProductDetail(param1));
        } else {
            showProductDetail(param1);
        }
    }
    window.scrollTo(0, 0);
}

// --- Dados & Renderização ---

async function carregarDadosLoja() {
    try {
        const colecoesSnap = await db.collection("colecoes").where("ativa", "==", true).get();
        activeCollections = colecoesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        activeCollections.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        
        const produtosSnap = await db.collection("pecas").where("status", "==", "active").get();
        products = produtosSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), preco: parseFloat(doc.data().preco || 0) }));
        
        renderizarSecoesColecoes(); 
        popularPreviewColecao(); 
        handleRouting();
    } catch (err) {
        console.error("Erro ao carregar loja:", err);
    }
}

function renderizarSecoesColecoes() {
    const container = elements.collectionsContainer;
    if (!container) return;
    container.innerHTML = ''; 

    activeCollections.forEach((colecao, index) => {
        const produtosDaColecao = products.filter(p => p.colecaoId === colecao.id);
        if (produtosDaColecao.length === 0) return;

        const section = document.createElement('section');
        section.className = "py-16 px-4 border-b border-gray-50 last:border-0";
        const splideId = `splide-collection-${index}`;

        section.innerHTML = `
            <div class="container mx-auto max-w-7xl text-center">
                <h3 class="serif text-3xl md:text-4xl font-light mb-2 text-gray-800">${colecao.nome}</h3>
                ${colecao.descricao ? `<p class="text-gray-500 mb-8 max-w-2xl mx-auto text-sm italic">${colecao.descricao}</p>` : '<div class="mb-8"></div>'}
                
                <div id="${splideId}" class="splide mb-12">
                    <div class="splide__track"><ul class="splide__list"></ul></div>
                </div>
                <button class="main-button text-white font-semibold py-3 px-8 rounded-full uppercase text-xs tracking-widest hover:shadow-lg transition-all" onclick="location.hash='#/colecao/${colecao.id}'">Ver Tudo</button>
            </div>
        `;
        container.appendChild(section);

        const splideList = section.querySelector('.splide__list');
        produtosDaColecao.slice(0, 8).forEach(peca => {
            const slide = document.createElement('li');
            slide.className = 'splide__slide';
            slide.appendChild(criarCardProduto(peca, '#home'));
            splideList.appendChild(slide);
        });

        new Splide(`#${splideId}`, {
            type: 'slide', perPage: 4, perMove: 1, gap: '20px', pagination: false, arrows: true,
            breakpoints: { 1024: { perPage: 3 }, 768: { perPage: 2 }, 640: { perPage: 1, padding: '20px' } }
        }).mount();
    });
}

function popularPreviewColecao() {
    const splideList = document.getElementById('home-splide-list');
    if (!splideList) return;
    
    // Filtra lançamentos recentes
    const lancamentos = [...products].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
    
    splideList.innerHTML = '';
    lancamentos.forEach(peca => {
        const slide = document.createElement('li');
        slide.className = 'splide__slide';
        slide.appendChild(criarCardProduto(peca, '#home'));
        splideList.appendChild(slide);
    });

    new Splide('#home-splide', {
        type: 'slide', perPage: 4, perMove: 1, gap: '20px', pagination: false,
        breakpoints: { 640: { perPage: 1, padding: '40px' }, 1024: { perPage: 3 } }
    }).mount();
}

// Card de Produto com Preço "De/Por" e Porcentagem
function criarCardProduto(peca, origin) {
    const card = document.createElement('div');
    card.className = "h-full bg-white group cursor-pointer flex flex-col";
    
    const precoFinal = peca.preco * (1 - (peca.desconto || 0)/100);
    const imgPrincipal = peca.imagens[0];
    const imgHover = peca.imagens[1] || peca.imagens[0];
    
    // HTML do Preço Elegante
    let priceHtml = '';
    if (peca.desconto > 0) {
        priceHtml = `
            <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 line-through">${formatarReal(peca.preco)}</span>
                <span class="text-sm font-semibold text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
            </div>
        `;
    } else {
        priceHtml = `<span class="text-sm font-semibold text-gray-800">${formatarReal(peca.preco)}</span>`;
    }

    card.innerHTML = `
        <div class="aspect-[3/4] relative overflow-hidden bg-gray-50 mb-3 rounded-sm card-img-wrapper">
             <img src="${imgPrincipal}" class="card-img-main">
             <img src="${imgHover}" class="card-img-hover">
             
             ${peca.desconto > 0 ? `<div class="badge-discount">-${peca.desconto}%</div>` : ''}
             
             <div class="quick-view-btn">
                Ver Detalhes
             </div>
        </div>
        <div class="text-center px-2">
            <h4 class="text-sm font-medium serif text-gray-800 truncate tracking-wide">${peca.nome}</h4>
            <div class="mt-1">${priceHtml}</div>
            <p class="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">${peca.categoria || 'Coleção'}</p>
        </div>
    `;
    
    card.addEventListener('click', () => {
        window.location.hash = `#/produto/${peca.id}`;
    });
    
    return card;
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
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">Nenhuma peça encontrada.</p>';
        return;
    }
    produtosDaColecao.forEach(peca => grid.appendChild(criarCardProduto(peca, `#/colecao/${collectionId}`)));
}

// --- Detalhes ---

function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;

    selectedSize = null;
    selectedColor = null;
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
    updateAddToCartButton();
    renderRecommendations(currentProduct);

    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
}

function renderRecommendations(current) {
    const container = document.getElementById('related-products-container');
    if (!container) return;
    container.innerHTML = '';
    
    // Sugestão aleatória simples
    const suggestions = products.filter(p => p.id !== current.id).sort(() => 0.5 - Math.random()).slice(0, 4);
    
    if (suggestions.length > 0) {
        const title = document.createElement('h3');
        title.className = "serif text-2xl text-center mt-12 mb-6 text-gray-800";
        title.textContent = "Você também pode gostar";
        container.appendChild(title);
        
        const grid = document.createElement('div');
        grid.className = "grid grid-cols-2 md:grid-cols-4 gap-4";
        suggestions.forEach(p => grid.appendChild(criarCardProduto(p, '#product')));
        container.appendChild(grid);
    }
}

function setupSplideCarousel() {
    const mainList = document.getElementById('main-carousel-list');
    const thumbList = document.getElementById('thumbnail-carousel-list');
    mainList.innerHTML = '';
    thumbList.innerHTML = '';

    const images = currentProduct.imagens.length > 0 ? currentProduct.imagens : ['https://placehold.co/600x800/eee/ccc?text=Sem+imagem'];

    images.forEach((img) => {
        mainList.innerHTML += `<li class="splide__slide flex items-center justify-center bg-gray-50 h-[50vh] md:h-[60vh]"><img src="${img}" class="h-full w-auto object-contain"></li>`;
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
    if (cores.length === 0) return;

    const div = document.createElement('div');
    div.className = 'color-selector-container mb-6';
    div.innerHTML = `
        <p class="text-sm font-medium mb-2 text-gray-700">Cor:</p>
        <div class="flex gap-3 flex-wrap">
            ${cores.map((c, i) => `
                <div class="color-option border border-gray-200 rounded p-1 cursor-pointer flex items-center gap-2 pr-3 hover:border-[--cor-ouro-acento]" data-idx="${i}">
                    <div class="w-6 h-6 rounded-full border border-gray-100 shadow-sm" style="background-color:${c.hex}"></div>
                    <span class="text-xs font-medium">${c.nome}</span>
                </div>
            `).join('')}
        </div>
    `;
    document.querySelector('.size-selector').after(div);
    
    div.querySelectorAll('.color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            div.querySelectorAll('.color-option').forEach(b => b.classList.remove('border-[--cor-ouro-acento]', 'bg-amber-50'));
            btn.classList.add('border-[--cor-ouro-acento]', 'bg-amber-50');
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
    const temCor = currentProduct.cores && currentProduct.cores.length > 0;
    
    if (selectedSize && (!temCor || selectedColor !== null)) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.textContent = "ADICIONAR À SACOLA";
    }
}

function addToCart() {
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    const cartId = `${currentProduct.id}-${selectedSize}-${corObj?.nome || 'unico'}`;
    
    const existing = cart.find(i => i.cartId === cartId);
    if (existing) {
        existing.quantity++;
    } else {
        cart.push({
            cartId, id: currentProduct.id, nome: currentProduct.nome,
            preco: precoFinal, imagem: currentProduct.imagens[0],
            tamanho: selectedSize, cor: corObj, quantity: 1
        });
    }
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
    openCart();
}

function updateCartUI() {
    const container = elements.cartItemsContainer;
    let total = 0, count = 0;
    container.innerHTML = '';
    
    if (cart.length === 0) {
        elements.cartEmptyMsg.classList.remove('hidden');
        elements.cartCountBadge.style.display = 'none';
        elements.cartSubtotalEl.textContent = 'R$ 0,00';
        return;
    }
    elements.cartEmptyMsg.classList.add('hidden');
    
    cart.forEach(item => {
        total += item.preco * item.quantity;
        count += item.quantity;
        container.innerHTML += `
            <div class="flex gap-4 mb-4 border-b pb-4 last:border-0">
                <img src="${item.imagem}" class="w-16 h-20 object-cover rounded-sm border border-gray-100">
                <div class="flex-grow">
                    <h4 class="font-medium text-sm text-gray-800">${item.nome}</h4>
                    <p class="text-xs text-gray-500 mb-1">${item.tamanho} ${item.cor ? `| ${item.cor.nome}` : ''}</p>
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-sm">${formatarReal(item.preco)}</span>
                        <div class="flex items-center border rounded bg-white">
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="dec" data-id="${item.cartId}">-</button>
                            <span class="px-2 text-xs">${item.quantity}</span>
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="inc" data-id="${item.cartId}">+</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
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

// --- Checkout Inteligente ---

async function openCheckoutModal() {
    if (cart.length === 0) return alert("Sua sacola está vazia.");
    updateCheckoutSummary();
    
    // Auto-preenchimento
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
                }
            } else {
                // Se não tem dados salvos, pré-preenche com o Auth
                elements.checkoutForm.email.value = currentUser.email;
                if(currentUser.displayName) elements.checkoutForm.nome.value = currentUser.displayName;
            }
        } catch(e) { console.error("Erro auto-fill:", e); }
    }
    
    elements.checkoutModal.classList.add('active');
    closeCart();
}

function closeCheckoutModal() { elements.checkoutModal.classList.remove('active'); }

function updateCheckoutSummary() {
    const summary = elements.checkoutSummary;
    summary.innerHTML = '';
    let total = 0;
    cart.forEach(item => {
        total += item.preco * item.quantity;
        summary.innerHTML += `
            <div class="flex justify-between text-sm mb-2 border-b border-dashed border-gray-200 pb-2">
                <div><span class="font-medium text-gray-700">${item.quantity}x ${item.nome}</span></div>
                <span>${formatarReal(item.preco * item.quantity)}</span>
            </div>`;
    });
    const pgto = document.querySelector('input[name="pagamento"]:checked')?.value;
    let final = total;
    if (pgto === 'PIX') { 
        const desc = total * 0.05; 
        final -= desc;
        summary.innerHTML += `<div class="flex justify-between text-sm text-green-600 font-medium mt-2"><span>Desconto PIX (5%)</span><span>-${formatarReal(desc)}</span></div>`;
    }
    elements.checkoutTotal.textContent = formatarReal(final);
}

function setupPaymentOptions() {
    document.querySelectorAll('input[name="pagamento"]').forEach(r => {
        r.addEventListener('change', () => {
            document.querySelectorAll('.payment-label').forEach(l => l.classList.remove('border-[--cor-ouro-acento]', 'bg-amber-50'));
            if(r.checked) r.nextElementSibling.classList.add('border-[--cor-ouro-acento]', 'bg-amber-50');
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
        if(i > 2) val = total * (1 + TAXA_JUROS); 
        select.innerHTML += `<option value="${i}">${i}x de ${formatarReal(val/i)} ${i>2 ?'(c/ juros)':'(sem juros)'}</option>`;
    }
}

async function finalizarPedido(formData) {
    const cliente = {
        nome: formData.get('nome'),
        telefone: formData.get('telefone'),
        email: formData.get('email'),
        endereco: {
            rua: formData.get('rua'), numero: formData.get('numero'),
            cep: formData.get('cep'), cidade: formData.get('cidade')
        }
    };
    
    // Se logado, atualiza o cadastro para facilitar próxima compra
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
        userId: currentUser ? currentUser.uid : null
    };

    try {
        const ref = await db.collection('pedidos').add(pedido);
        const msg = `Olá! Fiz um pedido no site (ID #${ref.id.slice(0,6).toUpperCase()}).\nCliente: ${cliente.nome}\nTotal: ${formatarReal(pedido.total)}`;
        window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`, '_blank');
        
        cart = []; localStorage.setItem('lamedCart', '[]'); updateCartUI();
        closeCheckoutModal();
    } catch (e) { alert("Erro ao enviar pedido: " + e.message); }
}

// Helpers
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function openCart() { elements.cartOverlay.classList.add('visivel'); elements.cartDrawer.classList.add('open'); }
function closeCart() { elements.cartDrawer.classList.remove('open'); elements.cartOverlay.classList.remove('visivel'); }
function toggleAccordion(e) { 
    e.currentTarget.nextElementSibling.classList.toggle('hidden'); 
    e.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate'); 
}

// Favoritos Helper
async function checkFavoriteStatus(productId) {
    if (!currentUser || !productId) return;
    const icon = document.querySelector('#btn-favorite i');
    if(!icon) return;
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const favs = doc.data()?.favoritos || [];
        if (favs.includes(productId)) {
            icon.className = "fa-solid fa-heart text-red-500";
        } else {
            icon.className = "fa-regular fa-heart";
        }
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', init);
