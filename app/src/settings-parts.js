// Pieces the sections of Settings share (src/settings-screen.js, src/settings-agents.js): data
// that loads once and on demand again, and a status line for each action.

import { html, useEffect, useState } from './ui.js';

/**
 * Data for a section that loads once and on demand again.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} load
 */
export function useLoad(load) {
  const [state, setState] = useState(/** @type {{ data: T | null, error: unknown }} */ ({ data: null, error: null }));
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, error: null }),
      (/** @type {unknown} */ error) => !controller.signal.aborted && setState((s) => ({ ...s, error })),
    );
    return () => controller.abort();
  }, [round]);
  return { ...state, reload: () => setRound((r) => r + 1) };
}

/**
 * A status line for an action, and a runner that reports its failure there.
 * @returns {[string, boolean, (action: () => Promise<unknown>, done?: string) => Promise<void>]}
 */
export function useAction() {
  const [status, setStatus] = useState({ text: '', error: false });
  const run = async (/** @type {() => Promise<unknown>} */ action, done = '') => {
    setStatus({ text: '', error: false });
    try {
      await action();
      setStatus({ text: done, error: false });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };
  return [status.text, status.error, run];
}

/** @param {{ text: string, error: boolean, testid?: string }} props */
export const Status = ({ text, error, testid }) =>
  html`<p class=${`form-status${error ? ' error' : ''}`} role="status" data-testid=${testid ?? 'settings-status'}>${text}</p>`;
