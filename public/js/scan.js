// Barcode scanner using ZXing.
// - Restricts to retail formats (EAN-13/EAN-8/UPC-A/UPC-E) to avoid grabbing QR/Code128 by mistake.
// - Requires 2 consecutive identical decodes before firing onCode, so a single bad frame is ignored.

let zxingLoaded = false;

function loadZXing() {
  if (zxingLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/zxing.min.js';
    s.onload = () => { zxingLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('ZXing の読み込みに失敗しました (public/vendor/zxing.min.js を配置してください)'));
    document.head.appendChild(s);
  });
}

// Generate a QR code SVG for the given text. Returns an SVGElement.
export async function genQrSvg(text, size = 220) {
  await loadZXing();
  const Z = window.ZXingBrowser || window.ZXing;
  const Writer = Z?.BrowserQRCodeSvgWriter || Z?.QRCodeWriter;
  if (!Writer) throw new Error('ZXing QR ライターが見つかりません');
  const writer = new Writer();
  return writer.write(text, size, size);
}

const CONFIRM_COUNT = 2; // how many consecutive identical reads to require

// Common format presets so callers don't need to reach into ZXing themselves.
export const FORMAT_PRESETS = {
  retail: (Z) => [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
    Z.BarcodeFormat.UPC_A,  Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.ITF,
  ].filter(Boolean),
  qr: (Z) => [Z.BarcodeFormat.QR_CODE].filter(Boolean),
};

export async function startScanner(videoEl, onCode, opts = {}) {
  await loadZXing();
  const Z = window.ZXingBrowser || window.ZXing;
  if (!Z) throw new Error('ZXing が読み込まれていません');

  // Caller can pass a preset name or a custom formats array.
  let formats;
  if (Array.isArray(opts.formats))      formats = opts.formats;
  else if (typeof opts.formats === 'string' && FORMAT_PRESETS[opts.formats])
    formats = FORMAT_PRESETS[opts.formats](Z);
  else
    formats = FORMAT_PRESETS.retail(Z);

  let hints = null;
  try {
    if (Z.BarcodeFormat && Z.DecodeHintType) {
      hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
    }
  } catch (_) { /* hints are optional */ }

  const Reader = Z.BrowserMultiFormatReader || Z.BrowserBarcodeReader;
  const reader = hints ? new Reader(hints) : new Reader();

  let stopped = false;
  let controls = null;

  // Confirmation buffer: only accept a value seen at least CONFIRM_COUNT times in a row
  let lastValue = null;
  let lastCount = 0;
  let fired = false;
  const accept = (text) => {
    if (stopped || fired) return;
    if (text === lastValue) {
      lastCount += 1;
    } else {
      lastValue = text;
      lastCount = 1;
    }
    if (lastCount >= CONFIRM_COUNT) {
      fired = true;
      onCode(text);
    }
  };

  // Explicit constraints: high resolution + continuous autofocus.
  // Default constraints (low res, single-shot focus) are why barcodes were blurry.
  const videoConstraints = {
    facingMode: { ideal: 'environment' },
    width:      { ideal: 1280 },
    height:     { ideal: 720 },
    advanced:   [{ focusMode: 'continuous' }],
  };

  try {
    if (typeof reader.decodeFromConstraints === 'function') {
      controls = await reader.decodeFromConstraints(
        { video: videoConstraints }, videoEl,
        (result) => { if (!stopped && result) accept(result.getText()); }
      );
    } else if (typeof reader.decodeFromVideoDevice === 'function') {
      controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result, err, ctl) => {
        if (stopped) return;
        if (result) accept(result.getText());
      });
    } else {
      throw new Error('対応する ZXing API が見つかりません');
    }

    // After the camera starts, try applying continuous autofocus on the actual track
    // (some browsers ignore the `advanced` constraint above but accept applyConstraints).
    setTimeout(() => {
      try {
        const stream = videoEl.srcObject;
        const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
        if (!track || !track.applyConstraints) return;
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        const advanced = [];
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' });
        }
        if (advanced.length) track.applyConstraints({ advanced }).catch(() => {});
      } catch (_) {}
    }, 400);
  } catch (e) {
    throw new Error('カメラを起動できませんでした: ' + (e.message || e));
  }

  return {
    stop() {
      stopped = true;
      try { controls && controls.stop && controls.stop(); } catch (_) {}
      try { reader.reset && reader.reset(); } catch (_) {}
      try {
        const stream = videoEl.srcObject;
        if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
      } catch (_) {}
    }
  };
}
