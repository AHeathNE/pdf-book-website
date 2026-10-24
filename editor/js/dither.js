// Turns a rasterized page into the two-color dot pattern the Dither setting
// applies to the whole book. The algorithms (Floyd–Steinberg, Atkinson,
// ordered 8x8 Bayer, threshold) are the ones the thermal-printer projects
// use; the difference is that the output here is ink/paper colors instead of
// a printer's 1-bit raster, and the tone curve is just contrast/brightness —
// no printer-specific midtone compensation.

export const DITHER_LABELS = {
  floyd: 'Floyd–Steinberg',
  atkinson: 'Atkinson',
  ordered: 'Ordered (halftone)',
  threshold: 'Threshold',
};

const BAYER8 = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length;
    const out = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        out[y][x] = 4 * m[y][x]; out[y][x + n] = 4 * m[y][x] + 2;
        out[y + n][x] = 4 * m[y][x] + 3; out[y + n][x + n] = 4 * m[y][x] + 1;
      }
    }
    m = out;
  }
  return m;
})();

const FLOYD_STEINBERG = [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]; // /16
const ATKINSON = [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]; // /8 — spreads only 6/8 of the error, so highlights and shadows stay clean

// gray: Float32Array (0 black … 255 white) -> Uint8Array, 1 = ink dot
function ditherGray(gray, w, h, type) {
  const bits = new Uint8Array(w * h);
  if (type === 'ordered') {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        bits[y * w + x] = gray[y * w + x] > ((BAYER8[y & 7][x & 7] + 0.5) / 64) * 255 ? 0 : 1;
      }
    }
    return bits;
  }
  if (type === 'threshold') {
    for (let i = 0; i < gray.length; i += 1) bits[i] = gray[i] >= 128 ? 0 : 1;
    return bits;
  }
  const kernel = type === 'atkinson' ? ATKINSON : FLOYD_STEINBERG;
  const div = type === 'atkinson' ? 8 : 16;
  const g = Float32Array.from(gray);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const old = g[y * w + x];
      const nv = old >= 128 ? 255 : 0;
      const err = old - nv;
      bits[y * w + x] = nv ? 0 : 1;
      for (const [dx, dy, k] of kernel) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < w && yy < h) g[yy * w + xx] += (err * k) / div;
      }
    }
  }
  return bits;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// source: any canvas at the page's native size. Returns a canvas one pixel
// per dot — `dotSize` times smaller each way than the source — drawn in the
// ink/paper colors. Scale it back up with the browser's own pixelated
// rendering (the viewer/editor overlay) or upscaleDots() (the PDF).
export function ditherToDots(source, settings) {
  const dot = Math.min(16, Math.max(1, Math.round(settings.dotSize) || 1));
  const w = Math.max(1, Math.round(source.width / dot));
  const h = Math.max(1, Math.round(source.height / dot));

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  tg.fillStyle = '#fff';
  tg.fillRect(0, 0, w, h);
  tg.imageSmoothingQuality = 'high';
  tg.drawImage(source, 0, 0, w, h);
  const px = tg.getImageData(0, 0, w, h).data;

  const contrast = settings.contrast || 0;
  const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const b = (settings.brightness || 0) * 1.28;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i += 1) {
    const v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    gray[i] = Math.min(255, Math.max(0, f * (v - 128) + 128 + b));
  }
  const bits = ditherGray(gray, w, h, settings.type);

  const ink = hexToRgb(settings.ink);
  const paper = hexToRgb(settings.paper);
  const out = tg.createImageData(w, h);
  for (let i = 0; i < bits.length; i += 1) {
    const c = bits[i] ? ink : paper;
    out.data[i * 4] = c[0];
    out.data[i * 4 + 1] = c[1];
    out.data[i * 4 + 2] = c[2];
    out.data[i * 4 + 3] = 255;
  }
  tg.putImageData(out, 0, 0);
  return tmp;
}

// Blows a dot canvas back up to the page's native size without smoothing, so
// each dot stays a crisp square block.
export function upscaleDots(dotCanvas, width, height) {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(dotCanvas, 0, 0, width, height);
  return out;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the dithered page'))), 'image/png');
  });
}
