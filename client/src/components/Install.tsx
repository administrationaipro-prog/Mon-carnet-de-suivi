import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state';
import { canPrompt, isStandalone, platform, promptInstall, snapshot, subscribeInstall } from '../install';
import { Card, Notice } from './ui';

function useInstallState() {
  useSyncExternalStore(subscribeInstall, snapshot);
  return { standalone: isStandalone(), canPrompt: canPrompt(), platform: platform() };
}

/** Bouton « Installer l’application » : boîte native si disponible, sinon page d’aide. Masqué une fois installée. */
export function InstallButton({ block = false, small = false }: { block?: boolean; small?: boolean }) {
  const { t } = useApp();
  const s = useInstallState();
  if (s.standalone) return null;
  const cls = `btn ${small ? 'small' : ''} ${block ? 'block' : ''}`;
  if (s.canPrompt) return <button type="button" className={`${cls} primary`} onClick={() => promptInstall()}>📲 {t('install_app')}</button>;
  return <Link className={cls} to="/installer">📲 {t('install_app')}</Link>;
}

/** Page d’aide à l’installation (accessible sans compte). */
export function InstallPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useApp();
  const s = useInstallState();
  const url = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="stack install-page">
      {!embedded && <h1>📲 {t('install_title')}</h1>}
      {s.standalone ? <Notice kind="ok">{t('install_done')}</Notice> : (
        <>
          <p>{t('install_intro')}</p>
          {s.canPrompt && <button className="btn primary block" onClick={() => promptInstall()}>📲 {t('install_app')}</button>}
          <Card title={`🤖 ${t('install_android')}`} className={s.platform === 'android' ? 'highlight' : ''}>
            <ol className="steps">
              <li>{t('install_android_1')}</li>
              <li>{t('install_android_2')}</li>
              <li>{t('install_android_3')}</li>
            </ol>
          </Card>
          <Card title={`🍎 ${t('install_ios')}`} className={s.platform === 'ios' ? 'highlight' : ''}>
            <ol className="steps">
              <li>{t('install_ios_1')}</li>
              <li>{t('install_ios_2')}</li>
              <li>{t('install_ios_3')}</li>
            </ol>
          </Card>
          <Card title={`💻 ${t('install_desktop')}`} className={s.platform === 'other' ? 'highlight' : ''}>
            <p className="small">{t('install_desktop_1')}</p>
          </Card>
        </>
      )}
      <Card title={t('install_share')}>
        <p className="small muted">{t('install_share_text')}</p>
        <code className="secret">{url}</code>
      </Card>
      <Link to="/" className="btn block">← {t('back')}</Link>
    </div>
  );
}
