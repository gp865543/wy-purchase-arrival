// Convert our complete BITMAP job into one cropped, lossless PCX; keep BOX native.
export type StoredLabel = { image: Uint8Array; left: number; top: number; initialization: string; border: string };
export function storedLabel(command: { dataBase64: string; initialization?: string }, dpi: number): StoredLabel {
  const raw = atob(command.dataBase64);
  const bitmaps: { x: number; y: number; stride: number; height: number; pixels: string }[] = [];
  let offset = 0, border = '';
  while (offset < raw.length) {
    if (raw.startsWith('BITMAP ', offset)) {
      const m = /^BITMAP (-?\d+),(-?\d+),(\d+),(\d+),0,/.exec(raw.slice(offset, offset + 100));
      if (!m) throw new Error('标签位图格式错误');
      const [x, y, stride, height] = m.slice(1).map(Number) as [number, number, number, number];
      offset += m[0].length;
      if (stride < 1 || height < 1 || stride * height > raw.length - offset) throw new Error('标签位图不完整');
      bitmaps.push({ x, y, stride, height, pixels: raw.slice(offset, offset + stride * height) });
      offset += stride * height;
    } else {
      const end = raw.indexOf('\r\n', offset);
      if (end < 0) throw new Error('标签指令不完整');
      const line = raw.slice(offset, end);
      if (line.startsWith('BOX ')) border += line + '\r\n';
      offset = end;
    }
    if (raw.slice(offset, offset + 2) !== '\r\n') throw new Error('标签位图边界错误');
    offset += 2;
  }
  if (!bitmaps.length || !command.initialization) throw new Error('标签缺少内容或纸张参数');
  const left = Math.min(...bitmaps.map(b => b.x)), top = Math.min(...bitmaps.map(b => b.y));
  const width = Math.max(...bitmaps.map(b => b.x + b.stride * 8)) - left;
  const height = Math.max(...bitmaps.map(b => b.y + b.height)) - top;
  if (width * height > 16_000_000) throw new Error('标签尺寸过大');
  const pixels = new Uint8Array(width * height);
  for (const b of bitmaps) for (let y = 0; y < b.height; y++) for (let x = 0; x < b.stride * 8; x++) {
    pixels[(b.y - top + y) * width + b.x - left + x] = (b.pixels.charCodeAt(y * b.stride + (x >> 3)) & (128 >> (x & 7))) ? 0 : 1;
  }
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[y * width + x]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < x0) throw new Error('标签图片为空');
  const croppedWidth = x1 - x0 + 1, croppedHeight = y1 - y0 + 1;
  const stride = Math.ceil(croppedWidth / 16) * 2;
  const header = new Uint8Array(128), view = new DataView(header.buffer);
  header.set([10, 5, 1, 1]);
  view.setUint16(8, croppedWidth - 1, true); view.setUint16(10, croppedHeight - 1, true);
  view.setUint16(12, dpi, true); view.setUint16(14, dpi, true);
  header.set([255, 255, 255], 19); header[65] = 1;
  view.setUint16(66, stride, true); view.setUint16(68, 1, true);
  const encoded: number[] = [...header];
  for (let y = y0; y <= y1; y++) {
    const row = new Uint8Array(stride).fill(255);
    for (let x = x0; x <= x1; x++) if (pixels[y * width + x]) row[(x - x0) >> 3] &= ~(128 >> ((x - x0) & 7));
    for (let i = 0; i < row.length;) {
      let count = 1;
      while (count < 63 && i + count < row.length && row[i + count] === row[i]) count++;
      if (count > 1 || row[i]! >= 192) encoded.push(192 | count);
      encoded.push(row[i]!); i += count;
    }
  }
  return { image: new Uint8Array(encoded), left: left + x0, top: top + y0, initialization: command.initialization, border };
}
