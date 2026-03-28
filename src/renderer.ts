import * as PIXI from 'pixi.js';
import {
  Ball, Pocket, Vec2, TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, POCKET_RADIUS,
  vec2, vecLen
} from './physics';

const TABLE_COLOR = 0x1B5E20;       // Dark green cloth
const TABLE_BORDER_COLOR = 0x4E342E; // Dark wood
const CUSHION_COLOR = 0x2E7D32;      // Slightly lighter green
const CUE_BALL_COLOR = 0xFFF9C4;     // Yellowish ivory
const BALL_COLOR = 0xFAFAFA;         // White for Russian billiards
const POCKET_COLOR = 0x111111;
const AIM_LINE_COLOR = 0xFFFFFF;
const POWER_BAR_BG = 0x333333;
const POWER_BAR_FILL = 0xFF5722;

export class Renderer {
  app: PIXI.Application;
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

  scale: number = 1;
  offsetX: number = 0;
  offsetY: number = 0;

  private screenW: number = 0;
  private screenH: number = 0;

  constructor() {
    this.app = null!;
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

    this.calculateScale();

    this.app.stage.addChild(this.tableContainer);
    this.tableContainer.addChild(this.aimLine);

    // UI layer on top
    this.app.stage.addChild(this.uiContainer);
    this.uiContainer.addChild(this.powerBar);

    // Spin indicator
    this.setupSpinIndicator();

    // Message text (center screen)
    this.messageText.anchor.set(0.5);
    this.messageText.position.set(this.screenW / 2, this.screenH - 60);
    this.uiContainer.addChild(this.messageText);

    // Score text
    this.scoreText.position.set(10, 10);
    this.uiContainer.addChild(this.scoreText);

    // Turn text
    this.turnText.anchor.set(1, 0);
    this.turnText.position.set(this.screenW - 10, 10);
    this.uiContainer.addChild(this.turnText);

    window.addEventListener('resize', () => this.onResize());
  }

  private calculateScale(): void {
    // Portrait mode: table is vertical
    // Leave space for UI elements at bottom
    const uiSpace = 180;
    const padding = 30;
    const availW = this.screenW - padding * 2;
    const availH = this.screenH - padding * 2 - uiSpace;

    // Table in portrait: width maps to screen width, height maps to screen height
    const scaleX = availW / TABLE_WIDTH;
    const scaleY = availH / TABLE_HEIGHT;
    this.scale = Math.min(scaleX, scaleY);

    // Center the table
    const tableDisplayW = TABLE_WIDTH * this.scale;
    const tableDisplayH = TABLE_HEIGHT * this.scale;
    this.offsetX = (this.screenW - tableDisplayW) / 2;
    this.offsetY = padding;

    this.tableContainer.position.set(this.offsetX, this.offsetY);
    this.tableContainer.scale.set(this.scale);
  }

  private onResize(): void {
    this.screenW = window.innerWidth;
    this.screenH = window.innerHeight;
    this.app.renderer.resize(this.screenW, this.screenH);
    this.calculateScale();
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

    // Background circle (ball representation)
    this.spinBg = new PIXI.Graphics();
    this.spinBg.beginFill(0x555555, 0.8);
    this.spinBg.drawCircle(spinSize / 2, spinSize / 2, spinSize / 2);
    this.spinBg.endFill();
    // Cross lines
    this.spinBg.lineStyle(1, 0x888888, 0.5);
    this.spinBg.moveTo(spinSize / 2, 0);
    this.spinBg.lineTo(spinSize / 2, spinSize);
    this.spinBg.moveTo(0, spinSize / 2);
    this.spinBg.lineTo(spinSize, spinSize / 2);
    // Outer ring
    this.spinBg.lineStyle(2, 0xAAAAAA, 0.8);
    this.spinBg.drawCircle(spinSize / 2, spinSize / 2, spinSize / 2);
    this.spinIndicator.addChild(this.spinBg);

    // Spin dot (shows where cue hits)
    this.spinDot = new PIXI.Graphics();
    this.spinDot.beginFill(0xFF5722);
    this.spinDot.drawCircle(0, 0, 6);
    this.spinDot.endFill();
    this.spinDot.position.set(spinSize / 2, spinSize / 2);
    this.spinIndicator.addChild(this.spinDot);

    // Label
    const label = new PIXI.Text('Винт', {
      fontSize: 12,
      fill: 0xAAAAAA,
      fontFamily: 'Arial',
    });
    label.anchor.set(0.5, 0);
    label.position.set(spinSize / 2, spinSize + 5);
    this.spinIndicator.addChild(label);

    this.uiContainer.addChild(this.spinIndicator);
  }

