// ConfiguraÃ§Ãµes e Init do Firebase
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

// VariÃ¡veis Globais
let products = [];
let activeCollections = []; 
let cart = [];
let currentProduct = null;
let selectedSize = null;
let selectedColor = null;
let comboSelections = {};
let currentUser = null;
const TAXA_JUROS = 0.0549;
let currentHomeFilter = 'all';
let currentHomePage = 1;
const HOME_PAGE_SIZE = 10;

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
    mobileCartButton: document.getElementById('mobile-cart-btn'),
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

    // PÃ¡ginas
    collectionsContainer: document.getElementById('collections-container'),
    favoriteBtn: document.getElementById('btn-favorite'),
    userIconLink: document.getElementById('header-user-icon-link'),
    
    // Auth Modal
    authPromptModal: document.getElementById('auth-prompt-modal'),
    closeAuthPromptBtn: document.getElementById('close-auth-prompt'),
    dismissAuthPromptBtn: document.getElementById('auth-prompt-dismiss'),

    // Popup de prazo
    deliveryPopupOverlay: document.getElementById('delivery-popup-overlay'),
    dismissDeliveryPopupBtn: document.getElementById('dismiss-delivery-popup'),
    closeDeliveryPopupBtn: document.getElementById('close-delivery-popup')
};

const bodyScrollLocks = new Set();
let deliveryPopupTimer = null;
const mobileBottomNavLinks = Array.from(document.querySelectorAll('.mobile-bottom-link[href]'));

function syncBodyScrollState() {
    document.body.classList.toggle('no-scroll', bodyScrollLocks.size > 0);
}

function lockBodyScroll(key) {
    bodyScrollLocks.add(key);
    syncBodyScrollState();
}

function unlockBodyScroll(key) {
    bodyScrollLocks.delete(key);
    syncBodyScrollState();
}

function updateMobileBottomNavState() {
    if (mobileBottomNavLinks.length === 0) return;

    const hash = window.location.hash;
    let activeHref = '#home';

    if (hash === '#loja' || hash.startsWith('#/categoria/')) {
        activeHref = '#loja';
    } else if (hash === '#colecoes' || hash.startsWith('#/colecao/')) {
        activeHref = '#colecoes';
    } else if (hash === '#conheca-loja') {
        activeHref = '#conheca-loja';
    } else if (hash === '#sacola') {
        activeHref = '';
    }

    mobileBottomNavLinks.forEach((link) => {
        const isActive = link.getAttribute('href') === activeHref;
        link.classList.toggle('is-active', isActive);

        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

// --- INIT ---
function init() {
    console.log('Inicializando...');

    scheduleDeliveryPopupCheck();
    updateMobileBottomNavState();

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
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '120px 0px' });
    document.querySelectorAll('.scroll-animate').forEach((el) => observer.observe(el));
}

function scheduleDeliveryPopupCheck() {
    if (localStorage.getItem('lamed_hide_delivery_notice') === 'true') return;

    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            deliveryPopupTimer = window.setTimeout(checkDeliveryPopup, 700);
        }, { timeout: 1200 });
        return;
    }

    deliveryPopupTimer = window.setTimeout(checkDeliveryPopup, 1000);
}

function checkDeliveryPopup() {
    const popup = elements.deliveryPopupOverlay;
    if (!popup) return;

    const hideNotice = localStorage.getItem('lamed_hide_delivery_notice');
    if (hideNotice === 'true') return;
    popup.classList.add('active');
    lockBodyScroll('delivery-popup');
}

function closeDeliveryPopup(hideForever = false) {
    const popup = elements.deliveryPopupOverlay;
    if (!popup) return;

    if (deliveryPopupTimer) {
        clearTimeout(deliveryPopupTimer);
        deliveryPopupTimer = null;
    }

    popup.classList.remove('active');
    unlockBodyScroll('delivery-popup');

    if (hideForever) {
        localStorage.setItem('lamed_hide_delivery_notice', 'true');
    }
}

