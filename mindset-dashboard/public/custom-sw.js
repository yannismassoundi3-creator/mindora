/*
  Ce qu'on peut faire pour qu'une notification ne se perde pas, et ce qu'on ne peut
  pas faire.

  Rapporté par un utilisateur : « je la reçois bien, mais elle est au milieu de
  plein d'autres ». **Aucune application web ne peut se classer devant les autres
  dans le volet du téléphone.** Le rang y est décidé par le système et par les
  réglages de la personne ; sur Android nos notifications vivent toutes dans le
  salon de Chrome, sur iOS on ne contrôle rien du tout. Promettre l'inverse serait
  mentir, et bricoler pour l'obtenir ne produirait que du bruit.

  Restent trois leviers réels, et ils sont posés ici :

  - **`tag` : ne plus se faire concurrence à soi-même.** Deux notifications de même
    nature s'empilaient ; la seconde remplace désormais la première. Une pile de
    trois messages du même coach se lit comme du harcèlement et se balaie d'un
    geste — une seule, à jour, se lit.
  - **`renotify` : le remplacement doit se signaler.** Sans lui, remplacer se fait
    en silence, et la notification à jour arriverait sans que personne ne le sache.
  - **`requireInteraction` : ce qui a été demandé ne s'évapore pas.** Réservé aux
    rappels, que la personne a elle-même fixés à une heure précise. Une notification
    ambiante qui refuse de disparaître serait exactement l'inverse du service rendu.

  Les rappels ne sont jamais regroupés : chacun porte son propre texte et son propre
  `tag`. Les fondre ferait disparaître un rappel de 22 h 30 sous celui de 23 h,
  c'est-à-dire perdre ce que la personne avait demandé.
*/
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

      // `renotify` sans `tag` lève une TypeError et la notification n'est jamais
      // affichée : les deux vont ensemble, ou aucun des deux.
      if (data.tag) {
        options.tag = data.tag;
        options.renotify = true;
      }

      if (data.persistante) {
        options.requireInteraction = true;
        // Une vibration courte : c'est le seul signal qui traverse une poche.
        options.vibrate = [200, 100, 200];
      }

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
