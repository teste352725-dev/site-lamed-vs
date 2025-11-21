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

// HABILITAR PERSISTÊNCIA OFFLINE
// Isso permite que o app funcione mesmo se a rede falhar (comum em iframes)
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn('Persistência falhou: Múltiplas abas abertas.');
        } else if (err.code == 'unimplemented') {
            console.warn('Persistência não suportada pelo navegador.');
        }
    });

// Variáveis de Estado
let currentUser = null;
let unsubscribeChat = null;
let unsubscribeStatus = null; 

// Configurar Persistência de Auth
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(error => console.error("Erro na persistência de auth:", error));

// Solicitar permissão de notificação
if ("Notification" in window && Notification.permission !== "granted") {
    try { Notification.requestPermission(); } catch(e){}
}

// ============================================================================
// SISTEMA DE AUTENTICAÇÃO
// ============================================================================

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('user-panel').classList.remove('hidden');
        
        const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Cliente');
        document.getElementById('user-name').textContent = displayName;
        
        const avatarUrl = user.photoURL || `https://ui-avatars.com/api/?name=${displayName}&background=A58A5C&color=fff`;
        document.getElementById('user-avatar').src = avatarUrl;
        
        carregarMeusPedidos();
        carregarFavoritos();
        iniciarChat();
        
    } else {
        currentUser = null;
        if (unsubscribeChat) unsubscribeChat(); 
        if (unsubscribeStatus) unsubscribeStatus();
        
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('user-panel').classList.add('hidden');
    }
});

window.fazerLoginGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(erro => {
        console.error("Erro Login Google:", erro);
        let msg = erro.message;
        // Tratamento específico para ambiente restrito
        if (erro.code === 'auth/operation-not-supported-in-this-environment' || erro.code === 'auth/network-request-failed') {
            msg = "O login não é suportado neste ambiente de teste ou a rede foi bloqueada. Tente abrir o site em uma nova aba ou usar Email/Senha.";
        }
        mostrarErroLogin(msg);
    });
};

const emailForm = document.getElementById('email-form');
if (emailForm) {
    emailForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value;
        const pass = document.getElementById('pass-input').value;
        
        if (!email || !pass) {
            mostrarErroLogin("Por favor, preencha e-mail e senha.");
            return;
        }
        
        auth.signInWithEmailAndPassword(email, pass).catch(erro => {
            if(erro.code === 'auth/user-not-found') {
                auth.createUserWithEmailAndPassword(email, pass)
                    .then(() => { console.log("Nova conta criada."); })
                    .catch(e => mostrarErroLogin("Erro ao criar conta: " + e.message));
            } else if (erro.code === 'auth/network-request-failed') {
                 mostrarErroLogin("Erro de Conexão: O navegador bloqueou o acesso ao Firebase. Verifique sua internet ou configurações de privacidade.");
            } else {
                mostrarErroLogin("Erro no login: " + erro.message);
            }
        });
    });
}

function mostrarErroLogin(msg) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    } else {
        alert(msg);
    }
}

window.fazerLogout = () => auth.signOut();

// ============================================================================
// NAVEGAÇÃO (ABAS)
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
// MÓDULO: PEDIDOS
// ============================================================================

