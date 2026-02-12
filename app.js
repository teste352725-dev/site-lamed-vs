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

// Formatação
const formatarReal = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// --- CARREGAMENTO INICIAL ---

async function loadStoreData() {
    try {
        const pSnap = await db.collection('pecas').where('status', '==', 'active').get();
        products = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
        
        const cSnap = await db.collection('colecoes').get();
        activeCollections = cSnap.docs.map(d => ({id: d.id, ...d.data()}));
        
        renderCollections();
    } catch (err) {
        console.error("Erro ao carregar dados:", err);
    }
}

// --- RENDERIZAÇÃO DA PÁGINA INICIAL ---

function renderCollections() {
    const gallery = document.getElementById('collection-gallery');
    if (!gallery) return;

    gallery.innerHTML = activeCollections.map(col => {
        const colProducts = products.filter(p => p.colecaoId === col.id);
        if (colProducts.length === 0) return '';

        return `
            <section class="mb-16">
                <div class="text-center mb-10">
                    <h2 class="text-4xl font-serif text-[--cor-marrom-cta]">${col.nome}</h2>
                    <div class="w-24 h-px bg-[--cor-ouro-acento] mx-auto mt-4"></div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
                    ${colProducts.map(p => renderProductCard(p)).join('')}
                </div>
            </section>
        `;
    }).join('');
}

function renderProductCard(p) {
    const precoFinal = p.preco * (1 - (p.desconto || 0) / 100);
    return `
        <div class="group cursor-pointer" onclick="showProductDetail('${p.id}')">
            <div class="relative overflow-hidden aspect-[3/4] mb-4 bg-gray-100">
                <img src="${p.imagens[0]}" class="w-full h-full object-cover transition duration-700 group-hover:scale-105">
                ${p.desconto > 0 ? `<div class="absolute top-4 left-4 bg-white px-3 py-1 text-[10px] font-bold tracking-widest text-red-600 shadow-sm">-${p.desconto}%</div>` : ''}
            </div>
            <h3 class="text-xs uppercase tracking-widest text-gray-500 mb-1 font-medium">${p.categoria.replace('_', ' ')}</h3>
            <p class="font-serif text-lg text-gray-800 mb-2 leading-tight">${p.nome}</p>
            <div class="flex items-center gap-2">
                <span class="text-[--cor-marrom-cta] font-medium">${formatarReal(precoFinal)}</span>
                ${p.desconto > 0 ? `<span class="text-xs text-gray-400 line-through">${formatarReal(p.preco)}</span>` : ''}
            </div>
        </div>
    `;
}

// --- DETALHES DO PRODUTO ---

function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;
    
    selectedSize = null; 
    selectedColor = null; 
    comboSelections = {};
    
    document.getElementById('detail-title').textContent = currentProduct.nome;
    document.getElementById('detail-description').innerHTML = currentProduct.descricao || '';
    
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;

    // Limpezas
    ['mesa-posta-warning', 'combo-selector-container', 'custom-input-container'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.remove();
    });

    const btnContainer = document.getElementById('add-to-cart-button').parentElement;

    // Lógica de Personalização
    const isPersonalizado = currentProduct.personalizavel === true || 
                          currentProduct.nome.toLowerCase().includes('letra') || 
                          currentProduct.nome.toLowerCase().includes('personaliz');

    if (isPersonalizado) {
        const customDiv = document.createElement('div');
        customDiv.id = 'custom-input-container';
        customDiv.className = 'mb-6 mt-4 p-4 bg-gray-50 border border-gray-200 rounded';
        customDiv.innerHTML = `
            <label class="block text-xs font-bold uppercase tracking-widest text-[#643f21] mb-2">
                Personalização (Qual Letra ou Nome?) <span class="text-red-500">*</span>
            </label>
            <input type="text" id="product-custom-text" class="w-full border border-gray-300 p-2.5 rounded text-sm focus:border-[#A58A5C] outline-none" placeholder="Ex: Letra A, Família Silva...">
        `;
        btnContainer.insertBefore(customDiv, document.getElementById('add-to-cart-button'));
    }

    // Lógica de Mesa Posta
    if (['lugar_americano', 'guardanapo', 'caminho_mesa', 'porta_guardanapo'].includes(currentProduct.categoria)) {
        selectedSize = 'Único';
        const warningDiv = document.createElement('div');
        warningDiv.id = 'mesa-posta-warning';
        warningDiv.className = 'bg-orange-50 text-[#643f21] text-xs p-3 rounded mb-4 flex gap-2 items-center';
        warningDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation text-[#A58A5C]"></i><span>Valor referente a <strong>1 unidade avulsa</strong>.</span>`;
        btnContainer.insertBefore(warningDiv, document.getElementById('add-to-cart-button'));
    }

    renderSizes();
    renderColors();
    updateAddToCartButton();
    
    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
    window.scrollTo(0, 0);
}

