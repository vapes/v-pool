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
  shotButtonsContainer: PIXI.Container;
  private shootBtnBounds = { x: 0, y: 0, w: 0, h: 0 };

  menuContainer: PIXI.Container;
  private menuBtnBounds: { x: number; y: number; w: number; h: number; mode: string }[] = [];

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
    this.shotButtonsContainer = new PIXI.Container();
    this.menuContainer = new PIXI.Container();
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
    this.shotButtonsContainer.visible = false;
    this.uiContainer.addChild(this.shotButtonsContainer);

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
    const headString = TABLE_WIDTH * 0.35;
    bg.moveTo(headString, 0);
    bg.lineTo(headString, TABLE_HEIGHT);

    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 4);
    bg.endFill();
    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH * 0.73, TABLE_HEIGHT / 2, 4);
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

  updatePocketed(p1Balls: number[], p2Balls: number[], vsComputer: boolean = false): void {
    this.pocketedContainer.removeChildren();
    const ballR = 10;
    const startY = this.screenH - 40;
    const gap = ballR * 2.4;

    const p1Name = vsComputer ? 'Вы' : 'Игрок 1';
    const p2Name = vsComputer ? 'Комп' : 'Игрок 2';

    // Player 1 — left side
    const p1Label = new PIXI.Text(`${p1Name}: ${p1Balls.length}`, {
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
    const p2Label = new PIXI.Text(`${p2Name}: ${p2Balls.length}`, {
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

  showMenu(): void {
    this.menuContainer.removeChildren();
    this.menuBtnBounds = [];

    // Dark overlay
    const overlay = new PIXI.Graphics();
    overlay.beginFill(0x0a0500, 0.95);
    overlay.drawRect(0, 0, this.screenW, this.screenH);
    overlay.endFill();
    this.menuContainer.addChild(overlay);

    // Title
    const title = new PIXI.Text('Русский Бильярд', {
      fontSize: 32, fill: 0xF5E6C8, fontFamily: 'Arial', fontWeight: 'bold',
    });
    title.anchor.set(0.5);
    title.position.set(this.screenW / 2, this.screenH * 0.18);
    this.menuContainer.addChild(title);

    const subtitle = new PIXI.Text('Свободная пирамида', {
      fontSize: 18, fill: 0x999999, fontFamily: 'Arial',
    });
    subtitle.anchor.set(0.5);
    subtitle.position.set(this.screenW / 2, this.screenH * 0.18 + 40);
    this.menuContainer.addChild(subtitle);

    // Menu buttons
    const buttons = [
      { label: 'Свободная игра', mode: 'free_play', color: 0x2E7D32 },
      { label: 'Игра с компьютером', mode: 'vs_computer', color: 0x1565C0 },
      { label: 'Головоломки', mode: 'puzzles', color: 0xE65100 },
    ];

    const btnW = Math.min(280, this.screenW - 60);
    const btnH = 56;
    const gap = 20;
    const startY = this.screenH * 0.38;

    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      const x = (this.screenW - btnW) / 2;
      const y = startY + i * (btnH + gap);

      const btn = new PIXI.Graphics();
      btn.beginFill(b.color, 0.9);
      btn.drawRoundedRect(0, 0, btnW, btnH, 12);
      btn.endFill();
      btn.lineStyle(2, 0xFFFFFF, 0.15);
      btn.drawRoundedRect(0, 0, btnW, btnH, 12);
      btn.position.set(x, y);
      this.menuContainer.addChild(btn);

      const label = new PIXI.Text(b.label, {
        fontSize: 22, fill: 0xFFFFFF, fontFamily: 'Arial', fontWeight: 'bold',
      });
      label.anchor.set(0.5);
      label.position.set(x + btnW / 2, y + btnH / 2);
      this.menuContainer.addChild(label);

      this.menuBtnBounds.push({ x, y, w: btnW, h: btnH, mode: b.mode });
    }

    // Decorative ball
    const ball = new PIXI.Graphics();
    ball.beginFill(0xFAFAFA);
    ball.drawCircle(0, 0, 30);
    ball.endFill();
    const highlight = new PIXI.Graphics();
    highlight.beginFill(0xFFFFFF, 0.4);
    highlight.drawEllipse(-9, -9, 10, 9);
    highlight.endFill();
    ball.addChild(highlight);
    ball.position.set(this.screenW / 2, this.screenH * 0.75);
    this.menuContainer.addChild(ball);

    this.menuContainer.visible = true;
    this.app.stage.addChild(this.menuContainer);
  }

  hideMenu(): void {
    this.menuContainer.visible = false;
    this.app.stage.removeChild(this.menuContainer);
    this.menuBtnBounds = [];
  }

  getMenuButtonAt(pos: Vec2): string | null {
    for (const b of this.menuBtnBounds) {
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        return b.mode;
      }
    }
    return null;
  }

  showShotButtons(): void {
    this.shotButtonsContainer.removeChildren();

    const btnW = 140;
    const btnH = 50;
    const x0 = (this.screenW - btnW) / 2;
    const y0 = this.screenH - 70;

    // Shoot button (green)
    const shootBtn = new PIXI.Graphics();
    shootBtn.beginFill(0x2E7D32, 0.9);
    shootBtn.drawRoundedRect(0, 0, btnW, btnH, 10);
    shootBtn.endFill();
    shootBtn.lineStyle(2, 0x4CAF50);
    shootBtn.drawRoundedRect(0, 0, btnW, btnH, 10);
    shootBtn.position.set(x0, y0);
    const shootLabel = new PIXI.Text('Удар', {
      fontSize: 22, fill: 0xFFFFFF, fontFamily: 'Arial', fontWeight: 'bold',
    });
    shootLabel.anchor.set(0.5);
    shootLabel.position.set(x0 + btnW / 2, y0 + btnH / 2);
    this.shotButtonsContainer.addChild(shootBtn, shootLabel);
    this.shootBtnBounds = { x: x0, y: y0, w: btnW, h: btnH };

    this.shotButtonsContainer.visible = true;
  }

  hideShotButtons(): void {
    this.shotButtonsContainer.visible = false;
    this.shotButtonsContainer.removeChildren();
  }

  getShotButtonAt(pos: Vec2): 'shoot' | null {
    if (!this.shotButtonsContainer.visible) return null;
    const s = this.shootBtnBounds;
    if (pos.x >= s.x && pos.x <= s.x + s.w && pos.y >= s.y && pos.y <= s.y + s.h) {
      return 'shoot';
    }
    return null;
  }

  getPowerBarBounds(): { x: number; y: number; w: number; h: number } {
    const barWidth = 20;
    const barHeight = 200;
    const touchPadding = 20;
    return {
      x: 20 - touchPadding,
      y: this.screenH - barHeight - 100 - touchPadding,
      w: barWidth + touchPadding * 2,
      h: barHeight + touchPadding * 2,
    };
  }

  isTouchOnPowerBar(pos: Vec2): boolean {
    const b = this.getPowerBarBounds();
    return pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h;
  }

  getPowerFromScreenY(screenY: number): number {
    const barHeight = 200;
    const barY = this.screenH - barHeight - 100;
    const clamped = Math.max(barY, Math.min(barY + barHeight, screenY));
    return 1 - (clamped - barY) / barHeight;
  }

  updateTurn(n: number, label?: string): void {
    this.turnText.text = label ? `Ход: ${label}` : `Ход: Игрок ${n}`;
  }

  resetView(): void {
    this.fitTableToScreen();
    this.applyCameraTransform();
  }

  clearGame(): void {
    this.tableContainer.removeChildren();
    this.tableContainer.addChild(this.aimLine);
    this.aimLine.clear();
    this.powerBar.clear();
    this.ballGraphics.clear();
    this.hideShotButtons();
    this.pocketedContainer.removeChildren();
    this.messageText.text = '';
    this.scoreText.text = '';
    this.turnText.text = '';
    this.fitTableToScreen();
    this.applyCameraTransform();
  }
}
