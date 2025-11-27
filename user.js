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
        iniciarChat();
        
    } else {
        currentUser = null;
        if(authContainer) authContainer.classList.remove('hidden');
        if(userPanel) userPanel.classList.add('hidden');
        
        // Padrão: mostrar login
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
            
            // Sucesso: o onAuthStateChanged cuidará do redirecionamento
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
        
        // Se primeiro login, cria doc
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
    
    // Busca dados do Firestore
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const data = doc.data() || {};
        
        const photo = data.fotoUrl || currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}&background=A58A5C&color=fff`;
        avatarEl.src = photo;

        // Preenche formulário de edição
        document.getElementById('profile-edit-avatar').src = photo;
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

// --- PEDIDOS ---
function carregarMeusPedidos() {
    const list = document.getElementById('orders-list');
    if(!list) return;
    
    db.collection('pedidos').where('userId', '==', currentUser.uid).orderBy('data', 'desc')
        .onSnapshot(snap => {
            list.innerHTML = '';
            if(snap.empty) { list.innerHTML = '<p class="text-center text-gray-400 py-10">Você ainda não tem pedidos.</p>'; return; }
            
            snap.forEach(doc => {
                const p = doc.data();
                const total = p.total ? p.total.toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) : 'R$ 0,00';
                
                let itensHtml = (p.produtos || []).map(i => `
                    <div class="flex justify-between text-xs text-gray-500 mt-1 border-b border-gray-50 pb-1">
                        <span>${i.quantity}x ${i.nome}</span>
                        <span>${(i.preco * i.quantity).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                    </div>
                `).join('');

                list.innerHTML += `
                    <div class="bg-white border border-gray-100 p-5 rounded-lg shadow-sm hover:shadow-md transition mb-4">
                        <div class="flex justify-between mb-3 border-b border-gray-50 pb-2">
                            <div>
                                <span class="font-bold text-gray-800">#${doc.id.slice(0,6).toUpperCase()}</span>
                                <span class="text-xs text-gray-400 block">${new Date(p.data.seconds*1000).toLocaleDateString()}</span>
                            </div>
                            <span class="text-xs px-3 py-1 rounded-full uppercase tracking-wider font-bold ${getStatusClass(p.status)} h-fit">${p.status}</span>
                        </div>
                        <div class="mb-3">${itensHtml}</div>
                        <div class="text-right font-serif text-xl text-[--cor-marrom]">${total}</div>
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
