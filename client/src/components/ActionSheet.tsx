import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state';
import { Icon, type IconName } from './Icon';

const ACTIONS: [string, string, IconName, string][] = [
  ['/weigh', 'v3_act_weigh', 'scale', ''], ['/parasitisme/tournee', 'v3_act_parasite', 'shield', 'red'], ['/health', 'v3_act_health', 'health', 'blue'], ['/repro', 'v3_act_repro', 'repro', 'gold'],
  ['/simulateur', 'v3_act_mating', 'dna', 'plum'], ['/feeding', 'v3_act_feed', 'wheat', 'grey'],
];

/** Feuille d’actions du bouton « + » : toutes les saisies en un geste, depuis n’importe quel écran. */
export function ActionSheet({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row between nowrap"><h2 id="sheet-title">{t('v3_sheet_title')}</h2><button className="icon-btn small" onClick={onClose} aria-label={t('close')}><Icon name="x" size={18} /></button></div>
        <p className="sub">{t('v3_sheet_sub')}</p>
        <div className="acts">
          {ACTIONS.map(([to, k, icon, c]) => (
            <Link key={to} to={to} className="act" onClick={onClose}><span className={`ic ${c}`}><Icon name={icon} /></span>{t(k)}</Link>
          ))}
        </div>
        <Link to="/herd/new" className="task" style={{ marginTop: '.7rem' }} onClick={onClose}>
          <span className="ic" style={{ background: 'var(--primary)', color: '#fff' }}><Icon name="plus" /></span>
          <span className="t"><b>{t('tile_new_animal')}</b><small>{t('v3_new_animal_sub')}</small></span><Icon name="chev" />
        </Link>
        <p className="small muted row nowrap" style={{ margin: '.9rem 0 0' }}><Icon name="wifioff" size={18} />{t('v3_offline_ok')}</p>
      </div>
    </div>
  );
}
