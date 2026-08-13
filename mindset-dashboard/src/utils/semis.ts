/**
 * Efface la vie que les comptes n'ont jamais vécue.
 *
 * Jusqu'au 12 août 2026, l'application distribuait d'office à chaque nouveau compte
 * neuf tâches de routine, deux habitudes déjà montées en niveau, deux objectifs de
 * semaine à moitié faits et deux objectifs long terme. Les valeurs par défaut ont
 * été retirées du code, mais uniquement pour les comptes créés après : les autres
 * gardent ce passé, écrit dans leur navigateur puis remonté au serveur, qui le leur
 * renvoie fidèlement à chaque connexion.
 *
 * Ce n'est pas qu'un désagrément d'affichage. Le message du matin est rédigé à
 * partir de ces données : un compte sans aucune routine mais porteur du faux
 * objectif « Aller à la salle de sport » s'est vu réclamer « 10m de footing » un
 * matin, tâche que personne n'avait jamais définie. L'app est faite pour qu'on
 * arrive les mains vides et qu'on remplisse en parlant au coach.
 *
 * **Règle de sûreté : on ne retire que ce qui est resté strictement intact.** Une
 * entrée dont le titre, l'avancement ou l'expérience a bougé a été adoptée par
 * quelqu'un — la supprimer détruirait un vrai travail. Les identifiants aident :
 * toute création, à la main comme par l'IA, tire le sien de `Date.now()`, donc les
 * petits identifiants ci-dessous ne peuvent désigner que les semis d'origine.
 *
 * La fonction est idempotente : elle peut tourner à chaque redescente sans risque.
 */

/** Signature exacte d'un semis. Tout écart signifie que l'entrée a servi. */
type Semis = Record<string, unknown> & { id: number | string; title: string };

const MICRO: Semis[] = [
  { id: 1, title: 'Aller à la salle de sport', progress: 2, total: 4, done: false },
  { id: 2, title: 'Lire 50 pages', progress: 50, total: 50, done: true },
];

const MACRO: Semis[] = [
  { id: 1, title: 'Indépendance Financière', deadline: 'Déc 2026' },
  // Apostrophe droite, comme dans le semis d'origine : une apostrophe typographique
  // ne correspondrait à rien et l'objectif resterait en place sans que rien ne le dise.
  { id: 2, title: "Physique d'Athlète", deadline: 'Juil 2026' },
];

// L'expérience et le niveau étaient offerts avec l'habitude. Ils ne bougent qu'en
// la validant : les voir inchangés prouve qu'elle n'a jamais servi.
const HABITUDES: Semis[] = [
  { id: '1', title: 'Lecture (10 pages)', xp: 120, level: 2 },
  { id: '2', title: 'Méditation (10 min)', xp: 450, level: 4 },
];

// Les cases des routines se décochent chaque nuit : `done` ne dit rien de l'usage,
// on ne le compare pas.
const ROUTINES: Semis[] = [
  { id: 1, title: 'Méditation Express', time: '5 min' },
  { id: 2, title: 'Visualisation des objectifs', time: '10 min' },
  { id: 3, title: 'Lecture inspirante', time: '15 min' },
  { id: 4, title: 'Marche digestive', time: '10 min' },
  { id: 5, title: 'Lecture ou Podcast', time: '15 min' },
  { id: 6, title: 'Planification après-midi', time: '5 min' },
  { id: 7, title: 'Bilan de la journée', time: '5 min' },
  { id: 8, title: 'Déconnexion des écrans', time: '30 min' },
  { id: 9, title: 'Étirements légers', time: '10 min' },
];

/** Vrai si l'entrée correspond trait pour trait à l'un des semis attendus. */
function estUnSemisIntact(entree: any, semis: Semis[]): boolean {
  if (!entree || typeof entree !== 'object') return false;

  return semis.some((modele) =>
    // `==` sur l'identifiant : le stockage a parfois rendu des nombres là où le
    // semis écrivait des chaînes, et l'inverse. Le titre lève toute ambiguïté.
    Object.entries(modele).every(([champ, attendu]) =>
      champ === 'id' ? String(entree.id) === String(attendu) : entree[champ] === attendu,
    ),
  );
}

/** Relit une liste stockée, la filtre, et la réécrit seulement si elle a changé. */
function nettoyerListe(cle: string, semis: Semis[]): boolean {
  const brut = localStorage.getItem(cle);
  if (!brut) return false;

  try {
    const liste = JSON.parse(brut);
    if (!Array.isArray(liste)) return false;

    const gardees = liste.filter((e) => !estUnSemisIntact(e, semis));
    if (gardees.length === liste.length) return false;

    localStorage.setItem(cle, JSON.stringify(gardees));
    return true;
  } catch {
    return false;
  }
}

/**
 * Les routines sont rangées par créneau : les tâches semées vivent dans le `items`
 * de chaque groupe. On vide les tâches sans jamais supprimer les trois créneaux,
 * qui sont la structure de la page et non des données.
 */
function nettoyerRoutines(): boolean {
  const brut = localStorage.getItem('mindset_routines');
  if (!brut) return false;

  try {
    const groupes = JSON.parse(brut);
    if (!Array.isArray(groupes)) return false;

    let modifie = false;
    const propres = groupes.map((groupe: any) => {
      if (!Array.isArray(groupe?.items)) return groupe;

      const gardees = groupe.items.filter((i: any) => !estUnSemisIntact(i, ROUTINES));
      if (gardees.length === groupe.items.length) return groupe;

      modifie = true;
      return { ...groupe, items: gardees };
    });

    if (!modifie) return false;

    localStorage.setItem('mindset_routines', JSON.stringify(propres));
    return true;
  } catch {
    return false;
  }
}

/**
 * Retire les semis restants. Rend `true` si quelque chose a été retiré, à charge
 * pour l'appelant de faire réafficher les écrans concernés.
 */
export function nettoyerSemis(): boolean {
  // Pas de court-circuit paresseux : les quatre listes doivent être examinées.
  const resultats = [
    nettoyerListe('mindset_micro_obj', MICRO),
    nettoyerListe('mindset_macro_obj', MACRO),
    nettoyerListe('mindset_habits', HABITUDES),
    nettoyerRoutines(),
  ];

  return resultats.some(Boolean);
}