function renderSizes() {
    const container = document.getElementById('detail-sizes');
    if (!container) return;
    
    if (selectedSize === 'Único') {
        container.innerHTML = '<span class="text-sm text-gray-500">Tamanho Único</span>';
        return;
    }

    const sizes = ['P', 'M', 'G', 'GG'];
    container.innerHTML = sizes.map(s => `
        <button onclick="selectSize('${s}')" class="px-6 py-2 border text-xs tracking-widest transition ${selectedSize === s ? 'bg-black text-white border-black' : 'border-gray-200 hover:border-black'}">
            ${s}
        </button>
    `).join('');
}

function renderColors() {
    const container = document.getElementById('detail-colors');
    if (!container) return;
    container.innerHTML = currentProduct.cores.map(c => `
        <button onclick="selectColor('${c.nome}')" 
            class="w-8 h-8 rounded-full border-2 transition ${selectedColor === c.nome ? 'border-black scale-110' : 'border-transparent'}" 
            style="background-color: ${c.hex}" title="${c.nome}"></button>
    `).join('');
}

function selectSize(s) { selectedSize = s; renderSizes(); updateAddToCartButton(); }
function selectColor(n) { selectedColor = n; renderColors(); updateAddToCartButton(); }

function updateAddToCartButton() {
    const btn = document.getElementById('add-to-cart-button');
    const hasSize = selectedSize !== null;
    const hasColor = selectedColor !== null;
    btn.disabled = !(hasSize && hasColor);
    btn.style.opacity = (hasSize && hasColor) ? '1' : '0.5';
}

// --- CARRINHO ---

function toggleCart() {
    document.getElementById('cart-sidebar').classList.toggle('translate-x-full');
}

function addToCart() {
    const customInput = document.getElementById('product-custom-text');
    const customText = customInput ? customInput.value.trim() : '';

    if (customInput && !customText) {
        alert("Por favor, informe a personalização desejada.");
        return;
    }

    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    const item = {
        id: currentProduct.id,
        nome: currentProduct.nome,
        preco: precoFinal,
        tamanho: selectedSize,
        cor: currentProduct.cores.find(c => c.nome === selectedColor),
        personalizacao: customText,
        quantity: 1,
        imagem: currentProduct.imagens[0]
    };

    cart.push(item);
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
    toggleCart();
}

function updateCartUI() {
    const container = document.getElementById('cart-items-container');
    const subtotalEl = document.getElementById('cart-subtotal');
    
    if (cart.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 mt-20">O seu carrinho está vazio.</p>';
        subtotalEl.textContent = 'R$ 0,00';
        return;
    }

    let subtotal = 0;
    container.innerHTML = cart.map((item, index) => {
        subtotal += item.preco * item.quantity;
        return `
            <div class="flex gap-4 p-4 border-b">
                <img src="${item.imagem}" class="w-20 h-24 object-cover">
                <div class="flex-grow">
                    <h4 class="text-sm font-serif">${item.nome}</h4>
                    <p class="text-[10px] text-gray-500 uppercase tracking-widest mt-1">
                        ${item.tamanho} | ${item.cor.nome}
                        ${item.personalizacao ? ` | Letra: ${item.personalizacao}` : ''}
                    </p>
                    <div class="flex justify-between items-center mt-3">
                        <span class="text-sm font-medium">${formatarReal(item.preco)}</span>
                        <button onclick="removeFromCart(${index})" class="text-gray-400 hover:text-red-500"><i class="fa-solid fa-trash-can text-xs"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    subtotalEl.textContent = formatarReal(subtotal);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
}

// --- CHECKOUT VIA WHATSAPP ---

async function finalizeOrder() {
    if (cart.length === 0) return;

    let subtotal = cart.reduce((sum, i) => sum + (i.preco * i.quantity), 0);
    
    let msg = `*NOVO PEDIDO - LAMÉD*\n\n`;
    cart.forEach(item => {
        msg += `▪️ *${item.nome}*\n`;
        msg += `  Tamanho: ${item.tamanho} | Cor: ${item.cor.nome}\n`;
        if(item.personalizacao) msg += `  Personalização: ${item.personalizacao}\n`;
        msg += `  Qtd: ${item.quantity} | ${formatarReal(item.preco)}\n\n`;
    });
    
    msg += `*Total: ${formatarReal(subtotal)}*\n\n`;
    msg += `Gostaria de prosseguir com o pagamento.`;

    const url = `https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
}

// --- INICIALIZAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    loadStoreData();
    const savedCart = localStorage.getItem('lamedCart');
    if (savedCart) cart = JSON.parse(savedCart);
    updateCartUI();
});

function backToHome() {
    document.getElementById('product-detail-view').classList.add('hidden');
    document.getElementById('collection-gallery').classList.remove('hidden');
    window.scrollTo(0, 0);
}
