/**
 * Command search ("Quick Launch"): match typed words against every ribbon command,
 * in English and German whatever the interface language.
 */
import type { ReactNode } from 'react';
import { translate } from './i18n';

export interface CommandEntry {
  /** Stable key: the English path and label. */
  id: string;
  /** English label (translation key). */
  label: string;
  /** Where it lives, as English keys: ribbon tab, group, and the button whose menu holds it. */
  path: string[];
  title?: string;
  /** Shortcut, e.g. "Ctrl+S". */
  keys?: string;
  /** Untranslated extra text shown after the label (e.g. a current value). */
  value?: string;
  icon?: ReactNode;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  /** Why it is unavailable. */
  reason?: string;
}

/** Lower case without accents, so "loschen" finds "Löschen" and "strasse" finds "Straße". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
}

const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' };
const both = (key: string) => {
  const de = translate('de', key);
  if (de === key) return key;
  // "oeffnen" finds "Öffnen" as well as "offnen".
  const spelled = de.replace(/[äöüÄÖÜ]/g, (c) => UMLAUTS[c]);
  return `${key} ${de}${spelled === de ? '' : ` ${spelled}`}`;
};

interface Indexed {
  entry: CommandEntry;
  label: string;
  labelWords: string[];
  path: string;
  pathWords: string[];
  title: string;
}

const index = (entry: CommandEntry): Indexed => {
  const label = normalize(both(entry.label));
  const path = normalize(entry.path.map(both).join(' '));
  return { entry, label, labelWords: words(label), path, pathWords: words(path), title: normalize(entry.title ? both(entry.title) : '') };
};

function tokenScore(x: Indexed, t: string): number {
  if (x.labelWords.includes(t)) return 12;
  if (x.labelWords.some((w) => w.startsWith(t))) return 10;
  if (x.label.includes(t)) return 6;
  if (x.pathWords.some((w) => w.startsWith(t))) return 3;
  if (x.path.includes(t)) return 2;
  if (t.length > 2 && x.title.includes(t)) return 1;
  return 0;
}

/** Best matches for `query`, most relevant first. Every word must match somewhere. */
export function searchCommands(entries: CommandEntry[], query: string, limit = 12): CommandEntry[] {
  const tokens = words(query);
  if (!tokens.length) return [];
  const q = normalize(query.trim());
  const scored: { e: CommandEntry; score: number }[] = [];
  for (const x of entries.map(index)) {
    let score = 0;
    for (const t of tokens) {
      const s = tokenScore(x, t);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (!score) continue;
    if (x.label.startsWith(q)) score += 4;
    if (x.entry.disabled) score -= 5;
    scored.push({ e: x.entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.label.length - b.e.label.length);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Drop repeats of the same command in several places (the first, leftmost tab wins). */
export function dedupe(entries: CommandEntry[]): CommandEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.label}\u0000${e.value ?? ''}\u0000${e.title ?? ''}\u0000${e.path.length > 2 ? e.path[e.path.length - 1] : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------- recently used

const RECENT_KEY = 'pdf-xploder.recent-commands';

export function recentCommands(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentCommands().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* storage unavailable */
  }
}
