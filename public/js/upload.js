// Shared multipart file upload helpers. The bare fetch() boilerplate was
// duplicated across settings/sell/tasks; one helper keeps the CSRF header,
// cookie credentials, and error decoding consistent.

// POST /api/uploads/image — for product / avatar / listing images.
// Returns { url, path, mime, size, thumb_url?, thumb_path? }。 サムネは
// 画像 + GD 利用可なときだけ付く。 frontend は thumb_url があればそれを
// 一覧などのサムネ表示に使うのが望ましい (本文表示はオリジナルで)。
export async function uploadImage(file) {
  return uploadTo('/api/uploads/image', file);
}

// 既知の image URL から推定サムネ URL を返す helper。 サーバの
// thumb_url_for() と同じ規約 (/uploads/<name>.<ext> → /uploads/<name>.thumb.jpg)。
// サムネ存在チェックは出来ないので、 サムネ無い古い画像でも 「.thumb.jpg」
// にアクセスして 404 になる可能性あり (img tag は onerror で fallback できる)。
export function thumbUrlFor(imageUrl) {
  if (!imageUrl) return imageUrl;
  const m = imageUrl.match(/^(.*\/uploads\/[^.]+)\.([A-Za-z0-9]+)$/);
  if (!m) return imageUrl;
  return m[1] + '.thumb.jpg';
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
