/**
 * Sépare le message du coach du bloc technique qui l'accompagne.
 *
 * Le modèle range son plan entre `<PLAN>` et `</PLAN>`. L'extraction reposait sur
 * une seule expression régulière exigeant les deux balises intactes — et quand la
 * fermeture arrivait mutilée (« ; ↘'PLAN> » a été observé en production), plus rien
 * ne correspondait : le bloc n'était ni appliqué ni retiré. On lisait donc, sous une
 * phrase annonçant fièrement le plan, quarante lignes de JSON brut.
 *
 * Le principe ici : **le marqueur d'ouverture suffit à condamner tout ce qui suit.**
 * Ce qui vient après `<PLAN>` n'a jamais vocation à être lu par un humain, que le
 * modèle ait refermé sa balise correctement ou non. Mieux vaut afficher un message
 * tronqué qu'un message rempli d'accolades.
 */

/** Ouverture, tolérante aux espaces et à la casse. */
const OUVERTURE = /<\s*PLAN\s*>/i;

/**
 * Fermeture, très tolérante : le chevron initial et la barre oblique peuvent avoir
 * disparu, seul « PLAN> » reste fiable. On ne cherche ce motif qu'après l'ouverture,
 * sans quoi il se reconnaîtrait lui-même dans la balise d'ouverture.
 */
const FERMETURE = /<?\s*\/?\s*PLAN\s*>/i;

/** Champs qui trahissent un plan, quelle que soit la forme du bloc. */
const CHAMPS_DE_PLAN =
  /"(new(Habits|Routines|Nutrition|MacroObjectives|MicroObjectives|Objectives)|macroObjectives|microObjectives|replace(Habits|Routines|Nutrition|MacroObjectives|MicroObjectives))"/;

export interface PlanExtrait {
  /** Le texte à afficher, débarrassé de toute trace technique. */
  texte: string;
  /** Le JSON candidat, ou une chaîne vide s'il n'y en avait pas. */
  json: string;
  /** Vrai si un bloc de plan était présent — même illisible. */
  planPresent: boolean;
}

/** Retire tout résidu de balise, en dernier recours avant affichage. */
function nettoyerResidus(texte: string): string {
  return texte
    .replace(/<?\s*\/?\s*PLAN\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Répare les maladresses de format les plus courantes.
 *
 * Le prompt interdit déjà les virgules en rafale (« ] , , , ] ») et le modèle les
 * produit quand même. On ne cherche pas à sauver l'insauvable : juste à rattraper
 * ce qui se rattrape sans risque d'inventer des données.
 */
export function reparerJson(brut: string): string {
  let s = brut.trim();

  // Virgules en rafale, et virgule traînante avant une fermeture.
  s = s.replace(/,(\s*,)+/g, ',').replace(/,\s*([}\]])/g, '$1');
  // Virgule en tête de bloc, laissée par un champ disparu.
  s = s.replace(/([{[])\s*,/g, '$1');
  s = s.replace(/^[\s,]+/, '');

  const debut = s.indexOf('{');
  const fin = s.lastIndexOf('}');
  if (debut !== -1 && fin > debut) s = s.slice(debut, fin + 1);

  return s.trim();
}

/**
 * Index de l'accolade fermante qui referme celle de `debut`, ou -1.
 *
 * Les accolades qui vivent **à l'intérieur d'une chaîne** ne comptent pas :
 * « Squats {3x15} » est un titre d'exercice, pas un niveau d'imbrication.
 */
function finDeLObjet(texte: string, debut: number): number {
  let profondeur = 0;
  let dansUneChaine = false;
  let echappe = false;

  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];

    if (dansUneChaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansUneChaine = false;
      continue;
    }

    if (c === '"') dansUneChaine = true;
    else if (c === '{') profondeur++;
    else if (c === '}' && --profondeur === 0) return i;
  }

  return -1;
}

