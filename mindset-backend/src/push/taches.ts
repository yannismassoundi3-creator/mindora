import { estPourAujourdhui, jourDeSemaine } from './recurrence';

/**
 * Ce qui reste à faire, et ce qui est déjà fait.
 *
 * Les routines et les objectifs arrivent du client en JSON libre, tantôt à plat,
 * tantôt groupés dans `items`. Toute notification qui cite une tâche part d'ici :
 * sans ce tri, le coach réclame des tâches que la personne vient de cocher — le
 * réflexe le plus sûr pour faire désinstaller une app de coaching.
 *
 * Une seule définition, partagée par le brief du matin et le coup de pouce : deux
 * copies finiraient par diverger, et l'une des deux se remettrait à réclamer du
 * travail déjà fait sans que rien ne le signale.
 *
 * **Le fil rouge de ce fichier : une coche n'est vraie qu'à une date.** Le client
 * décoche les routines chaque nuit et remet les objectifs à zéro chaque lundi ;
 * le serveur, lui, ne remet jamais rien. Lire ces listes sans regarder de quel
 * jour ni de quelle semaine elles parlent ne produit pas d'erreur — ça produit
 * une réponse plausible et fausse, ce qui est bien pire.
 */
export interface TachesTriees {
  restantes: string[];
  faites: string[];
}

/**
 * Le jour tel que le client l'écrit : `YYYY-MM-DD`, en UTC.
 *
 * C'est sa convention, pas la nôtre, et c'est elle qu'il faut reprendre : passer
 * l'heure de Paris ici décalerait la frontière de deux heures et ferait mentir la
 * comparaison ci-dessous chaque nuit entre minuit et 2 h.
 */
export function jourDuClient(maintenant = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

/**
 * Le lundi de la semaine, en UTC — le repère qui identifie une semaine.
 *
 * Même définition que `cleSemaine` dans `utils/semaine.ts` du client, y compris le
 * choix du lundi plutôt que d'un numéro de semaine ISO : un numéro préfixé de
 * l'année civile change au 1er janvier, donc en plein milieu d'une semaine, une
 * fois par an. Un lundi n'a pas d'année à lui.
 */
export function semaineDuClient(jour: string | Date = new Date()): string {
  const d = typeof jour === 'string' ? new Date(`${jour}T00:00:00Z`) : new Date(jour);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Les coches des routines valent-elles encore pour aujourd'hui ?
 *
 * Le décochage quotidien n'a jamais lieu ici : c'est le client qui, à l'ouverture,
 * compare la date qu'il a posée au jour courant et remet tout à zéro. Tant que
 * personne n'ouvre l'app, la base garde donc les coches de la veille — et la
 * notification qui les lit telles quelles félicite au réveil pour un travail qui
 * n'a pas commencé. C'est ce qui est parti un matin à 10 h 50 (« Félicitations, tu
 * as terminé tous tes exercices »), une heure avant que l'app, ouverte, montre les
 * six tâches intactes. Rien n'avait échoué côté serveur : la donnée était juste
 * vieille d'un jour, et parfaitement plausible.
 *
 * On tranche donc sur la date que le client a lui-même écrite (`last_routine_date`),
 * avec exactement son test : ce que le serveur conclut est ce que l'écran montrera.
 * Une date absente ou abîmée est périmée — le client la traite pareil, et décochera.
 */
export function cochesDuJour(jour: unknown, maintenant = new Date()): boolean {
  return typeof jour === 'string' && jour.slice(0, 10) === jourDuClient(maintenant);
}

/** Le tri commun. `garder` écarte ce qui ne concerne pas la période, `faite` décide du camp. */
function trier(
  valeur: unknown,
  garder: (el: any) => boolean,
  faite: (el: any) => boolean,
): TachesTriees {
  const restantes: string[] = [];
  const faites: string[] = [];
  if (!Array.isArray(valeur)) return { restantes, faites };

  for (const entree of valeur) {
    const elements = Array.isArray((entree as any)?.items) ? (entree as any).items : [entree];
    for (const el of elements) {
      const titre = el?.title || el?.name;
      if (typeof titre !== 'string' || !titre.trim()) continue;
      if (!garder(el)) continue;
      (faite(el) ? faites : restantes).push(titre);
    }
  }
  return { restantes, faites };
}

/**
 * Le tri nu : tout est retenu, une coche vaut une coche.
 *
 * Réservé à ce qui n'a ni jour ni semaine — les objectifs long terme, ou un appel
 * qui a déjà daté ses données. Les routines passent par `tachesDuJour`, les
 * objectifs de semaine par `objectifsDeLaSemaine`.
 */
export function separerTaches(valeur: unknown): TachesTriees {
  return trier(valeur, () => true, (el) => !!el?.done);
}

/**
 * A-t-elle des routines, quel que soit le jour où elles tombent ?
 *
 * Sert à distinguer les deux journées vides, que la récurrence rend très
 * différentes : celle d'un compte qui n'a encore rien défini — où il faut inviter
 * à décider quelque chose — et le jour sans séance de quelqu'un dont le programme
 * dit précisément que c'est repos. Les confondre revient à annoncer « ta journée
 * est vide » quatre matins sur sept à quelqu'un qui suit exactement le plan qu'on
 * lui a donné.
 */
export function aDesRoutines(
  sync: { routines?: unknown } | null | undefined,
): boolean {
  const toutes = separerTaches(sync?.routines);
  return toutes.restantes.length + toutes.faites.length > 0;
}

/**
 * Les routines du jour, telles que l'app les montrera.
 *
 * Deux filtres, et il faut les deux : la **récurrence** (une tâche du mardi n'est
 * pas sur l'écran d'un dimanche) et la **date des coches** (celles de la veille ne
 * valent plus rien). C'est le seul point d'entrée à utiliser pour une notification
 * qui parle de routines.
 */
export function tachesDuJour(
  sync: { routines?: unknown; last_routine_date?: string | null } | null | undefined,
  maintenant = new Date(),
): TachesTriees {
  const jour = jourDeSemaine(maintenant);
  const coches = cochesDuJour(sync?.last_routine_date, maintenant);
  return trier(
    sync?.routines,
    (el) => estPourAujourdhui(el, jour),
    (el) => coches && !!el?.done,
  );
}

/**
 * Les objectifs de la semaine en cours.
 *
 * Même piège que les routines, d'un cran plus lent : les micro-objectifs sont
 * remis à zéro chaque lundi, et là encore par le client seul (`Layout.tsx`). Un
 * objectif bouclé vendredi reste donc `done` en base jusqu'à la prochaine
 * ouverture — le lundi matin, le coach ne voyait plus aucun objectif en cours à
 * citer, alors que la semaine venait de les rendre tous.
 *
 * `awardedDate` porte le jour du dernier avancement, et c'est lui qui tranche. En
 * son absence on garde la coche : ne pas mentionner un objectif est un petit
 * défaut, réclamer un objectif que la personne vient de finir en est un grand.
 */
export function objectifsDeLaSemaine(valeur: unknown, maintenant = new Date()): TachesTriees {
  const semaine = semaineDuClient(maintenant);
  return trier(
    valeur,
    () => true,
    (el) => {
      if (!el?.done) return false;
      const date = typeof el?.awardedDate === 'string' ? el.awardedDate.slice(0, 10) : '';
      if (!date) return true;
      return semaineDuClient(date) === semaine;
    },
  );
}
