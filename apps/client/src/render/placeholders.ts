// Procedural placeholder images for `gen:` asset references, drawn on a
// canvas. Real modules will reference image files instead.

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_COLOR: Record<string, string> = {
  S: '#1d1d1f',
  H: '#c62828',
  D: '#c62828',
  C: '#1d1d1f',
};
const COLORS: Record<string, string> = {
  red: '#e53935',
  blue: '#1e88e5',
  green: '#43a047',
  yellow: '#fdd835',
  gold: '#ffb300',
};

/** Pixel density of generated images relative to world units. */
export const PLACEHOLDER_DENSITY = 3;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rank: string,
  suit: string,
): void {
  roundRect(ctx, 1, 1, w - 2, h - 2, w * 0.08);
  ctx.fillStyle = '#fffdf7';
  ctx.fill();
  ctx.strokeStyle = '#9e9e9e';
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  const symbol = SUIT_SYMBOL[suit] ?? '?';
  ctx.fillStyle = SUIT_COLOR[suit] ?? '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${w * 0.22}px sans-serif`;
  ctx.fillText(rank, w * 0.17, h * 0.12);
  ctx.font = `${w * 0.18}px sans-serif`;
  ctx.fillText(symbol, w * 0.17, h * 0.26);
  ctx.font = `${w * 0.55}px sans-serif`;
  ctx.fillText(symbol, w / 2, h * 0.56);
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  ctx.font = `bold ${w * 0.22}px sans-serif`;
  ctx.fillText(rank, w * 0.17, h * 0.12);
  ctx.restore();
}

function drawBack(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  roundRect(ctx, 1, 1, w - 2, h - 2, w * 0.08);
  ctx.fillStyle = '#fafafa';
  ctx.fill();
  roundRect(ctx, w * 0.08, w * 0.08, w * 0.84, h - w * 0.16, w * 0.05);
  ctx.fillStyle = COLORS[color] ?? '#1e88e5';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = w * 0.03;
  for (let i = -h; i < w + h; i += w * 0.12) {
    ctx.beginPath();
    ctx.moveTo(i, w * 0.08);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
}

function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, cells: number): void {
  const s = w / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f0d9b5' : '#b58863';
      ctx.fillRect(c * s, r * s, s, h / cells);
    }
  }
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = s * 0.08;
  ctx.strokeRect(0, 0, w, h);
}

function drawToken(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const r = Math.min(w, h) / 2 - 2;
  const g = ctx.createRadialGradient(w * 0.4, h * 0.35, r * 0.1, w / 2, h / 2, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, COLORS[color] ?? color);
  g.addColorStop(1, '#212121');
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function drawBag(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = '#6d4c41';
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h * 0.25);
  ctx.quadraticCurveTo(w * 0.05, h * 0.95, w * 0.5, h * 0.95);
  ctx.quadraticCurveTo(w * 0.95, h * 0.95, w * 0.7, h * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4e342e';
  ctx.fillRect(w * 0.28, h * 0.15, w * 0.44, h * 0.12);
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.62, w * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = COLORS[color] ?? color;
  ctx.fill();
}

function drawFelt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#2e7d4f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect((i * 7919) % w, (i * 104729) % h, 2, 2);
  }
}

/**
 * Draws a `gen:` asset on a canvas of the given world size. Returns null for
 * unknown references (the caller shows a generic placeholder).
 */
export function drawPlaceholder(
  ref: string,
  worldW: number,
  worldH: number,
): HTMLCanvasElement | null {
  const [scheme, kind, a = '', b = ''] = ref.split(':');
  if (scheme !== 'gen') return null;
  const canvas = document.createElement('canvas');
  const d = PLACEHOLDER_DENSITY;
  canvas.width = Math.max(1, Math.round(worldW * d));
  canvas.height = Math.max(1, Math.round(worldH * d));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  switch (kind) {
    case 'card':
      drawCard(ctx, w, h, a, b);
      break;
    case 'back':
      drawBack(ctx, w, h, a);
      break;
    case 'board':
      drawBoard(ctx, w, h, Number(a) || 8);
      break;
    case 'token':
      drawToken(ctx, w, h, a);
      break;
    case 'bag':
      drawBag(ctx, w, h, a);
      break;
    case 'felt':
      drawFelt(ctx, w, h);
      break;
    default:
      return null;
  }
  return canvas;
}
