import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { todayIso } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Loading, Notice, useLoad, downloadUrl } from '../components/ui';

const PALETTE = ['#1f6f43', '#c2410c', '#1d4ed8', '#a21caf', '#0f766e', '#b45309', '#4d7c0f', '#be123c'];

export function Analytics() {
  const { t, farm, lang, num, pct, d } = useApp();
  const yearAgo = (() => { const x = new Date(); x.setFullYear(x.getFullYear() - 1); return x.toISOString().slice(0, 10); })();
  const [from, setFrom] = useState(yearAgo); const [to, setTo] = useState(todayIso());
  const [q, setQ] = useState({ from: yearAgo, to: todayIso() });
  const a = useLoad<any>(farm ? `/farms/${farm.id}/analytics?from=${q.from}&to=${q.to}` : null);
  if (!farm) return null;
  const x = a.data;
  const ind = (key: string, k: string, v: any, fmt: (n: any) => string, extra?: string) => (
    <div className="stat" key={key}>
      <div className="stat-value">{v.value === null ? '—' : fmt(v.value)}</div>
      <div className="stat-label">{t(k)}</div>
      <div className="stat-sub">{t(`inddef.${key}`)}{v.num !== undefined ? ` — ${v.num} / ${v.den}` : ''}{extra ? ` ${extra}` : ''}</div>
    </div>
  );
  const breeds = x ? [...new Set(x.curves.map((c: any) => c.breed_code ?? 'UNKNOWN'))] as string[] : [];
  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>{t('analytics_title')}</h1>
        <div className="row wrap">{['animals', 'weighings', 'feeding', 'health', 'repro'].map((k) => (
          <button key={k} className="btn small" onClick={() => downloadUrl(`/api/farms/${farm.id}/export/${k}.csv?lang=${lang}`)}>CSV {k}</button>
        ))}</div>
      </div>
      <Card>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setQ({ from, to }); }}>
          <label className="field inline"><span className="field-label">{t('from')}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field inline"><span className="field-label">{t('to')}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn">{t('apply')}</button>
        </form>
      </Card>
      <Notice>{t('descriptive_notice')}</Notice>
      <ErrorMsg error={a.error} />
      {a.loading && !x ? <Loading /> : x && (
        <>
          <p className="muted">{t('period')} : {d(x.period.from)} → {d(x.period.to)} · {t('population_exposed')} : <strong>{x.population.exposed}</strong></p>
          <div className="stats">
            {ind('mortality', 'ind_mortality', x.indicators.mortality, pct)}
            {ind('morbidity', 'ind_morbidity', x.indicators.morbidity, pct)}
            {ind('weaning', 'ind_weaning', x.indicators.weaning_rate, pct)}
            {ind('maternal', 'ind_maternal', x.indicators.maternal_productivity, (v) => num(v, 2))}
            <div className="stat">
              <div className="stat-value">{x.indicators.feed_cost_per_kg.value === null ? '—' : `${num(x.indicators.feed_cost_per_kg.value, 2)} €/kg`}</div>
              <div className="stat-label">{t('ind_feedcost')}</div>
              <div className="stat-sub">{t('inddef.feedcost')} — {num(x.indicators.feed_cost_per_kg.cost, 2)} € / {num(x.indicators.feed_cost_per_kg.gain_kg, 2)} kg · {x.indicators.feed_cost_per_kg.records_without_cost} {t('records_without_cost')}</div>
            </div>
            {ind('completeness', 'ind_completeness', x.indicators.completeness, pct)}
          </div>
          <Card title={t('growth_by_breed')}>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('breed')}</th><th className="num">{t('animals')}</th><th className="num">{t('gmq')} n</th><th className="num">{t('gmq')} {t('mean')}</th><th className="num">{t('median')}</th><th className="num">{t('min')}–{t('max')}</th><th className="num">{t('missing_data')}</th><th className="num">{t('weight_j30')}</th><th className="num">{t('weight_j60')}</th><th className="num">{t('weight_j90')}</th></tr></thead>
              <tbody>{x.growth_by_breed.map((g: any) => (
                <tr key={g.breed_code}><td>{lang === 'fr' ? g.label_fr : g.label_en}</td><td className="num">{g.animals}</td><td className="num">{g.gmq.n}</td><td className="num">{num(g.gmq.mean, 0)}</td><td className="num">{num(g.gmq.median, 0)}</td>
                  <td className="num">{g.gmq.n ? `${num(g.gmq.min, 0)}–${num(g.gmq.max, 0)}` : '—'}</td><td className="num">{g.gmq.missing}</td>
                  {(['weight_j30', 'weight_j60', 'weight_j90'] as const).map((k) => <td key={k} className="num">{g[k].n ? `${num(g[k].mean, 2)} (n=${g[k].n})` : '—'}</td>)}</tr>
              ))}</tbody>
            </table></div>
            <p className="small muted">{t('gmq_unit')} · {t('standard_weights')}</p>
          </Card>
          {x.curves.length > 0 && (
            <Card title={t('all_curves')}>
              <div className="chart" role="img" aria-label={t('all_curves')}>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                    <XAxis dataKey="age" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `J${v}`} stroke="var(--muted)" allowDuplicatedCategory={false} />
                    <YAxis width={56} tickFormatter={(v: number) => `${num(v, 1)} kg`} stroke="var(--muted)" />
                    <Tooltip formatter={(v: any) => `${num(Number(v), 2)} kg`} labelFormatter={(l) => `${t('age_days')} : ${l}`} />
                    <Legend />
                    {x.curves.slice(0, 40).map((c: any) => (
                      <Line key={c.id} data={c.points} dataKey="weight" name={c.label} stroke={PALETTE[breeds.indexOf(c.breed_code ?? 'UNKNOWN') % PALETTE.length]} dot={{ r: 3 }} strokeWidth={1.5} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