  // Convert screen coordinates to table coordinates
  screenToTable(screenX: number, screenY: number): Vec2 {
    const x = (screenX - this.offsetX) / this.scale;
    const y = (screenY - this.offsetY) / this.scale;
    return vec2(x, y);
  }

  // Convert table coordinates to screen coordinates
  tableToScreen(tableX: number, tableY: number): Vec2 {
    const x = tableX * this.scale + this.offsetX;
    const y = tableY * this.scale + this.offsetY;
    return vec2(x, y);
  }

  drawTable(pockets: Pocket[]): void {
    // Draw once as a static background
    const bg = new PIXI.Graphics();

    // Outer wood border
    const borderWidth = 50;
    bg.beginFill(TABLE_BORDER_COLOR);
    bg.drawRoundedRect(
      -borderWidth, -borderWidth,
      TABLE_WIDTH + borderWidth * 2, TABLE_HEIGHT + borderWidth * 2,
      15
    );
    bg.endFill();

    // Cushion rails
    const railWidth = 30;
    bg.beginFill(CUSHION_COLOR);
    bg.drawRect(-railWidth, -railWidth, TABLE_WIDTH + railWidth * 2, TABLE_HEIGHT + railWidth * 2);
    bg.endFill();

    // Playing surface
    bg.beginFill(TABLE_COLOR);
    bg.drawRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
    bg.endFill();

    // Cloth texture lines (subtle)
    bg.lineStyle(1, 0x1A6B1E, 0.15);
    for (let y = 0; y < TABLE_HEIGHT; y += 40) {
      bg.moveTo(0, y);
      bg.lineTo(TABLE_WIDTH, y);
    }

    // Head string line (where cue ball is placed)
    bg.lineStyle(2, 0xFFFFFF, 0.15);
    const headString = TABLE_HEIGHT * 0.65;
    bg.moveTo(0, headString);
    bg.lineTo(TABLE_WIDTH, headString);

    // Center spot
    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 4);
    bg.endFill();

    // Foot spot
    bg.beginFill(0xFFFFFF, 0.2);
    bg.drawCircle(TABLE_WIDTH / 2, TABLE_HEIGHT * 0.27, 4);
    bg.endFill();

    // Pockets
    for (const pocket of pockets) {
      bg.beginFill(POCKET_COLOR);
      bg.drawCircle(pocket.pos.x, pocket.pos.y, pocket.radius + 5);
      bg.endFill();
      // Inner pocket shadow
      bg.beginFill(0x000000, 0.8);
      bg.drawCircle(pocket.pos.x, pocket.pos.y, pocket.radius);
      bg.endFill();
    }

    // Diamond markers on rails
    bg.beginFill(0xF5F5DC, 0.6);
    // Top rail diamonds
    for (let i = 1; i < 8; i++) {
      bg.drawCircle(TABLE_WIDTH * i / 8, -railWidth / 2, 4);
    }
    // Bottom rail diamonds
    for (let i = 1; i < 8; i++) {
      bg.drawCircle(TABLE_WIDTH * i / 8, TABLE_HEIGHT + railWidth / 2, 4);
    }
    // Left rail diamonds
    for (let i = 1; i < 4; i++) {
      bg.drawCircle(-railWidth / 2, TABLE_HEIGHT * i / 4, 4);
    }
    // Right rail diamonds
    for (let i = 1; i < 4; i++) {
      bg.drawCircle(TABLE_WIDTH + railWidth / 2, TABLE_HEIGHT * i / 4, 4);
    }
    bg.endFill();

