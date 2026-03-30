import { Vec2, vec2, vecSub, vecLen, vecNorm, BALL_RADIUS } from './physics';
import { Renderer } from './renderer';

export type InputState = 'idle' | 'aiming' | 'confirming' | 'spinning' | 'panning' | 'gesturing' | 'penalty_selection';

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
  onCancelAim: (() => void) | null = null;
  // Called to find which ball is at screen position; returns ball screen pos or null
  findBallAtScreen: ((pos: Vec2) => Vec2 | null) | null = null;
  // Called during penalty selection to identify which ball was tapped; returns ball id or null
  findBallIdAtScreen: ((pos: Vec2) => number | null) | null = null;
  // Called when opponent selects a штрафной ball by id
  onPenaltyBallSelect: ((ballId: number) => void) | null = null;

  // Multi-touch tracking
  private activeTouches: Map<number, Vec2> = new Map();
  private lastPinchDist: number = 0;
  private lastPinchAngle: number = 0;
  private lastPinchCenter: Vec2 = vec2(0, 0);
  private isPanning = false;
  private lastPanPos: Vec2 = vec2(0, 0);
  private prevState: InputState = 'idle';
  private isDraggingPowerBar = false;
  private boundTouchStart!: (e: TouchEvent) => void;
  private boundTouchMove!: (e: TouchEvent) => void;
  private boundTouchEnd!: (e: TouchEvent) => void;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.canvas = renderer.app.view as HTMLCanvasElement;
    this.setupEvents();
  }

  private setupEvents(): void {
    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);
    this.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this.boundTouchEnd, { passive: false });

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
        this.state = this.prevState;
      } else if (this.state === 'confirming') {
        // Stay in confirming — buttons are shown
        this.isDraggingPowerBar = false;
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
    // Penalty selection: tap any ball to claim it as штрафной
    if (this.state === 'penalty_selection') {
      const ballId = this.findBallIdAtScreen?.(pos);
      if (ballId !== null && ballId !== undefined) {
        this.onPenaltyBallSelect?.(ballId);
        this.state = 'idle';
      }
      return;
    }

    // In confirming state: check button, power bar, spin, or ball tap
    if (this.state === 'confirming') {
      // Check shoot button
      const btn = this.renderer.getShotButtonAt(pos);
      if (btn === 'shoot') {
        this.renderer.hideShotButtons();
        if (this.power > 0.02) {
          this.onShoot?.(this.aimDirection, this.power);
        }
        this.state = 'idle';
        this.power = 0;
        return;
      }

      // Check power bar — start dragging to adjust power
      if (this.renderer.isTouchOnPowerBar(pos)) {
        this.isDraggingPowerBar = true;
        this.updatePowerFromBar(pos);
        return;
      }

      // Check spin indicator
      if (this.isTouchOnSpinIndicator(pos)) {
        this.prevState = 'confirming';
        this.state = 'spinning';
        this.updateSpin(pos);
        return;
      }

      // Check if tapping the same active ball → re-aim
      const savedCueBallPos = { ...this.cueBallScreenPos };
      if (this.isTouchOnAnyBall(pos)) {
        // If same ball (cueBallScreenPos didn't change much), re-aim
        const sameBall = vecLen(vecSub(this.cueBallScreenPos, savedCueBallPos)) < 5;
        if (sameBall) {
          this.renderer.hideShotButtons();
          this.state = 'aiming';
          this.lastPanPos = { ...pos };
          this.updateAimFromScreenPos(pos);
          return;
        }
        // Different ball → cancel
        this.cancelConfirming();
        return;
      }

      // Tap elsewhere → ignore
      return;
    }

    if (this.state !== 'idle') return;

    // Check spin indicator
    if (this.isTouchOnSpinIndicator(pos)) {
      this.prevState = 'idle';
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

    // Dragging power bar in confirming state
    if (this.state === 'confirming' && this.isDraggingPowerBar) {
      this.updatePowerFromBar(pos);
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
    if (this.state === 'confirming' && this.isDraggingPowerBar) {
      this.isDraggingPowerBar = false;
      return;
    }

    if (this.state === 'spinning') {
      this.state = this.prevState;
      return;
    }

    if (this.state === 'panning') {
      this.state = 'idle';
      this.isPanning = false;
      return;
    }

    if (this.state !== 'aiming') return;

    if (this.power > 0.02) {
      // Don't shoot — go to confirming state, show buttons
      this.state = 'confirming';
      this.renderer.showShotButtons();
    } else {
      this.state = 'idle';
      this.power = 0;
    }
  }

  private updatePowerFromBar(pos: Vec2): void {
    this.power = Math.max(0.02, this.renderer.getPowerFromScreenY(pos.y));
    this.renderer.drawPowerBar(this.power);
    this.onAimUpdate?.(this.aimDirection, this.power);
  }

  private cancelAiming(): void {
    if (this.state === 'aiming' || this.state === 'confirming') {
      this.renderer.hideShotButtons();
      this.state = 'idle';
      this.power = 0;
      this.renderer.clearAimLine();
      this.renderer.drawPowerBar(0);
      this.onCancelAim?.();
    }
  }

  private cancelConfirming(): void {
    this.renderer.hideShotButtons();
    this.isDraggingPowerBar = false;
    this.state = 'idle';
    this.power = 0;
    this.renderer.clearAimLine();
    this.renderer.drawPowerBar(0);
    this.onCancelAim?.();
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

  // Enter penalty selection mode: next tap selects штрафной ball
  enablePenaltySelection(): void {
    this.state = 'penalty_selection';
  }

  resetToIdle(): void {
    this.renderer.hideShotButtons();
    this.state = 'idle';
    this.isPanning = false;
    this.power = 0;
  }

  destroy(): void {
    this.canvas.removeEventListener('touchstart', this.boundTouchStart);
    this.canvas.removeEventListener('touchmove', this.boundTouchMove);
    this.canvas.removeEventListener('touchend', this.boundTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.boundTouchEnd);
  }
}
