import * as api from './api.js';
import { submissionStoragePath, MAX_UPLOAD_BYTES } from './submission.js';
import { t } from './i18n.js';

// Only an unsubmitted assignment has a cloud draft. Check again immediately
// before the conditional write, so another tab's turn-in cannot be undone.
export async function saveCloudDraft({ assignment, studentId, userId, body, file }, client = api) {
  const checkAccount = () => {
    if (!studentId || client.getSession()?.user_id !== userId) throw new Error(t('drafts.accountChanged'));
  };
  checkAccount();
  if (assignment.submission_mode !== 'online') throw new Error(t('drafts.locked'));
  if (file && file.size > MAX_UPLOAD_BYTES) throw new Error(t('turnin.tooBig'));
  const [existing] = await client.getTable('assignment_submissions', `select=id,status,file_upload_id&assignment_id=eq.${encodeURIComponent(assignment.id)}&student_id=eq.${encodeURIComponent(studentId)}`);
  checkAccount();
  if (existing && existing.status !== 'draft') throw new Error(t('drafts.locked'));
  let fileUploadId = existing?.file_upload_id ?? null;
  if (file) {
    const path = submissionStoragePath(assignment.id, studentId, file.name);
    await client.uploadFile(path, file);
    checkAccount();
    fileUploadId = await client.insertRow('file_uploads', {
      class_id: assignment.class_id, student_id: studentId, audience: 'teachers',
      title: `${assignment.title} — submission`, storage_path: path,
      file_name: file.name.slice(0, 200), mime_type: file.type || null,
      size_bytes: file.size, uploaded_by: userId,
    }, { returnId: true });
    checkAccount();
  }
  const data = { body: body || null, file_upload_id: fileUploadId };
  let id = existing?.id;
  if (existing) await client.updateDraftSubmission(id, studentId, data);
  else id = await client.insertRow('assignment_submissions', { ...data, assignment_id: assignment.id, student_id: studentId, status: 'draft' }, { returnId: true });
  checkAccount();
  return { id, ...data, status: 'draft' };
}
