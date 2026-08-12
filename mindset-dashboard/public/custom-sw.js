self.addEventListener('push', function (event) {
  if (event.data) {
    try {
      const data = event.data.json();
      const title = data.title || 'Disciplix';
      const options = {
        body: data.body || 'Vous avez une nouvelle notification.',
        icon: data.icon || '/icon-192.png',
        badge: '/icon-192.png',
        data: {
          url: data.url || '/'
        }
      };

      event.waitUntil(self.registration.showNotification(title, options));
    } catch (e) {
      console.error('Error parsing push data', e);
    }
  }
});

/**
 * Ouvre l'application là où la notification l'a promis.
 *
 * L'ancienne version ne reprenait une fenêtre existante que si son adresse était
 * *exactement* celle de la notification. Or l'app tourne sur « / » et les
 * notifications visent « /?auth=true&vue=chat » : l'égalité stricte était donc
 * toujours fausse, et on retombait systématiquement sur openWindow(). Sur une PWA
 * installée sur iOS — le seul cas où iOS délivre le push — openWindow ne rouvre
 * rien de fiable quand l'app est déjà en arrière-plan. Résultat : la notification
 * arrive, on la touche, il ne se passe rien.
 *
 * On reprend maintenant n'importe quelle fenêtre de notre origine, on la met au
 * premier plan, puis on la renvoie vers l'adresse demandée. openWindow ne sert
 * plus que si aucune fenêtre n'est ouverte.
 */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const cible = new URL(event.notification.data?.url || '/', self.location.origin);

  event.waitUntil(
    (async () => {
      const fenetres = await clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const fenetre of fenetres) {
        if (new URL(fenetre.url).origin !== cible.origin) continue;

        // focus() d'abord : c'est lui qui ramène la PWA au premier plan, et il doit
        // partir pendant que le geste de l'utilisateur est encore « frais ».
        if ('focus' in fenetre) await fenetre.focus();

        // navigate() n'existe pas partout (Safari), et échoue sur une fenêtre que le
        // service worker ne contrôle pas. Ce n'est pas grave : la personne est déjà
        // devant l'app, elle a juste atterri sur l'écran précédent.
        if ('navigate' in fenetre && fenetre.url !== cible.href) {
          try {
            await fenetre.navigate(cible.href);
          } catch (e) {
            console.warn('Navigation impossible depuis la notification', e);
          }
        }
        return;
      }

      if (clients.openWindow) await clients.openWindow(cible.href);
    })()
  );
});
