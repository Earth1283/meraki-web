// Keeps a stored session alive: Supabase access tokens last an hour, and the
// refresh token behind them is good for much longer, so refreshing a little
// before each expiry (and on coming back to the tab or the network) means a
// returning user is still signed in however long the tab sat idle.
import { refreshSessionIfDue } from './api.js';

const CHECK_EVERY_MS = 60_000;
const MARGIN_SEC = 300;

export function keepSessionAlive() {
  const check = () => { refreshSessionIfDue(MARGIN_SEC).catch(() => {}); };
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
  check();
}
