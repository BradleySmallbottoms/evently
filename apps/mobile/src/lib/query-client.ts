import { focusManager, QueryClient } from '@tanstack/react-query';

// Re-exported so tests share this module's focus singleton.
export { focusManager, QueryObserver } from '@tanstack/react-query';

/** Event lists stay as they are on a quick return, then reload on the next foreground. */
export const EVENT_LIST_STALE_MS = 5 * 60 * 1000;

/** Opt a public-event query into the foreground stale window. Other queries stay put. */
export const eventListFreshness = {
  staleTime: EVENT_LIST_STALE_MS,
  refetchOnWindowFocus: true,
} as const;

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Foreground focus is opt-in via eventListFreshness. A global default
        // would refetch identity, preferences, and saved events on every return.
        refetchOnWindowFocus: false,
      },
    },
  });
}

type AppStateLike = {
  addEventListener: (type: 'change', listener: (status: string) => void) => { remove: () => void };
};

/**
 * Native has no window focus. Treat AppState "active" as focused so a stale
 * event list can refetch. Web already uses the document focus listener.
 */
export function subscribeQueryFocus(appState: AppStateLike, platformOs: string): () => void {
  if (platformOs === 'web') return () => {};
  let remove = () => {};
  focusManager.setEventListener((handleFocus) => {
    const subscription = appState.addEventListener('change', (status) => {
      handleFocus(status === 'active');
    });
    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      subscription.remove();
    };
    remove = cleanup;
    return cleanup;
  });
  return () => remove();
}
