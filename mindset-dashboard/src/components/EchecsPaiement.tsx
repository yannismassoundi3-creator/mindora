import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { api } from '../services/api';
// Les mêmes styles que les signalements : ce sont deux listes d'incidents datés
// et nominatifs, et leur donner deux apparences ferait croire à deux natures.
import './SignalementsIA.css';

/*
  Les paiements qui n'ont même pas pu s'ouvrir.

  C'est le pire échec possible dans ce produit : quelqu'un a décidé de payer, et
  l'écran lui a répondu « réessaie dans un moment ». Constaté le 20 août 2026 sur
  la capture d'un abonné — et invisible jusque-là, puisque la cause ne s'écrivait
  que dans les journaux de l'hébergeur.

  Le code de Stripe est affiché tel quel parce que c'est lui qui décide du geste :
  `resource_missing` sur `customer` est une fiche périmée (désormais rattrapée
  toute seule), `api_key_expired` est une variable à changer, `rate_limit` est une
  minute à attendre. Une phrase écrite ici à leur place ne saurait pas les
  distinguer.
*/

interface Echec {
  id: string;
  quand: string;
  prenom: string;
  email: string;
  formule: string;
  code: string;
  parametre: string | null;
  message: string | null;
  rattrape: boolean;
}

export const EchecsPaiement: React.FC = () => {
  const [total, setTotal] = useState<number | null>(null);
  const [rattrapes, setRattrapes] = useState(0);
  const [liste, setListe] = useState<Echec[]>([]);
  const [panne, setPanne] = useState(false);

  useEffect(() => {
    api
      .get('/admin/paiements-echoues')
      .then((r: any) => {
        setTotal(r.total);
        setRattrapes(r.rattrapes ?? 0);
        setListe(r.echecs ?? []);
      })
      .catch(() => setPanne(true));
  }, []);

  return (
    <section className="signalements">
      <h2 className="signalements-titre">
        <CreditCard size={20} /> Paiements refusés à l’ouverture
      </h2>

      <p className="signalements-intro">
        Quelqu’un a voulu payer et n’a pas pu. Le code vient de Stripe : c’est lui qui dit
        s’il faut attendre une minute ou corriger une variable.
      </p>

      {panne && <p className="signalements-vide">La liste n’a pas pu être chargée.</p>}

      {!panne && total === 0 && (
        <p className="signalements-vide">Aucun paiement refusé. C’est la bonne nouvelle.</p>
      )}

      {total !== null && total > 0 && (
        <p className="signalements-vide">
          {total} au total, dont <strong>{rattrapes}</strong> rattrapé{rattrapes > 1 ? 's' : ''} tout
          seul{rattrapes > 1 ? 's' : ''} — la personne a fini par payer, mais l’échec a bien eu lieu.
        </p>
      )}

      {liste.map((e) => (
        <article key={e.id} className="signalement">
          <header className="signalement-tete">
            <span className="signalement-qui">
              {e.prenom} · {e.formule}
              {e.rattrape && ' · rattrapé'}
            </span>
            <span className="signalement-quand">
              {new Date(e.quand).toLocaleString('fr-FR', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </header>
          <p className="signalement-message">
            <strong>{e.code}</strong>
            {e.parametre ? ` sur ${e.parametre}` : ''}
            {e.message ? ` — ${e.message}` : ''}
          </p>
        </article>
      ))}
    </section>
  );
};
