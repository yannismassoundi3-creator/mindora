import { lienApp, origineApp, origineValide, ORIGINE_PAR_DEFAUT } from './origines';

/**
 * Une variable d'environnement fausse ne lève jamais d'erreur : elle fabrique des
 * liens morts, et personne ne l'apprend. C'est exactement ce qui s'est produit —
 * `FRONTEND_URL` a pointé sur un domaine inexistant pendant des jours, envoyant
 * dans le vide chaque notification push et chaque e-mail de réinitialisation.
 *
 * Ces tests fixent le principe qui l'empêche de recommencer : la configuration
 * est confrontée à la liste des adresses où l'application est réellement servie.
 */
describe('origines — le lien vers l’application', () => {
  const envInitial = { ...process.env };

  afterEach(() => {
    process.env = { ...envInitial };
  });

  describe('origineValide', () => {
    it('accepte notre adresse de production', () => {
      expect(origineValide('https://disciplix-ai.vercel.app')).toBe('https://disciplix-ai.vercel.app');
    });

    it('normalise la barre finale', () => {
      // Selon la façon dont la variable est saisie sur Render, on fabriquait sinon
      // des liens en « //?auth=true ».
      expect(origineValide('https://disciplix-ai.vercel.app/')).toBe('https://disciplix-ai.vercel.app');
    });

    it('refuse un domaine qui commence par le nôtre', () => {
      // Une comparaison par préfixe aurait accepté celui-ci.
      expect(origineValide('https://disciplix-ai.vercel.app.pirate.example')).toBeNull();
    });

    it('refuse une adresse illisible sans lever d’exception', () => {
      expect(origineValide('pas une adresse')).toBeNull();
      expect(origineValide(undefined)).toBeNull();
      expect(origineValide('')).toBeNull();
    });

    it('refuse localhost en production et l’accepte ailleurs', () => {
      process.env.NODE_ENV = 'production';
      expect(origineValide('http://localhost:5173')).toBeNull();
      process.env.NODE_ENV = 'development';
      expect(origineValide('http://localhost:5173')).toBe('http://localhost:5173');
    });
  });

  describe('origineApp', () => {
    it('ignore une FRONTEND_URL qui ne désigne pas notre application', () => {
      // Le cas réel du 13 août 2026, resté invisible parce qu'un lien mort
      // s'envoie exactement comme un lien valide.
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = 'https://mindset-dashboard.onrender.com';

      expect(origineApp()).toBe(ORIGINE_PAR_DEFAUT);
    });

    it('tient quand la variable est absente', () => {
      delete process.env.FRONTEND_URL;

      expect(origineApp()).toBe(ORIGINE_PAR_DEFAUT);
    });

    it('suit la variable quand elle est juste', () => {
      // Sans quoi le jour où un domaine propre est ajouté à la liste, il resterait
      // sans effet — la protection ne doit pas geler la configuration.
      process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app/';

      expect(origineApp()).toBe('https://disciplix-ai.vercel.app');
    });

    it('laisse le développement pointer sur sa propre machine', () => {
      process.env.NODE_ENV = 'development';
      process.env.FRONTEND_URL = 'http://localhost:3001';

      expect(origineApp()).toBe('http://localhost:3001');
    });
  });

  it('colle le chemin sans doubler la barre', () => {
    process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app/';

    expect(lienApp('/?auth=true')).toBe('https://disciplix-ai.vercel.app/?auth=true');
    expect(lienApp()).toBe('https://disciplix-ai.vercel.app');
  });
});
