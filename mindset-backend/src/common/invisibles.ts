/**
 * Les caractères que le modèle glisse dans ses balises et que personne ne voit.
 *
 * Mesuré contre le vrai Groq le 26 août 2026, sur `openai/gpt-oss-120b` : il a
 * répondu `<U+200B RAPPEL 2026-08-26T14:30>Termine les squats…`, avec un **espace
 * de largeur nulle entre le chevron et le mot**. Vérifié aux octets : `E2 80 8B`.
 *
 * Les conséquences sont doubles, et c'est ce qui rend ce caractère si coûteux :
 *
 * 1. `RappelService.MARQUEUR` ne reconnaît pas la balise — **aucun rappel n'est
 *    programmé**, alors que la personne en avait demandé un ;
 * 2. `RappelService.RESIDUS` ne la reconnaît pas non plus, parce qu'en JavaScript
 *    `\s` ne couvre **pas** U+200B (la classe s'arrête à U+200A). La balise n'est
 *    donc pas nettoyée : elle s'affiche en clair dans la conversation.
 *
 * Autrement dit, un caractère invisible transforme un rappel manquant en rappel
 * manquant **plus** un produit qui a l'air de se démonter à l'écran. C'est la
 * faute que `rappel.service.ts` désigne lui-même comme la plus chère du fichier.
 *
 * **On retire plutôt que d'assouplir les expressions.** Rendre chaque `\s` du
 * projet tolérant aux invisibles demanderait de ne jamais en oublier un — dans le
 * marqueur de rappel, celui d'annulation, la balise `<PLAN>` et tout ce qui
 * viendra après. Un nettoyage en amont vaut pour tout ce qui suit, y compris ce
 * qui n'est pas encore écrit.
 */

/**
 * Ce qu'on retire, **écrit en points de code et jamais en clair**.
 *
 * C'est la règle que suit déjà `RappelService.estUneDemandeDeRappel` pour les
 * diacritiques, et elle vaut dix fois plus ici : recopiés littéralement dans le
 * fichier, ces caractères seraient invisibles à la relecture, un éditeur pourrait
 * les normaliser sans prévenir, et personne ne saurait dire ce que la liste
 * contient vraiment. En hexadécimal, elle se lit.
 */
const POINTS_INVISIBLES: readonly number[] = [
  0x00ad, // trait d'union conditionnel : invisible tant qu'il ne coupe pas
  0x200b, // ESPACE DE LARGEUR NULLE — celui qui a été mesuré le 26 août
  0x200c, // antiliant
  0x2060, // liant sans chasse
  0xfeff, // espace insécable sans chasse (aussi utilisé comme marque d'ordre)
  // Contrôles bidirectionnels : ceux-là peuvent en plus réordonner l'affichage
  // d'un texte sans en changer un seul autre caractère.
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
];

/*
  U+200D (liant de largeur nulle) n'est pas dans la liste, volontairement.

  C'est lui qui assemble les émojis composés — une famille est faite de trois
  émojis collés par deux liants. Le retirer casserait un émoji visible pour se
  protéger d'une balise hypothétique : on échangerait un défaut mesuré contre un
  défaut certain. Si un modèle en place un jour dans une balise, ce sera à la
  mesure de le dire.
*/
const INVISIBLES = new Set<number>(POINTS_INVISIBLES);

/**
 * Retire les caractères invisibles d'une réponse de modèle.
 *
 * Sans effet sur ce que la personne lit — ces caractères ne dessinent rien — et
 * c'est ce qui rend l'opération sûre : on ne peut pas abîmer un texte en enlevant
 * ce qui ne s'affiche pas.
 *
 * Le parcours se fait par **point de code** et non par unité de code : `for...of`
 * rend « 👍 » d'un seul tenant là où un `for` classique le couperait en deux
 * moitiés de paire d'indirection, dont aucune n'est un caractère.
 */
export function retirerInvisibles(texte: string): string {
  if (!contientDesInvisibles(texte)) return texte;

  let sortie = '';
  for (const caractere of texte) {
    if (!INVISIBLES.has(caractere.codePointAt(0) as number)) sortie += caractere;
  }
  return sortie;
}

/** Vrai si le texte en contient. Sert aussi à ne journaliser que les vrais cas. */
export function contientDesInvisibles(texte: string): boolean {
  for (const caractere of texte) {
    if (INVISIBLES.has(caractere.codePointAt(0) as number)) return true;
  }
  return false;
}
