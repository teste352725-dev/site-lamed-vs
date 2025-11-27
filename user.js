// Configurações do Firebase
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
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Variáveis de Estado
let currentUser = null;
let unsubscribeChat = null;

// --- GERENCIAMENTO DE ESTADO ---

auth.onAuthStateChanged(async (user) => {
    const authContainer = document.getElementById('auth-container');
    const userPanel = document.getElementById('user-panel');

    if (user) {
        currentUser = user;
        if(authContainer) authContainer.classList.add('hidden');
        if(userPanel) userPanel.classList.remove('hidden');
        
        await carregarPerfilUsuario();
        carregarMeusPedidos();
        carregarFavoritos(); // Carrega os favoritos ao logar
        iniciarChat();
        
    } else {
        currentUser = null;
        if(authContainer) authContainer.classList.remove('hidden');
        if(userPanel) userPanel.classList.add('hidden');
        switchAuthView('login');
    }
});

window.switchAuthView = (view) => {
    document.querySelectorAll('.auth-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
}

// --- LOGIN ---
const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-pass').value;
        auth.signInWithEmailAndPassword(email, pass).catch(err => alert("Erro: " + err.message));
    });
}

// --- CADASTRO COMPLETO ---
const regForm = document.getElementById('register-form');
if(regForm) {
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-pass').value;
        const nome = document.getElementById('reg-nome').value;
        const sobrenome = document.getElementById('reg-sobrenome').value;
        const phone = document.getElementById('reg-phone').value;
        
        const endereco = {
            cep: document.getElementById('reg-cep').value,
            cidade: document.getElementById('reg-cidade').value,
            rua: document.getElementById('reg-rua').value,
            numero: document.getElementById('reg-numero').value
        };

        try {
            const btn = regForm.querySelector('button');
            btn.textContent = 'Criando conta...';
            btn.disabled = true;

            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            const user = userCred.user;
            const nomeCompleto = `${nome} ${sobrenome}`;
            
            await user.updateProfile({ displayName: nomeCompleto });
            
            // Salva dados extras no Firestore
            await db.collection('usuarios').doc(user.uid).set({
                nome: nomeCompleto,
                email: email,
                telefone: phone,
                endereco: endereco,
                fotoUrl: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
        } catch(err) {
            alert("Erro no cadastro: " + err.message);
            const btn = regForm.querySelector('button');
            btn.textContent = 'Finalizar Cadastro';
            btn.disabled = false;
        }
    });
}

