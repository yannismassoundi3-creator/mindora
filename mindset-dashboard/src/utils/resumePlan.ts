/**
 * Ce que le plan a réellement installé, écrit sous la réponse du coach.
 *
 * ## Le problème, tel qu'un utilisateur l'a formulé
 *
 * « L'IA semble assez limitée, elle m'a donné des exos pas trop spécifiques »
 * — retour d'un utilisateur, 27 août 2026, après avoir demandé un programme de
 * calisthénie. Or le plan qu'il avait reçu ce jour-là contenait sept à neuf
 * exercices nommés et chiffrés. **Il ne les avait pas lus dans le chat.**
 *
 * Le schéma du plan interdit au coach de commenter son bloc — à raison : le JSON
 * s'applique tout seul, et le recopier en prose fait dépasser le plafond de
 * jetons, ce qui coupe le bloc en plein milieu. La conversation affichait donc
 * deux phrases de constat, puis « ✅ Plan appliqué avec succès ! L'interface a
 * été mise à jour. » Tout le travail était derrière un changement d'écran, et
 * quelqu'un qui reste dans le chat conclut que le coach n'a presque rien dit.
 *
 * Ce résumé n'est pas écrit par le modèle : il est composé à partir de ce qui
 * vient d'être écrit dans les listes. Il ne coûte donc aucun jeton, il ne peut
 * pas être tronqué, et il ne peut pas mentir sur ce qui a été installé.
 *
 * ## Pourquoi il ne se déduit pas du bloc `<PLAN>`
 *
 * `applyPlanData` écarte les doublons (`nouveautes`) : redemander le même plan
 * n'installe rien du tout. Résumer le JSON reçu annoncerait alors neuf tâches
 * dont aucune n'existe — exactement la panne muette que ce projet paie en boucle.
 * Le résumé se construit donc à l'écriture, ligne par ligne, et le cas « rien de
 * neuf » se dit au lieu de se déguiser en succès.
 */

/** Ce qui a été écrit dans les listes, dans l'ordre où ça l'a été. */
export interface PlanInstalle {
  /** Le créneau est déjà lisible : « Matin », « Midi », « Soir ». */
  taches: { creneau: string; titre: string }[];
  habitudes: string[];
  repas: string[];
  objectifs: string[];
}

export function planInstalleVide(): PlanInstalle {
  return { taches: [], habitudes: [], repas: [], objectifs: [] };
}

/**
 * Au-delà, la liste cesse d'être lisible dans une bulle de conversation et
 * redevient ce qu'on cherchait à éviter : un mur qu'on ne lit pas.
 */
const MAX_LISTE = 10;

function enumerer(valeurs: string[]): string {
  const gardes = valeurs.slice(0, MAX_LISTE);
  const reste = valeurs.length - gardes.length;
  return gardes.join(' · ') + (reste > 0 ? ` · +${reste}` : '');
}

function accorder(n: number, singulier: string, pluriel = singulier + 's'): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

/**
 * La phrase — ou le bloc — ajoutée sous la réponse du coach.
 *
 * Rend une chaîne vide quand rien n'a été touché **et** que rien n'était proposé :
 * l'appelant a d'autres messages pour les cas d'échec, et coller un résumé vide
 * sous une réponse ordinaire ferait du bruit à chaque message.
 */
export function resumerPlanInstalle(installe: PlanInstalle): string {
  const { taches, habitudes, repas, objectifs } = installe;
  const total = taches.length + habitudes.length + repas.length + objectifs.length;
  if (total === 0) return '';

  const compte: string[] = [];
  if (taches.length) compte.push(accorder(taches.length, 'tâche'));
  if (habitudes.length) compte.push(accorder(habitudes.length, 'habitude'));
  if (repas.length) compte.push(accorder(repas.length, 'repas', 'repas'));
  if (objectifs.length) compte.push(accorder(objectifs.length, 'objectif'));

  /*
    Une liste Markdown, et non des lignes séparées par un simple retour.

    La conversation passe par `ReactMarkdown` sans `remark-breaks` : un retour à
    la ligne isolé y vaut une espace, et les quatre lignes de ce résumé se
    colleraient en un seul paragraphe — soit le mur de texte qu'on veut éviter.
  */
  const lignes: string[] = [];

  // Les créneaux dans l'ordre de la journée, et seulement ceux qui ont reçu
  // quelque chose : une ligne « Midi : » vide ferait croire à un oubli.
  for (const creneau of ['Matin', 'Midi', 'Soir']) {
    const titres = taches.filter((t) => t.creneau === creneau).map((t) => t.titre);
    if (titres.length) lignes.push(`- **${creneau}** : ${enumerer(titres)}`);
  }
  // Un créneau que le mappage n'a pas reconnu ne disparaît pas du résumé.
  const autres = taches.filter((t) => !['Matin', 'Midi', 'Soir'].includes(t.creneau));
  if (autres.length) lignes.push(`- **Autres** : ${enumerer(autres.map((t) => t.titre))}`);

  if (habitudes.length) lignes.push(`- **Habitudes** : ${enumerer(habitudes)}`);
  if (repas.length) lignes.push(`- **Repas** : ${enumerer(repas)}`);
  if (objectifs.length) lignes.push(`- **Objectifs** : ${enumerer(objectifs)}`);

  return `\n\n✅ **Plan appliqué** — ${compte.join(', ')}.\n\n` + lignes.join('\n');
}

/**
 * Le cas où le plan est arrivé entier et n'a rien ajouté.
 *
 * Il n'est pas rare : « refais-moi un programme » deux fois de suite, ou un
 * modèle qui repropose ce qu'il a déjà installé la veille. Annoncer un succès
 * laisserait chercher sur l'écran des tâches qui n'y sont pas ; annoncer une
 * erreur serait faux, puisque rien n'a échoué.
 */
export function resumerPlanSansNouveaute(): string {
  return (
    "\n\n✅ **Rien de neuf à installer** — tout ce que je viens de te proposer était déjà dans tes listes. " +
    'Redemande-moi de le **changer** si tu veux autre chose.'
  );
}