    this.tableContainer.addChildAt(bg, 0);
  }

  createBallGraphics(balls: Ball[]): void {
    for (const ball of balls) {
      const container = new PIXI.Container();

      // Ball shadow
      const shadow = new PIXI.Graphics();
      shadow.beginFill(0x000000, 0.3);
      shadow.drawEllipse(3, 3, ball.radius * 0.95, ball.radius * 0.85);
      shadow.endFill();
      container.addChild(shadow);

      // Ball body
      const gfx = new PIXI.Graphics();
      const color = ball.isCue ? CUE_BALL_COLOR : BALL_COLOR;
      gfx.beginFill(color);
      gfx.drawCircle(0, 0, ball.radius);
      gfx.endFill();

      // Highlight (3D effect)
      const highlight = new PIXI.Graphics();
      highlight.beginFill(0xFFFFFF, 0.4);
      highlight.drawEllipse(-ball.radius * 0.3, -ball.radius * 0.3, ball.radius * 0.35, ball.radius * 0.3);
      highlight.endFill();
      gfx.addChild(highlight);

      container.addChild(gfx);

      // Number text for non-cue balls
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

      if (ball.isPocketed) {
        gfx.visible = false;
        continue;
      }

      gfx.visible = true;
      gfx.position.set(ball.pos.x, ball.pos.y);
    }
  }

  drawAimLine(points: Vec2[], power: number): void {
    this.aimLine.clear();
    if (points.length < 2) return;

    // Main aim line (fading)
    const maxAlpha = Math.min(0.8, power * 1.5);
    for (let i = 0; i < points.length - 1; i++) {
      const alpha = maxAlpha * (1 - i / points.length);
      const width = Math.max(1, 3 - (i / points.length) * 2);

      if (i >= points.length - 3 && points.length > 5) {
        // Last segment (object ball prediction) - different color
        this.aimLine.lineStyle(width, 0xFFAA00, alpha * 0.7);
      } else {
        this.aimLine.lineStyle(width, AIM_LINE_COLOR, alpha);
      }

      // Dashed line effect
      if (i % 3 !== 2) {
        this.aimLine.moveTo(points[i].x, points[i].y);
        this.aimLine.lineTo(points[i + 1].x, points[i + 1].y);
      }
    }
  }

  clearAimLine(): void {
    this.aimLine.clear();
  }

  drawPowerBar(power: number): void {
    this.powerBar.clear();
    if (power <= 0) return;

    const barWidth = 20;
    const barHeight = 200;
    const x = 20;
    const y = this.screenH - barHeight - 100;

    // Background
    this.powerBar.beginFill(POWER_BAR_BG, 0.7);
    this.powerBar.drawRoundedRect(x, y, barWidth, barHeight, 5);
    this.powerBar.endFill();

    // Fill (gradient from green to red)
    const fillHeight = barHeight * power;
    const fillY = y + barHeight - fillHeight;

    let fillColor: number;
    if (power < 0.33) fillColor = 0x4CAF50;
    else if (power < 0.66) fillColor = 0xFFC107;
    else fillColor = 0xFF5722;

    this.powerBar.beginFill(fillColor, 0.9);
    this.powerBar.drawRoundedRect(x, fillY, barWidth, fillHeight, 5);
    this.powerBar.endFill();

    // Border
    this.powerBar.lineStyle(2, 0xAAAAAA, 0.5);
    this.powerBar.drawRoundedRect(x, y, barWidth, barHeight, 5);

    // Power percentage text
    const pct = Math.round(power * 100);
    this.powerBar.lineStyle(0);
    // Small ticks
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
      setTimeout(() => {
        this.messageText.alpha = 0;
      }, duration);
    }
  }

  updateScore(player1: number, player2: number): void {
    this.scoreText.text = `Игрок 1: ${player1}  |  Игрок 2: ${player2}`;
  }

  updateTurn(playerNum: number): void {
    this.turnText.text = `Ход: Игрок ${playerNum}`;
  }
}
