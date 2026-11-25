import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

export type PdfReport = {
  number: string; phase: string; species: string; sample_date: string; sample_mode: string | null; reason: string | null;
  farm: { name: string; locality: string | null; ede: string | null; owner: string | null; territory: string | null; herd: number };
  vet: { name: string; ordinal: string; clinic: string };
  lab: { name: string | null; ref: string | null; received: string | null; method: string | null; limit: number | null; comment: string | null };
  results: { animal: string; ident: string; category: string; famacha: number | null; bcs: number | null; strongyles: number | null; nematodirus: number | null; coccidia: string | null }[];
  fecrt: { n: number; mean_before: number; mean_after: number; reduction: number | null; status: string; threshold: number } | null;
  threshold_epg: number | null;
  interpretation: string;
  signature_png: string; signed_at: string; channel: string;
  content_hash: string; verify_url: string; source_name: string | null; source_sha256: string | null;
};

// Les polices standard PDF (WinAnsi) n'ont pas tous les caractères Unicode : on remplace les plus courants.
const clean = (s: string | null | undefined) => (s ?? '').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->').replace(/[’‘]/g, "'")
  .replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').replace(/[  ]/g, ' ').replace(/[^\x20-\x7E -ÿŒœ€]/g, '');
const fr = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso ?? '-');
const n = (v: number | null) => (v === null || v === undefined ? '-' : v.toLocaleString('fr-FR').replace(/ /g, ' '));

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export async function buildCoproPdf(r: PdfReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rapport de coproscopie ${r.number}`); doc.setAuthor(r.vet.name); doc.setCreator('Carnet de suivi');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.08, 0.32, 0.23), blue = rgb(0.11, 0.21, 0.34), grey = rgb(0.35, 0.37, 0.36), line = rgb(0.8, 0.84, 0.82);
  const W = 595.28, H = 841.89, M = 42;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(clean(s), { x, y: yy, size: o.size ?? 9.5, font: o.f ?? font, color: o.color ?? rgb(0.1, 0.12, 0.11) });
  const ensure = (h: number) => { if (y - h < M + 70) { page = doc.addPage([W, H]); y = H - M; } };
  const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yy - h, width: w, height: h, borderColor: line, borderWidth: 0.8, color: fill });

  // En-tête
  text('Carnet de suivi', M, y, { size: 13, f: bold, color: green });
  text('Suivi et optimisation de la production ovine et caprine', M, y - 13, { size: 8.5, color: grey });
  const rn = `Rapport n° ${r.number}`;
  text(rn, W - M - bold.widthOfTextAtSize(rn, 10), y, { size: 10, f: bold });
  const em = `Signé le ${fr(r.signed_at)}`;
  text(em, W - M - font.widthOfTextAtSize(em, 9), y - 13, { size: 9 });
  y -= 24; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.6, color: green });
  y -= 22;
  const title = "RAPPORT D'ANALYSE COPROSCOPIQUE";
  text(title, (W - bold.widthOfTextAtSize(title, 15)) / 2, y, { size: 15, f: bold });
  y -= 14;
  const sub = `Strongles gastro-intestinaux - ${r.phase === 'J14' ? 'contrôle après traitement (J14)' : r.phase === 'J0' ? 'avant traitement (J0)' : 'examen'} - ${r.species === 'caprine' ? 'Caprins' : 'Ovins'}`;
  text(sub, (W - font.widthOfTextAtSize(clean(sub), 9)) / 2, y, { size: 9, color: grey });
  y -= 16;

  // Cadres exploitation / vétérinaire / prélèvement / méthode
  const colW = (W - 2 * M - 10) / 2;
  const cell = (x: number, title: string, lines: string[], fill?: ReturnType<typeof rgb>, color?: ReturnType<typeof rgb>) => {
    const h = 18 + lines.length * 12;
    box(x, y, colW, h, fill);
    text(title, x + 8, y - 12, { size: 7.5, f: bold, color: green });
    lines.forEach((l, i) => text(l, x + 8, y - 25 - i * 12, { size: 9, f: color ? bold : font, color }));
    return h;
  };
  const vetFill = rgb(0.93, 0.95, 0.99);
  const h1 = Math.max(
    cell(M, 'EXPLOITATION', [`${r.farm.name}${r.farm.locality ? ` - ${r.farm.locality}` : ''}`, `Responsable : ${r.farm.owner ?? '-'}`, `N° EDE / cheptel : ${r.farm.ede ?? 'non renseigné'}`, `Espèce : ${r.species === 'caprine' ? 'Caprins' : 'Ovins'} - Effectif : ${r.farm.herd}`]),
    cell(M + colW + 10, 'VÉTÉRINAIRE', [r.vet.name, `N° d'inscription à l'Ordre : ${r.vet.ordinal}`, r.vet.clinic], vetFill, blue),
  );
  y -= h1 + 8;
  const h2 = Math.max(
    cell(M, 'PRÉLÈVEMENT', [`Date : ${fr(r.sample_date)}`, `Mode : ${r.sample_mode ?? 'individuel'}`, `Motif : ${r.reason ?? '-'}`]),
    cell(M + colW + 10, "MÉTHODE D'ANALYSE", [`${r.lab.method ?? '-'}`, `Seuil de détection : ${r.lab.limit ? `${r.lab.limit} oeufs/g` : '-'}`, `Laboratoire : ${r.lab.name ?? '-'}${r.lab.ref ? ` (${r.lab.ref})` : ''}`], vetFill, blue),
  );
  y -= h2 + 12;

  // Tableau des résultats
  const cols: [string, number, 'l' | 'r'][] = [['Animal', 86, 'l'], ['Identification', 86, 'l'], ['Catégorie', 78, 'l'], ['FAMACHA', 46, 'r'], ['NEC', 34, 'r'], ['Strongles (OPG)', 72, 'r'], ['Nematodirus', 58, 'r'], ['Coccidies', 51, 'l']];
  const header = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: rgb(0.93, 0.96, 0.94) });
    let x = M + 4;
    for (const [c, w, a] of cols) { const tw = bold.widthOfTextAtSize(c, 7.5); text(c, a === 'r' ? x + w - tw - 6 : x, y - 11, { size: 7.5, f: bold }); x += w; }
    y -= 16;
  };
  header();
  for (const row of r.results) {
    ensure(15); if (y > H - M - 5) header();
    const above = r.threshold_epg !== null && row.strongyles !== null && row.strongyles >= r.threshold_epg;
    const vals = [row.animal, row.ident, row.category, n(row.famacha), row.bcs === null ? '-' : String(row.bcs).replace('.', ','), `${n(row.strongyles)}${above ? ' *' : ''}`, n(row.nematodirus), row.coccidia ?? '-'];
    let x = M + 4;
    vals.forEach((v, i) => {
      const [, w, a] = cols[i]; const f = i >= 5 ? bold : font; const s = clean(v).slice(0, 26); const tw = f.widthOfTextAtSize(s, 8.5);
      text(s, a === 'r' ? x + w - tw - 6 : x, y - 11, { size: 8.5, f, color: i >= 5 ? blue : undefined }); x += w;
    });
    y -= 15; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line });
  }
  const vals = r.results.map((x) => x.strongyles).filter((v): v is number => v !== null);
  if (vals.length) { y -= 12; text(`Moyenne strongles : ${n(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))} OPG sur ${vals.length} animal(aux)${r.threshold_epg !== null ? ` - * : au-dessus du seuil de traitement retenu pour l'exploitation (${n(r.threshold_epg)} OPG)` : ''}`, M, y, { size: 8.5, color: grey }); }
  y -= 14;

  if (r.fecrt) {
    ensure(40);
    const f = r.fecrt;
    box(M, y, W - 2 * M, 34, rgb(0.99, 0.96, 0.9));
    text("TEST DE RÉDUCTION DE L'EXCRÉTION FÉCALE (FECRT)", M + 8, y - 12, { size: 7.5, f: bold, color: green });
    text(`J0 : ${n(f.mean_before)} OPG - J14 : ${n(f.mean_after)} OPG - ${f.n} animaux - réduction : ${f.reduction === null ? 'non calculable' : `${String(f.reduction).replace('.', ',')} %`} (seuil retenu ${f.threshold} %) : ${f.status === 'effective' ? 'efficacité conforme' : f.status === 'doubtful' ? 'efficacité douteuse' : '-'}`, M + 8, y - 25, { size: 9, f: bold });
    y -= 44;
  }
  if (r.lab.comment) {
    const ls = wrap(`Commentaire du laboratoire : ${r.lab.comment}`, font, 9, W - 2 * M - 16); ensure(ls.length * 12 + 10);
    ls.forEach((l) => { text(l, M, y, { size: 9, color: grey }); y -= 12; }); y -= 6;
  }
  const ils = wrap(r.interpretation, bold, 9.5, W - 2 * M - 16);
  ensure(ils.length * 13 + 26);
  box(M, y, W - 2 * M, ils.length * 13 + 22, vetFill);
  text('INTERPRÉTATION ET CONCLUSION DU VÉTÉRINAIRE', M + 8, y - 12, { size: 7.5, f: bold, color: green });
  ils.forEach((l, i) => text(l, M + 8, y - 26 - i * 13, { size: 9.5, f: bold, color: blue }));
  y -= ils.length * 13 + 32;

  // Signature
  ensure(110);
  box(M, y, colW + 40, 96);
  text('SIGNATURE DU VÉTÉRINAIRE', M + 8, y - 12, { size: 7.5, f: bold, color: green });
  try {
    const png = await doc.embedPng(Buffer.from(r.signature_png.replace(/^data:image\/png;base64,/, ''), 'base64'));
    const sc = Math.min(200 / png.width, 46 / png.height);
    page.drawImage(png, { x: M + 10, y: y - 66, width: png.width * sc, height: png.height * sc });
  } catch { /* signature illisible : le texte ci-dessous fait foi */ }
  text(`${r.vet.name} - signé le ${fr(r.signed_at)} à ${r.signed_at.slice(11, 16)} UTC`, M + 8, y - 78, { size: 8.5 });
  text(`Confirmation par code ${r.channel === 'sms' ? 'SMS' : 'courriel'} - identité vérifiée (n° ordinal)`, M + 8, y - 89, { size: 8, color: grey });
  page.drawRectangle({ x: M + colW + 60, y: y - 70, width: W - 2 * M - colW - 60, height: 54, borderColor: rgb(0.16, 0.33, 0.72), borderWidth: 2 });
  text('SIGNÉ ÉLECTRONIQUEMENT', M + colW + 72, y - 36, { size: 11, f: bold, color: rgb(0.16, 0.33, 0.72) });
  text(`${fr(r.signed_at)} ${r.signed_at.slice(11, 16)} UTC`, M + colW + 72, y - 52, { size: 9, f: bold, color: rgb(0.16, 0.33, 0.72) });
  y -= 108;

  // Pied de page : empreinte et QR de vérification
  ensure(70);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
  const qr = await doc.embedPng(await QRCode.toBuffer(r.verify_url, { margin: 1, width: 180 }));
  page.drawImage(qr, { x: M, y: y - 62, width: 58, height: 58 });
  const foot = [
    'Document signé électroniquement et scellé. Toute modification invalide la signature.',
    `Empreinte SHA-256 du contenu : ${r.content_hash}`,
    `Vérifier l'authenticité : ${r.verify_url}`,
    r.source_name ? `Pièce source conservée : ${r.source_name} (SHA-256 ${r.source_sha256?.slice(0, 16)}...)` : 'Résultats saisis par le vétérinaire.',
  ];
  foot.forEach((l, i) => text(l, M + 68, y - 14 - i * 12, { size: 7.5, color: grey }));
  return doc.save();
}
