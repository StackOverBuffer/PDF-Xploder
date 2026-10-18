import { describe, expect, it } from 'vitest';
import { sessionStorable, sessionTabs, useStore } from '../src/store/store';

const bytes = new Uint8Array([37, 80, 68, 70]);

describe('session backup', () => {
  it('keeps plain documents but never password-protected ones', () => {
    expect(sessionStorable({ bytes, encryption: null, security: null })).toBe(true);
    expect(sessionStorable({ bytes, encryption: { encrypted: true, permissions: {} as never }, security: null })).toBe(false);
    // New passwords not saved yet: they must not end up in browser storage either.
    expect(sessionStorable({ bytes, encryption: null, security: { userPassword: 'x', ownerPassword: 'y' } as never })).toBe(false);
    expect(sessionStorable({ bytes: null, encryption: null, security: null })).toBe(false);
  });

  it('lists every tab with a document, active and parked, in tab order', () => {
    const S = useStore.getState;
    for (const t of [...S().tabs]) S().closeTab(t.id, { force: true });
    useStore.setState({ fileName: 'a.pdf', bytes, pageIds: ['p1'], dirty: true });
    S().newTab();
    useStore.setState({ fileName: 'b.pdf', bytes, pageIds: ['p1'], encryption: { encrypted: true, permissions: {} as never } });
    S().newTab(); // empty: not listed
    const { tabs } = sessionTabs();
    expect(tabs.map((t) => [t.doc.fileName, t.storable, t.doc.dirty])).toEqual([
      ['a.pdf', true, true],
      ['b.pdf', false, false],
    ]);
  });
});
