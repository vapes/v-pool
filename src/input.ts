import { Vec2, vec2, vecSub, vecLen, vecNorm, BALL_RADIUS } from './physics';
import { Renderer } from './renderer';

export type InputState = 'idle' | 'aiming' | 'spinning' | 'panning' | 'gesturing' | 'ball_in_hand';

export class InputHandler {
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;

  state: InputState = 'idle';
  private cueBallScreenPos: Vec2 = vec2(0, 0);

  aimDirection: Vec2 = vec2(0, -1);
  power: number = 0;
  spinX: number = 0;
  spinY: number = 0;

  onShoot: ((direction: Vec2, power: number) => void) | null = null;
  onAimUpdate: ((direction: Vec2, power: number) => void) | null = null;
  onSpinChange: ((x: number, y: number) => void) | null = null;
  onBallInHandPlace: ((pos: Vec2) => void) | null = null;
  // Called to find which ball is at screen position; returns ball screen pos or null
  findBallAtScreen: ((pos: Vec2) => Vec2 | null) | null = null;

  // Multi-touch tracking
  private activeTouches: Map<number, Vec2> = new Map();
  private lastPinchDist: number = 0;
  private lastPinchAngle: number = 0;
  private lastPinchCenter: Vec2 = vec2(0, 0);
  private isPanning = false;
  private lastPanPos: Vec2 = vec2(0, 0);

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.canvas = renderer.app.view as HTMLCanvasElement;
    this.setupEvents();
  }

  private setupEvents(): void {
    this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchcancel', this.onTouchEnd.bind(this), { passive: false });

    // Mouse fallback
    let mouseDown = false;
    this.canvas.addEventListener('mousedown', (e) => {
      mouseDown = true;
      this.handleSingleStart(vec2(e.clientX, e.clientY));
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (mouseDown) this.handleSingleMove(vec2(e.clientX, e.clientY));
    });
    this.canvas.addEventListener('mouseup', (e) => {
      mouseDown = false;
      this.handleSingleEnd(vec2(e.clientX, e.clientY));
    });

    // Mouse wheel for zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const r = this.renderer;
      // Zoom toward mouse position
      const mx = e.clientX;
      const my = e.clientY;
      r.camX = mx - (mx - r.camX) * zoomFactor;
      r.camY = my - (my - r.camY) * zoomFactor;
      r.camZoom *= zoomFactor;
      r.camZoom = Math.max(0.02, Math.min(0.5, r.camZoom));
      r.applyCameraTransform();
    }, { passive: false });
  }

  setCueBallPos(tablePos: Vec2): void {
    this.cueBallScreenPos = this.renderer.tableToScreen(tablePos.x, tablePos.y);
  }

  private isTouchOnSpinIndicator(pos: Vec2): boolean {
    const bounds = this.renderer.getSpinIndicatorBounds();
    const dx = pos.x - (bounds.x + bounds.size / 2);
    const dy = pos.y - (bounds.y + bounds.size / 2);
    return Math.sqrt(dx * dx + dy * dy) < bounds.size / 2 + 15;
  }

  private isTouchOnAnyBall(pos: Vec2): boolean {
    // First check via callback (game decides which balls are hittable)
    if (this.findBallAtScreen) {
      const ballPos = this.findBallAtScreen(pos);
      if (ballPos) {
        this.cueBallScreenPos = ballPos;
        return true;
      }
      return false;
    }
    // Fallback: check cue ball only
    const dist = vecLen(vecSub(pos, this.cueBallScreenPos));
    const hitRadius = Math.max(30, BALL_RADIUS * this.renderer.camZoom + 20);
    return dist < hitRadius;
  }

  // --- Touch events ---
  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.activeTouches.set(t.identifier, vec2(t.clientX, t.clientY));
    }

    const count = this.activeTouches.size;

    if (count === 2) {
      // Switch to gesture mode (pinch/rotate/pan)
      this.cancelAiming();
      this.isPanning = false;
      this.state = 'gesturing';
      this.initPinch();
    } else if (count === 1) {
      const pos = this.getFirstTouch();
      this.handleSingleStart(pos);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.activeTouches.set(t.identifier, vec2(t.clientX, t.clientY));
    }

    const count = this.activeTouches.size;

    if (count >= 2 && this.state === 'gesturing') {
      this.handlePinch();
    } else if (count === 1) {
      const pos = this.getFirstTouch();
      this.handleSingleMove(pos);
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      this.activeTouches.delete(e.changedTouches[i].identifier);
    }

    if (this.activeTouches.size === 0) {
      if (this.state === 'aiming') {
        this.handleSingleEnd(vec2(0, 0));
      } else if (this.state === 'gesturing' || this.state === 'panning') {
        this.state = 'idle';
      } else if (this.state === 'spinning') {
        this.state = 'idle';
      }
      this.isPanning = false;
    } else if (this.activeTouches.size === 1 && this.state === 'gesturing') {
      // Went from 2 fingers to 1 — switch to pan
      this.state = 'panning';
      this.isPanning = true;
      this.lastPanPos = this.getFirstTouch();
    }
  }

  private getFirstTouch(): Vec2 {
    const first = this.activeTouches.values().next().value;
    return first || vec2(0, 0);
  }

  // --- Pinch/Rotate/Pan (2 fingers) ---
  private initPinch(): void {
    const touches = Array.from(this.activeTouches.values());
    if (touches.length < 2) return;
    const [a, b] = touches;
    this.lastPinchDist = vecLen(vecSub(a, b));
    this.lastPinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.lastPinchCenter = vec2((a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  private handlePinch(): void {
    const touches = Array.from(this.activeTouches.values());
    if (touches.length < 2) return;
    const [a, b] = touches;

    const dist = vecLen(vecSub(a, b));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const center = vec2((a.x + b.x) / 2, (a.y + b.y) / 2);

    const r = this.renderer;

    // Pan: move camera by center delta
    const dx = center.x - this.lastPinchCenter.x;
    const dy = center.y - this.lastPinchCenter.y;
    r.camX += dx;
    r.camY += dy;

    // Zoom: scale relative to pinch center
    if (this.lastPinchDist > 0) {
      const zoomFactor = dist / this.lastPinchDist;
      const newZoom = Math.max(0.02, Math.min(0.5, r.camZoom * zoomFactor));
      const actualFactor = newZoom / r.camZoom;

      r.camX = center.x - (center.x - r.camX) * actualFactor;
      r.camY = center.y - (center.y - r.camY) * actualFactor;
      r.camZoom = newZoom;
    }

    // Rotate relative to pinch center
    const dAngle = angle - this.lastPinchAngle;
    if (Math.abs(dAngle) < Math.PI) { // avoid jumps
      const cos = Math.cos(dAngle);
      const sin = Math.sin(dAngle);
      const ox = r.camX - center.x;
      const oy = r.camY - center.y;
      r.camX = center.x + ox * cos - oy * sin;
      r.camY = center.y + ox * sin + oy * cos;
      r.camRotation += dAngle;
    }

    r.applyCameraTransform();

    this.lastPinchDist = dist;
    this.lastPinchAngle = angle;
    this.lastPinchCenter = center;
  }

  // --- Single finger ---
  private handleSingleStart(pos: Vec2): void {
    if (this.state === 'ball_in_hand') {
      const tablePos = this.renderer.screenToTable(pos.x, pos.y);
      this.onBallInHandPlace?.(tablePos);
      return;
    }

    if (this.state !== 'idle') return;

    // Check spin indicator
    if (this.isTouchOnSpinIndicator(pos)) {
      this.state = 'spinning';
      this.updateSpin(pos);
      return;
    }

    // Check if touching any hittable ball
    if (this.isTouchOnAnyBall(pos)) {
      this.state = 'aiming';
      this.lastPanPos = { ...pos };
      // Show initial aim line immediately (default direction from cue ball)
      this.updateAimFromScreenPos(pos);
      return;
    }

    // Otherwise: pan with 1 finger
    this.state = 'panning';
    this.isPanning = true;
    this.lastPanPos = { ...pos };
  }

  private handleSingleMove(pos: Vec2): void {
    if (this.state === 'spinning') {
      this.updateSpin(pos);
      return;
    }

    if (this.state === 'panning' && this.isPanning) {
      const r = this.renderer;
      r.camX += pos.x - this.lastPanPos.x;
      r.camY += pos.y - this.lastPanPos.y;
      r.applyCameraTransform();
      this.lastPanPos = { ...pos };
      return;
    }

    if (this.state !== 'aiming') return;

    this.updateAimFromScreenPos(pos);
  }

  private updateAimFromScreenPos(pos: Vec2): void {
    // Direction: from touch point to cue ball (we're pulling back)
    const dragVec = vecSub(this.cueBallScreenPos, pos);
    const dragDist = vecLen(dragVec);

    if (dragDist > 5) {
      // Screen direction -> table direction (undo camera rotation)
      const screenDir = vecNorm(dragVec);
      const cos = Math.cos(-this.renderer.camRotation);
      const sin = Math.sin(-this.renderer.camRotation);
      this.aimDirection = vec2(
        screenDir.x * cos - screenDir.y * sin,
        screenDir.x * sin + screenDir.y * cos
      );
      this.power = Math.min(1, dragDist / 250);
      this.onAimUpdate?.(this.aimDirection, this.power);
    }
  }

  private handleSingleEnd(_pos: Vec2): void {
    if (this.state === 'spinning') {
      this.state = 'idle';
      return;
    }

    if (this.state === 'panning') {
      this.state = 'idle';
      this.isPanning = false;
      return;
    }

    if (this.state !== 'aiming') return;

    if (this.power > 0.02) {
      this.onShoot?.(this.aimDirection, this.power);
    }

    this.state = 'idle';
    this.power = 0;
  }

  private cancelAiming(): void {
    if (this.state === 'aiming') {
      this.state = 'idle';
      this.power = 0;
      this.renderer.clearAimLine();
      this.renderer.drawPowerBar(0);
    }
  }

  private updateSpin(pos: Vec2): void {
    const bounds = this.renderer.getSpinIndicatorBounds();
    const centerX = bounds.x + bounds.size / 2;
    const centerY = bounds.y + bounds.size / 2;
    const maxOffset = bounds.size / 2;

    let sx = (pos.x - centerX) / maxOffset;
    let sy = (pos.y - centerY) / maxOffset;
    const len = Math.sqrt(sx * sx + sy * sy);
    if (len > 1) { sx /= len; sy /= len; }

    this.spinX = sx;
    this.spinY = sy;
    this.renderer.updateSpinDot(sx, sy);
    this.onSpinChange?.(sx, sy);
  }

  enableBallInHand(): void {
    this.state = 'ball_in_hand';
  }

  resetToIdle(): void {
    this.state = 'idle';
    this.isPanning = false;
    this.power = 0;
  }
}
