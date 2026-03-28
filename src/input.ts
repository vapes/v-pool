import { Vec2, vec2, vecSub, vecLen, vecNorm, vecScale, BALL_RADIUS } from './physics';
import { Renderer } from './renderer';

export interface ShotParams {
  direction: Vec2;
  power: number;
}

export type InputState = 'idle' | 'aiming' | 'spinning' | 'ball_in_hand';

export class InputHandler {
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;

  state: InputState = 'idle';
  private touchStartPos: Vec2 = vec2(0, 0);
  private touchCurrentPos: Vec2 = vec2(0, 0);
  private cueBallScreenPos: Vec2 = vec2(0, 0);

  aimDirection: Vec2 = vec2(0, -1);
  power: number = 0;
  spinX: number = 0;
  spinY: number = 0;

  // Callbacks
  onShoot: ((direction: Vec2, power: number) => void) | null = null;
  onAimUpdate: ((direction: Vec2, power: number) => void) | null = null;
  onSpinChange: ((x: number, y: number) => void) | null = null;
  onBallInHandPlace: ((pos: Vec2) => void) | null = null;

  private isAiming = false;
  private isDraggingSpin = false;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.canvas = renderer.app.view as HTMLCanvasElement;
    this.setupEvents();
  }

  private setupEvents(): void {
    this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });

    // Mouse fallback for testing
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
  }

  setCueBallPos(tablePos: Vec2): void {
    this.cueBallScreenPos = this.renderer.tableToScreen(tablePos.x, tablePos.y);
  }

  private getEventPos(e: TouchEvent): Vec2 {
    const touch = e.touches[0] || e.changedTouches[0];
    return vec2(touch.clientX, touch.clientY);
  }

  private isTouchOnSpinIndicator(pos: Vec2): boolean {
    const bounds = this.renderer.getSpinIndicatorBounds();
    const dx = pos.x - (bounds.x + bounds.size / 2);
    const dy = pos.y - (bounds.y + bounds.size / 2);
    return Math.sqrt(dx * dx + dy * dy) < bounds.size / 2 + 15;
  }

  private isTouchOnCueBall(pos: Vec2): boolean {
    const dist = vecLen(vecSub(pos, this.cueBallScreenPos));
    return dist < BALL_RADIUS * this.renderer.scale + 30; // generous touch area
  }

  private handleStart(pos: Vec2): void {
    if (this.state === 'ball_in_hand') {
      const tablePos = this.renderer.screenToTable(pos.x, pos.y);
      this.onBallInHandPlace?.(tablePos);
      return;
    }

    if (this.state !== 'idle') return;

    // Check spin indicator first
    if (this.isTouchOnSpinIndicator(pos)) {
      this.isDraggingSpin = true;
      this.updateSpin(pos);
      return;
    }

    // Check if touching near cue ball
    if (this.isTouchOnCueBall(pos)) {
      this.isAiming = true;
      this.touchStartPos = { ...pos };
      this.touchCurrentPos = { ...pos };
      this.state = 'aiming';
    }
  }

  private handleMove(pos: Vec2): void {
    if (this.isDraggingSpin) {
      this.updateSpin(pos);
      return;
    }

    if (!this.isAiming) return;

    this.touchCurrentPos = { ...pos };

    // Direction: from touch point to cue ball (we're pulling back)
    const dragVec = vecSub(this.cueBallScreenPos, pos);
    const dragDist = vecLen(dragVec);

    if (dragDist > 10) {
      this.aimDirection = vecNorm(dragVec);

      // Power based on drag distance (max at ~250px drag)
      this.power = Math.min(1, dragDist / 250);

      this.onAimUpdate?.(this.aimDirection, this.power);
    }
  }

  private handleEnd(_pos: Vec2): void {
    if (this.isDraggingSpin) {
      this.isDraggingSpin = false;
      return;
    }

    if (!this.isAiming) return;
    this.isAiming = false;

    if (this.power > 0.02) {
      // Convert screen direction to table direction
      const tableDir = this.aimDirection;
      this.onShoot?.(tableDir, this.power);
    }

    this.state = 'idle';
    this.power = 0;
  }

  private updateSpin(pos: Vec2): void {
    const bounds = this.renderer.getSpinIndicatorBounds();
    const centerX = bounds.x + bounds.size / 2;
    const centerY = bounds.y + bounds.size / 2;
    const maxOffset = bounds.size / 2;

    let sx = (pos.x - centerX) / maxOffset;
    let sy = (pos.y - centerY) / maxOffset;

    // Clamp to circle
    const len = Math.sqrt(sx * sx + sy * sy);
    if (len > 1) {
      sx /= len;
      sy /= len;
    }

    this.spinX = sx;
    this.spinY = sy;
    this.renderer.updateSpinDot(sx, sy);
    this.onSpinChange?.(sx, sy);
  }

  // Touch events
  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.handleStart(this.getEventPos(e));
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    this.handleMove(this.getEventPos(e));
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this.handleEnd(this.getEventPos(e));
  }

  // Mouse events
  private onMouseDown(e: MouseEvent): void {
    this.handleStart(vec2(e.clientX, e.clientY));
  }

  private onMouseMove(e: MouseEvent): void {
    this.handleMove(vec2(e.clientX, e.clientY));
  }

  private onMouseUp(e: MouseEvent): void {
    this.handleEnd(vec2(e.clientX, e.clientY));
  }

  enableBallInHand(): void {
    this.state = 'ball_in_hand';
  }

  resetToIdle(): void {
    this.state = 'idle';
    this.isAiming = false;
    this.isDraggingSpin = false;
    this.power = 0;
  }
}
