/**
 * Reconnaître la ligne dont quelqu'un parle, quand il l'écrit à sa façon.
 *
 * Extrait de `editionsPlan` le 27 août 2026, parce qu'un second appelant est
 * apparu : cocher une tâche depuis le chat doit la retrouver exactement comme une
 * retouche retrouve la sienne. Deux copies auraient divergé au premier
 * ajustement, et la personne aurait alors constaté que le coach sait renommer une
 * tâche mais pas la cocher — pour la même phrase.
 */


/**
 * Compare deux libellés comme un humain les lirait.
 *
 * Le modèle recopie « Méditation 10 min » depuis un contexte où le titre est
 * peut-être « Méditation 10min » ou « méditation 10 minutes ». Exiger l'égalité
 * stricte ferait échouer la moitié des retouches sur une espace — et un refus
 * pour une espace se lit comme une panne, pas comme une précaution.
 *
 * **Les diacritiques sont retirés par leur point de code, jamais collés en clair.**
 * Écrits littéralement, les accents combinants sont invisibles à la relecture et
 * un éditeur les recompose sans prévenir — on ne saurait plus ce que la plage
 * contient vraiment. Ce sont U+0300 à U+036F, ce que `NFD` produit en séparant
 * « é » en « e » plus son accent.
 */
const PREMIER_DIACRITIQUE = 0x300;
const DERNIER_DIACRITIQUE = 0x36f;

function normaliser(texte: unknown): string {
  let sansAccent = '';
  for (const caractere of String(texte ?? '').toLowerCase().normalize('NFD')) {
    const point = caractere.codePointAt(0) as number;
    if (point < PREMIER_DIACRITIQUE || point > DERNIER_DIACRITIQUE) sansAccent += caractere;
  }

  return sansAccent.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * L'index de la ligne visée, ou -1.
 *
 * Trois passes, de la plus sûre à la plus tolérante : égalité, puis préfixe, puis
 * inclusion. **La première passe qui trouve UNE seule ligne gagne** ; si une passe
 * en trouve plusieurs, on s'arrête là et on refuse. Deux habitudes qui contiennent
 * « lecture » ne se départagent pas au hasard : renommer la mauvaise est la seule
 * faute vraiment coûteuse que ce fichier puisse commettre.
 */
export function trouverIndex(lignes: any[], cible: string, titreDe: (l: any) => unknown): number {
  const vise = normaliser(cible);
  if (!vise) return -1;

  const titres = lignes.map((l) => normaliser(titreDe(l)));

  /*
    La dernière passe compare sans aucun séparateur.

    « Méditation 10min » et « Méditation 10 min » désignent la même ligne, et le
    modèle produit l'une ou l'autre selon son humeur. Sans cette passe, la retouche
    échouait sur une espace — un refus pour une espace se lit comme une panne.
  */
  const colle = (t: string) => t.replace(/ /g, '');

  for (const correspond of [
    (t: string) => t === vise,
    (t: string) => t.startsWith(vise) || vise.startsWith(t),
    (t: string) => t.includes(vise) || vise.includes(t),
    (t: string) => colle(t) === colle(vise) || colle(t).includes(colle(vise)),
  ]) {
    const trouves = titres.reduce<number[]>((acc, t, i) => (t && correspond(t) ? [...acc, i] : acc), []);
    if (trouves.length === 1) return trouves[0];
    // Plusieurs candidats : on s'arrête là plutôt que de tenter une passe encore
    // plus tolérante, qui en trouverait davantage et choisirait au hasard.
    if (trouves.length > 1) return -1;
  }

  return -1;
}
