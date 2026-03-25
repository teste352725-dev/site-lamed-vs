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
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_REMOTE_IMAGE_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'storage.googleapis.com',
    'ui-avatars.com',
    'lh3.googleusercontent.com'
]);

// Variáveis de Estado
let currentUser = null;
let unsubscribeChat = null;
let pushMessagingInstance = null;
let currentPushToken = "";
let pushConfigCache = null;
let pushRequestInFlight = false;
let pushForegroundListenerBound = false;

function resolveApiBaseUrl() {
    const configured = document.querySelector('meta[name="lamed-api-base-url"]')?.getAttribute('content')?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    try {
        const stored = window.localStorage.getItem('lamed_api_base_url')?.trim();
        if (stored) return stored.replace(/\/+$/, '');
    } catch (error) {}

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3001';
    }

    return '';
}

const API_BASE_URL = resolveApiBaseUrl();

function buildBackendUrl(pathname) {
    const safePath = String(pathname || '').startsWith('/') ? pathname : `/${pathname || ''}`;
    return API_BASE_URL ? `${API_BASE_URL}${safePath}` : safePath;
}

function sanitizePlainText(value, maxLength = 160) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizePhone(value) {
    return String(value ?? '')
        .replace(/[^\d+\-() ]/g, '')
        .trim()
        .slice(0, 30);
}

function normalizeImageUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        if (parsed.origin !== window.location.origin && !ALLOWED_REMOTE_IMAGE_HOSTS.has(parsed.hostname)) return '';
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function buildAvatarUrl(name) {
    const safeName = sanitizePlainText(name || 'U', 80) || 'U';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=A58A5C&color=fff`;
}

function getPushStatusElement() {
    return document.getElementById('push-status-text');
}

function setPushStatus(message) {
    const statusEl = getPushStatusElement();
    if (statusEl) {
        statusEl.textContent = sanitizePlainText(message, 220);
    }
}

function updatePushButtonsState({ enableDisabled = false, disableDisabled = false, enableLabel = 'Ativar neste aparelho' } = {}) {
    const enableBtn = document.getElementById('push-enable-btn');
    const disableBtn = document.getElementById('push-disable-btn');

    if (enableBtn) {
        enableBtn.disabled = enableDisabled;
        enableBtn.textContent = enableLabel;
        enableBtn.classList.toggle('opacity-60', enableDisabled);
        enableBtn.classList.toggle('cursor-not-allowed', enableDisabled);
    }

    if (disableBtn) {
        disableBtn.disabled = disableDisabled;
        disableBtn.classList.toggle('opacity-60', disableDisabled);
        disableBtn.classList.toggle('cursor-not-allowed', disableDisabled);
    }
}

async function fetchPushConfig() {
    if (pushConfigCache) return pushConfigCache;

    const response = await fetch(buildBackendUrl('/api/notifications/config'), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel carregar a configuracao de notificacoes.', 220));
    }

    pushConfigCache = payload;
    return pushConfigCache;
}

function getPushMessagingInstance() {
    if (pushMessagingInstance) return pushMessagingInstance;
    if (!firebase.messaging || typeof firebase.messaging !== 'function') return null;
    pushMessagingInstance = firebase.messaging();
    return pushMessagingInstance;
}

async function ensurePushServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Seu navegador nao oferece suporte completo a notificacoes web.');
    }

    return navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope'
    });
}

async function sendPushSubscriptionToBackend(pathname, token) {
    const authToken = await currentUser.getIdToken();
    const response = await fetch(buildBackendUrl(pathname), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
            token,
            permission: Notification.permission
        })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel atualizar sua inscricao de notificacoes.', 220));
    }

    return payload;
}

async function ativarPushNotifications() {
    if (pushRequestInFlight || !currentUser) return;
    pushRequestInFlight = true;
    updatePushButtonsState({ enableDisabled: true, disableDisabled: true, enableLabel: 'Ativando...' });

    try {
        const config = await fetchPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) {
            throw new Error('As notificacoes ainda nao foram configuradas pela loja.');
        }

        if (!('Notification' in window)) {
            throw new Error('Seu navegador nao suporta notificacoes.');
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Permissao de notificacao nao concedida.');
        }

        const messaging = getPushMessagingInstance();
        if (!messaging) {
            throw new Error('O navegador nao suportou o Firebase Messaging neste aparelho.');
        }

        const registration = await ensurePushServiceWorkerRegistration();
        const token = await messaging.getToken({
            vapidKey: config.vapidPublicKey,
            serviceWorkerRegistration: registration
        });

        if (!token) {
            throw new Error('Nao foi possivel gerar o token de notificacao deste aparelho.');
        }

        currentPushToken = token;
        await sendPushSubscriptionToBackend('/api/notifications/register', token);
        setPushStatus('Notificacoes ativas neste aparelho. Vamos avisar voce sobre pedidos e suporte.');
    } catch (error) {
        console.error('[push.enable]', error);
        setPushStatus(error?.message || 'Nao foi possivel ativar as notificacoes agora.');
    } finally {
        pushRequestInFlight = false;
        updatePushButtonsState();
    }
}

async function desativarPushNotifications() {
    if (pushRequestInFlight || !currentUser) return;
    pushRequestInFlight = true;
    updatePushButtonsState({ enableDisabled: true, disableDisabled: true, enableLabel: 'Ativar neste aparelho' });

    try {
        const messaging = getPushMessagingInstance();
        let token = currentPushToken;

        if (!token && messaging) {
            const config = await fetchPushConfig().catch(() => null);
            const registration = await ensurePushServiceWorkerRegistration().catch(() => null);
            if (config?.vapidPublicKey && registration) {
                token = await messaging.getToken({
                    vapidKey: config.vapidPublicKey,
                    serviceWorkerRegistration: registration
                }).catch(() => '');
            }
        }

        if (token) {
            await sendPushSubscriptionToBackend('/api/notifications/unregister', token);
            if (messaging && typeof messaging.deleteToken === 'function') {
                await messaging.deleteToken(token).catch(() => {});
            }
        }

        currentPushToken = '';
        setPushStatus('Notificacoes desativadas neste aparelho.');
    } catch (error) {
        console.error('[push.disable]', error);
        setPushStatus(error?.message || 'Nao foi possivel desativar as notificacoes agora.');
    } finally {
        pushRequestInFlight = false;
        updatePushButtonsState();
    }
}

async function iniciarNotificacoesWeb() {
    const enableBtn = document.getElementById('push-enable-btn');
    const disableBtn = document.getElementById('push-disable-btn');
    if (!enableBtn || !disableBtn) return;

    enableBtn.onclick = ativarPushNotifications;
    disableBtn.onclick = desativarPushNotifications;

    if (!currentUser) {
        setPushStatus('Entre na sua conta para ativar notificacoes neste aparelho.');
        updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
        return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !firebase.messaging) {
        setPushStatus('Este navegador nao oferece suporte completo a notificacoes web.');
        updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
        return;
    }

    try {
        const config = await fetchPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) {
            setPushStatus('As notificacoes ainda estao em configuracao na loja.');
            updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
            return;
        }

        if (Notification.permission === 'granted') {
            const messaging = getPushMessagingInstance();
            const registration = await ensurePushServiceWorkerRegistration();
            currentPushToken = await messaging.getToken({
                vapidKey: config.vapidPublicKey,
                serviceWorkerRegistration: registration
            }).catch(() => '');

            setPushStatus(
                currentPushToken
                    ? 'Notificacoes prontas neste aparelho.'
                    : 'Permissao concedida, mas o token ainda nao foi sincronizado. Toque para ativar novamente.'
            );

            if (!pushForegroundListenerBound && typeof messaging.onMessage === 'function') {
                pushForegroundListenerBound = true;
                messaging.onMessage((payload) => {
                    const title = sanitizePlainText(payload?.notification?.title || payload?.data?.title || 'Laméd vs', 120);
                    const body = sanitizePlainText(payload?.notification?.body || payload?.data?.body || 'Voce recebeu uma nova atualizacao.', 240);
                    if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
                        new Notification(title, { body });
                    }
                });
            }
        } else if (Notification.permission === 'denied') {
            setPushStatus('As notificacoes foram bloqueadas neste navegador. Libere nas configuracoes do aparelho para voltar a usar.');
        } else {
            setPushStatus('Ative as notificacoes para receber atualizacoes de pedido e suporte.');
        }
    } catch (error) {
        console.error('[push.init]', error);
        setPushStatus('Nao foi possivel carregar a configuracao de notificacoes agora.');
    } finally {
        updatePushButtonsState({ disableDisabled: !currentPushToken && Notification.permission !== 'granted' });
    }
}

// --- GERENCIAMENTO DE ESTADO ---

auth.onAuthStateChanged(async (user) => {
    const authContainer = document.getElementById('auth-container');
    const userPanel = document.getElementById('user-panel');

    if (user) {
        currentUser = user;
        if(authContainer) authContainer.classList.add('hidden');
        if(userPanel) userPanel.classList.remove('hidden');
        
        await carregarPerfilUsuario();
        await iniciarNotificacoesWeb();
        carregarMeusPedidos();
        carregarFavoritos();
        iniciarChat();
        applyTabFromHash();
        
    } else {
        currentUser = null;
        if (unsubscribeChat) {
            unsubscribeChat();
            unsubscribeChat = null;
        }
        currentPushToken = '';
        if(authContainer) authContainer.classList.remove('hidden');
        if(userPanel) userPanel.classList.add('hidden');
        switchAuthView('login');
        setPushStatus('Entre na sua conta para ativar notificacoes neste aparelho.');
        updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
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
        auth.signInWithEmailAndPassword(email, pass)
            .catch(() => alert("Nao foi possivel entrar com esse email e senha."));
    });
}

// --- CADASTRO COMPLETO ---
const regForm = document.getElementById('register-form');
if(regForm) {
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-pass').value;
        const nome = sanitizePlainText(document.getElementById('reg-nome').value, 60);
        const sobrenome = sanitizePlainText(document.getElementById('reg-sobrenome').value, 60);
        const phone = sanitizePhone(document.getElementById('reg-phone').value);
        
        const endereco = {
            cep: sanitizePlainText(document.getElementById('reg-cep').value, 12),
            cidade: sanitizePlainText(document.getElementById('reg-cidade').value, 80),
            rua: sanitizePlainText(document.getElementById('reg-rua').value, 120),
            numero: sanitizePlainText(document.getElementById('reg-numero').value, 40)
        };

        try {
            const btn = regForm.querySelector('button');
            btn.textContent = 'Criando conta...';
            btn.disabled = true;

            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            const user = userCred.user;
            const nomeCompleto = sanitizePlainText(`${nome} ${sobrenome}`, 80);
            
            await user.updateProfile({ displayName: nomeCompleto });
            
            await db.collection('usuarios').doc(user.uid).set({
                nome: nomeCompleto,
                email: email,
                telefone: phone,
                endereco: endereco,
                fotoUrl: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
        } catch(err) {
            const errorCode = String(err?.code || '');
            if (errorCode === 'auth/weak-password') {
                alert("A senha precisa ter pelo menos 6 caracteres.");
            } else if (errorCode === 'auth/invalid-email') {
                alert("Digite um email valido.");
            } else {
                alert("Nao foi possivel concluir o cadastro agora.");
            }
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
    
    const safeDisplayName = sanitizePlainText(currentUser.displayName || 'Cliente', 80) || 'Cliente';
    document.getElementById('user-name-display').textContent = safeDisplayName;
    const avatarEl = document.getElementById('user-avatar-display');
    
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const data = doc.data() || {};
        
        const photo = normalizeImageUrl(data.fotoUrl) || normalizeImageUrl(currentUser.photoURL) || buildAvatarUrl(safeDisplayName);
        if(avatarEl) avatarEl.src = photo;

        const editAvatar = document.getElementById('profile-edit-avatar');
        if(editAvatar) editAvatar.src = photo;
        
        document.getElementById('profile-photo-url').value = data.fotoUrl || '';
        document.getElementById('profile-nome').value = data.nome || safeDisplayName || '';
        document.getElementById('profile-phone').value = data.telefone || '';
        
        if(data.endereco) {
            document.getElementById('profile-cep').value = data.endereco.cep || '';
            document.getElementById('profile-cidade').value = data.endereco.cidade || '';
            document.getElementById('profile-rua').value = data.endereco.rua || '';
            document.getElementById('profile-numero').value = data.endereco.numero || '';
        }
    } catch(e) { console.error("Erro perfil:", e); }
}

// --- UPLOAD DE FOTO ---
window.uploadFotoPerfil = async (input) => {
    const file = input.files[0];
    if (!file || !currentUser) return;

    if (!String(file.type || '').startsWith('image/')) {
        alert("Selecione um arquivo de imagem valido.");
        input.value = '';
        return;
    }

    if (Number(file.size || 0) > MAX_PROFILE_IMAGE_BYTES) {
        alert("A imagem precisa ter no maximo 5 MB.");
        input.value = '';
        return;
    }

    const imgPreview = document.getElementById('profile-edit-avatar');
    imgPreview.style.opacity = '0.5';
    
    try {
        const ref = storage.ref(`profile_images/${currentUser.uid}_${Date.now()}`);
        await ref.put(file);
        const url = await ref.getDownloadURL();

        await currentUser.updateProfile({ photoURL: url });
        await db.collection('usuarios').doc(currentUser.uid).update({
            fotoUrl: url
        });

        imgPreview.src = url;
        document.getElementById('user-avatar-display').src = url;
        document.getElementById('profile-photo-url').value = url;
        alert("Foto de perfil atualizada!");

    } catch (error) {
        console.error("Erro no upload:", error);
        alert("Nao foi possivel enviar a imagem agora.");
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

        const nome = sanitizePlainText(document.getElementById('profile-nome').value, 80);
        const phone = sanitizePhone(document.getElementById('profile-phone').value);
        const fotoUrl = normalizeImageUrl(document.getElementById('profile-photo-url').value);
        const endereco = {
            cep: sanitizePlainText(document.getElementById('profile-cep').value, 12),
            cidade: sanitizePlainText(document.getElementById('profile-cidade').value, 80),
            rua: sanitizePlainText(document.getElementById('profile-rua').value, 120),
            numero: sanitizePlainText(document.getElementById('profile-numero').value, 40)
        };

        try {
            if(nome) {
                await currentUser.updateProfile({
                    displayName: nome,
                    photoURL: fotoUrl || normalizeImageUrl(currentUser.photoURL) || null
                });
            }
            
            await db.collection('usuarios').doc(currentUser.uid).set({
                nome, telefone: phone, fotoUrl, endereco
            }, { merge: true });
            
            alert("Dados atualizados!");
            location.reload(); 
        } catch(e) {
            alert("Nao foi possivel salvar suas alteracoes agora.");
            btn.textContent = 'Salvar Alterações';
            btn.disabled = false;
        }
    });
}

// --- NAVEGAÇÃO ---
function activateAccountTab(tab, trigger = null) {
    const safeTab = ['pedidos', 'favoritos', 'dados', 'chat'].includes(tab) ? tab : 'pedidos';
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${safeTab}`)?.classList.remove('hidden');

    document.querySelectorAll('.tab-btn').forEach((button) => {
        const tabName = button.getAttribute('onclick')?.match(/switchTab\('([^']+)'\)/)?.[1];
        button.classList.toggle('active', tabName === safeTab);
    });

    if (trigger?.currentTarget) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        trigger.currentTarget.classList.add('active');
    }

    if (window.location.hash !== `#${safeTab}`) {
        window.location.hash = safeTab;
    }

    if(safeTab === 'chat') rolarChatParaBaixo();
}

