import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Archive from './Archive.jsx'

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

  // no banner — just apply the new version silently as soon as it's ready
  useEffect(() => {
    if (needRefresh) updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

  return <Archive />;
}
