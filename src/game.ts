import {
  Ball, PhysicsEngine, createBalls, createPockets,
  shootCueBall, isMoving, vec2, vecSub, vecLen,
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, SpinParams, Vec2
} from './physics';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import type { GameMode } from './main';

type GameState = 'waiting' | 'simulating' | 'ball_in_hand' | 'game_over';

export class Game {
  private physics: PhysicsEngine;
  private renderer: Renderer;
  private input!: InputHandler;
  private mode: GameMode;
  private onBackToMenu: () => void;
  private tickerFn: (() => void) | null = null;

  private gameState: GameState = 'waiting';
  private currentPlayer: number = 1;
  private pocketedByPlayer: [number[], number[]] = [[], []];
  private activeBall!: Ball;
  private pyramidBroken: boolean = false;

  constructor(renderer: Renderer, mode: GameMode, onBackToMenu: () => void) {
    const balls = createBalls();
    const pockets = createPockets();
    this.physics = new PhysicsEngine(balls, pockets);
    this.renderer = renderer;
    this.mode = mode;
    this.onBackToMenu = onBackToMenu;
    this.activeBall = balls[0];
  }

  start(): void {
    this.input = new InputHandler(this.renderer);
    this.renderer.drawTable(this.physics.pockets);
    this.renderer.createBallGraphics(this.physics.balls);
    this.renderer.updatePocketed([], []);
    this.renderer.updateTurn(1);
    this.renderer.showMessage('Свободная пирамида — бейте битком', 3000);

    this.setupInputCallbacks();
    this.tickerFn = () => this.update();
    this.renderer.app.ticker.add(this.tickerFn);
  }

  private cleanup(): void {
    if (this.tickerFn) {
      this.renderer.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
    }
    this.renderer.clearGame();
    this.input.destroy();
  }

  private setupInputCallbacks(): void {
    this.input.findBallAtScreen = (screenPos: Vec2): Vec2 | null => {
      if (this.gameState !== 'waiting') return null;

      const hitRadius = Math.max(30, BALL_RADIUS * this.renderer.camZoom + 20);

      for (const ball of this.physics.balls) {
        if (ball.isPocketed) continue;
        if (!this.pyramidBroken && !ball.isCue) continue;

        const ballScreen = this.renderer.tableToScreen(ball.pos.x, ball.pos.y);
        const dist = vecLen(vecSub(screenPos, ballScreen));
        if (dist < hitRadius) {
          this.activeBall = ball;
          return ballScreen;
        }
      }
      return null;
    };

    this.input.onShoot = (direction, power) => {
      if (this.gameState !== 'waiting') return;

      const spin: SpinParams = {
        x: this.input.spinX,
        y: this.input.spinY,
      };

      this.physics.resetTurnTracking();
      this.physics.activeBallId = this.activeBall.id;
      shootCueBall(this.activeBall, direction, power, spin);
      this.gameState = 'simulating';

      if (!this.pyramidBroken) {
        this.pyramidBroken = true;
      }

      this.renderer.hideShotButtons();
      this.renderer.clearAimLine();
      this.renderer.drawPowerBar(0);
    };

    this.input.onCancelAim = () => {
      // Nothing special needed, input already clears aim line
    };

    this.input.onAimUpdate = (direction, power) => {
      if (this.gameState !== 'waiting') return;

      const traj = this.physics.predictTrajectory(
        this.activeBall.pos, direction, power, 200, this.activeBall.id
      );
      this.renderer.drawAimLine(traj, power);
      this.renderer.drawPowerBar(power);
    };

    this.input.onBallInHandPlace = (pos) => {
      if (this.gameState !== 'ball_in_hand') return;

      const cue = this.physics.balls[0];
      const placeX = Math.max(BALL_RADIUS, Math.min(TABLE_WIDTH - BALL_RADIUS, pos.x));
      const placeY = Math.max(BALL_RADIUS, Math.min(TABLE_HEIGHT - BALL_RADIUS, pos.y));

      let valid = true;
      for (const ball of this.physics.balls) {
        if (ball.isPocketed || ball.id === 0) continue;
        if (vecLen(vecSub(vec2(placeX, placeY), ball.pos)) < BALL_RADIUS * 2.5) {
          valid = false;
          break;
        }
      }

      if (valid) {
        cue.pos = vec2(placeX, placeY);
        cue.isPocketed = false;
        cue.vel = vec2(0, 0);
        cue.spin = vec2(0, 0);
        this.activeBall = cue;
        this.gameState = 'waiting';
        this.input.resetToIdle();
        this.renderer.showMessage('Биток установлен', 1500);
      } else {
        this.renderer.showMessage('Нельзя поставить здесь!', 1500);
      }
    };
  }

  private update(): void {
    if (this.gameState === 'simulating') {
      this.physics.update(1);
      if (!isMoving(this.physics.balls)) {
        this.onTurnEnd();
      }
    }
    this.renderer.updateBalls(this.physics.balls);
  }

  private onTurnEnd(): void {
    const pocketed = this.physics.pocketedThisTurn;

    // Foul: no ball was hit at all
    if (pocketed.length === 0 && this.physics.firstHitBallId === -1) {
      this.renderer.showMessage('Фол! Нет касания', 2500);
      this.switchPlayer();
      this.gameState = 'waiting';
      this.activeBall = this.physics.balls[0];
      this.input.resetToIdle();
      return;
    }

    if (pocketed.length > 0) {
      // All pocketed balls go to the current player's score
      // In Russian billiards (свободная пирамида):
      // - You CAN pocket the cue ball (свояк) — it counts!
      // - You CAN pocket the ball you're hitting with — it counts!
      // - Any ball going into a pocket scores for the current player
      for (const id of pocketed) {
        this.pocketedByPlayer[this.currentPlayer - 1].push(id);
      }

      this.renderer.updatePocketed(
        this.pocketedByPlayer[0],
        this.pocketedByPlayer[1]
      );

      const count = pocketed.length;
      const word = count === 1 ? 'шар' : (count < 5 ? 'шара' : 'шаров');
      this.renderer.showMessage(
        `Игрок ${this.currentPlayer}: +${count} ${word}!`, 2000
      );

      // Check win (first to 8)
      if (this.pocketedByPlayer[this.currentPlayer - 1].length >= 8) {
        this.gameState = 'game_over';
        this.renderer.showMessage(`Игрок ${this.currentPlayer} победил!`, 0);
        setTimeout(() => this.resetGame(), 5000);
        return;
      }

      // If cue ball (id=0) was pocketed, need to place it back
      const cue = this.physics.balls[0];
      if (cue.isPocketed) {
        cue.isPocketed = false;
        cue.pos = vec2(TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2);
        cue.vel = vec2(0, 0);
        cue.spin = vec2(0, 0);
        this.gameState = 'ball_in_hand';
        this.input.enableBallInHand();
        this.renderer.showMessage('Поставьте биток', 0);
        // Player continues (scored, no foul)
        return;
      }

      // Player scored — continues shooting
      this.gameState = 'waiting';
      this.activeBall = this.physics.balls[0];
      this.input.resetToIdle();
    } else {
      // Nothing pocketed — switch player
      this.switchPlayer();
      this.gameState = 'waiting';
      this.activeBall = this.physics.balls[0];
      this.input.resetToIdle();
    }
  }

  private switchPlayer(): void {
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.renderer.updateTurn(this.currentPlayer);
  }

  private resetGame(): void {
    this.cleanup();
    this.onBackToMenu();
  }
}
