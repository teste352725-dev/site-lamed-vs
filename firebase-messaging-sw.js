self.addEventListener('notificationclick', (event) => {
  const targetUrl = event.notification?.data?.link || 'https://www.lamedvs.com.br/minha-conta.html#pedidos';
  event.notification.close();

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        client.navigate(targetUrl).catch(() => {});
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }

    return undefined;
  })());
});

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U',
    authDomain: 'site-lamed.firebaseapp.com',
    databaseURL: 'https://site-lamed-default-rtdb.firebaseio.com',
    projectId: 'site-lamed',
    storageBucket: 'site-lamed.firebasestorage.app',
    messagingSenderId: '862756160215',
    appId: '1:862756160215:web:d0fded233682bf93eaa692',
    measurementId: 'G-BL1G961PGT'
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const notification = payload?.notification || {};
    const data = payload?.data || {};
    const title = String(notification.title || data.title || 'Laméd vs').slice(0, 120);
    const body = String(notification.body || data.body || 'Você recebeu uma nova atualização.').slice(0, 240);
    const link = String(payload?.fcmOptions?.link || data.link || 'https://www.lamedvs.com.br/minha-conta.html#pedidos');
    const icon = String(notification.icon || data.icon || 'https://i.ibb.co/mr93jDHT/JM.png');

    self.registration.showNotification(title, {
      body,
      icon,
      data: {
        link
      }
    });
  });
} catch (error) {
  console.warn('[firebase-messaging-sw] Messaging indisponível neste ambiente.', error);
}