function applyTabFromHash() {
    const hashTab = String(window.location.hash || '').replace(/^#/, '');
    if (['pedidos', 'favoritos', 'dados', 'chat'].includes(hashTab)) {
        activateAccountTab(hashTab);
    }
}

window.switchTab = (tab) => {
    const trigger = typeof event !== 'undefined' ? event : null;
    activateAccountTab(tab, trigger);
}

window.addEventListener('hashchange', applyTabFromHash);

// --- PEDIDOS (ATUALIZADO) ---
function carregarMeusPedidos() {
    const list = document.getElementById('orders-list');
    if(!list || !currentUser) return;
    
    db.collection('pedidos')
        .where('userId', '==', currentUser.uid)
        .orderBy('data', 'desc')
        .onSnapshot(snap => {
            list.innerHTML = '';
            
            // MUDANÇA AQUI: Mensagem personalizada quando não há pedidos
            if(snap.empty) { 
                list.innerHTML = `
                    <div class="text-center py-12">
                        <i class="fa-solid fa-bag-shopping text-4xl text-gray-300 mb-4"></i>
                        <p class="text-gray-600 mb-4">Você ainda não realizou nenhum pedido.</p>
                        <a href="index.html" class="inline-block text-[#643f21] font-medium border-b border-[#643f21] pb-0.5 hover:text-[#A58A5C] hover:border-[#A58A5C] transition-colors">
                            Que tal dar uma olhada em nossos produtos?
                        </a>
                    </div>
                `;
                return; 
            }
            
            snap.forEach(doc => {
                const p = doc.data();
                const valorTotal = typeof p.total === 'number' ? p.total : 0;
                const totalFormatado = valorTotal.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
                
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

// --- FAVORITOS ---
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
            div.replaceChildren();
            snap.forEach(doc => {
                const msg = doc.data();
                const cls = msg.sender === 'user' ? 'msg-user' : 'msg-admin';
                const bubble = document.createElement('div');
                bubble.className = `mb-2 text-sm ${cls} break-words shadow-sm`;
                bubble.textContent = sanitizePlainText(msg.text, 1000);
                div.appendChild(bubble);
            });
            rolarChatParaBaixo();
        });

    const form = document.getElementById('chat-form');
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    newForm.onsubmit = async (e) => {
        e.preventDefault();
        const inp = document.getElementById('message-input');
        const text = sanitizePlainText(inp.value, 1000);
        if(!text) return;
        inp.value = '';
        const userName = sanitizePlainText(currentUser.displayName || 'Cliente', 80) || 'Cliente';
        
        const ts = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('chats').doc(chatId).collection('messages').add({
            text,
            sender: 'user',
            timestamp: ts,
            userName
        });
        await db.collection('chats_ativos').doc(chatId).set({
            lastMessage: text.slice(0, 140),
            lastUpdate: ts,
            userName,
            userId: chatId,
            unread: true
        }, {merge: true});
    }
}

function rolarChatParaBaixo() {
    const d = document.getElementById('chat-messages');
    if(d) setTimeout(() => d.scrollTop = d.scrollHeight, 100);
}
