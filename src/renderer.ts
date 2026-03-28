import * as PIXI from 'pixi.js';
import {
  Ball, Pocket, Vec2, TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS,
  vec2, vecLen, TrajectoryResult
} from './physics';

const TABLE_COLOR = 0x1B5E20;
const TABLE_BORDER_COLOR = 0x4E342E;
const CUSHION_COLOR = 0x2E7D32;
const CUE_BALL_COLOR = 0xFFF9C4;
const BALL_COLOR = 0xFAFAFA;
const POCKET_COLOR = 0x111111;
const AIM_LINE_COLOR = 0xFFFFFF;
const POWER_BAR_BG = 0x333333;

export class Renderer {
  app: PIXI.Application;
  // viewContainer holds camera transforms (pan/zoom/rotate)
  viewContainer: PIXI.Container;
  // tableContainer holds table + balls in physics coords
  tableContainer: PIXI.Container;
  ballGraphics: Map<number, PIXI.Container> = new Map();
  aimLine: PIXI.Graphics;
  powerBar: PIXI.Graphics;
  spinIndicator: PIXI.Container;
  spinDot: PIXI.Graphics;
  spinBg: PIXI.Graphics;
  uiContainer: PIXI.Container;
  messageText: PIXI.Text;
  scoreText: PIXI.Text;
  turnText: PIXI.Text;
  pocketedContainer: PIXI.Container;

  // Camera state
  camX: number = 0;
  camY: number = 0;
  camZoom: number = 1;
  camRotation: number = 0;

  screenW: number = 0;
  screenH: number = 0;

  constructor() {
    this.app = null!;
    this.viewContainer = new PIXI.Container();
    this.tableContainer = new PIXI.Container();
    this.aimLine = new PIXI.Graphics();
    this.powerBar = new PIXI.Graphics();
    this.spinIndicator = new PIXI.Container();
    this.spinDot = new PIXI.Graphics();
    this.spinBg = new PIXI.Graphics();
    this.uiContainer = new PIXI.Container();
    this.messageText = new PIXI.Text('', { fontSize: 24, fill: 0xffffff, fontFamily: 'Arial' });
    this.scoreText = new PIXI.Text('', { fontSize: 18, fill: 0xffffff, fontFamily: 'Arial' });
    this.turnText = new PIXI.Text('', { fontSize: 16, fill: 0xCCCCCC, fontFamily: 'Arial' });
    this.pocketedContainer = new PIXI.Container();
  }

