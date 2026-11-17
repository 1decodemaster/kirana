import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './App';
import { startOfflineQueue } from './api/client';
import { QUEUE_DRAINED_EVENT } from './lib/offline';
import { shouldRedirectToLogin } from './lib/session';
import { applyThemePreference, loadThemePreference } from './lib/theme';
import './styles/tokens.css';

const registry: { client?: QueryClient } = {};

/** §8.10 "Session expired": a 401 outside the auth screens ends the
 * session — drop cached data and land on the login screen. The expired
 * banner only shows when the session was actually in use (a query that
 * already had data died), not on a first visit. */
function onCacheError(error: unknown, ...rest: readonly unknown[]): void {
  const pathname = window.location.pathname;
  if (!shouldRedirectToLogin(error, pathname)) return;
  const hadData = rest.some((entry) => {
    const state = (entry as { state?: { data?: unknown } } | undefined)?.state;
    return state?.data !== undefined;
  });
  registry.client?.clear();
  void router.navigate(hadData ? '/login?expired=1' : '/login');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      // §8.7 offline reading: refetches pause while offline and resume on
      // reconnect — cached data keeps rendering.
    },
    mutations: {
      // §4.7: mutations always attempt immediately; a network failure is
      // queued by the api client and replayed on reconnect. ('online' would
      // park the mutation in a paused state instead.)
      networkMode: 'offlineFirst',
      retry: false,
    },
  },
  queryCache: new QueryCache({ onError: onCacheError }),
  mutationCache: new MutationCache({ onError: onCacheError }),
});
registry.client = queryClient;

// Restore the §8.2 theme override before first paint of the tree.
applyThemePreference(loadThemePreference(window.localStorage), document.documentElement);

// §4.7: replay queued mutations on boot and on reconnect; a successful
// replay invalidates the caches (the optimistic state became server state).
startOfflineQueue();
window.addEventListener(QUEUE_DRAINED_EVENT, () => {
  void queryClient.invalidateQueries();
});

// G4.4 installability: the offline-shell service worker (production only —
// the dev server has no dist to cache).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('#root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
