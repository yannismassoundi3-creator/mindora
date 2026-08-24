import { MODELES_CHAT, MODELES_COURTS, tousLesModeles, effortDeRaisonnement } from './modeles';

/*
  L'ordre de la chaine du chat n'est pas une preference, c'est une mesure.

  Le critere annonce — « la capacite a produire le bloc <PLAN> en JSON valide,
  puisque c est ce qui casse en premier sur un petit modele » — etait juste. Il
  n avait simplement jamais ete verifie, et le classement qu on en avait tire
  etait faux : `gpt-oss-20b` etait en deuxieme position alors qu il **refuse**
  de produire le plan.

  Mesure du 24 aout 2026, vrai Groq, « fais-moi un plan complet pour la semaine »
  avec un profil d inscription complet :

    gpt-oss-120b   bloc present, JSON valide, 15 min pour 15 declarees
    qwen3.6-27b    bloc present, JSON valide, 15/15, macro et micro produits
    gpt-oss-20b    AUCUN bloc — « Je ne peux pas creer un plan complet pour
                   toute la semaine en une seule reponse », puis du Markdown

  Ce que coutait la deuxieme position : a l heure de pointe, quand la chaine a
  bascule, demander un plan rendait une belle routine dans le chat et **aucune
  tache dans l application**. Rien ne le signalait.

  Ce fichier existe pour qu on ne remette pas le petit modele devant celui qui
  sait faire le travail, par reflexe « du plus gros au plus petit ».
*/
describe('la chaine des modeles', () => {
  it('place le petit modele en dernier : il ne sait pas produire de plan', () => {
    const petit = MODELES_CHAT.indexOf('openai/gpt-oss-20b');
    const qwen = MODELES_CHAT.indexOf('qwen/qwen3.6-27b');

    expect(petit).toBe(MODELES_CHAT.length - 1);
    expect(qwen).toBeGreaterThanOrEqual(0);
    expect(qwen).toBeLessThan(petit);
  });

  it('garde le plus capable en tete', () => {
    expect(MODELES_CHAT[0]).toBe('openai/gpt-oss-120b');
  });

  it('laisse les textes courts au petit modele', () => {
    // A l inverse du chat, et c est voulu : 160 a 900 caracteres sans aucun JSON
    // a produire. La capacite du gros n y change presque rien, le quota qu elle
    // consomme, si.
    expect(MODELES_COURTS[0]).toBe('openai/gpt-oss-20b');
  });

  it('annonce chaque identifiant au controle d exploitation', () => {
    // Une liste de modeles ecrite en dur pourrit toute seule : c est
    // `GET /admin/modeles` qui dit lesquels repondent encore, et il ne peut le
    // dire que de ceux qu on lui donne.
    const tous = tousLesModeles();
    for (const m of [...MODELES_CHAT, ...MODELES_COURTS]) expect(tous).toContain(m);
    expect(new Set(tous).size).toBe(tous.length);
  });

  it('n envoie un reglage de raisonnement qu aux modeles qui en acceptent un', () => {
    // Une valeur etrangere est un 400, pas un defaut ignore : les GPT-OSS
    // n acceptent que low/medium/high, Qwen que none/default.
    for (const m of tousLesModeles()) {
      const effort = effortDeRaisonnement(m);
      if (m.startsWith('openai/gpt-oss')) expect(['low', 'medium', 'high']).toContain(effort);
      else if (m.startsWith('qwen/')) expect(['none', 'default']).toContain(effort);
    }
    expect(effortDeRaisonnement('un/modele-inconnu')).toBeUndefined();
  });
});
