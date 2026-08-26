import { contientDesInvisibles, retirerInvisibles } from './invisibles';

/*
  Le caractère mesuré, écrit par son point de code.

  Le coller en clair dans ce fichier le rendrait invisible à la relecture — et un
  test dont on ne peut pas lire l'entrée ne prouve rien. C'est la même règle que
  dans le module lui-même.
*/
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);

describe('les caractères invisibles', () => {
  /*
    La réponse réelle de `openai/gpt-oss-120b`, mesurée le 26 août 2026 sur
    « j'ai pas pu, j'étais crevé du taf ». Vérifiée aux octets : E2 80 8B entre le
    chevron et le mot.

    Elle échouait deux fois. La balise n'était pas reconnue, donc aucun rappel
    n'était programmé ; et elle n'était pas nettoyée non plus, parce que `\s` ne
    couvre pas U+200B en JavaScript — elle s'affichait telle quelle dans la
    conversation.
  */
  it('retire l’espace de largeur nulle que le modèle glisse dans une balise', () => {
    const brut = `<${ZWSP}RAPPEL 2026-08-26T14:30>Termine les squats.</RAPPEL>`;

    const propre = retirerInvisibles(brut);

    expect(propre).toBe('<RAPPEL 2026-08-26T14:30>Termine les squats.</RAPPEL>');
    // La forme obtenue doit être celle que le marqueur sait lire.
    expect(/<\s*RAPPEL\s/.test(propre)).toBe(true);
  });

  it('ne touche pas à un texte ordinaire', () => {
    const texte = 'Tu as tenu 4 jours. Fais **Squats (4x12)** maintenant. 🔥';
    expect(retirerInvisibles(texte)).toBe(texte);
    expect(contientDesInvisibles(texte)).toBe(false);
  });

  /*
    Le liant de largeur nulle est le seul invisible qu'on garde.

    Il assemble les émojis composés : le retirer casserait une famille en trois
    bonhommes séparés. On échangerait un défaut mesuré contre un défaut certain,
    et celui-là se verrait.
  */
  it('épargne le liant qui assemble les émojis', () => {
    const famille = `👨${ZWJ}👩${ZWJ}👧`;
    expect(retirerInvisibles(`Bien joué ${famille}`)).toBe(`Bien joué ${famille}`);
  });

  it('retire aussi les contrôles bidirectionnels', () => {
    // Ceux-là ne se contentent pas d'être invisibles : ils réordonnent l'affichage
    // sans changer un seul autre caractère.
    const brut = `${String.fromCharCode(0x202e)}RAPPEL`;
    expect(retirerInvisibles(brut)).toBe('RAPPEL');
  });

  it('rend la même chaîne quand il n’y a rien à retirer', () => {
    // Pas une optimisation gratuite : la fonction est appelée sur chaque réponse
    // du coach, et le cas normal est qu'il n'y ait rien.
    const texte = 'Rien à nettoyer ici.';
    expect(retirerInvisibles(texte)).toBe(texte);
  });

  it('parcourt par point de code, sans couper les paires d’indirection', () => {
    // Un `for` classique découperait « 👍 » en deux moitiés dont aucune n'est un
    // caractère, et la comparaison de points de code deviendrait du hasard.
    expect(retirerInvisibles(`a${ZWSP}👍b`)).toBe('a👍b');
  });

  it('dit s’il y en a, sans se tromper deux fois de suite', () => {
    // Une expression `g` gardait `lastIndex` d'un appel à l'autre : un appel sur
    // deux mentait. Le parcours explicite n'a pas cet état, et ce test le fige.
    const avec = `x${ZWSP}y`;
    expect(contientDesInvisibles(avec)).toBe(true);
    expect(contientDesInvisibles(avec)).toBe(true);
  });
});
