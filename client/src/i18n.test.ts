import { describe, it, expect } from 'vitest';
import { catalogs, translate } from './i18n';

describe('catalogue i18n', () => {
  it('toutes les clés existent en français et en anglais, non vides', () => {
    const fr = Object.keys(catalogs.fr).sort(), en = Object.keys(catalogs.en).sort();
    expect(en).toEqual(fr);
    for (const k of fr) { expect(catalogs.fr[k].length).toBeGreaterThan(0); expect(catalogs.en[k].length).toBeGreaterThan(0); }
  });
  it('les variables sont présentes dans les deux langues', () => {
    for (const k of Object.keys(catalogs.fr)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(catalogs.en[k]), k).toEqual(vars(catalogs.fr[k]));
    }
  });
  it('interpolation', () => {
    expect(translate('en', 'n_pending_sync', { n: 3 })).toBe('3 entry(ies) waiting to sync');
  });
});