  async init(): Promise<void> {
    this.screenW = window.innerWidth;
    this.screenH = window.innerHeight;

    this.app = new PIXI.Application({
      width: this.screenW,
      height: this.screenH,
      backgroundColor: 0x1a0a00,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    document.body.appendChild(this.app.view as HTMLCanvasElement);

    // viewContainer at center of screen, holds tableContainer
    this.viewContainer.addChild(this.tableContainer);
    this.tableContainer.addChild(this.aimLine);
    this.app.stage.addChild(this.viewContainer);

    // UI layer on top (not affected by camera)
    this.app.stage.addChild(this.uiContainer);
    this.uiContainer.addChild(this.powerBar);

    this.setupSpinIndicator();

    this.messageText.anchor.set(0.5);
    this.messageText.position.set(this.screenW / 2, this.screenH - 60);
    this.uiContainer.addChild(this.messageText);

    this.scoreText.position.set(10, 10);
    this.uiContainer.addChild(this.scoreText);

    this.turnText.anchor.set(1, 0);
    this.turnText.position.set(this.screenW - 10, 10);
    this.uiContainer.addChild(this.turnText);

    this.uiContainer.addChild(this.pocketedContainer);

    // Fit table to screen initially (rotated for portrait)
    this.fitTableToScreen();
    this.applyCameraTransform();

    window.addEventListener('resize', () => this.onResize());
  }

  private fitTableToScreen(): void {
    const uiSpace = 140;
    const padding = 15;
    const availW = this.screenW - padding * 2;
    const availH = this.screenH - padding * 2 - uiSpace;

    // Rotated -90°: table width(3550) becomes visual height, table height(1775) becomes visual width
    const scaleX = availW / TABLE_HEIGHT;
    const scaleY = availH / TABLE_WIDTH;
    this.camZoom = Math.min(scaleX, scaleY);
    this.camRotation = -Math.PI / 2;

    // Center of table in table coords
    const tableCX = TABLE_WIDTH / 2;
    const tableCY = TABLE_HEIGHT / 2;

    // After rotation, center of table should map to center of available area
    const screenCX = this.screenW / 2;
    const screenCY = padding + availH / 2;

    // The viewContainer pivot is at (0,0). We position it so that the table center
    // ends up at screen center.
    // Rotated table center: rotate (tableCX, tableCY) by camRotation
    const cos = Math.cos(this.camRotation);
    const sin = Math.sin(this.camRotation);
    const rotCX = tableCX * cos - tableCY * sin;
    const rotCY = tableCX * sin + tableCY * cos;

    this.camX = screenCX - rotCX * this.camZoom;
    this.camY = screenCY - rotCY * this.camZoom;
  }

  applyCameraTransform(): void {
    this.viewContainer.position.set(this.camX, this.camY);
    this.viewContainer.scale.set(this.camZoom);
    this.viewContainer.rotation = this.camRotation;
  }

  private onResize(): void {
    this.screenW = window.innerWidth;
    this.screenH = window.innerHeight;
    this.app.renderer.resize(this.screenW, this.screenH);
    this.fitTableToScreen();
    this.applyCameraTransform();
    this.repositionUI();
  }

  private repositionUI(): void {
    this.messageText.position.set(this.screenW / 2, this.screenH - 60);
    this.turnText.position.set(this.screenW - 10, 10);
    this.setupSpinIndicator();
  }

  private setupSpinIndicator(): void {
    this.spinIndicator.removeChildren();
    this.uiContainer.removeChild(this.spinIndicator);

    this.spinIndicator = new PIXI.Container();
    const spinSize = 60;
    const spinX = this.screenW - spinSize - 20;
    const spinY = this.screenH - spinSize - 100;
    this.spinIndicator.position.set(spinX, spinY);

    this.spinBg = new PIXI.Graphics();
    this.spinBg.beginFill(0x555555, 0.8);
    this.spinBg.drawCircle(spinSize / 2, spinSize / 2, spinSize / 2);
    this.spinBg.endFill();
    this.spinBg.lineStyle(1, 0x888888, 0.5);
    this.spinBg.moveTo(spinSize / 2, 0);
    this.spinBg.lineTo(spinSize / 2, spinSize);
    this.spinBg.moveTo(0, spinSize / 2);
    this.spinBg.lineTo(spinSize, spinSize / 2);
    this.spinBg.lineStyle(2, 0xAAAAAA, 0.8);
    this.spinBg.drawCircle(spinSize / 2, spinSize / 2, spinSize / 2);
    this.spinIndicator.addChild(this.spinBg);

    this.spinDot = new PIXI.Graphics();
    this.spinDot.beginFill(0xFF5722);
    this.spinDot.drawCircle(0, 0, 6);
    this.spinDot.endFill();
    this.spinDot.position.set(spinSize / 2, spinSize / 2);
    this.spinIndicator.addChild(this.spinDot);

    const label = new PIXI.Text('Винт', {
      fontSize: 12, fill: 0xAAAAAA, fontFamily: 'Arial',
    });
    label.anchor.set(0.5, 0);
    label.position.set(spinSize / 2, spinSize + 5);
    this.spinIndicator.addChild(label);

    this.uiContainer.addChild(this.spinIndicator);
  }

  // Screen coords -> table coords (accounting for camera pan/zoom/rotation)
  screenToTable(screenX: number, screenY: number): Vec2 {
    // Undo position
    let x = screenX - this.camX;
    let y = screenY - this.camY;
    // Undo scale
    x /= this.camZoom;
    y /= this.camZoom;
    // Undo rotation
    const cos = Math.cos(-this.camRotation);
    const sin = Math.sin(-this.camRotation);
    const tx = x * cos - y * sin;
    const ty = x * sin + y * cos;
    return vec2(tx, ty);
  }

  // Table coords -> screen coords
  tableToScreen(tableX: number, tableY: number): Vec2 {
    // Apply rotation
    const cos = Math.cos(this.camRotation);
    const sin = Math.sin(this.camRotation);
    const rx = tableX * cos - tableY * sin;
    const ry = tableX * sin + tableY * cos;
    // Apply scale + position
    return vec2(rx * this.camZoom + this.camX, ry * this.camZoom + this.camY);
  }

  drawTable(pockets: Pocket[]): void {
    const bg = new PIXI.Graphics();

    const borderWidth = 50;
    bg.beginFill(TABLE_BORDER_COLOR);
    bg.drawRoundedRect(
      -borderWidth, -borderWidth,
      TABLE_WIDTH + borderWidth * 2, TABLE_HEIGHT + borderWidth * 2, 15
    );
    bg.endFill();

    const railWidth = 30;
    bg.beginFill(CUSHION_COLOR);
    bg.drawRect(-railWidth, -railWidth, TABLE_WIDTH + railWidth * 2, TABLE_HEIGHT + railWidth * 2);
    bg.endFill();

    bg.beginFill(TABLE_COLOR);
    bg.drawRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
    bg.endFill();

    bg.lineStyle(1, 0x1A6B1E, 0.15);
    for (let y = 0; y < TABLE_HEIGHT; y += 40) {
      bg.moveTo(0, y);
      bg.lineTo(TABLE_WIDTH, y);
    }

    bg.lineStyle(2, 0xFFFFFF, 0.15);
    const headString = TABLE_HEIGHT * 0.65;
    bg.moveTo(0, headString);
    bg.lineTo(TABLE_WIDTH, headString);

    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 4);
    bg.endFill();
    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH / 2, TABLE_HEIGHT * 0.27, 4);
    bg.endFill();

    for (const pocket of pockets) {
      bg.beginFill(POCKET_COLOR);
      bg.drawCircle(pocket.pos.x, pocket.pos.y, pocket.radius + 5);
      bg.endFill();
      bg.beginFill(0x000000, 0.8);
      bg.drawCircle(pocket.pos.x, pocket.pos.y, pocket.radius);
      bg.endFill();
    }

    bg.beginFill(0xF5F5DC, 0.6);
    for (let i = 1; i < 8; i++) {
      bg.drawCircle(TABLE_WIDTH * i / 8, -railWidth / 2, 4);
      bg.drawCircle(TABLE_WIDTH * i / 8, TABLE_HEIGHT + railWidth / 2, 4);
    }
    for (let i = 1; i < 4; i++) {
      bg.drawCircle(-railWidth / 2, TABLE_HEIGHT * i / 4, 4);
      bg.drawCircle(TABLE_WIDTH + railWidth / 2, TABLE_HEIGHT * i / 4, 4);
    }
    bg.endFill();

    this.tableContainer.addChildAt(bg, 0);
  }

