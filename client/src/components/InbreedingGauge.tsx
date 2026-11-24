import { useApp } from '../state';

export type InbreedingLevel = 'ok' | 'warning' | 'refused';
export const levelChip = (l: InbreedingLevel | null | undefined) => (l === 'refused' ? 'err' : l === 'warning' ? 'warn' : 'ok');

/** Jauge de consanguinité : vert sous le seuil d’alerte, orange jusqu’à la limite, rouge au-delà (refus d’enregistrement). */
export function InbreedingGauge({ percent, warn, max }: { percent: number; warn: number; max: number }) {
  const { t, num } = useApp();
  const scale = Math.max(25, max * 1.6, percent * 1.1);
  const at = (v: number) => Math.min(100, (v / scale) * 100);
  return (
    <div className="gauge-wrap" role="img" aria-label={`${t('inbreeding')} ${num(percent, 2)} %`}>
      <div className="gauge" style={{ background: `linear-gradient(90deg, var(--primary-bright) 0 ${at(warn)}%, var(--mango) ${at(warn)}% ${at(max)}%, var(--danger) ${at(max)}% 100%)` }}>
        <span className="gauge-marker" style={{ left: `${at(percent)}%` }} />
      </div>
      <div className="gauge-ticks">
        <span style={{ left: `${at(warn)}%` }}>{t('gauge_warn')} {num(warn, 2)} %</span>
        <span style={{ left: `${at(max)}%` }}>{t('gauge_limit')} {num(max, 2)} %</span>
      </div>
    </div>
  );
}
