import { useRegisterSW } from 'virtual:pwa-register/react';
import Archive from './Archive.jsx'

const mono = "ui-monospace, 'SF Mono', Menlo, monospace";

export default function App() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Poll every 30 s and re-check when the tab becomes visible (covers
      // iOS PWA background/foreground cycles where controllerchange is dropped).
      setInterval(() => registration.update(), 30_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  return (
    <>
      <Archive />
      {needRefresh && (
        <div style={{
          position: 'fixed', bottom: 88, left: '50%',
          transform: 'translateX(-50%)',
          background: '#B08D57', color: '#1B1815',
          fontFamily: mono, fontSize: 12,
          padding: '10px 16px', borderRadius: 6,
          zIndex: 70, display: 'flex', alignItems: 'center',
          gap: 12, whiteSpace: 'nowrap',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          Update ready
          <button
            onClick={() => updateServiceWorker(true)}
            style={{
              background: '#1B1815', color: '#B08D57',
              border: 'none', borderRadius: 4,
              padding: '4px 10px', fontFamily: mono,
              fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >Reload</button>
        </div>
      )}
    </>
  );
}