function carregarMeusPedidos() {
    if (!currentUser) return;
    const lista = document.getElementById('orders-list');
    if (!lista) return;
    
    // Usando onSnapshot com tratamento de erro para offline
    db.collection('pedidos')
      .where('userId', '==', currentUser.uid)
      .onSnapshot({ includeMetadataChanges: true }, snap => {
          lista.innerHTML = '';
          
          if (snap.empty) {
              lista.innerHTML = `
                <div class="text-center py-10">
                    <i class="fa-solid fa-bag-shopping text-4xl text-gray-200 mb-3"></i>
                    <p class="text-gray-500">Você ainda não fez nenhum pedido.</p>
                    <a href="index.html#colecao" class="text-[--cor-ouro] underline text-sm mt-2 block">Ir para a loja</a>
                </div>`;
              return;
          }
          
          const pedidos = snap.docs.map(d => ({id: d.id, ...d.data()}));
          pedidos.sort((a, b) => {
              const dateA = a.data && a.data.seconds ? a.data.seconds : 0;
              const dateB = b.data && b.data.seconds ? b.data.seconds : 0;
              return dateB - dateA;
          });

          pedidos.forEach(p => {
              const dataStr = p.data ? new Date(p.data.seconds * 1000).toLocaleDateString('pt-BR') : 'Data desc.';
              const statusColors = {
                  'pendente': 'bg-yellow-100 text-yellow-800',
                  'processando': 'bg-blue-100 text-blue-800',
                  'enviado': 'bg-purple-100 text-purple-800',
                  'entregue': 'bg-green-100 text-green-800',
                  'cancelado': 'bg-red-100 text-red-800'
              };
              
              let itensHtml = '';
              if (p.produtos && Array.isArray(p.produtos)) {
                  itensHtml = p.produtos.map(i => `
                      <div class="flex justify-between text-sm mt-1 text-gray-600 border-b border-gray-100 pb-1 last:border-0">
                          <span>${i.quantity}x ${i.nome} <span class="text-xs">(${i.tamanho}${i.cor ? ', '+i.cor.nome : ''})</span></span>
                          <span>R$ ${parseFloat(i.preco).toFixed(2)}</span>
                      </div>
                  `).join('');
              }

              const totalFormatado = parseFloat(p.total || 0).toFixed(2).replace('.',',');

              lista.innerHTML += `
                  <div class="bg-white p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow">
                      <div class="flex justify-between items-start mb-3 pb-2 border-b">
                          <div>
                              <span class="font-bold text-gray-800 text-lg">#${p.id.slice(0,6).toUpperCase()}</span>
                              <p class="text-xs text-gray-500 flex items-center mt-1">
                                <i class="fa-regular fa-calendar mr-1"></i> ${dataStr}
                              </p>
                          </div>
                          <span class="px-3 py-1 rounded-full text-xs font-bold uppercase ${statusColors[p.status] || 'bg-gray-100 text-gray-600'}">
                              ${p.status}
                          </span>
                      </div>
                      
                      <div class="mb-3 bg-gray-50 p-3 rounded text-sm">
                          ${itensHtml}
                      </div>
                      
                      <div class="flex justify-between items-center font-bold text-[--cor-marrom] text-lg">
                          <span>Total</span>
                          <span>R$ ${totalFormatado}</span>
                      </div>
                      
                      ${snap.metadata.fromCache ? '<div class="text-xs text-orange-500 mt-2 text-right"><i class="fa-solid fa-wifi-slash"></i> Modo Offline</div>' : ''}
                  </div>
              `;
          });
      }, error => {
          console.error("Erro pedidos:", error);
          lista.innerHTML = '<p class="text-center text-red-500 py-4">Não foi possível carregar seus pedidos (Erro de conexão).</p>';
      });
}

// ============================================================================
// MÓDULO: FAVORITOS (Com Fallback)
// ============================================================================