// --- GOOGLE LOGIN ---
window.fazerLoginGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(async (result) => {
        const user = result.user;
        const docRef = db.collection('usuarios').doc(user.uid);
        const docSnap = await docRef.get();
        
        if (!docSnap.exists) {
            await docRef.set({
                nome: user.displayName,
                email: user.email,
                fotoUrl: user.photoURL,
                telefone: '',
                endereco: {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    }).catch(err => console.error(err));
};

window.fazerLogout = () => auth.signOut();

// --- PERFIL E DADOS ---

async function carregarPerfilUsuario() {
    if(!currentUser) return;
    
    // Atualiza Header
    document.getElementById('user-name-display').textContent = currentUser.displayName || 'Cliente';
    const avatarEl = document.getElementById('user-avatar-display');
    
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const data = doc.data() || {};
        
        const photo = data.fotoUrl || currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName || 'U'}&background=A58A5C&color=fff`;
        if(avatarEl) avatarEl.src = photo;

        // Preenche formulário de edição
        const editAvatar = document.getElementById('profile-edit-avatar');
        if(editAvatar) editAvatar.src = photo;
        
        document.getElementById('profile-photo-url').value = data.fotoUrl || '';
        document.getElementById('profile-nome').value = data.nome || currentUser.displayName || '';
        document.getElementById('profile-phone').value = data.telefone || '';
        
        if(data.endereco) {
            document.getElementById('profile-cep').value = data.endereco.cep || '';
            document.getElementById('profile-cidade').value = data.endereco.cidade || '';
            document.getElementById('profile-rua').value = data.endereco.rua || '';
            document.getElementById('profile-numero').value = data.endereco.numero || '';
        }
    } catch(e) { console.error("Erro perfil:", e); }
}

// --- UPLOAD DE FOTO (NOVO) ---
window.uploadFotoPerfil = async (input) => {
    const file = input.files[0];
    if (!file || !currentUser) return;

    const imgPreview = document.getElementById('profile-edit-avatar');
    // Preview imediato
    imgPreview.style.opacity = '0.5';
    
    try {
        // Upload para o Storage
        const ref = storage.ref(`profile_images/${currentUser.uid}_${Date.now()}`);
        await ref.put(file);
        const url = await ref.getDownloadURL();

        // Atualiza no Firestore e Auth
        await currentUser.updateProfile({ photoURL: url });
        await db.collection('usuarios').doc(currentUser.uid).update({
            fotoUrl: url
        });

        // Atualiza UI
        imgPreview.src = url;
        document.getElementById('user-avatar-display').src = url;
        document.getElementById('profile-photo-url').value = url;
        alert("Foto de perfil atualizada!");

    } catch (error) {
        console.error("Erro no upload:", error);
        alert("Erro ao enviar imagem: " + error.message);
    } finally {
        imgPreview.style.opacity = '1';
        input.value = '';
    }
};

// Salvar Perfil
const profileForm = document.getElementById('profile-form');
if(profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = profileForm.querySelector('button');
        btn.textContent = 'Salvando...';
        btn.disabled = true;

        const nome = document.getElementById('profile-nome').value;
        const phone = document.getElementById('profile-phone').value;
        const fotoUrl = document.getElementById('profile-photo-url').value;
        const endereco = {
            cep: document.getElementById('profile-cep').value,
            cidade: document.getElementById('profile-cidade').value,
            rua: document.getElementById('profile-rua').value,
            numero: document.getElementById('profile-numero').value
        };

        try {
            if(nome) await currentUser.updateProfile({ displayName: nome, photoURL: fotoUrl || currentUser.photoURL });
            
            await db.collection('usuarios').doc(currentUser.uid).set({
                nome, telefone: phone, fotoUrl, endereco
            }, { merge: true });
            
            alert("Dados atualizados!");
            location.reload(); 
        } catch(e) {
            alert("Erro ao salvar: " + e.message);
            btn.textContent = 'Salvar Alterações';
            btn.disabled = false;
        }
    });
}

// --- NAVEGAÇÃO ---
window.switchTab = (tab) => {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(tab === 'chat') rolarChatParaBaixo();
}

// --- PEDIDOS (Melhorado) ---
function carregarMeusPedidos() {
    const list = document.getElementById('orders-list');
    if(!list || !currentUser) return;
    
    // Consulta por userId
    db.collection('pedidos')
        .where('userId', '==', currentUser.uid)
        .orderBy('data', 'desc')
        .onSnapshot(snap => {
            list.innerHTML = '';
            if(snap.empty) { 
                list.innerHTML = '<div class="text-center py-10"><i class="fa-solid fa-basket-shopping text-4xl text-gray-200 mb-3"></i><p class="text-gray-400">Você ainda não fez pedidos.</p></div>'; 
                return; 
            }
            
            snap.forEach(doc => {
                const p = doc.data();
                // Verificação de segurança para o total
                const valorTotal = typeof p.total === 'number' ? p.total : 0;
                const totalFormatado = valorTotal.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
                
                // Formatação da data
                let dataPedido = 'Data desconhecida';
                if(p.data && p.data.seconds) {
                    dataPedido = new Date(p.data.seconds*1000).toLocaleDateString('pt-BR');
                }

                let itensHtml = (p.produtos || []).map(i => `
                    <div class="flex justify-between text-xs text-gray-500 mt-1 border-b border-gray-50 pb-1 last:border-0">
                        <span>${i.quantity}x ${i.nome} - <span class="text-[10px] bg-gray-100 px-1 rounded">${i.tamanho || 'U'}</span></span>
                        <span>${(i.preco * i.quantity).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                    </div>
                `).join('');

                list.innerHTML += `
                    <div class="bg-white border border-gray-100 p-5 rounded-lg shadow-sm hover:shadow-md transition">
                        <div class="flex justify-between mb-3 border-b border-gray-50 pb-2">
                            <div>
                                <span class="font-bold text-gray-800">#${doc.id.slice(0,6).toUpperCase()}</span>
                                <span class="text-xs text-gray-400 block">${dataPedido}</span>
                            </div>
                            <span class="text-xs px-3 py-1 rounded-full uppercase tracking-wider font-bold ${getStatusClass(p.status)} h-fit flex items-center">${p.status}</span>
                        </div>
                        <div class="mb-3 space-y-1">${itensHtml}</div>
                        <div class="text-right">
                            <span class="text-xs text-gray-400 mr-2">Total</span>
                            <span class="font-serif text-lg text-[#643f21] font-bold">${totalFormatado}</span>
                        </div>
                    </div>
                `;
            });
        });
}

function getStatusClass(status) {
    if(status === 'entregue') return 'text-green-600 bg-green-50';
    if(status === 'cancelado') return 'text-red-600 bg-red-50';
    if(status === 'enviado') return 'text-blue-600 bg-blue-50';
    return 'text-yellow-600 bg-yellow-50';
}

// --- FAVORITOS (NOVO) ---
async function carregarFavoritos() {
    const grid = document.getElementById('favorites-grid');
    if (!grid || !currentUser) return;

    try {
        const userDoc = await db.collection('usuarios').doc(currentUser.uid).get();
        const favoritosIds = userDoc.data()?.favoritos || [];

        if (favoritosIds.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center py-10"><i class="fa-regular fa-heart text-4xl text-gray-200 mb-3"></i><p class="text-gray-400">Sua lista de desejos está vazia.</p></div>';
            return;
        }

        // Busca os detalhes de cada produto favoritado
        grid.innerHTML = '<p class="col-span-full text-center text-sm text-gray-400">Carregando...</p>';
        
        const promises = favoritosIds.map(id => db.collection('pecas').doc(id).get());
        const snapshots = await Promise.all(promises);
        
        grid.innerHTML = '';
        let itemsFound = 0;

        snapshots.forEach(doc => {
            if (doc.exists) {
                itemsFound++;
                const p = doc.data();
                const img = (p.imagens && p.imagens[0]) ? p.imagens[0] : '';
                const preco = parseFloat(p.preco || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
                
                grid.innerHTML += `
                    <div class="bg-white border border-gray-100 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition cursor-pointer group" onclick="window.location.href='index.html#/produto/${doc.id}'">
                        <div class="aspect-[3/4] relative bg-gray-50">
                            <img src="${img}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                        </div>
                        <div class="p-3 text-center">
                            <h4 class="text-sm font-medium text-gray-800 truncate">${p.nome}</h4>
                            <p class="text-xs text-[#643f21] font-bold mt-1">${preco}</p>
                        </div>
                    </div>
                `;
            }
        });

        if (itemsFound === 0) {
            grid.innerHTML = '<p class="col-span-full text-center text-gray-400">Produtos não encontrados.</p>';
        }

    } catch (e) {
        console.error("Erro ao carregar favoritos:", e);
        grid.innerHTML = '<p class="col-span-full text-center text-red-400">Erro ao carregar.</p>';
    }
}

// --- CHAT ---
function iniciarChat() {
    if (!currentUser) return;
    const chatId = currentUser.uid;
    const div = document.getElementById('chat-messages');
    if(!div) return;

    if (unsubscribeChat) unsubscribeChat();
    unsubscribeChat = db.collection('chats').doc(chatId).collection('messages').orderBy('timestamp')
        .onSnapshot(snap => {
            div.innerHTML = '';
            snap.forEach(doc => {
                const msg = doc.data();
                const cls = msg.sender === 'user' ? 'msg-user' : 'msg-admin';
                div.innerHTML += `<div class="mb-2 text-sm ${cls} break-words shadow-sm">${msg.text}</div>`;
            });
            rolarChatParaBaixo();
        });

    const form = document.getElementById('chat-form');
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    newForm.onsubmit = async (e) => {
        e.preventDefault();
        const inp = document.getElementById('message-input');
        const text = inp.value.trim();
        if(!text) return;
        inp.value = '';
        
        const ts = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('chats').doc(chatId).collection('messages').add({
            text, sender: 'user', timestamp: ts, userName: currentUser.displayName
        });
        await db.collection('chats_ativos').doc(chatId).set({
            lastMessage: text, lastUpdate: ts, userName: currentUser.displayName, userId: chatId, unread: true
        }, {merge: true});
    }
}

function rolarChatParaBaixo() {
    const d = document.getElementById('chat-messages');
    if(d) setTimeout(() => d.scrollTop = d.scrollHeight, 100);
}
