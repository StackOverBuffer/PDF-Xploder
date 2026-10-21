/** Preferences: changes apply at once and are remembered in this browser. */
import { Modal } from './Dialogs';
import { useStore } from '../store/store';
import { setSessionEnabled, useSession } from '../store/session';
import { DEFAULT_PREFS, setPrefs, usePrefs, type DefaultZoom } from '../lib/prefs';
import { setTheme, useTheme, type Theme } from '../lib/theme';
import { useLang, useT, type Lang } from '../lib/i18n';

const NOFLEX = { flex: 'none' } as const;

export function PrefsDialog({ close }: { close: () => void }) {
  const t = useT();
  const theme = useTheme((x) => x.theme);
  const lang = useLang((l) => l.lang);
  const setLang = useLang((l) => l.setLang);
  const author = useStore((s) => s.author);
  const zoom = usePrefs((p) => p.defaultZoom);
  const session = useSession((x) => x.enabled);
  const background = usePrefs((p) => p.backgroundDrawing);
  return (
    <Modal title={t('Preferences')} onClose={close} footer={<button className="primary" onClick={close}>{t('Close')}</button>}>
      <h3 className="prefs-heading">{t('Appearance')}</h3>
      <label className="row"><span>{t('Theme')}</span>
        <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
          <option value="system">{t('Same as system')}</option>
          <option value="light">{t('Light')}</option>
          <option value="dark">{t('Dark')}</option>
        </select>
      </label>
      <label className="row"><span>{t('Language')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>
      <h3 className="prefs-heading">{t('Documents')}</h3>
      <label className="row"><span>{t('Zoom when opening')}</span>
        <select value={zoom} onChange={(e) => setPrefs({ defaultZoom: e.target.value as DefaultZoom })}>
          <option value="width">{t('Fit width')}</option>
          <option value="page">{t('Fit page')}</option>
          <option value="actual">{t('Actual size')}</option>
        </select>
      </label>
      <label className="row"><span>{t('Author name')}</span>
        <input value={author} onChange={(e) => useStore.getState().setAuthor(e.target.value)} />
      </label>
      <label className="row"><input type="checkbox" style={NOFLEX} checked={session} onChange={(e) => void setSessionEnabled(e.target.checked)} /> {t('Restore open documents at the next start')}</label>
      <label className="row" title={t('Complex pages (plans, maps) are drawn in a background thread, so scrolling and zooming stay smooth. Uses more memory.')}>
        <input type="checkbox" style={NOFLEX} checked={background !== 'off'} onChange={(e) => setPrefs({ backgroundDrawing: e.target.checked ? 'auto' : 'off' })} /> {t('Draw complex pages in the background (experimental)')}
      </label>
      <h3 className="prefs-heading">{t('Window')}</h3>
      <div className="row">
        <span className="muted small" style={{ flex: 1 }}>{t('Pane widths, open panes and the ribbon tab are remembered.')}</span>
        <button style={NOFLEX} onClick={() => setPrefs({ sidebarWidth: DEFAULT_PREFS.sidebarWidth, propsWidth: DEFAULT_PREFS.propsWidth, showProps: true })}>{t('Reset layout')}</button>
      </div>
    </Modal>
  );
}
