import QRCode from 'qrcode';
import { bitmap, bitmapJob, encode } from './bitmap';
import type { PrinterSettings } from './printer';

export function compileCalibration(s: PrinterSettings) {
  const dpi = Number(s.dpi);
  if (s.language !== 'TSPL') throw new Error('请读取并保存 TSPL 设备参数');
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error('请填写有效 DPI 后打印测试');
  if (![s.paperWidth, s.paperHeight, s.x, s.y, s.gap, s.blackMarkHeight, s.blackMarkOffset].every(Number.isFinite)) throw new Error('打印设备参数无效');
  const dot = (mm: number) => Math.sign(mm) * Math.round(Math.abs(mm * dpi / 25.4));
  const sign = s.direction === 0 ? 1 : -1;
  const x = (mm: number) => dot(mm) + sign * dot(s.x), y = (mm: number) => dot(mm) + sign * dot(s.y);
  const media = s.mediaType === 'blackMark' ? `BLINE ${s.blackMarkHeight} mm,${s.blackMarkOffset} mm` : `GAP ${s.mediaType === 'continuous' ? 0 : s.gap} mm,0 mm`;
  const parts = [encode([
    `SIZE ${s.paperWidth} mm,${s.paperHeight} mm`, media,
    `DIRECTION ${s.direction === 0 ? 1 : 0},0`, 'REFERENCE 0,0', 'SHIFT 0', 'OFFSET 0 mm', 'CLS',
    `BOX ${x(1)},${y(1)},${x(s.paperWidth - 1)},${y(s.paperHeight - 1)},${Math.max(1, dot(0.3))}`,
    `BOX ${x(8)},${y(16)},${x(18)},${y(26)},${Math.max(1, dot(0.3))}`, '',
  ].join('\r\n'))];
  function text(value: string, left: number, top: number, mm = 3) {
    const size = dot(mm);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法生成标签位图');
    context.font = `${size}px sans-serif`;
    canvas.width = Math.ceil(context.measureText(value).width) + 4;
    canvas.height = Math.ceil(size * 1.6);
    context.font = `${size}px sans-serif`;
    context.fillText(value, 2, size * 1.2);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    parts.push(...bitmap(x(left), y(top), canvas.width, canvas.height, (column, row) => pixels[(row * canvas.width + column) * 4 + 3] >= 128));
  }
  text('TOP - 位图打印测试', 8, 6);
  text('10 x 10 mm', 21, 18);
  text('中文、数字 123.456', 8, 29);
  text(`FRAME ${s.paperWidth - 2} x ${s.paperHeight - 2} mm`, 8, 40, 2.5);
  const qr = QRCode.create('WY41', { errorCorrectionLevel: 'M' }).modules;
  const cell = Math.max(1, Math.floor(dot(12) / (qr.size + 8)));
  parts.push(...bitmap(x(s.paperWidth - 20) + cell * 4, y(27) + cell * 4, qr.size * cell, qr.size * cell, (column, row) => !!qr.get(Math.floor(row / cell), Math.floor(column / cell))));
  return bitmapJob(parts);
}
