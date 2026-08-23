import React, { useEffect, useState } from 'react';
import { Share2, X, Download, Check } from 'lucide-react';
import './PartageSemaine.css';
import { lireBilanSemaine, type BilanSemaine } from '../utils/semaine';
import { dessinerCarteSemaine, partagerCarte } from '../utils/carteSemaine';
import { playClickSound } from '../utils/sounds';

/*
  Montrer sa semaine.

  Rien dans l'application ne sortait de l'application. Pour un produit dont le
  sujet est la régularité, c'est le levier le plus naturel qui manquait : la
  preuve d'assiduité est précisément ce que les gens ont envie de montrer, et
  c'est aussi la seule chose qui donne envie à quelqu'un d'autre d'essayer.

  Le bouton ne s'affiche pas quand il n'y a rien à montrer. Une carte à 0 %
  proposée à quelqu'un qui vient d'arriver lui demanderait de publier son échec.
*/

/** En dessous, la semaine n'a pas encore assez de matière pour être montrée. */
const JOURS_MINIMUM = 2;

export const PartageSemaine: React.FC = () => {
  const [bilan, setBilan] = useState<BilanSemaine | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [apercu, setApercu] = useState<string | null>(null);
  const [etat, setEtat] = useState<'idle' | 'travail' | 'fait' | 'telecharge' | 'echec'>('idle');

  useEffect(() => {
    const relire = () => setBilan(lireBilanSemaine());
    relire();
    window.addEventListener('mindset:journee', relire);
    window.addEventListener('storage', relire);
    return () => {
      window.removeEventListener('mindset:journee', relire);
      window.removeEventListener('storage', relire);
    };
  }, []);

  // L'aperçu n'est dessiné qu'à l'ouverture : produire un PNG de 1080 px à
  // chaque affichage du tableau de bord serait payé par tout le monde, pour un
  // écran que presque personne n'ouvre.
  useEffect(() => {
    if (!ouvert || !bilan) return;
    let vivant = true;
    let url: string | null = null;

    dessinerCarteSemaine(bilan, localStorage.getItem('mindset_user_name') || undefined)
      .then((blob) => {
        if (!vivant) return;
        url = URL.createObjectURL(blob);
        setApercu(url);
      })
      .catch(() => setEtat('echec'));

    return () => {
      vivant = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ouvert, bilan]);

  if (!bilan || bilan.joursActifs < JOURS_MINIMUM) return null;

  const partager = async () => {
    if (!bilan) return;
    playClickSound();
    setEtat('travail');
    try {
      const blob = await dessinerCarteSemaine(
        bilan,
        localStorage.getItem('mindset_user_name') || undefined,
      );
      const texte = `${bilan.joursActifs} jours tenus cette semaine, ${bilan.moyenne} % de discipline. Suivi avec Disciplix.`;
      const resultat = await partagerCarte(blob, texte);
      if (resultat === 'partage') setEtat('fait');
      else if (resultat === 'telecharge') setEtat('telecharge');
      else if (resultat === 'annule') setEtat('idle');
      else setEtat('echec');
    } catch {
      setEtat('echec');
    }
  };

  return (
    <>
      <button className="partage-semaine__declencheur" onClick={() => { playClickSound(); setOuvert(true); }}>
        <Share2 size={15} />
        Montrer ma semaine
      </button>

      {ouvert && (
        <div
          className="partage-semaine__fond"
          onClick={() => setOuvert(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Partager le bilan de la semaine"
        >
          <div className="partage-semaine__boite glass-panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="partage-semaine__fermer"
              onClick={() => setOuvert(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>

            <h3 className="partage-semaine__titre">Ta semaine</h3>

            {apercu ? (
              <img className="partage-semaine__apercu" src={apercu} alt="Aperçu du bilan de la semaine" />
            ) : (
              <div className="partage-semaine__attente">Préparation de l'image…</div>
            )}

            <button
              className="partage-semaine__action"
              onClick={partager}
              disabled={etat === 'travail' || !apercu}
            >
              {etat === 'travail' && 'Préparation…'}
              {etat === 'fait' && (<><Check size={16} /> Partagé</>)}
              {etat === 'telecharge' && (<><Download size={16} /> Image enregistrée</>)}
              {etat === 'echec' && 'Réessayer'}
              {etat === 'idle' && (<><Share2 size={16} /> Partager</>)}
            </button>

            {etat === 'telecharge' && (
              <p className="partage-semaine__note">
                Ton navigateur ne sait pas partager un fichier directement. L'image
                est dans tes téléchargements, prête à être publiée.
              </p>
            )}
            {etat === 'echec' && (
              <p className="partage-semaine__note">
                L'image n'a pas pu être produite. Réessaie dans un instant.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
