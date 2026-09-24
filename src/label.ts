import { bitmap, bitmapJob, encode } from './bitmap';
import QRCode from 'qrcode';
import type { PurchaseOrderDetail } from './api';
import type { PrinterSettings } from './printer';

// 标签内容数据。字段与 wy-material-print/label.ts 的 Label 不兼容：
//   - 用 orderNo 替代 plan（采购订单号）
//   - 用 detail 替代 item（PO 明细）
//   - 没有 department（收货不需要"领料部门"）
//   - 没有 preparation（标签直接使用订单数量，不录入实收）
//   - 没有 unit（U8 PO_PODetails 不存计量单位，留空字符串）
//
// 算法骨架（labelSize / labelLines / compileLabel / qrPath）原样克隆，编译与排版规则不变。
export type Label = {
  orderNo: string;
  detail: PurchaseOrderDetail;
  serial: number;
  copies: string;
  printCount?: number;
  planNumber?: string;
  allocationQuantity?: number;
  paper?: PrinterSettings;
  operator?: string;
  operatedAt?: string;
};

export function labelSize(paper?: PrinterSettings) {
  const width = (paper?.paperWidth ?? 68) - 4;
  const height = (paper?.paperHeight ?? 46) - 4;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('标签宽高须大于 4 mm，请调整蓝牙设置');
  return { width, height };
}

