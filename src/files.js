import * as api from './api.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

// Signed URLs expire in an hour and are single-use-ish (Supabase reissues
// them fine, but they're not meant to be stashed) — so this is requested
// fresh on every click rather than cached on the file row.
export async function downloadFileUpload(f, triggerBtn) {
  const original = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = t('detail.downloadPreparing');
  }
  try {
    const url = await api.getSignedFileUrl(f.storage_path);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    showToast(t('detail.downloadFailed', { msg: err.message }), 'bad');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = original;
    }
  }
}