  createBallGraphics(balls: Ball[]): void {
    for (const ball of balls) {
      const container = new PIXI.Container();

      const shadow = new PIXI.Graphics();
      shadow.beginFill(0x000000, 0.3);
      shadow.drawEllipse(3, 3, ball.radius * 0.95, ball.radius * 0.85);
      shadow.endFill();
      container.addChild(shadow);

      const gfx = new PIXI.Graphics();
      const color = ball.isCue ? CUE_BALL_COLOR : BALL_COLOR;
      gfx.beginFill(color);
      gfx.drawCircle(0, 0, ball.radius);
      gfx.endFill();

      const highlight = new PIXI.Graphics();
      highlight.beginFill(0xFFFFFF, 0.4);
      highlight.drawEllipse(-ball.radius * 0.3, -ball.radius * 0.3, ball.radius * 0.35, ball.radius * 0.3);
      highlight.endFill();
      gfx.addChild(highlight);
      container.addChild(gfx);

      if (!ball.isCue) {
        const numText = new PIXI.Text(ball.id.toString(), {
          fontSize: ball.radius * 0.9,
          fill: 0x333333,
          fontWeight: 'bold',
          fontFamily: 'Arial',
        });
        numText.anchor.set(0.5);
        container.addChild(numText);
      }

      container.position.set(ball.pos.x, ball.pos.y);
      this.tableContainer.addChild(container);
      this.ballGraphics.set(ball.id, container);
    }
  }

  updateBalls(balls: Ball[]): void {
    for (const ball of balls) {
      const gfx = this.ballGraphics.get(ball.id);
      if (!gfx) continue;
      if (ball.isPocketed) { gfx.visible = false; continue; }
      gfx.visible = true;
      gfx.position.set(ball.pos.x, ball.pos.y);
    }
  }

  drawAimLine(traj: TrajectoryResult, power: number): void {
    this.aimLine.clear();

    const px = 1 / this.camZoom; // 1 screen pixel in table units
    const w = px * 2; // consistent thin line
    const alpha = Math.max(0.5, Math.min(0.9, power * 2));

    // Cue ball path — white dashed
    const cp = traj.cuePath;
    if (cp.length >= 2) {
      this.aimLine.lineStyle(w, AIM_LINE_COLOR, alpha);
      this.aimLine.moveTo(cp[0].x, cp[0].y);
      for (let i = 1; i < cp.length; i++) {
        // Dashed: draw 2 segments, skip 1
        if (i % 3 !== 0) {
          this.aimLine.lineTo(cp[i].x, cp[i].y);
        } else {
          this.aimLine.moveTo(cp[i].x, cp[i].y);
        }
      }
    }

    // Object ball direction — orange solid
    if (traj.objectBallDir.length === 2) {
      const [from, to] = traj.objectBallDir;
      this.aimLine.lineStyle(w, 0xFFAA00, alpha * 0.9);
      this.aimLine.moveTo(from.x, from.y);
      this.aimLine.lineTo(to.x, to.y);
      // Small circle at object ball contact
      this.aimLine.lineStyle(w, 0xFFAA00, alpha);
      this.aimLine.drawCircle(from.x, from.y, BALL_RADIUS);
    }

    // Cue ball deflection after hit — white dotted, fainter
    if (traj.cueDeflection.length === 2) {
      const [from, to] = traj.cueDeflection;
      this.aimLine.lineStyle(w, AIM_LINE_COLOR, alpha * 0.5);
      // Dotted pattern
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const dotSpacing = px * 8;
      const dots = Math.floor(len / dotSpacing);
      for (let i = 0; i < dots; i++) {
        const t = i / dots;
        const x = from.x + dx * t;
        const y = from.y + dy * t;
        if (i % 2 === 0) {
          this.aimLine.moveTo(x, y);
        } else {
          this.aimLine.lineTo(x, y);
        }
      }
    }
  }

