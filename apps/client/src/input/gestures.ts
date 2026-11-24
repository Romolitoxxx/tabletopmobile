/** Callbacks of the table gestures, in screen coordinates. */
export interface GestureHandlers {
  /** Id of the component under a screen point that can be dragged, or null. */
  draggableAt(sx: number, sy: number): string | null;
  /** Id of any component under a screen point, or null. */
  componentAt(sx: number, sy: number): string | null;
  onTap(id: string | null, sx: number, sy: number, additive: boolean): void;
  onLongPress(id: string | null, sx: number, sy: number): void;
  onDragStart(id: string, sx: number, sy: number): void;
  onDragMove(sx: number, sy: number): void;
  onDragEnd(sx: number, sy: number): void;
  onDragCancel(): void;
  onPan(dx: number, dy: number): void;
  onZoom(sx: number, sy: number, factor: number): void;
}

const LONG_PRESS_MS = 450;
const MOVE_THRESHOLD_TOUCH = 10;
const MOVE_THRESHOLD_MOUSE = 4;

type Mode = 'idle' | 'pending' | 'drag' | 'pan' | 'pinch' | 'done';

/**
 * Turns pointer events (touch, mouse, pen) into table gestures: tap, long
 * press, drag, pan, pinch zoom, wheel zoom, right click.
 */
export class Gestures {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'idle';
  private start = { x: 0, y: 0 };
  private target: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinchDistance = 0;
  private pinchCenter = { x: 0, y: 0 };
  private pointerType = 'touch';

  constructor(
    private readonly el: HTMLElement,
    private readonly h: GestureHandlers,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.contextMenu);
  }

  private local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private pinchState(): { d: number; c: { x: number; y: number } } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { d: 0, c: { x: 0, y: 0 } };
    return { d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.button === 2) return; // handled by contextmenu
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.pointerType = e.pointerType;
    if (this.pointers.size === 1) {
      this.mode = 'pending';
      this.start = p;
      this.target = this.h.draggableAt(p.x, p.y);
      this.clearTimer();
      this.timer = setTimeout(() => {
        if (this.mode !== 'pending') return;
        this.mode = 'done';
        this.h.onLongPress(
          this.h.componentAt(this.start.x, this.start.y),
          this.start.x,
          this.start.y,
        );
      }, LONG_PRESS_MS);
    } else if (this.pointers.size === 2) {
      this.clearTimer();
      if (this.mode === 'drag') this.h.onDragCancel();
      this.mode = 'pinch';
      const s = this.pinchState();
      this.pinchDistance = s.d;
      this.pinchCenter = s.c;
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    switch (this.mode) {
      case 'pending': {
        const threshold =
          this.pointerType === 'mouse' ? MOVE_THRESHOLD_MOUSE : MOVE_THRESHOLD_TOUCH;
        if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < threshold) return;
        this.clearTimer();
        if (this.target) {
          this.mode = 'drag';
          this.h.onDragStart(this.target, this.start.x, this.start.y);
          this.h.onDragMove(p.x, p.y);
        } else {
          this.mode = 'pan';
          this.h.onPan(p.x - this.start.x, p.y - this.start.y);
        }
        return;
      }
      case 'drag':
        this.h.onDragMove(p.x, p.y);
        return;
      case 'pan':
        this.h.onPan(p.x - prev.x, p.y - prev.y);
        return;
      case 'pinch': {
        const s = this.pinchState();
        if (this.pinchDistance > 0 && s.d > 0)
          this.h.onZoom(s.c.x, s.c.y, s.d / this.pinchDistance);
        this.h.onPan(s.c.x - this.pinchCenter.x, s.c.y - this.pinchCenter.y);
        this.pinchDistance = s.d;
        this.pinchCenter = s.c;
        return;
      }
      default:
        return;
    }
  };

  private readonly up = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    this.clearTimer();
    if (this.mode === 'pending') {
      this.h.onTap(this.h.componentAt(p.x, p.y), p.x, p.y, e.shiftKey || e.ctrlKey || e.metaKey);
    } else if (this.mode === 'drag') {
      this.h.onDragEnd(p.x, p.y);
    }
    if (this.pointers.size === 0) {
      this.mode = 'idle';
    } else if (this.mode === 'pinch') {
      // One finger lifted: continue as a pan with the remaining one.
      this.mode = 'pan';
    }
  };

  private readonly cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.clearTimer();
    if (this.mode === 'drag') this.h.onDragCancel();
    if (this.pointers.size === 0) this.mode = 'idle';
  };

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      this.h.onZoom(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      this.h.onPan(-e.deltaX, -e.deltaY);
    }
  };

  private readonly contextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.h.onLongPress(this.h.componentAt(p.x, p.y), p.x, p.y);
  };
}
