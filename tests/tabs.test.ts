import { describe, expect, it, beforeEach } from 'vitest';
import { anyTabDirty, useStore } from '../src/store/store';

const S = () => useStore.getState();
/** Pretend a document is open in the active tab (no pdf.js needed for the tab logic). */
const fakeDoc = (name: string, extra: Record<string, unknown> = {}) => useStore.setState({ fileName: name, pageIds: ['p1', 'p2'], currentPage: 1, scale: 1.5, fit: null, ...extra });
const names = () => S().tabs.map((t) => (t.id === S().activeTab ? `*${S().fileName}` : t.fileName));

describe('document tabs', () => {
  beforeEach(() => {
    // Back to a single empty tab.
    for (const t of [...S().tabs]) S().closeTab(t.id, { force: true });
  });

  it('keeps each tab’s document state when switching', () => {
    fakeDoc('a.pdf', { annotations: { p1: [{ id: 'x' }] } });
    const a = S().activeTab;
    S().newTab();
    fakeDoc('b.pdf', { currentPage: 0, scale: 2 });
    const b = S().activeTab;
    expect(names()).toEqual(['a.pdf', '*b.pdf']);
    S().switchTab(a);
    expect(S()).toMatchObject({ fileName: 'a.pdf', currentPage: 1, scale: 1.5 });
    expect(S().annotations).toEqual({ p1: [{ id: 'x' }] });
    S().switchTab(b);
    expect(S()).toMatchObject({ fileName: 'b.pdf', currentPage: 0, scale: 2 });
    expect(S().annotations).toEqual({});
  });

  it('closes active, inactive and last tabs', () => {
    fakeDoc('a.pdf');
    S().newTab();
    fakeDoc('b.pdf');
    S().newTab();
    fakeDoc('c.pdf');
    S().closeTab(S().tabs[0].id, { force: true });
    expect(names()).toEqual(['b.pdf', '*c.pdf']);
    S().closeTab(S().activeTab, { force: true });
    expect(names()).toEqual(['*b.pdf']);
    S().closeTab(S().activeTab, { force: true });
    expect(S().tabs).toHaveLength(1);
    expect(S().fileName).toBe('');
  });

  it('tracks unsaved changes in inactive tabs and refuses to switch while busy', () => {
    fakeDoc('a.pdf', { dirty: true });
    const a = S().activeTab;
    S().newTab();
    fakeDoc('b.pdf');
    expect(anyTabDirty()).toBe(true);
    expect(S().tabs.find((t) => t.id === a)).toMatchObject({ fileName: 'a.pdf', dirty: true });
    useStore.setState({ busy: 'Saving…' });
    S().switchTab(a);
    expect(S().fileName).toBe('b.pdf');
    useStore.setState({ busy: null });
    S().switchTab(a);
    expect(S().fileName).toBe('a.pdf');
  });

  it('reorders tabs', () => {
    fakeDoc('a.pdf');
    S().newTab();
    fakeDoc('b.pdf');
    S().newTab();
    fakeDoc('c.pdf');
    S().moveTab(S().activeTab, 0);
    expect(names()).toEqual(['*c.pdf', 'a.pdf', 'b.pdf']);
  });
});