async function carregarFavoritos() {
    if (!currentUser) return;
    const grid = document.getElementById('favorites-grid');
    const empty = document.getElementById('no-favorites');
    
    if (!grid || !empty) return;

    try {
        const userDoc = await db.collection('usuarios').doc(currentUser.uid).get({ source: 'default' })
            .catch(async () => await db.collection('usuarios').doc(currentUser.uid).get({ source: 'cache' })); // Tenta cache se falhar
            
        if (!userDoc.exists) {
             empty.classList.remove('hidden');
             return;
        }

        const favIds = userDoc.data()?.favoritos || [];
        
        if (favIds.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        
        empty.classList.add('hidden');
        grid.innerHTML = '<div class="col-span-full text-center py-12"><i class="fa-solid fa-spinner fa-spin text-3xl text-[--cor-ouro]"></i></div>';

        // Buscar produtos ativos
        const snap = await db.collection('pecas').where('status', '==', 'active').get();
        
        const favoritos = snap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .filter(p => favIds.includes(p.id));

        grid.innerHTML = '';
        
        if (favoritos.length === 0) {
            empty.classList.remove('hidden'); 
            return;
        }

        favoritos.forEach(p => {
            const img = (p.imagens && p.imagens[0]) ? p.imagens[0] : 'https://placehold.co/300x400/eee/ccc?text=Sem+Imagem';
            
            grid.innerHTML += `
                <div class="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden group relative flex flex-col">
                    <div class="relative aspect-[3/4] bg-gray-100">
                        <img src="${img}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">
                        
                        <button onclick="removerFavorito('${p.id}')" class="absolute top-2 right-2 w-8 h-8 bg-white rounded-full text-red-500 shadow flex items-center justify-center hover:bg-red-50 transition z-10">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                    
                    <div class="p-3 text-center flex-1 flex flex-col justify-between">
                        <h4 class="text-sm font-medium truncate text-gray-800 mb-1">${p.nome}</h4>
                        <a href="index.html#/produto/${p.id}" class="text-xs bg-[--cor-marrom] text-white py-2 px-4 rounded-full block w-full hover:bg-[#4a2e18] transition">
                            Ver Detalhes
                        </a>
                    </div>
                </div>
            `;
        });

    } catch (e) {
        console.error("Erro favoritos:", e);
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500">Erro ao carregar favoritos. Verifique sua conexão.</p>';
    }
}

window.removerFavorito = async (id) => {
    if (!currentUser) return;
    const userRef = db.collection('usuarios').doc(currentUser.uid);
    try {
        await userRef.update({
            favoritos: firebase.firestore.FieldValue.arrayRemove(id)
        });
        carregarFavoritos(); 
    } catch (e) {
        console.error("Erro ao remover favorito:", e);
        alert("Erro ao remover (Offline?)");
    }
}

// ============================================================================
// MÓDULO: CHAT (WHATSAPP STYLE)
// ============================================================================

function iniciarChat() {
    if (!currentUser) return;
    const chatId = currentUser.uid;
    const messagesDiv = document.getElementById('chat-messages');
    
    configurarStatusAdmin(chatId);

    if (unsubscribeChat) unsubscribeChat();

    unsubscribeChat = db.collection('pedidos').doc('chat_global').collection(chatId)
       .orderBy('timestamp', 'asc')
       .onSnapshot({ includeMetadataChanges: true }, snap => {
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
           console.log("Chat offline ou erro de permissão:", error.message);
           messagesDiv.innerHTML += '<div class="text-center text-xs text-red-400 mt-2">Conexão instável. Mensagens podem demorar.</div>';
       });

    // Configurar envio
    const chatForm = document.getElementById('chat-form');
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
            
            await db.collection('pedidos').doc('chat_global').collection(chatId).add({
                text: text,
                sender: 'user',
                timestamp: timestamp,
                userName: currentUser.displayName || currentUser.email
            });
            
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
            alert("Erro ao enviar. Verifique sua conexão.");
            input.value = text; 
        }
    };
}

function rolarChatParaBaixo() {
    const div = document.getElementById('chat-messages');
    if (div) setTimeout(() => { div.scrollTop = div.scrollHeight; }, 100);
}

function configuringStatusAdmin(chatId) {
    const statusEl = document.querySelector('.bg-white .text-green-600'); 
    if (!statusEl) return;
    
    // Status estático "Atendimento" para evitar "Online" falso
    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-gray-400"></span> Atendimento`;
}

function configurarStatusAdmin(chatId) {
    // Placeholder se quiser implementar lógica real depois
    const statusEl = document.querySelector('.bg-white .text-green-600'); 
    if (statusEl) {
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-gray-400"></span> Atendimento`;
    }
}