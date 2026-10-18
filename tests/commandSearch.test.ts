import { describe, expect, it } from 'vitest';
import { dedupe, normalize, searchCommands, type CommandEntry } from '../src/lib/commandSearch';

const e = (label: string, path: string[], extra: Partial<CommandEntry> = {}): CommandEntry => ({ id: [...path, label].join('/'), label, path, run: () => {}, ...extra });
const ENTRIES = [
  e('Rotate left', ['Organize', 'Pages']),
  e('Rotate view right', ['Home', 'View']),
  e('Watermark', ['Organize', 'Page marks']),
  e('Delete', ['Organize', 'Pages']),
  e('OCR Pages', ['Convert', 'OCR'], { disabled: true }),
  e('Save', ['File', 'Document'], { keys: 'Ctrl+S' }),
  e('Save as', ['File', 'Document']),
];
const labels = (q: string) => searchCommands(ENTRIES, q).map((x) => x.label);

describe('command search', () => {
  it('normalizes accents and ß', () => {
    expect(normalize('Löschen Straße')).toBe('loschen strasse');
  });

  it('finds commands by English and German words, whatever the UI language', () => {
    expect(labels('rotate')).toEqual(['Rotate left', 'Rotate view right']);
    expect(labels('Wasserzeichen')).toEqual(['Watermark']);
    expect(labels('loschen')).toEqual(['Delete']);
  });

  it('requires every word and uses the location as context', () => {
    expect(labels('rotate view')).toEqual(['Rotate view right']);
    expect(labels('organize rot')).toEqual(['Rotate left']);
    expect(labels('rotate xyz')).toEqual([]);
  });

  it('ranks exact and prefix matches first, disabled commands last', () => {
    expect(labels('save')).toEqual(['Save', 'Save as']);
    // A name match beats a match on the location only.
    expect(labels('pages')).toEqual(['OCR Pages', 'Delete', 'Rotate left']);
    const list = [e('Print', ['File'], { disabled: true }), e('Print preview', ['File'])];
    expect(searchCommands(list, 'print').map((x) => x.label)).toEqual(['Print preview', 'Print']);
  });

  it('drops the same command repeated on another tab', () => {
    const list = dedupe([e('Highlight', ['Comment', 'Text markup']), e('Highlight', ['Review', 'Comments']), e('Highlight', ['Comment', 'Text markup', 'Colour'])]);
    expect(list.map((x) => x.path[0])).toEqual(['Comment', 'Comment']);
  });
});

describe('command search spelling', () => {
  it('accepts umlauts written as ae/oe/ue', () => {
    expect(searchCommands([e('Open', ['File', 'Document'])], 'oeffnen').map((x) => x.label)).toEqual(['Open']);
  });
});
