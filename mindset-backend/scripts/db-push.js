#!/usr/bin/env node
/**
 * Mise à jour du schéma de la base au déploiement, sans perte de données silencieuse.
 *
 * Le script de build lançait « prisma db push --accept-data-loss ». Ce drapeau dit à
 * Prisma : applique le schéma quoi qu'il en coûte, et n'attends pas de confirmation.
 * Sur Render, où le build tourne sans personne devant l'écran, une faute de frappe dans
 * un nom de champ suffisait donc à supprimer une colonne de production — un champ
 * renommé se lit comme « supprime l'ancien, crée le nouveau » — et le déploiement se
 * terminait en vert.
 *
 * Ici, on calcule d'abord le SQL que Prisma s'apprête à exécuter, et on regarde s'il
 * détruit quelque chose. Si oui, le déploiement s'arrête et affiche les ordres en
 * cause. Sinon, la mise à jour part comme avant.
 *
 * Pour un changement destructeur voulu (une colonne réellement à supprimer), relancer
 * le déploiement avec la variable d'environnement ALLOW_DATA_LOSS=true, puis la
 * retirer. C'est volontairement manuel : c'est le geste qui manquait.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SCHEMA = path.join(RACINE, 'prisma', 'schema.prisma');

// En local, DATABASE_URL vit dans .env : la commande Prisma le lisait toute seule, ce
// script non. Sur Render la variable est déjà dans l'environnement et rien n'est écrasé.
try {
  require('dotenv').config({ path: path.join(RACINE, '.env') });
} catch {
  /* dotenv absent : on se contente des variables déjà présentes. */
}

/**
 * Ordres SQL qui font perdre des données, avec le mot à afficher à l'utilisateur.
 *
 * DROP INDEX et DROP CONSTRAINT n'y sont pas : ils relâchent une règle, ils n'effacent
 * aucune ligne. À l'inverse, un changement de type peut tronquer sur place (un Text
 * ramené à Varchar(50)), et un passage en obligatoire échoue ou impose une valeur par
 * défaut aux lignes déjà écrites.
 */
const ORDRES_DESTRUCTEURS = [
  { motif: /\bDROP\s+TABLE\b/i, quoi: 'suppression de table' },
  { motif: /\bDROP\s+COLUMN\b/i, quoi: 'suppression de colonne' },
  { motif: /\bSET\s+DATA\s+TYPE\b/i, quoi: 'changement de type (peut tronquer)' },
  { motif: /\bSET\s+NOT\s+NULL\b/i, quoi: 'passage en obligatoire' },
];

/**
 * Appelle le CLI Prisma installé dans node_modules, par son fichier JavaScript.
 *
 * Pas « npx » : sous Windows la commande s'appelle npx.cmd, et Node refuse d'exécuter un
 * .cmd sans passer par un shell (EINVAL). Passer par un shell obligerait à citer
 * DATABASE_URL à la main, mot de passe compris. On lance donc le même programme
 * directement avec node, ce qui marche pareil ici et sur Render.
 */
