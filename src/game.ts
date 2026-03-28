import {
  Ball, PhysicsEngine, createBalls, createPockets,
  shootCueBall, isMoving, vec2, vecSub, vecLen,
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, SpinParams, Vec2
} from './physics';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { AI } from './ai';
import type { GameMode } from './main';

type GameState = 'waiting' | 'simulating' | 'ball_in_hand' | 'game_over' | 'ai_thinking';

export class Game {
  private physics: PhysicsEngine;
  private renderer: Renderer;
  private input!: InputHandler;
  private ai: AI | null = null;
  private mode: GameMode;
  private onBackToMenu: () => void;
  private tickerFn: (() => void) | null = null;
  private aiTimeoutId: number | null = null;

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
    if (mode === 'vs_computer') {
      this.ai = new AI(0.6);
    }
  }

  start(): void {
    this.input = new InputHandler(this.renderer);
    this.renderer.drawTable(this.physics.pockets);
    this.renderer.createBallGraphics(this.physics.balls);
    this.renderer.updatePocketed([], [], this.mode === 'vs_computer');
    if (this.mode === 'vs_computer') {
      this.renderer.updateTurn(1, 'Вы');
    } else {
      this.renderer.updateTurn(1);
    }
    const msg = this.mode === 'vs_computer'
      ? 'Вы играете белыми. Ваш ход!'
      : 'Свободная пирамида — бейте битком';
    this.renderer.showMessage(msg, 3000);

    this.setupInputCallbacks();
    this.tickerFn = () => this.update();
    this.renderer.app.ticker.add(this.tickerFn);
  }

  private cleanup(): void {
    if (this.tickerFn) {
      this.renderer.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
    }
    if (this.aiTimeoutId !== null) {
      clearTimeout(this.aiTimeoutId);
      this.aiTimeoutId = null;
    }
    this.renderer.clearGame();
    this.input.destroy();
  }

  private isAiTurn(): boolean {
    return this.mode === 'vs_computer' && this.currentPlayer === 2;
  }

  private triggerAiTurn(): void {
    if (!this.ai) return;
    this.gameState = 'ai_thinking';
    this.renderer.showMessage('Компьютер думает...', 0);

    this.aiTimeoutId = window.setTimeout(() => {
      this.aiTimeoutId = null;
      if (this.gameState !== 'ai_thinking') return;

      const shot = this.ai!.findBestShot(
        this.physics.balls, this.physics.pockets, this.pyramidBroken
      );

      this.activeBall = shot.striker;

      // Show aim line briefly
      const traj = this.physics.predictTrajectory(
        shot.striker.pos, shot.direction, shot.power, 200, shot.striker.id
      );
      this.renderer.drawAimLine(traj, shot.power);
      this.renderer.drawPowerBar(shot.power);

      // Execute shot after showing aim line
      this.aiTimeoutId = window.setTimeout(() => {
        this.aiTimeoutId = null;
        this.physics.resetTurnTracking();
        this.physics.activeBallId = shot.striker.id;
        shootCueBall(shot.striker, shot.direction, shot.power, shot.spin);
        this.gameState = 'simulating';

        if (!this.pyramidBroken) this.pyramidBroken = true;

        this.renderer.clearAimLine();
        this.renderer.drawPowerBar(0);
      }, 800);
    }, 1000 + Math.random() * 500);
  }

  private triggerAiBallInHand(): void {
    if (!this.ai) return;
    this.gameState = 'ai_thinking';
    this.renderer.showMessage('Компьютер ставит биток...', 0);

    this.aiTimeoutId = window.setTimeout(() => {
      this.aiTimeoutId = null;
      const pos = this.ai!.findBallInHandPosition(
        this.physics.balls, this.physics.pockets
      );
      const cue = this.physics.balls[0];
      cue.pos = pos;
      cue.isPocketed = false;
      cue.vel = vec2(0, 0);
      cue.spin = vec2(0, 0);
      this.activeBall = cue;

      // Now take a shot
      this.triggerAiTurn();
    }, 800);
  }

  private setupInputCallbacks(): void {
    this.input.findBallAtScreen = (screenPos: Vec2): Vec2 | null => {
      if (this.gameState !== 'waiting' || this.isAiTurn()) return null;

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
      this.startTurn();
      return;
    }

    if (pocketed.length > 0) {
      for (const id of pocketed) {
        this.pocketedByPlayer[this.currentPlayer - 1].push(id);
      }

      this.renderer.updatePocketed(
        this.pocketedByPlayer[0],
        this.pocketedByPlayer[1],
        this.mode === 'vs_computer'
      );

      const playerName = this.isAiTurn() ? 'Компьютер' : `Игрок ${this.currentPlayer}`;
      const count = pocketed.length;
      const word = count === 1 ? 'шар' : (count < 5 ? 'шара' : 'шаров');
      this.renderer.showMessage(`${playerName}: +${count} ${word}!`, 2000);

      // Check win (first to 8)
      if (this.pocketedByPlayer[this.currentPlayer - 1].length >= 8) {
        this.gameState = 'game_over';
        const winner = this.isAiTurn() ? 'Компьютер победил!' : 'Вы победили!';
        const winMsg = this.mode === 'vs_computer' ? winner : `Игрок ${this.currentPlayer} победил!`;
        this.renderer.showMessage(winMsg, 0);
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

        if (this.isAiTurn()) {
          this.triggerAiBallInHand();
        } else {
          this.gameState = 'ball_in_hand';
          this.input.enableBallInHand();
          this.renderer.showMessage('Поставьте биток', 0);
        }
        return;
      }

      // Player scored — continues shooting
      this.continueTurn();
    } else {
      // Nothing pocketed — switch player
      this.switchPlayer();
      this.startTurn();
    }
  }

  private startTurn(): void {
    this.activeBall = this.physics.balls[0];
    if (this.isAiTurn()) {
      this.triggerAiTurn();
    } else {
      this.gameState = 'waiting';
      this.input.resetToIdle();
    }
  }

  private continueTurn(): void {
    this.activeBall = this.physics.balls[0];
    if (this.isAiTurn()) {
      this.triggerAiTurn();
    } else {
      this.gameState = 'waiting';
      this.input.resetToIdle();
    }
  }

  private switchPlayer(): void {
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    if (this.mode === 'vs_computer') {
      this.renderer.updateTurn(this.currentPlayer, this.currentPlayer === 1 ? 'Вы' : 'Компьютер');
    } else {
      this.renderer.updateTurn(this.currentPlayer);
    }
  }

  private resetGame(): void {
    this.cleanup();
    this.onBackToMenu();
  }
}
