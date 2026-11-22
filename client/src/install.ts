// Installation de la PWA : capture de l’évènement « beforeinstallprompt » (Chrome, Edge, Samsung Internet)
// le plus tôt possible, avant le rendu de React, pour ne pas le manquer.
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: BIPEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export const subscribeInstall = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Déjà ouverte comme application installée (écran d’accueil). */
export function isStandalone(): boolean {
  return installed || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
export function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  // iPadOS se présente comme un Mac : on le repère par l’écran tactile
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
export const canPrompt = () => !!deferred;

/** Ouvre la boîte d’installation native. Renvoie true si l’utilisateur a accepté. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === 'accepted';
}

export function snapshot() { return `${canPrompt()}|${isStandalone()}`; }