/**
 * Retire les objets JSON de plan : entiers, ou pas du tout.
 *
 * Le nettoyage de dernier recours du chat cherchait `{ … "newHabits" … }` avec une
 * expression non gourmande. Sur un vrai plan, elle s'arrêtait donc à la **première**
 * accolade fermante venue — celle d'une routine imbriquée — et emportait le début du
 * bloc en laissant la fin à l'écran. Ce qu'on lisait alors, capture à l'appui le
 * 22 août 2026 : `<PLAN> , , ], "newMicroObjectives": [ { "title": …`
 *
 * Une expression régulière ne sait pas compter les accolades ; ce parcours, si. Et
 * il applique la règle qui manquait : **un objet qu'on ne sait pas délimiter en
 * entier ne se coupe pas en deux.** Ce qui n'est pas un plan est rendu intact — du
 * JSON peut légitimement apparaître dans une réponse qui parle de code.
 */
export function retirerObjetsDePlan(texte: string): string {
  let sortie = '';
  let i = 0;

  while (i < texte.length) {
    if (texte[i] !== '{') {
      sortie += texte[i++];
      continue;
    }

    const fin = finDeLObjet(texte, i);

    // Accolade jamais refermée : la réponse a été coupée en plein plan. Le reste ne
    // sera jamais lu par un humain — on le retire au lieu de l'afficher.
    if (fin === -1) {
      if (!CHAMPS_DE_PLAN.test(texte.slice(i))) sortie += texte.slice(i);
      break;
    }

    const candidat = texte.slice(i, fin + 1);
    if (!CHAMPS_DE_PLAN.test(candidat)) sortie += candidat;
    i = fin + 1;
  }

  return sortie;
}

/**
 * Extrait le plan d'une réponse du coach.
 *
 * Trois chemins, du plus sûr au plus tolérant : les deux balises, l'ouverture seule,
 * puis un objet JSON reconnaissable à ses champs — le modèle oublie parfois les
 * balises et se contente d'un bloc de code, voire d'un objet nu.
 */
export function extrairePlan(reponse: string): PlanExtrait {
  let texte = reponse ?? '';

  // 1. Le cas normal.
  const strict = texte.match(/<\s*PLAN\s*>([\s\S]*?)<\s*\/\s*PLAN\s*>/i);
  if (strict) {
    return {
      texte: nettoyerResidus(texte.replace(strict[0], '')),
      json: strict[1],
      planPresent: true,
    };
  }

  // 2. L'ouverture est là, la fermeture est perdue ou déformée.
  const ouverture = texte.search(OUVERTURE);
  if (ouverture !== -1) {
    const avant = texte.slice(0, ouverture);
    const apres = texte.slice(ouverture).replace(OUVERTURE, '');

    const fermeture = apres.search(FERMETURE);
    const corps = fermeture === -1 ? apres : apres.slice(0, fermeture);
    // Ce qui suit une fermeture mutilée est rendu à la conversation : le modèle
    // écrit parfois une phrase de conclusion après son bloc.
    const suite = fermeture === -1 ? '' : apres.slice(fermeture).replace(FERMETURE, '');

    return {
      texte: nettoyerResidus(`${avant}\n${suite}`),
      json: corps,
      planPresent: true,
    };
  }

  // 3. Aucune balise : un bloc de code, ou un objet nu, reconnu à ses champs.
  let json = '';
  texte = texte.replace(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/g, (bloc, contenu) => {
    if (!json && CHAMPS_DE_PLAN.test(contenu)) {
      json = contenu;
      return '';
    }
    return bloc;
  });

  if (!json) {
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      const candidat = texte.slice(debut, fin + 1);
      // La liste des champs reconnus omettait les objectifs : un plan qui n'en
      // contenait que — le cas d'un « donne-moi des objectifs » — n'était donc
      // jamais reconnu, et s'affichait en clair.
      if (CHAMPS_DE_PLAN.test(candidat)) {
        json = candidat;
        texte = texte.replace(candidat, '');
      }
    }
  }

  return { texte: nettoyerResidus(texte), json, planPresent: json !== '' };
}