export function labelLines(label: Label) {
  const { orderNo, detail, serial, copies, printCount, planNumber, allocationQuantity } = label;
  const dimensions = labelSize(label.paper);
  const width = dimensions.width * 5;
  const height = dimensions.height * 5;
  // 标签字段布局：
  //   1. 订单号（左侧加粗）
  //   2. 生产计划号（右侧加粗，仅手动分配时显示）
  //   3. 到货日期（移到物料名称下方一行）
  //   4. 物料名称
  //   5. 规格
  //   6. 本张数量（来自分配；缺省回退订单数量）
  //   底部：打印次数 / 张序 / 操作人+时间
  const planText = planNumber ? `计划号 ${planNumber}` : '';
  const arriveText = detail.arriveDate ? `到货日期 ${detail.arriveDate}` : '';
  const displayQty = allocationQuantity ?? detail.quantity;
  const original = [
    { x: 14, y: 24, size: 16, anchor: 'start', text: orderNo },
    { x: width - 14, y: 24, size: 16, anchor: 'end', text: planText },
    { x: 14, y: 72, size: 16, anchor: 'start', text: detail.inventoryName },
    { x: 14, y: 104, size: 16, anchor: 'start', text: arriveText },
    { x: 14, y: 136, size: 16, anchor: 'start', text: `本张数量 ${displayQty}` },
    { x: 14, y: height - 15, size: 10, anchor: 'start', text: `打印次数 ${printCount ?? '待确认'}` },
    { x: width / 2, y: height - 15, size: 10, anchor: 'middle', text: `${serial} / ${copies}` },
    { x: width - 14, y: height - 15, size: 10, anchor: 'end', text: `${label.operator || '—'} ${label.operatedAt || ''}`.trim() },
  ].map((line, index) => ({
    ...line,
    underlineStart: index === 2 ? 0 : index === 4 ? 5 : -1,
    text: line.text.replace(/\\/g, '＼').replace(/"/g, '＂').replace(/\r\n|[\r\n\t\u2028\u2029]/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, ''),
  }));
  for (let size = 16; size >= 10; size--) {
    const step = size * 1.8;
    const body: typeof original = [];
    let y = 24 + step;
    let fits = true;
    for (let field = 2; field <= 4; field++) {
      if (field >= 3) y = height - 72 + size * 0.35 + (field === 3 ? -step / 2 : step / 2);
      const source = original[field];
      const text = source.text.replace(/ +/g, ' ').trim();
      let line = '', used = 0;
      const available = () => width - 28 - (field >= 3 ? 82 : 0);
      for (const char of text) {
        const charWidth = char.charCodeAt(0) < 128 && !/[MW@%]/.test(char) ? size * 0.65 : size;
        if (used + charWidth > available() && line) {
          if (field >= 3) { fits = false; break; }
          body.push({ ...source, text: line, size, y });
          y += step; line = ''; used = 0;
        }
        line += char; used += charWidth;
      }
      body.push({ ...source, text: line, size, y });
      if (used > available() || (field < 3 ? y + size * 0.3 > height - 109 : y > height - 35)) fits = false;
      y += step;
    }
    if (fits) return [...original.slice(0, 2).filter(line => line.text).map(line => ({ ...line, size })), ...body, ...original.slice(5)];
  }
  throw new Error('标签文字过长，缩小字号后仍无法完整排版，请缩短物料名称或规格');
}

export function qrPath(id: string) {
  const { modules } = QRCode.create(id, { errorCorrectionLevel: 'M' });
  let path = '';
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
  return { path, size: modules.size + 8 };
}

export function compileLabel(settings: PrinterSettings, label: Label) {
  if (![settings.paperWidth, settings.paperHeight, settings.gap, settings.blackMarkHeight, settings.blackMarkOffset].every(Number.isFinite)) throw new Error('设备参数无法生成打印指令，请在壳蓝牙页面检查');
  const dpi = Number(settings.dpi);
  if (!Number.isFinite(dpi) || dpi <= 0 || ![0, 1].includes(settings.direction) || !Number.isFinite(settings.x) || !Number.isFinite(settings.y)) throw new Error('DPI、方向或 X/Y 校准参数无效');
  const dots = (mm: number) => { const v = mm * dpi / 25.4; const n = Math.sign(v) * Math.round(Math.abs(v)); if (!Number.isSafeInteger(n)) throw new Error('打印点数无法表示'); return n; };
  const sign = settings.direction === 0 ? 1 : -1;
  const x = (mm: number) => dots(mm) + sign * dots(settings.x);
  const y = (mm: number) => dots(mm) + sign * dots(settings.y);
  // 二维码内容 = PO_PODetails.ID（明细行 ID，与 U8 字段 ID 对应；与桌面端 PR #106 详情页 row_id 同源）
  const qrId = String(label.detail.rowId);
  if (!qrId || qrId.length > 128) throw new Error('订单明细二维码 ID 无效');
  if (/["\\\x00-\x1f\x7f]/.test(qrId)) throw new Error('订单明细二维码 ID 含非法字符');
  const commands: Uint8Array[] = [];
  const dimensions = labelSize(settings);
  for (const line of labelLines({ ...label, paper: settings })) {
    const size = dots(line.size / 5);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前设备无法绘制标签文字');
    context.font = `${size}px sans-serif`;
    const textWidth = context.measureText(line.text).width;
    const serialWidth = Math.max(...'0123456789'.split('').map(digit => context.measureText(digit).width)) * label.copies.length + context.measureText(` / ${label.copies}`).width;
    canvas.width = Math.ceil(line.anchor === 'middle' ? Math.max(textWidth, serialWidth) : textWidth) + 4;
    canvas.height = Math.ceil(size * 1.6);
    context.font = `${size}px sans-serif`;
    context.fillStyle = 'black';
    context.fillText(line.text, line.anchor === 'middle' ? (canvas.width - textWidth) / 2 : 2, size * 1.2);
    if (line.underlineStart >= 0) {
      const prefixWidth = context.measureText(line.text.slice(0, line.underlineStart)).width;
      context.fillRect(2 + prefixWidth, Math.round(size * 1.32), context.measureText(line.text.slice(line.underlineStart)).width, Math.max(1, Math.round(size / 16)));
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const left = x(2 + line.x / 5) - (line.anchor === 'end' ? canvas.width - 2 : line.anchor === 'middle' ? canvas.width / 2 : 2);
    const top = y(2 + line.y / 5) - size * 1.2;
    commands.push(...bitmap(left, top, canvas.width, canvas.height, (column, row) => pixels[(row * canvas.width + column) * 4 + 3] >= 128));
  }
  const qr = QRCode.create(qrId, { errorCorrectionLevel: 'M' }).modules;
  const cell = Math.max(1, Math.min(10, Math.floor(dots(14.8) / (qr.size + 8))));
  commands.push(...bitmap(x(2 + dimensions.width - 2.8) - qr.size * cell, y(2 + dimensions.height - 21.8) + 4 * cell, qr.size * cell, qr.size * cell, (column, row) => !!qr.get(Math.floor(row / cell), Math.floor(column / cell))));
  const media = settings.mediaType === 'blackMark'
    ? `BLINE ${settings.blackMarkHeight} mm,${settings.blackMarkOffset} mm`
    : `GAP ${settings.mediaType === 'continuous' ? 0 : settings.gap} mm,0 mm`;
  const header = [`SIZE ${settings.paperWidth} mm,${settings.paperHeight} mm`, media, `DIRECTION ${settings.direction === 0 ? 1 : 0},0`, 'REFERENCE 0,0', 'SHIFT 0', 'OFFSET 0 mm', 'CODEPAGE 936', 'CLS', `BOX ${x(1)},${y(1)},${x(settings.paperWidth - 1)},${y(settings.paperHeight - 1)},${Math.max(1, dots(0.3))}`, ''].join('\r\n');
  return { ...bitmapJob([encode(header), ...commands]), initialization: header.slice(0, header.indexOf('CLS\r\n')) };
}