// --- SETUP EVENT LISTENERS (Restaurada) ---
function setupEventListeners() {
    window.addEventListener('hashchange', () => {
        handleRouting();
        updateMobileBottomNavState();
    });
    
    // Sidebar Toggles
    if (elements.sidebarToggle) elements.sidebarToggle.addEventListener('click', toggleSidebar);
    if (elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', toggleSidebar);
    if (elements.sidebarOverlay) elements.sidebarOverlay.addEventListener('click', toggleSidebar);
    if (elements.sidebarCollectionsToggle) elements.sidebarCollectionsToggle.addEventListener('click', toggleSidebarCollections);

    // Links da Sidebar para fechar ao clicar
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            if (typeof closeCart === 'function') closeCart();
            toggleSidebar();
        });
    });

    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => { window.history.back(); });
    
    if (elements.cartButton) elements.cartButton.addEventListener('click', openCart);
    if (elements.mobileCartButton) {
        elements.mobileCartButton.addEventListener('click', () => {
            if (window.location.hash === '#sacola') {
                openCart();
                return;
            }

            window.location.hash = '#sacola';
        });
    }
    if (elements.closeCartButton) elements.closeCartButton.addEventListener('click', closeCart);
    if (elements.cartOverlay) elements.cartOverlay.addEventListener('click', closeCart);

    mobileBottomNavLinks.forEach((link) => {
        link.addEventListener('click', () => {
            if (typeof closeCart === 'function') closeCart();
            if (elements.sidebarMenu?.classList.contains('open')) toggleSidebar();
        });
    });
    
    if (elements.finalizarPedidoBtn) elements.finalizarPedidoBtn.addEventListener('click', openCheckoutModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeCheckoutModal));
    if (elements.checkoutForm) elements.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); finalizarPedido(new FormData(elements.checkoutForm)); });
    
    // DelegaÃ§Ã£o de eventos para opÃ§Ãµes dinÃ¢micas
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

        if (elements.closeDeliveryPopupBtn) {
        elements.closeDeliveryPopupBtn.addEventListener('click', () => closeDeliveryPopup(false));
    }

    if (elements.dismissDeliveryPopupBtn) {
        elements.dismissDeliveryPopupBtn.addEventListener('click', () => closeDeliveryPopup(true));
    }

    if (elements.deliveryPopupOverlay) {
        elements.deliveryPopupOverlay.addEventListener('click', (event) => {
            if (event.target === elements.deliveryPopupOverlay) {
                closeDeliveryPopup(false);
            }
        });
    }

    if(elements.checkoutCepInput) {
        elements.checkoutCepInput.addEventListener('blur', updateCheckoutSummary);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (elements.deliveryPopupOverlay?.classList.contains('active')) {
            closeDeliveryPopup(false);
            return;
        }

        if (elements.cartDrawer?.classList.contains('open')) {
            closeCart();
            return;
        }

        if (elements.sidebarMenu?.classList.contains('open')) {
            toggleSidebar();
        }
    });
    
    setupPaymentOptions();
}

