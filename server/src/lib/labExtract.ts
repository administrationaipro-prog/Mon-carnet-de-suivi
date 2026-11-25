import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from './errors.js';

/**
 * Lecture automatique d'un compte rendu de coproscopie (PDF ou photo) par l'API Claude.
 * Le résultat n'est qu'une proposition : le vétérinaire vérifie chaque valeur avant de signer,
 * et le fichier d'origine est conservé tel quel comme pièce source.
 */
export const LabExtraction = z.object({
  lab_name: z.string().nullable(),
  lab_ref: z.string().nullable(),
  received_date: z.string().nullable(),
  method: z.string().nullable(),
  detection_limit_epg: z.number().int().nullable(),
  lab_comment: z.string().nullable(),
  results: z.array(z.object({
    label: z.string(),
    matched_internal_id: z.string().nullable(),
    strongyles_epg: z.number().int().nullable(),
    nematodirus_epg: z.number().int().nullable(),
    coccidia: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
  })),
  warnings: z.array(z.string()),
});
export type LabExtractionT = z.infer<typeof LabExtraction>;

export type Candidate = { internal_id: string; official_id: string | null; name: string | null };
export type ExtractInput = { data: Buffer; mime: string; candidates: Candidate[] };
export type Extractor = (i: ExtractInput) => Promise<LabExtractionT>;

const SYSTEM = `Tu lis des comptes rendus d'analyse coproscopique (laboratoire vétérinaire ou cabinet) pour des ovins et des caprins.
Recopie fidèlement ce qui est écrit, sans rien inventer ni corriger. Une valeur absente ou illisible vaut null.
Les nombres d'œufs sont en œufs par gramme (OPG / EPG) : convertis-les en entiers (« 1 450 » → 1450 ; « < 50 » ou « négatif » → 0).
Pour chaque ligne de résultat, recopie l'identifiant de l'animal tel qu'il est écrit dans « label ».
Si cet identifiant correspond sans ambiguïté à un animal de la liste fournie (identifiant interne, numéro officiel avec ou sans espaces, ou nom), mets son identifiant interne dans « matched_internal_id », sinon null.
« confidence » : high si la valeur et l'animal sont nets ; medium si la lecture ou la correspondance demande une vérification ; low si c'est très incertain.
Les dates au format AAAA-MM-JJ. Signale dans « warnings » tout ce que le vétérinaire doit vérifier (ligne illisible, unité inhabituelle, animal inconnu, page manquante).`;

let override: Extractor | null = null;
/** Pour les tests : remplace l'appel à l'API par une fonction locale. */
export function setExtractor(fn: Extractor | null) { override = fn; }

export function extractorAvailable() {
  return !!override || !!config.anthropicApiKey || process.env.AI_EXTRACT_FAKE === '1';
}

/** Lecteur factice pour la démonstration et les tests de bout en bout (AI_EXTRACT_FAKE=1). */
const fakeExtractor: Extractor = async ({ candidates }) => ({
  lab_name: 'Laboratoire de démonstration', lab_ref: 'DEMO-001', received_date: new Date().toISOString().slice(0, 10),
  method: 'McMaster modifiée (NaCl)', detection_limit_epg: 50, lab_comment: 'Lecture simulée (mode démonstration).',
  results: candidates.map((c, i) => ({
    label: i === candidates.length - 1 && candidates.length > 1 ? `A${i + 1}` : c.official_id ?? c.internal_id,
    matched_internal_id: i === candidates.length - 1 && candidates.length > 1 ? null : c.internal_id,
    strongyles_epg: 300 + i * 650, nematodirus_epg: 0, coccidia: i % 2 ? '+' : '0',
    confidence: i === candidates.length - 1 && candidates.length > 1 ? 'medium' : 'high',
  })),
  warnings: [],
});

const claudeExtractor: Extractor = async ({ data, mime, candidates }) => {
  const client = new Anthropic({ apiKey: config.anthropicApiKey! });
  const b64 = data.toString('base64');
  const doc: Anthropic.Beta.BetaContentBlockParam = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', data: b64 } };
  const list = candidates.map((c) => `- ${c.internal_id}${c.official_id ? ` | ${c.official_id}` : ''}${c.name ? ` | ${c.name}` : ''}`).join('\n');
  try {
    const res = await client.beta.messages.parse({
      model: config.aiModel,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(LabExtraction) },
      system: SYSTEM,
      messages: [{ role: 'user', content: [doc, { type: 'text', text: `Animaux de l'exploitation (identifiant interne | numéro officiel | nom) :\n${list || '(aucun)'}\n\nExtrais les résultats de ce compte rendu.` }] }],
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused');
    if (res.stop_reason === 'max_tokens' || !res.parsed_output) throw new HttpError(422, 'ai_unreadable');
    return res.parsed_output;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'ai_not_configured');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(422, 'ai_unreadable');
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'ai_unavailable');
    throw e;
  }
};

export async function extractLabReport(i: ExtractInput): Promise<LabExtractionT> {
  if (override) return override(i);
  if (process.env.AI_EXTRACT_FAKE === '1' && !config.anthropicApiKey) return fakeExtractor(i);
  if (!config.anthropicApiKey) throw new HttpError(503, 'ai_not_configured');
  return claudeExtractor(i);
}

/** Rapproche une étiquette du laboratoire d'un animal (numéro officiel sans espaces, identifiant interne, nom). */
export function matchAnimal<T extends { id: string; internal_id: string; official_id: string | null; name: string | null }>(label: string, hint: string | null, animals: T[]): T | null {
  const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (hint) { const h = animals.find((a) => a.internal_id === hint); if (h) return h; }
  const l = norm(label);
  if (!l) return null;
  return animals.find((a) => norm(a.official_id) === l || norm(a.internal_id) === l || norm(a.name) === l) ?? null;
}
