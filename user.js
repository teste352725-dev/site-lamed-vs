// ============================================================================
// CONFIGURAÇÃO FIREBASE
// ============================================================================
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

// Inicialização Segura
let app;
try {
    app = firebase.app();
} catch (e) {
    app = firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Tratamento silencioso da persistência para evitar erros no console
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        console.log("Modo offline desativado (Ambiente restrito ou múltiplas abas).");
    });

// Variáveis de Estado
let currentUser = null;
let unsubscribeChat = null;

// ============================================================================
// SISTEMA DE AUTENTICAÇÃO
// ============================================================================

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        const loginScreen = document.getElementById('login-screen');
        const userPanel = document.getElementById('user-panel');
        
        if(loginScreen) loginScreen.classList.add('hidden');
        if(userPanel) userPanel.classList.remove('hidden');
        
        const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Cliente');
        const nameEl = document.getElementById('user-name');
        if(nameEl) nameEl.textContent = displayName;
        
        const avatarEl = document.getElementById('user-avatar');
        if(avatarEl) {
            avatarEl.src = user.photoURL || `https://ui-avatars.com/api/?name=${displayName}&background=A58A5C&color=fff`;
        }
        
        if(typeof carregarMeusPedidos === 'function') carregarMeusPedidos();
        if(typeof carregarFavoritos === 'function') carregarFavoritos();
        iniciarChat();
        
    } else {
        currentUser = null;
        if (unsubscribeChat) unsubscribeChat(); 
        
        const loginScreen = document.getElementById('login-screen');
        const userPanel = document.getElementById('user-panel');
        
        if(loginScreen) loginScreen.classList.remove('hidden');
        if(userPanel) userPanel.classList.add('hidden');
    }
});

window.fazerLoginGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(erro => {
        console.error("Erro Login Google:", erro);
        let msg = erro.message;
        if (erro.code === 'auth/operation-not-supported-in-this-environment' || erro.code === 'auth/network-request-failed') {
            msg = "Login bloqueado pelo navegador. Desative bloqueadores de anúncio (AdBlock) e tente novamente.";
        }
        alert(msg);
    });
};

window.fazerLogout = () => auth.signOut();

// ============================================================================
// NAVEGAÇÃO
// ============================================================================

window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.remove('hidden');
    
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    
    if(tabName === 'chat') rolarChatParaBaixo();
};

// ============================================================================
// MÓDULO: CHAT (CORRIGIDO)
// ============================================================================

function iniciarChat() {
    if (!currentUser) return;
    const chatId = currentUser.uid;
    const messagesDiv = document.getElementById('chat-messages');
    
    // Status visual
    const statusEl = document.querySelector('.text-green-600'); 
    if (statusEl) statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500"></span> Online`;

    if (unsubscribeChat) unsubscribeChat();

    // NOVA ESTRUTURA: /chats/{userId}/messages
    unsubscribeChat = db.collection('chats').doc(chatId).collection('messages')
       .orderBy('timestamp', 'asc')
       .onSnapshot(snap => {
           messagesDiv.innerHTML = '';
           
           if (snap.empty) {
               messagesDiv.innerHTML = `
                   <div class="flex flex-col items-center justify-center h-full text-gray-400 space-y-2 opacity-70">
                       <i class="fa-regular fa-comments text-4xl"></i>
                       <p class="text-xs bg-white/80 py-1 px-4 rounded-full shadow-sm">Inicie a conversa com nossa equipe.</p>
                   </div>`;
           }
           
           snap.forEach(doc => {
               const msg = doc.data();
               const isMe = msg.sender === 'user';
               
               let timeString = '...';
               if (msg.timestamp) {
                   const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp.seconds * 1000);
                   timeString = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
               }

               messagesDiv.innerHTML += `
                   <div class="msg-bubble ${isMe ? 'msg-user' : 'msg-admin'} shadow-sm flex flex-col">
                       <span class="text-sm">${msg.text}</span>
                       <span class="text-[9px] opacity-50 self-end mt-1 font-mono">${timeString}</span>
                   </div>
               `;
           });
           
           rolarChatParaBaixo();
       }, error => {
           console.error("Erro Chat:", error);
           if(error.code === 'permission-denied') {
               messagesDiv.innerHTML = '<div class="text-center text-xs text-red-500 mt-2 bg-red-100 p-2 rounded">Erro de permissão. Verifique se você está logado.</div>';
           } else {
               messagesDiv.innerHTML = '<div class="text-center text-xs text-red-500 mt-2 bg-red-100 p-2 rounded">Conexão bloqueada. Desative seu AdBlock.</div>';
           }
       });

    // Configurar envio
    const chatForm = document.getElementById('chat-form');
    // Remove listeners antigos clonando o elemento
    const newChatForm = chatForm.cloneNode(true);
    chatForm.parentNode.replaceChild(newChatForm, chatForm);

    newChatForm.onsubmit = async (e) => {
        e.preventDefault();
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text) return;
        
        input.value = ''; 
        
        try {
            const timestamp = firebase.firestore.FieldValue.serverTimestamp();
            
            // 1. Salva a mensagem na coleção correta
            await db.collection('chats').doc(chatId).collection('messages').add({
                text: text,
                sender: 'user',
                timestamp: timestamp,
                userName: currentUser.displayName || currentUser.email
            });
            
            // 2. Atualiza o status na lista do admin
            await db.collection('chats_ativos').doc(chatId).set({
                lastMessage: text,
                lastUpdate: timestamp,
                userName: currentUser.displayName || currentUser.email,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                unread: true 
            }, { merge: true });
            
            rolarChatParaBaixo();
            
        } catch (err) {
            console.error("Erro envio:", err);
            alert("Erro ao enviar. Se você tem um bloqueador de anúncios, desative-o.");
            input.value = text; // Devolve o texto para não perder
        }
    };
}

function rolarChatParaBaixo() {
    const div = document.getElementById('chat-messages');
    if (div) setTimeout(() => { div.scrollTop = div.scrollHeight; }, 100);
}
