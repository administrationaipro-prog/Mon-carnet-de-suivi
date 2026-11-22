// File d’attente hors connexion des pesées. Synchronisation contrôlée :
// - identifiant client (client_uuid) → aucun doublon si renvoi ;
// - un refus serveur (doublon, incohérence) n’écrase rien : l’entrée passe en « conflit » et l’utilisateur décide.
import { ApiError, post } from './api';

export type QueuedWeighing = {
  client_uuid: string; farmId: string; animalId: string; animalLabel: string;
  body: { date: string; weight_kg: number; height_cm?: number | null; length_cm?: number | null; note?: string | null };
  queued_at: string; conflict?: { code: string; details?: any };
};

const KEY = 'carnet.outbox.v1';
const listeners = new Set<() => void>();

export function readQueue(): QueuedWeighing[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function write(q: QueuedWeighing[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* stockage indisponible */ }
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function enqueue(item: QueuedWeighing) { write([...readQueue(), item]); }
export function discard(client_uuid: string) { write(readQueue().filter((q) => q.client_uuid !== client_uuid)); }
export function clearQueue() { write([]); }

let syncing = false;
export async function flush(opts: { confirmUuid?: string } = {}): Promise<{ sent: number; conflicts: number }> {
  if (syncing) return { sent: 0, conflicts: 0 };
  syncing = true;
  let sent = 0;
  try {
    for (const item of readQueue()) {
      if (item.conflict && item.client_uuid !== opts.confirmUuid) continue;
      try {
        await post(`/farms/${item.farmId}/animals/${item.animalId}/weighings`, {
          ...item.body, client_uuid: item.client_uuid, source: 'offline_sync', confirm: item.client_uuid === opts.confirmUuid ? true : undefined,
        });
        write(readQueue().filter((q) => q.client_uuid !== item.client_uuid));
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // toujours hors connexion
        if (e instanceof ApiError && e.status === 401) break;
        const code = e instanceof ApiError ? e.code : 'generic';
        write(readQueue().map((q) => (q.client_uuid === item.client_uuid ? { ...q, conflict: { code, details: e instanceof ApiError ? e.details : undefined } } : q)));
      }
    }
  } finally { syncing = false; }
  return { sent, conflicts: readQueue().filter((q) => q.conflict).length };
}
