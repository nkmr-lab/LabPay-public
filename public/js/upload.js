// Shared multipart file upload helpers. The bare fetch() boilerplate was
// duplicated across settings/sell/tasks; one helper keeps the CSRF header,
// cookie credentials, and error decoding consistent.

// POST /api/uploads/image — for product / avatar / listing images.
// Returns { url, path, mime, size } on success. Throws with a useful message
// on failure (server's error.message when available, else 'HTTP <status>').
export async function uploadImage(file) {
  return uploadTo('/api/uploads/image', file);
}

// POST /api/tasks/{taskId}/attachments — for the 原稿チェック-style attachment
// flow. Returns whatever the attachments endpoint returns (id + metadata).
export async function uploadTaskAttachment(taskId, file) {
  return uploadTo(`/api/tasks/${taskId}/attachments`, file);
}

async function uploadTo(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'X-Requested-With': 'labpay' },
    credentials: 'same-origin',
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}
