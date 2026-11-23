import { describe, expect, it } from 'vitest';
import { useStore } from '../src/store/store';

const bytes = new Uint8Array([37, 80, 68, 70]);

describe('search hits and undo', () => {
  it('keeps the hits when an undo restores only comments (e.g. redaction marks)', async () => {
    const S = useStore.getState;
    const hits = [{ page: 0, rect: { x: 10, y: 10, w: 40, h: 12 }, context: 'Secret' }];
    useStore.setState({ bytes, pageIds: ['p1'], annotations: {}, past: [], future: [], search: { query: 'Secret', hits, index: 0, matchCase: false } });
    S().checkpoint();
    useStore.setState({ annotations: { p1: [{ id: 'r1', type: 'redact', color: '#000', opacity: 1, author: 'me', createdAt: 0, rect: hits[0].rect }] } });
    await S().undo();
    expect(S().annotations).toEqual({});
    // The text did not change: the term is still there, and so are its hits.
    expect(S().search.hits).toEqual(hits);
    expect(S().search.index).toBe(0);
  });
});
