import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './App';
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
    },
  },
  queryCache: new QueryCache({ onError: onCacheError }),
  mutationCache: new MutationCache({ onError: onCacheError }),
});
registry.client = queryClient;

// Restore the §8.2 theme override before first paint of the tree.
applyThemePreference(loadThemePreference(window.localStorage), document.documentElement);

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
