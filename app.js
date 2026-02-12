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
try { app = firebase.app(); } catch (e) { app = firebase.initializeApp(appFirebaseConfig); }
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

// Formatação
const formatarReal = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Carregamento de Dados
async function loadStoreData() {
    const pSnap = await db.collection('pecas').where('status', '==', 'active').get();
    products = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    const cSnap = await db.collection('colecoes').get();
    activeCollections = cSnap.docs.map(d => ({id: d.id, ...d.data()}));
}

// Detalhe do Produto
function showProductDetail(id) {
    currentProduct = products.find(p => p.id === id);
    if (!currentProduct) return;
    
    selectedSize = null; selectedColor = null; 
    
    document.getElementById('detail-title').textContent = currentProduct.nome;
    document.getElementById('detail-description').innerHTML = currentProduct.descricao || '';
    
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    document.getElementById('detail-price').innerHTML = `
        <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(precoFinal)}</span>
        ${currentProduct.desconto > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(currentProduct.preco)}</span>` : ''}
    `;

    // Limpezas de UI anteriores
    ['mesa-posta-warning', 'combo-selector-container', 'custom-input-container'].forEach(id => {
        const el = document.getElementById(id); if(el) el.remove();
    });

    const containerPai = document.getElementById('add-to-cart-button').parentElement;

    // LÓGICA DE PERSONALIZAÇÃO INTEGRADA
    // Verifica o novo campo 'personalizavel' ou palavras-chave no nome para compatibilidade
    const isPersonalizavel = currentProduct.personalizavel === true || 
                            currentProduct.nome.toLowerCase().includes('letra') || 
                            currentProduct.nome.toLowerCase().includes('personaliz');

    if (isPersonalizavel) {
        const customDiv = document.createElement('div');
        customDiv.id = 'custom-input-container';
        customDiv.className = 'mb-6 mt-4 p-4 bg-gray-50 border border-gray-200 rounded';
        customDiv.innerHTML = `
            <label class="block text-xs font-bold uppercase tracking-widest text-gray-700 mb-2">
                Personalização (Qual Letra ou Nome?) <span class="text-red-500">*</span>
            </label>
            <input type="text" id="product-custom-text" class="w-full border border-gray-300 p-2.5 rounded text-sm focus:border-[#A58A5C] outline-none" placeholder="Ex: Letra A, Família Silva...">
            <p class="text-[10px] text-gray-400 mt-1">Insira as informações para este item.</p>
        `;
        containerPai.insertBefore(customDiv, document.getElementById('add-to-cart-button'));
    }

    // Lógica de Categoria Especial (Mesa Posta)
    if (['lugar_americano', 'guardanapo', 'caminho_mesa', 'porta_guardanapo'].includes(currentProduct.categoria)) {
        selectedSize = 'Único';
        const warningDiv = document.createElement('div');
        warningDiv.id = 'mesa-posta-warning';
        warningDiv.className = 'bg-orange-50 text-[#643f21] text-xs p-3 rounded mb-4 flex gap-2';
        warningDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>Valor referente a 1 unidade avulsa.</span>`;
        containerPai.insertBefore(warningDiv, document.getElementById('add-to-cart-button'));
    }

    renderColors();
    updateAddToCartButton();
    
    document.getElementById('collection-gallery').classList.add('hidden');
    document.getElementById('product-detail-view').classList.remove('hidden');
    window.scrollTo(0,0);
}

function renderColors() {
    const container = document.getElementById('detail-colors');
    if(!container) return;
    container.innerHTML = currentProduct.cores.map(c => `
        <button onclick="selectColor('${c.nome}')" class="w-8 h-8 rounded-full border-2 transition ${selectedColor === c.nome ? 'border-black scale-110' : 'border-transparent'}" style="background-color: ${c.hex}" title="${c.nome} (${c.quantidade} em estoque)"></button>
    `).join('');
}

function selectColor(nome) { selectedColor = nome; renderColors(); updateAddToCartButton(); }

function updateAddToCartButton() {
    const btn = document.getElementById('add-to-cart-button');
    const isValid = (selectedSize || currentProduct.categoria === 'combo') && selectedColor;
    btn.disabled = !isValid;
    btn.style.opacity = isValid ? '1' : '0.5';
}

function addToCart() {
    const customInput = document.getElementById('product-custom-text');
    const customText = customInput ? customInput.value.trim() : '';

    if (customInput && !customText) {
        alert("Por favor, preencha o campo de personalização.");
        return;
    }

    const item = {
        id: currentProduct.id,
        nome: currentProduct.nome,
        preco: currentProduct.preco * (1 - (currentProduct.desconto||0)/100),
        tamanho: selectedSize,
        cor: currentProduct.cores.find(c => c.nome === selectedColor),
        personalizacao: customText,
        quantity: 1,
        imagem: currentProduct.imagens[0]
    };

    cart.push(item);
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    alert("Produto adicionado!");
}
