// Registers the service worker and offers "New version, reload" when a new
// worker is waiting. The page reloads only when the reader taps the prompt.

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * @param {(apply: () => void) => void} onUpdateReady called with a function that activates the waiting worker
 */
export async function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return;
  let accepted = false;
  /** @param {ServiceWorker} worker */
  const offer = (worker) =>
    onUpdateReady(() => {
      accepted = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install also changes the controller; reload only on the reader's request.
    if (accepted) location.reload();
  });

  let registration;
  try {
    registration = await navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' });
  } catch (error) {
    console.warn('Service worker not registered; the app will not work offline.', error);
    return;
  }
  if (!registration) return; // registration blocked (for example by a test harness)
  if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
  const check = () => registration.update().catch(() => {});
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
