import React, { useState } from 'react';
import { LifeBuoy, Check, X } from 'lucide-react';
import { api } from '../services/api';
import './EtatSecours.css';

/*
  Le filet du coach, et la seule façon de savoir qu'il est tendu.

  Le fournisseur de secours ne travaille que lorsque toute la chaîne gratuite a
  échoué. Une clé recopiée de travers, une adresse à un caractère près ou un
  identifiant de modèle inexact y dormiraient donc jusqu'à la première panne de
  Groq — c'est-à-dire jusqu'au seul moment où l'on comptait dessus, et où l'on
  n'a plus le temps de corriger.

  Ce bouton tend le filet exprès. L'appel est réel : vérifier qu'une variable
  d'environnement est non vide ne prouve strictement rien.
*/

interface Etat {
  configure: boolean;
  url: string | null;
  modele: string | null;
  ok: boolean;
  latenceMs: number | null;
  erreur: string | null;
}

export const EtatSecours: React.FC = () => {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [encours, setEncours] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);

  const tester = async () => {
    setEncours(true);
    setPanne(null);
    try {
      setEtat(await api.get('/admin/secours'));
    } catch (e: any) {
      setPanne(e?.message || 'Le test n’a pas pu être lancé.');
    } finally {
      setEncours(false);
    }
  };

  return (
    <section className="secours">
      <h2 className="secours-titre">
        <LifeBuoy size={20} /> Secours du coach
      </h2>

      <p className="secours-intro">
        Le dernier maillon, payant, essayé seulement quand tous les modèles gratuits
        ont refusé. Comme il ne sert jamais en temps normal, une erreur de
        configuration y resterait invisible jusqu'à la première panne — ce test fait
        un vrai appel pour la débusquer avant.
      </p>

      <button className="btn-primary secours-bouton" onClick={tester} disabled={encours}>
        {encours ? 'Appel en cours…' : 'Tester le secours maintenant'}
      </button>

      {panne && <p className="secours-erreur">{panne}</p>}

      {etat && (
        <div className={`secours-resultat${etat.ok ? ' secours-resultat--ok' : ' secours-resultat--ko'}`}>
          <p className="secours-verdict">
            {etat.ok ? <Check size={16} /> : <X size={16} />}
            {!etat.configure
              ? 'Aucun secours configuré'
              : etat.ok
                ? `Le secours répond en ${etat.latenceMs} ms`
                : 'Le secours ne répond pas'}
          </p>

          {/*
            L'adresse et le modèle sont montrés parce qu'ils ne sont pas des
            secrets, et qu'ils portent la faute de frappe la plus probable : la
            valeur, elle, reste masquée sur Render et n'est jamais lisible ici.
          */}
          {etat.configure && (
            <dl className="secours-config">
              <dt>Adresse</dt>
              <dd>{etat.url}</dd>
              <dt>Modèle</dt>
              <dd>{etat.modele}</dd>
            </dl>
          )}

          {etat.erreur && (
            <p className="secours-detail">
              {/* Le message du fournisseur, tel quel : lui seul nomme la vraie faute. */}
              {etat.erreur}
            </p>
          )}

          {etat.ok && (
            <p className="secours-note">
              Le jour où Groq sature, le coach répondra quand même. La ligne
              <code> [Secours] 💳 </code> apparaîtra alors dans les journaux Render :
              c'est la seule trace qui relie une dépense à la saturation qui l'a
              causée.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