// --- UTILITÃRIOS ---
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function sanitizePlainText(value, maxLength = 160) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function stripAccents(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString();
    } catch (error) {
        return '';
    }
}
function buildAvatarUrl(name) {
    const safeName = sanitizePlainText(name || 'Cliente', 80) || 'Cliente';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=A58A5C&color=fff`;
}

function getPaymentKey(value) {
    return stripAccents(sanitizePlainText(value, 40)).toLowerCase();
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseCurrencyText(value) {
    return roundCurrency(parseFloat(String(value ?? '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0);
}

function sanitizeHexColor(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '#000000';
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-fA-F]{3,8}$/.test(normalized) ? normalized : '#000000';
}

function normalizeColorSelection(color) {
    if (!color || typeof color !== 'object') return null;
    const nome = sanitizePlainText(color.nome, 40);
    if (!nome) return null;

    return {
        nome,
        hex: sanitizeHexColor(color.hex)
    };
}

function normalizePersonalization(input) {
    if (!input || typeof input !== 'object') return null;

    const texto = sanitizePlainText(input.texto, 120);
    const observacoes = sanitizePlainText(input.observacoes, 280);

    if (!texto && !observacoes) return null;

    return {
        texto,
        observacoes
    };
}

function buildPersonalizationKey(personalizacao) {
    const safe = normalizePersonalization(personalizacao);
    if (!safe) return 'padrao';

    const raw = `${safe.texto || ''}-${safe.observacoes || ''}`;
    return stripAccents(raw)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'padrao';
}

function normalizeComboSelections(input) {
    if (!input || typeof input !== 'object') return {};

    return Object.entries(input).reduce((acc, [key, value]) => {
        const idx = parseInt(key, 10);
        if (!Number.isInteger(idx) || idx < 0 || !value || typeof value !== 'object') return acc;

        const nextValue = {};
        const safeColor = normalizeColorSelection(value.cor);
        const safeSize = sanitizePlainText(value.tamanho, 20);

        if (safeColor) nextValue.cor = safeColor;
        if (safeSize) nextValue.tamanho = safeSize;
        if (Object.keys(nextValue).length > 0) acc[idx] = nextValue;
        return acc;
    }, {});
}

function sanitizeCartItem(item) {
    if (!item || typeof item !== 'object') return null;

    const cartId = sanitizePlainText(item.cartId, 120);
    const nome = sanitizePlainText(item.nome, 120);
    const preco = roundCurrency(Number(item.preco));
    const quantity = Math.max(1, Math.min(99, parseInt(item.quantity, 10) || 0));

    if (!cartId || !nome || !Number.isFinite(preco) || preco < 0 || quantity < 1) return null;

    return {
        cartId,
        id: sanitizePlainText(item.id, 120),
        nome,
        preco,
        imagem: normalizeUrl(item.imagem),
        tamanho: sanitizePlainText(item.tamanho, 20),
        cor: normalizeColorSelection(item.cor),
        quantity,
        isCombo: item.isCombo === true,
        componentes: Array.isArray(item.componentes)
            ? item.componentes.map((comp) => ({
                id: sanitizePlainText(comp?.id, 120),
                nome: sanitizePlainText(comp?.nome, 120),
                quantidade: Math.max(1, parseInt(comp?.quantidade, 10) || 1),
                categoria: sanitizePlainText(comp?.categoria, 40)
            }))
            : null,
        comboSelections: normalizeComboSelections(item.comboSelections),
        personalizacao: normalizePersonalization(item.personalizacao)
    };
}

function normalizeSizeLabel(value) {
    const safe = sanitizePlainText(value, 20);
    if (!safe) return '';

    const upper = stripAccents(safe).toUpperCase();
    if (upper === 'UNICO') return 'Unico';
    if (['PP', 'P', 'M', 'G', 'GG', 'COMBO'].includes(upper)) return upper;
    return safe;
}
function isUniqueSize(value) {
    return stripAccents(sanitizePlainText(value, 20)).toUpperCase() === 'UNICO';
}

function isRoupaCategory(categoria) {
    const normalized = stripAccents(sanitizePlainText(categoria, 40)).toLowerCase();
    return ['vestido', 'conjunto', 'calca', 'camisa', 'saia', 'blusa'].includes(normalized);
}

function getDiscountedProductPrice(product) {
    const price = Number(product?.preco || 0);
    const discount = Number(product?.desconto || 0);
    return roundCurrency(price * (1 - discount / 100));
}

function calculateCheckoutTotals(cartItems, pagamento, parcelas, cep) {
    const subtotal = roundCurrency(cartItems.reduce((acc, item) => acc + (item.preco * item.quantity), 0));
    const hanukahSubtotal = roundCurrency(cartItems.reduce((acc, item) => acc + (isHanukahProduct(item) ? item.preco * item.quantity : 0), 0));
    let final = subtotal;
    let pixDiscount = 0;
    let cardFee = 0;

    const paymentKey = getPaymentKey(pagamento);

    if (paymentKey === 'pix') {
        pixDiscount = roundCurrency(subtotal * 0.05);
        final = roundCurrency(final - pixDiscount);
    } else if (paymentKey.includes('cartao') && parcelas > 2) {
        cardFee = roundCurrency(subtotal * TAXA_JUROS);
        final = roundCurrency(final + cardFee);
    }

    return {
        subtotal,
        hanukahSubtotal,
        pixDiscount,
        cardFee,
        final,
        freeShipping: isSudeste(cep) && hanukahSubtotal >= 500
    };
}

async function getProductMapByIds(ids) {
    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = [...new Set(ids.filter((id) => id && !productMap.has(id)))];

    if (missingIds.length > 0) {
        const snapshots = await Promise.all(missingIds.map((id) => db.collection('pecas').doc(id).get()));
        snapshots.forEach((snapshot) => {
            if (!snapshot.exists) return;
            const data = snapshot.data();
            productMap.set(snapshot.id, { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) });
        });
    }

    return productMap;
}

async function ensureProductLoaded(productMap, id) {
    if (productMap.has(id)) return productMap.get(id);
    if (!id) return null;

    const snapshot = await db.collection('pecas').doc(id).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    const product = { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) };
    productMap.set(snapshot.id, product);
    return product;
}

async function buildCanonicalCartSnapshot(sourceCart) {
    const baseIds = Array.isArray(sourceCart) ? sourceCart.map((item) => sanitizePlainText(item?.id, 120)).filter(Boolean) : [];
    const productMap = await getProductMapByIds(baseIds);
    const canonicalCart = [];

    for (const rawItem of sourceCart) {
        const sourceItem = sanitizeCartItem(rawItem);
        if (!sourceItem?.id) {
            throw new Error('Seu carrinho contem itens invalidos. Atualize a pagina e tente novamente.');
        }

        const product = await ensureProductLoaded(productMap, sourceItem.id);
        if (!product || product.status !== 'active') {
            throw new Error(`O produto "${sourceItem.nome}" nao esta mais disponivel.`);
        }

        const quantity = Math.max(1, Math.min(99, parseInt(sourceItem.quantity, 10) || 0));
        const canonicalItem = {
            cartId: sourceItem.cartId,
            id: product.id,
            nome: sanitizePlainText(product.nome, 120) || sourceItem.nome,
            preco: getDiscountedProductPrice(product),
            imagem: normalizeUrl(Array.isArray(product.imagens) ? product.imagens[0] : '') || 'https://placehold.co/600x800/eee/ccc?text=Sem+imagem',
            quantity
        };

        if (product.tipo === 'combo') {
            if (!Array.isArray(product.componentes) || product.componentes.length === 0) {
                throw new Error(`O combo "${canonicalItem.nome}" esta incompleto no cadastro.`);
            }

            const canonicalSelections = {};
            canonicalItem.isCombo = true;
            canonicalItem.tamanho = 'Combo';
            canonicalItem.cor = null;
            canonicalItem.componentes = [];

            for (let idx = 0; idx < product.componentes.length; idx++) {
                const component = product.componentes[idx];
                const componentProduct = await ensureProductLoaded(productMap, component.id);
                if (!componentProduct) {
                    throw new Error(`Um item do combo "${canonicalItem.nome}" nao foi encontrado.`);
                }

                const requestedSelection = sourceItem.comboSelections?.[idx] || sourceItem.comboSelections?.[String(idx)] || {};
                const componentQuantity = Math.max(1, parseInt(component.quantidade, 10) || 1);
                const canonicalComponent = {
                    id: sanitizePlainText(component.id, 120),
                    nome: sanitizePlainText(component.nome || componentProduct.nome, 120) || 'Item do combo',
                    quantidade: componentQuantity,
                    categoria: sanitizePlainText(component.categoria || componentProduct.categoria, 40)
                };

                const availableColors = Array.isArray(componentProduct.cores) ? componentProduct.cores : [];
                let canonicalColor = { nome: 'PadrÃƒÂ£o', hex: '#000000' };

                if (availableColors.length > 0) {
                    const requestedColorName = sanitizePlainText(requestedSelection.cor?.nome, 40);
                    const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
                    if (!matchedColor) {
                        throw new Error(`Uma cor do combo "${canonicalItem.nome}" nao esta mais disponivel.`);
                    }

                    canonicalColor = {
                        nome: sanitizePlainText(matchedColor.nome, 40),
                        hex: sanitizeHexColor(matchedColor.hex)
                    };
                }

                let canonicalSize = 'Ãšnico';
                if (isRoupaCategory(canonicalComponent.categoria)) {
                    canonicalSize = normalizeSizeLabel(requestedSelection.tamanho);
                    if (!['PP', 'P', 'M', 'G', 'GG'].includes(canonicalSize)) {
                        throw new Error(`Um tamanho do combo "${canonicalItem.nome}" precisa ser selecionado novamente.`);
                    }
                }

                canonicalSelections[idx] = { cor: canonicalColor, tamanho: canonicalSize };
                canonicalItem.componentes.push(canonicalComponent);
            }

            canonicalItem.comboSelections = canonicalSelections;
        } else {
            const availableColors = Array.isArray(product.cores) ? product.cores : [];
            canonicalItem.isCombo = false;
            canonicalItem.personalizacao = product.personalizavel ? normalizePersonalization(sourceItem.personalizacao) : null;

            if (availableColors.length > 0) {
                const requestedColorName = sanitizePlainText(sourceItem.cor?.nome, 40);
                const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
                if (!matchedColor) {
                    throw new Error(`A cor selecionada para "${canonicalItem.nome}" nao esta mais disponivel.`);
                }

                canonicalItem.cor = {
                    nome: sanitizePlainText(matchedColor.nome, 40),
                    hex: sanitizeHexColor(matchedColor.hex)
                };
            } else {
                canonicalItem.cor = null;
            }

            const canonicalSize = checkIsMesaPosta(product.categoria)
                ? 'Ãšnico'
                : normalizeSizeLabel(sourceItem.tamanho);

            if (!canonicalSize || canonicalSize === 'Combo') {
                throw new Error(`As opcoes de "${canonicalItem.nome}" precisam ser selecionadas novamente.`);
            }

            canonicalItem.tamanho = canonicalSize;
        }

        canonicalCart.push(canonicalItem);
    }

    return canonicalCart;
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
    const term = stripAccents(String(item.nome)).toLowerCase();
    return term.includes('hanukah') || term.includes('chanukia') || term.includes('chanuka') || term.includes('judaica');
}
function checkIsMesaPosta(categoria) {
    const catsMesa = ['mesa_posta', 'lugar_americano', 'guardanapo', 'caminho_mesa', 'anel_guardanapo', 'porta_guardanapo', 'trilho_velas', 'capa_de_matza'];
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
        unlockBodyScroll('sidebar');
        
        // Remove classe visual para fade out e espera transiÃ§Ã£o para esconder
        if(overlay) {
            overlay.classList.remove('visivel');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    } else {
        // Abrir
        elements.sidebarMenu.classList.add('open');
        elements.sidebarMenu.classList.remove('-translate-x-full');
        elements.sidebarMenu.classList.add('translate-x-0');
        lockBodyScroll('sidebar');
        
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

// --- ATUALIZAÃ‡ÃƒO DO USUÃRIO ---
async function atualizarInterfaceUsuario(user) {
    const sidebarUserArea = elements.sidebarUserArea;
    if (!sidebarUserArea) return;

    sidebarUserArea.replaceChildren();

    if (user) {
        let photoURL = user.photoURL;
        let displayName = sanitizePlainText(user.displayName || 'Cliente', 80) || 'Cliente';

        if (!photoURL) {
            try {
                const doc = await db.collection('usuarios').doc(user.uid).get();
                if (doc.exists) {
                    const data = doc.data();
                    if (data.fotoUrl) photoURL = normalizeUrl(data.fotoUrl);
                    if (data.nome) displayName = sanitizePlainText(data.nome, 80) || displayName;
                }
            } catch (error) {}
        }

        if (!photoURL) photoURL = buildAvatarUrl(displayName);

        const firstName = sanitizePlainText(displayName.split(' ')[0], 40) || 'Cliente';

        const avatar = document.createElement('img');
        avatar.src = photoURL;
        avatar.alt = firstName;
        avatar.className = 'w-10 h-10 rounded-full border border-[#45301F] object-cover';

        const textWrap = document.createElement('div');
        textWrap.className = 'flex flex-col';

        const hello = document.createElement('span');
        hello.className = 'text-xs text-gray-400 uppercase tracking-widest';
        hello.textContent = 'Ola,';

        const name = document.createElement('span');
        name.className = 'font-serif text-lg text-[#45301F] leading-none';
        name.textContent = firstName;

        textWrap.appendChild(hello);
        textWrap.appendChild(name);
        sidebarUserArea.appendChild(avatar);
        sidebarUserArea.appendChild(textWrap);
        return;
    }

    const avatarPlaceholder = document.createElement('div');
    avatarPlaceholder.className = 'w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-400';

    const icon = document.createElement('i');
    icon.className = 'fa-regular fa-user';
    avatarPlaceholder.appendChild(icon);

    const textWrap = document.createElement('div');
    textWrap.className = 'flex flex-col';

    const welcome = document.createElement('span');
    welcome.className = 'text-xs text-gray-400 uppercase tracking-widest';
    welcome.textContent = 'Bem-vindo';

    const link = document.createElement('a');
    link.href = 'minha-conta.html';
    link.className = 'font-bold text-[#A58A5C] text-sm hover:underline';
    link.textContent = 'Entrar / Cadastrar';

    textWrap.appendChild(welcome);
    textWrap.appendChild(link);
    sidebarUserArea.appendChild(avatarPlaceholder);
    sidebarUserArea.appendChild(textWrap);
}
