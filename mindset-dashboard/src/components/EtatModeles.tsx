import React, { useState } from 'react';
import { Cpu, Check, X, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import './EtatSecours.css';

/*
  Les modeles appeles par le produit, et la seule facon de savoir qu ils existent.

  Groq a eteint deux des modeles du produit le 16 aout 2026. Le 18, ils etaient
  encore nommes dans cinq fichiers, et personne ne le savait : chaque service
  retombe proprement sur son repli local quand un modele refuse — le bon
  comportement, et exactement ce qui rend la panne muette. Le brief du matin est
  parti en version generique pour tout le monde pendant deux jours.

  **Une liste de modeles ecrite en dur pourrit toute seule.** Ce bouton fait un
  vrai appel a chacun. Lire un catalogue dans une documentation ne prouve rien
  sur ce que cette cle-la peut appeler aujourd hui.
*/

interface EtatModele {
  modele: string;
  ok: boolean;
  latenceMs: number | null;
  erreur: string | null;
  usages: string[];
}

interface Etat {
  configure: boolean;
  modeles: EtatModele[];
  chainesCompletes: boolean;
}

export const EtatModeles: React.FC = () => {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [encours, setEncours] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);

  const tester = async () => {
    setEncours(true);
    setPanne(null);
    try {
      setEtat(await api.get('/admin/modeles'));
    } catch (e: any) {
      setPanne(e?.message || 'Le test n a pas pu etre lance.');
    } finally {
      setEncours(false);
    }
  };

  return (
    <section className="secours">
      <h2 className="secours-titre">
        <Cpu size={20} /> Modeles du coach
      </h2>

      <p className="secours-intro">
        Les identifiants appeles par le chat, le brief du matin, le bilan et la
        memoire longue. Quand un modele disparait du catalogue, rien ne casse
        visiblement : le texte devient generique et personne ne le signale. Ce test
        fait un vrai appel a chacun.
      </p>

      <button className="btn-primary secours-bouton" onClick={tester} disabled={encours}>
        {encours ? 'Appels en cours…' : 'Verifier les modeles'}
      </button>

      {panne && <p className="secours-erreur">{panne}</p>}

      {etat && (
        <div
          className={
            'secours-resultat ' +
            (etat.chainesCompletes ? 'secours-resultat--ok' : 'secours-resultat--ko')
          }
        >
          <p className="secours-verdict">
            {etat.chainesCompletes ? <Check size={16} /> : <AlertTriangle size={16} />}
            {!etat.configure
              ? 'Aucune cle Groq configuree'
              : etat.chainesCompletes
                ? 'Chaque chaine garde un maillon vivant'
                : 'Une chaine est entierement eteinte'}
          </p>

          {/*
            Un modele mort au milieu d une chaine ne casse rien — le code passe au
            suivant. C est la chaine entierement eteinte qui fait basculer tout le
            monde sur les replis locaux, et c est elle que le verdict nomme.
          */}
          <ul className="tournee-liste">
            {etat.modeles.map((m) => (
              <li key={m.modele}>
                <span>
                  {m.ok ? <Check size={13} /> : <X size={13} />} <code>{m.modele}</code>
                </span>
                <span className="tournee-motif">
                  {m.ok ? m.latenceMs + ' ms' : m.erreur}
                </span>
              </li>
            ))}
          </ul>

          {etat.modeles.some((m) => !m.ok) && (
            <p className="secours-note">
              Un identifiant refuse doit etre remplace dans
              <code> src/common/modeles.ts </code>: c est le seul endroit ou ils sont
              ecrits, pour qu un catalogue qui bouge ne se repare pas a cinq endroits.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
