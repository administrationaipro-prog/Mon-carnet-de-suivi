import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { todayIso } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Field, Loading, Notice, useLoad } from '../components/ui';
import { Icon } from '../components/Icon';
import { InbreedingGauge } from '../components/InbreedingGauge';

/** Simulateur de saillie : lecture seule, aucune donnée enregistrée. */
export function Mating() {
  const { t, farm, d, num, pct } = useApp();
  const [params] = useSearchParams();
  const animals = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null);
  const [ram, setRam] = useState(params.get('ram') ?? '');
  const [ewe, setEwe] = useState(params.get('ewe') ?? '');
  const [date, setDate] = useState(todayIso());
  const sim = useLoad<any>(farm && ram && ewe ? `/farms/${farm.id}/mating-simulator?ram=${ram}&ewe=${ewe}&date=${date}` : null, [ram, ewe, date]);
  if (!farm) return null;

  const list = animals.data ?? [];
  const name = (a: any) => `${a.internal_id}${a.name ? ` — ${a.name}` : ''}`;
  const x = sim.data && sim.data.ram.id === ram && sim.data.ewe.id === ewe ? sim.data : null;
  const gen = (g: number) => (g <= 2 ? t(`gen_${g}`) : t('gen_n', { n: g }));
  const inb = x?.inbreeding;
  const rep = x?.reproduction;
  const row = (label: string, a: React.ReactNode, b: React.ReactNode) => (<><div className="l">{label}</div><div className="v">{a}</div><div className="v">{b}</div></>);
  const n1 = (v: number | null | undefined, dg = 0) => (v === null || v === undefined ? '—' : num(v, dg));

  return (
    <div className="stack">
      <h1><Icon name="dna" size={26} />{t('sim_title')}</h1>
      <p className="muted" style={{ margin: 0 }}>{t('sim_intro')}</p>
      <Card>
        <div className="grid3">
          <Field label={t('ram')} required>
            <select value={ram} onChange={(e) => setRam(e.target.value)}>
              <option value="">{t('sim_pick')}</option>
              {list.filter((a) => a.sex === 'M').map((a) => <option key={a.id} value={a.id}>{name(a)}</option>)}
            </select>
          </Field>
          <Field label={t('ewe')} required>
            <select value={ewe} onChange={(e) => setEwe(e.target.value)}>
              <option value="">{t('sim_pick')}</option>
              {list.filter((a) => a.sex === 'F').map((a) => <option key={a.id} value={a.id}>{name(a)}</option>)}
            </select>
          </Field>
          <Field label={t('sim_date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} /></Field>
        </div>
      </Card>

      <ErrorMsg error={sim.error} />
      {ram && ewe && sim.loading && !x && <Loading />}
      {x && (
        <>
          <section className={`verdict ${inb.level}`} aria-live="polite">
            <div className="v-sub">{t('sim_f_label')}</div>
            <div className="v-big num">{num(inb.coefficient_percent, 2)} %</div>
            <div className="v-title">{t(`sim_verdict.${inb.level}`)}</div>
            <div className="v-sub">{t('sim_relationship', { pct: num(inb.relationship_percent, 1) })}</div>
          </section>

          <Card title={t('inbreeding')}>
            <InbreedingGauge percent={inb.coefficient_percent} warn={inb.warn_percent} max={inb.limit_percent} />
            <p className="small muted" style={{ margin: 0 }}>{t('inb_limit_line', { warn: num(inb.warn_percent, 2), max: num(inb.limit_percent, 2) })}</p>
            <h3>{t('sim_common')}</h3>
            {inb.common_ancestors.length === 0 ? <p className="muted small">{t('sim_no_common')}</p> : (
              <ul className="list">{inb.common_ancestors.map((a: any) => (
                <li key={a.id}><Link to={`/herd/${a.id}`}><b>{a.label}</b></Link><div className="small muted">{t('sim_common_row', { ram: gen(a.gen_ram), ewe: gen(a.gen_ewe) })}</div></li>
              ))}</ul>
            )}
            <p className="small muted">{t('sim_pedigree_known', { ram: inb.pedigree.ram_generations, ewe: inb.pedigree.ewe_generations })} · {t('inb_min_note')}</p>
          </Card>

          <Card title={t('sim_perf_title')}>
            <div className="compare">
              <div className="h" /><div className="h v">{x.ram.name ?? x.ram.internal_id}</div><div className="h v">{x.ewe.name ?? x.ewe.internal_id}</div>
              {row(t('sim_own_gmq'), n1(x.performance.ram.gmq), n1(x.performance.ewe.gmq))}
              {row(t('sim_own_j90'), n1(x.performance.ram.weight_j90, 1), n1(x.performance.ewe.weight_j90, 1))}
              {row(t('sim_progeny'), x.performance.ram.progeny.n, x.performance.ewe.progeny.n)}
              {row(t('sim_progeny_gmq'), n1(x.performance.ram.progeny.gmq_mean), n1(x.performance.ewe.progeny.gmq_mean))}
              {row(t('sim_progeny_bw'), n1(x.performance.ram.progeny.birth_weight_mean, 2), n1(x.performance.ewe.progeny.birth_weight_mean, 2))}
            </div>
            {x.performance.midparent_gmq !== null && <p style={{ margin: '.8rem 0 0' }}><b>{t('sim_midparent', { n: num(x.performance.midparent_gmq, 0) })}</b></p>}
            {x.performance.pair_progeny.n > 0 && <p className="small" style={{ margin: '.3rem 0 0' }}>{t('sim_pair_progeny', { n: x.performance.pair_progeny.n })}{x.performance.pair_progeny.gmq_mean !== null ? ` · ${t('gmq')} ${num(x.performance.pair_progeny.gmq_mean, 0)} ${t('gmq_unit')}` : ''}</p>}
            <p className="small muted" style={{ margin: '.6rem 0 0' }}>{t('sim_perf_note')}</p>
          </Card>

          <Card title={t('sim_repro_title')}>
            <div className="stats">
              <div className="stat accent">
                <div className="stat-label">{t('sim_success')}</div>
                <div className="stat-value">{rep.success.rate === null ? '—' : pct(rep.success.rate)}</div>
                <div className="stat-sub">
                  {rep.success.basis ? t(`sim_basis.${rep.success.basis}`, { k: rep.success.k, n: rep.success.n }) : t('sim_success_none', { min: rep.min_n })}
                  {rep.success.ci && <><br />{t('sim_ci', { low: pct(rep.success.ci.low), high: pct(rep.success.ci.high) })}</>}
                </div>
              </div>
              <div className="stat mango">
                <div className="stat-label">{t('sim_expected_lambing', { date: '' }).replace(/\s*$/, '')}</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>{d(rep.expected_lambing_date)}</div>
                <div className="stat-sub">{t('sim_date')} : {d(rep.mating_date)}</div>
              </div>
            </div>
            <p className="small" style={{ margin: '.8rem 0 0' }}>
              {rep.litter.ewe.n > 0 ? t('sim_litter', { n: num(rep.litter.ewe.mean, 2), count: rep.litter.ewe.n }) : t('sim_litter_none')}
            </p>
          </Card>
          <Notice kind="warn"><span className="row" style={{ alignItems: 'flex-start' }}><Icon name="info" size={20} /><span>{t('sim_notice')}</span></span></Notice>
        </>
      )}
    </div>
  );
}
