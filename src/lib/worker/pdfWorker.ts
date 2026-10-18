/**
 * Background thread for whole-document operations (pdf-lib parses and saves the
 * entire file: seconds for a big plan, which would freeze the interface).
 */
import * as ops from '../pdfOps';
import * as org from '../organize';
import * as sec from '../security';
import { useLang, type Lang } from '../i18n';
import { transferables, type WorkerModule } from './protocol';

const modules: Record<WorkerModule, Record<string, unknown>> = { ops, org, sec };

self.onmessage = async (e: MessageEvent<{ id: number; mod: WorkerModule; fn: string; args: unknown[]; lang: Lang }>) => {
  const { id, mod, fn, args, lang } = e.data;
  try {
    // Labels drawn into the file (measurements) follow the interface language.
    if (useLang.getState().lang !== lang) useLang.setState({ lang });
    const f = modules[mod][fn] as (...a: unknown[]) => unknown;
    const result = await f(...args);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, transferables(result));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