  clearAimLine(): void { this.aimLine.clear(); }

  drawPowerBar(power: number): void {
    this.powerBar.clear();
    if (power <= 0) return;
    const barWidth = 20;
    const barHeight = 200;
    const x = 20;
    const y = this.screenH - barHeight - 100;

    this.powerBar.beginFill(POWER_BAR_BG, 0.7);
    this.powerBar.drawRoundedRect(x, y, barWidth, barHeight, 5);
    this.powerBar.endFill();

    const fillHeight = barHeight * power;
    const fillY = y + barHeight - fillHeight;
    let fillColor: number;
    if (power < 0.33) fillColor = 0x4CAF50;
    else if (power < 0.66) fillColor = 0xFFC107;
    else fillColor = 0xFF5722;

    this.powerBar.beginFill(fillColor, 0.9);
    this.powerBar.drawRoundedRect(x, fillY, barWidth, fillHeight, 5);
    this.powerBar.endFill();

    this.powerBar.lineStyle(2, 0xAAAAAA, 0.5);
    this.powerBar.drawRoundedRect(x, y, barWidth, barHeight, 5);
    for (let i = 0; i <= 4; i++) {
      const tickY = y + (barHeight * i) / 4;
      this.powerBar.lineStyle(1, 0xAAAAAA, 0.5);
      this.powerBar.moveTo(x + barWidth, tickY);
      this.powerBar.lineTo(x + barWidth + 5, tickY);
    }
  }

  updateSpinDot(spinX: number, spinY: number): void {
    const spinSize = 60;
    const maxOffset = spinSize / 2 - 8;
    this.spinDot.position.set(
      spinSize / 2 + spinX * maxOffset,
      spinSize / 2 + spinY * maxOffset
    );
  }

  getSpinIndicatorBounds(): { x: number; y: number; size: number } {
    const pos = this.spinIndicator.position;
    return { x: pos.x, y: pos.y, size: 60 };
  }

  showMessage(text: string, duration: number = 2000): void {
    this.messageText.text = text;
    this.messageText.alpha = 1;
    if (duration > 0) {
      setTimeout(() => { this.messageText.alpha = 0; }, duration);
    }
  }

  updatePocketed(p1Balls: number[], p2Balls: number[]): void {
    this.pocketedContainer.removeChildren();
    const ballR = 10;
    const startY = this.screenH - 40;
    const gap = ballR * 2.4;

    // Player 1 — left side
    const p1Label = new PIXI.Text(`Игрок 1: ${p1Balls.length}`, {
      fontSize: 14, fill: 0xFFFFFF, fontFamily: 'Arial',
    });
    p1Label.position.set(10, startY - 22);
    this.pocketedContainer.addChild(p1Label);

    for (let i = 0; i < p1Balls.length; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(0xFAFAFA);
      g.drawCircle(0, 0, ballR);
      g.endFill();
      const num = new PIXI.Text(p1Balls[i].toString(), {
        fontSize: 10, fill: 0x333333, fontWeight: 'bold', fontFamily: 'Arial',
      });
      num.anchor.set(0.5);
      g.addChild(num);
      g.position.set(15 + i * gap, startY);
      this.pocketedContainer.addChild(g);
    }

    // Player 2 — right side
    const p2Label = new PIXI.Text(`Игрок 2: ${p2Balls.length}`, {
      fontSize: 14, fill: 0xFFFFFF, fontFamily: 'Arial',
    });
    p2Label.anchor.set(1, 0);
    p2Label.position.set(this.screenW - 10, startY - 22);
    this.pocketedContainer.addChild(p2Label);

    for (let i = 0; i < p2Balls.length; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(0xFAFAFA);
      g.drawCircle(0, 0, ballR);
      g.endFill();
      const num = new PIXI.Text(p2Balls[i].toString(), {
        fontSize: 10, fill: 0x333333, fontWeight: 'bold', fontFamily: 'Arial',
      });
      num.anchor.set(0.5);
      g.addChild(num);
      g.position.set(this.screenW - 15 - i * gap, startY);
      this.pocketedContainer.addChild(g);
    }
  }

  updateTurn(n: number): void {
    this.turnText.text = `Ход: Игрок ${n}`;
  }

  resetView(): void {
    this.fitTableToScreen();
    this.applyCameraTransform();
  }
}
