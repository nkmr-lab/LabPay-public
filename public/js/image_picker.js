// 画像アップロード UI の共通配線。各 view で
//   <input type="file" id="X-file"> + <input type="hidden" id="X-url"> +
//   <img id="X-preview" hidden> + <div id="X-status"></div>
// を自前で wire up していたパターンを 1 関数に。
//
// 使い方:
//   import { setupImagePicker } from '../image_picker.js';
//   setupImagePicker('image');   // → 上記 ID prefix 'image' で自動配線
//   setupImagePicker('nj-image', { onUploaded: (data) => {...} });

import { uploadImage } from './upload.js';

export function setupImagePicker(prefix, opts = {}) {
  const {
    onUploaded = null,
    // ID prefix の後ろに -file / -url / -preview / -status / _file / _url / _preview / _status
    // どちらの命名スタイルでも拾える。
    fileSelector    = `#${prefix}-file,#${prefix}_file`,
    urlSelector     = `#${prefix}-url,#${prefix}_url,#${prefix}-image_url,#${prefix}image_url`,
    previewSelector = `#${prefix}-preview,#${prefix}_preview,#${prefix}-image_preview,#${prefix}image_preview`,
    statusSelector  = `#${prefix}-status,#${prefix}_status,#${prefix}-image_status,#${prefix}image_status`,
  } = opts;

  const file    = document.querySelector(fileSelector);
  const urlEl   = document.querySelector(urlSelector);
  const preview = document.querySelector(previewSelector);
  const status  = document.querySelector(statusSelector);
  if (!file) return null;

  file.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    // ローカルプレビュー (アップロード完了前にとりあえず見せる)
    if (preview) {
      const reader = new FileReader();
      reader.onload = (e) => { preview.src = e.target.result; preview.hidden = false; };
      reader.readAsDataURL(f);
    }
    if (status) status.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      if (urlEl) urlEl.value = data.url || '';
      if (preview) { preview.src = data.url; preview.hidden = false; }
      if (status) status.textContent = `✓ 完了 (${Math.round((data.size || 0)/1024)} KB)`;
      if (onUploaded) onUploaded(data);
    } catch (e) {
      if (status) status.textContent = '失敗: ' + e.message;
    }
  });
  return { fileEl: file, urlEl, previewEl: preview, statusEl: status };
}