function prisma(args) {
  let cli;
  try {
    cli = require.resolve('prisma/build/index.js', { paths: [RACINE] });
  } catch {
    throw new Error(
      'Le paquet « prisma » est introuvable dans node_modules : lancer « npm install » d’abord.',
    );
  }

  return execFileSync(process.execPath, [cli, ...args], {
    cwd: RACINE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Découpe le SQL en ordres et retient ceux qui détruisent.
 *
 * Les lignes de commentaire de Prisma sont écartées : elles décrivent parfois en toutes
 * lettres l'ordre qu'on cherche (« Warning: You are about to drop the column … »), ce
 * qui donnerait une alerte pour un changement anodin situé juste à côté.
 */
function trouverDestructeurs(sql) {
  return sql
    .split(';')
    .map((ordre) =>
      ordre
        .split('\n')
        .filter((ligne) => !ligne.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)
    .flatMap((ordre) => {
      const trouve = ORDRES_DESTRUCTEURS.find(({ motif }) => motif.test(ordre));
      return trouve ? [{ ordre, quoi: trouve.quoi }] : [];
    });
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[db-push] DATABASE_URL absente : impossible de mettre le schéma à jour.');
    process.exit(1);
  }

  let sql;
  try {
    sql = prisma([
      'migrate',
      'diff',
      '--from-url',
      process.env.DATABASE_URL,
      '--to-schema-datamodel',
      SCHEMA,
      '--script',
    ]);
  } catch (erreur) {
    // Sans cette comparaison on ne sait pas ce qu'on s'apprête à faire. Pousser quand
    // même reviendrait à remettre le --accept-data-loss aveugle qu'on retire ici.
    console.error('[db-push] La comparaison avec la base a échoué, rien n’a été modifié.');
    console.error(erreur.stderr || erreur.message);
    process.exit(1);
  }

  const destructeurs = trouverDestructeurs(sql);
  const autorise = process.env.ALLOW_DATA_LOSS === 'true';

  if (destructeurs.length > 0 && !autorise) {
    console.error('');
    console.error('[db-push] Déploiement arrêté : ce schéma détruit des données en base.');
    console.error('');
    for (const { ordre, quoi } of destructeurs) {
      console.error(`  • ${quoi}`);
      console.error(`    ${ordre.replace(/\s+/g, ' ')}`);
    }
    console.error('');
    console.error('  Si c’est un champ renommé, la donnée de l’ancienne colonne est perdue :');
    console.error('  la recopier d’abord, ou garder l’ancien nom.');
    console.error('');
    console.error('  Si la suppression est voulue : relancer le déploiement avec');
    console.error('  ALLOW_DATA_LOSS=true dans les variables d’environnement, puis la retirer.');
    console.error('');
    process.exit(1);
  }

  if (destructeurs.length > 0) {
    console.warn(
      `[db-push] ALLOW_DATA_LOSS=true : ${destructeurs.length} ordre(s) destructeur(s) appliqué(s) volontairement.`,
    );
  }

  /*
    Le drapeau part **toujours**, et ce n'est pas un retour en arrière.

    Il fallait le lire deux fois pour s'en convaincre, donc : `--accept-data-loss` ne
    veut pas dire « détruis ». Il veut dire « ne me demande pas confirmation ». Or la
    confirmation, c'est tout ce qui précède dans ce fichier : on a calculé le SQL, on
    l'a lu, et on n'a rien trouvé de destructeur. Arrivé ici, la question a déjà été
    posée et tranchée.

    Sans lui, Prisma refusait de pousser pour des avertissements qui ne perdent
    aucune donnée — et le déploiement du 21 août 2026 est tombé exactement là-dessus :

      « A unique constraint covering the columns [google_sub] on the table User will
        be added. If there are existing duplicate values, this will fail. »

    La colonne était créée dans la même passe, donc vide partout : la contrainte ne
    pouvait rien casser. Et même dans le cas contraire, **l'échec de cet ordre est
    sûr** — la contrainte n'est pas créée, rien n'est effacé, le build s'arrête en
    rouge. C'est un risque d'échec, pas un risque de perte.

    Le garde-fou reste entier : il tient à la liste `ORDRES_DESTRUCTEURS` ci-dessus,
    pas à ce drapeau. Une colonne supprimée, une table effacée, un type rétréci, un
    champ rendu obligatoire — tout cela arrête encore le déploiement avant d'arriver
    ici. C'était le défaut du script : il savait conclure, et il ne s'appuyait pas sur
    sa propre conclusion.

    --skip-generate : « prisma generate » est l'étape suivante du build, la faire deux
    fois ne sert qu'à rallonger le déploiement.
  */
  const args = ['db', 'push', '--skip-generate', '--accept-data-loss'];

  try {
    console.log(prisma(args));
  } catch (erreur) {
    console.error(erreur.stdout || '');
    console.error(erreur.stderr || erreur.message);
    process.exit(1);
  }
}

main();
