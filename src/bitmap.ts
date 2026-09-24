export const encode = (text: string) => new TextEncoder().encode(text);

export function bitmap(left: number, top: number, width: number, height: number, black: (x: number, y: number) => boolean) {
  const stride = Math.ceil(width / 8);
  const pixels = new Uint8Array(stride * height).fill(255);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    if (black(column, row)) pixels[row * stride + (column >> 3)] &= ~(0x80 >> (column & 7));
  }
  return [encode(`BITMAP ${Math.round(left)},${Math.round(top)},${stride},${height},0,`), pixels, encode('\r\n')];
}

export function bitmapJob(parts: Uint8Array[]) {
  let binary = '';
  for (const part of [...parts, encode('PRINT 1,1\r\n')]) {
    for (let offset = 0; offset < part.length; offset += 8192) binary += String.fromCharCode(...part.subarray(offset, offset + 8192));
  }
  return { dataBase64: btoa(binary) };
}
