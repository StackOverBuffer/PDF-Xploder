/** The Fonts and Security tabs of Document properties. */
import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { listFonts, isStandardFont, type FontInfo } from '../lib/fontList';
import { rangeText } from '../lib/organize';
import { useT } from '../lib/i18n';
import { RestrictionsSummary } from './SecurityDialogs';

export function FontsTab() {
  const t = useT();
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  useEffect(() => {
    const b = useStore.getState().bytes;
    if (b) listFonts(b).then(setFonts).catch(() => setFonts([]));
  }, []);
  if (!fonts) return <p>{t('Loading…')}</p>;
  if (!fonts.length) return <p className="muted">{t('The pages use no fonts.')}</p>;
  const missing = fonts.filter((f) => !f.embedded && !isStandardFont(f.name)).length;
  return (
    <>
      <div className="font-list">
        <table className="perm-summary">
          <thead>
            <tr><th>{t('Font')}</th><th>{t('Font type')}</th><th>{t('Embedded')}</th><th>{t('Pages')}</th></tr>
          </thead>
          <tbody>
            {fonts.map((f, i) => (
              <tr key={i}>
                <td>{f.name}{f.encoding && <div className="muted small">{f.encoding}</div>}</td>
                <td>{f.type}</td>
                <td className={f.embedded || isStandardFont(f.name) ? '' : 'bad'}>
                  {f.embedded ? t(f.subset ? 'Embedded subset' : 'Embedded') : t(isStandardFont(f.name) ? 'No (standard font)' : 'No')}
                </td>
                <td>{rangeText(f.pages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing > 0 && <p className="warn-text small">{t('Fonts that are not embedded are replaced by similar fonts on other computers, so the text may look different or not fit.')}</p>}
    </>
  );
}

export function SecurityTab() {
  const t = useT();
  const s = useStore();
  const enc = s.encryption;
  const status = !enc?.encrypted
    ? t('Not encrypted')
    : s.lock?.needsUserPassword || (!s.securityChanged && s.security?.userPassword)
      ? t('Encrypted, opens with a password')
      : t('Encrypted, opens without a password');
  return (
    <>
      <table className="perm-summary">
        <tbody>
          <tr><td>{t('Security')}</td><td>{status}</td></tr>
          {enc?.encrypted && <tr><td>{t('Encryption')}</td><td>{enc.algorithm}</td></tr>}
          {s.securityChanged && <tr><td>{t('When saving')}</td><td>{s.security ? `${t('Encrypted')} (${s.security.algorithm})` : t('Not encrypted')}</td></tr>}
          {enc?.encrypted && (
            <tr>
              <td>{t('Permissions password')}</td>
              <td>{s.ownerAccess ? t('Known (or no restrictions)') : s.restrictionsLifted ? t('Restrictions lifted for this session') : t('Not known')}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small"><strong>{t('What this session may do')}</strong></p>
      <RestrictionsSummary />
    </>
  );
}
