import {
  Ball, PhysicsEngine, createBalls, createPockets,
  shootCueBall, isMoving, vec2, vecSub, vecNorm, vecLen,
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, SpinParams
} from './physics';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { Vec2 } from './physics';

type GameState = 'waiting' | 'shooting' | 'simulating' | 'ball_in_hand' | 'game_over';

export class Game {
  private physics: PhysicsEngine;
  private renderer: Renderer;
  private input!: InputHandler;

  private gameState: GameState = 'waiting';
  private currentPlayer: number = 1;
  private scores: [number, number] = [0, 0];
  // The ball currently selected for shooting (any ball in Russian billiards)
  private activeBall!: Ball;
  private pyramidBroken: boolean = false;

  constructor() {
    const balls = createBalls();
    const pockets = createPockets();
    this.physics = new PhysicsEngine(balls, pockets);
    this.renderer = new Renderer();
    this.activeBall = balls[0]; // cue ball by default
  }

  async start(): Promise<void> {
    await this.renderer.init();
    this.input = new InputHandler(this.renderer);
    this.renderer.drawTable(this.physics.pockets);
    this.renderer.createBallGraphics(this.physics.balls);
    this.renderer.updateScore(0, 0);
    this.renderer.updateTurn(1);
    this.renderer.showMessage('Свободная пирамида — бейте битком', 3000);

    this.setupInputCallbacks();
    this.renderer.app.ticker.add(() => this.update());
  }

  private setupInputCallbacks(): void {
    // Find which ball the player touched (any non-pocketed ball)
    this.input.findBallAtScreen = (screenPos: Vec2): Vec2 | null => {
      if (this.gameState !== 'waiting') return null;

      const hitRadius = Math.max(30, BALL_RADIUS * this.renderer.camZoom + 20);

      // Before pyramid is broken, only cue ball (id=0) can be hit
      // After break, any ball can be used as the striker
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

      // Mark pyramid as broken after first shot
      if (!this.pyramidBroken) {
        this.pyramidBroken = true;
      }

      this.renderer.clearAimLine();
      this.renderer.drawPowerBar(0);
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
      let placeX = Math.max(BALL_RADIUS, Math.min(TABLE_WIDTH - BALL_RADIUS, pos.x));
      let placeY = Math.max(BALL_RADIUS, Math.min(TABLE_HEIGHT - BALL_RADIUS, pos.y));

      // Check no overlap with other balls
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
    const dt = 1;

    if (this.gameState === 'simulating') {
      this.physics.update(dt);

      if (!isMoving(this.physics.balls)) {
        this.onTurnEnd();
      }
    }

    this.renderer.updateBalls(this.physics.balls);
  }

  private onTurnEnd(): void {
    const pocketed = this.physics.pocketedThisTurn;
    const activePocketed = pocketed.includes(this.activeBall.id);
    const otherPocketed = pocketed.filter(id => id !== this.activeBall.id);

    let foul = false;

    // Foul: the ball you hit with went into a pocket (scratch)
    if (activePocketed && otherPocketed.length === 0) {
      foul = true;
      this.renderer.showMessage('Фол! Биток в лузе без забитого шара', 2500);
    }

    // Foul: no ball hit
    if (!foul && this.physics.firstHitBallId === -1) {
      foul = true;
      this.renderer.showMessage('Фол! Нет касания', 2500);
    }

    if (foul) {
      // Re-spot any pocketed balls on a foul
      for (const id of pocketed) {
        this.respotBall(id);
      }
      this.switchPlayer();
    } else if (pocketed.length > 0) {
      // In Russian billiards, ANY pocketed ball scores (including the striker!)
      // The ball that was struck (active ball) going in also counts
      // if at least one other ball was also pocketed or hit a cushion
      const points = pocketed.length;
      this.scores[this.currentPlayer - 1] += points;
      this.renderer.updateScore(this.scores[0], this.scores[1]);

      const word = points === 1 ? 'шар' : (points < 5 ? 'шара' : 'шаров');
      this.renderer.showMessage(
        `Игрок ${this.currentPlayer}: +${points} ${word}!`, 2000
      );

      // If active ball was pocketed, need to place cue ball
      if (activePocketed) {
        // Use cue ball (id=0) for ball-in-hand if it was the one pocketed,
        // otherwise just continue
        const cue = this.physics.balls[0];
        if (cue.isPocketed) {
          this.gameState = 'ball_in_hand';
          this.input.enableBallInHand();
          this.renderer.showMessage('Поставьте биток', 0);
          // Don't check win until ball placed
        }
      }

      // Check win (first to 8)
      if (this.scores[this.currentPlayer - 1] >= 8) {
        this.gameState = 'game_over';
        this.renderer.showMessage(`Игрок ${this.currentPlayer} победил!`, 0);
        setTimeout(() => this.resetGame(), 5000);
        return;
      }

      // Player continues after scoring
    } else {
      // No score, no foul - switch player
      this.switchPlayer();
    }

    if (this.gameState !== 'ball_in_hand' && this.gameState !== 'game_over') {
      this.gameState = 'waiting';
      this.activeBall = this.physics.balls[0]; // reset to cue ball
      this.input.resetToIdle();
    }
  }

  private switchPlayer(): void {
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.renderer.updateTurn(this.currentPlayer);
  }

  private respotBall(id: number): void {
    const ball = this.physics.balls.find(b => b.id === id);
    if (!ball) return;

    ball.isPocketed = false;
    ball.vel = vec2(0, 0);
    ball.spin = vec2(0, 0);

    const footSpot = vec2(TABLE_WIDTH / 2, TABLE_HEIGHT * 0.27);
    let pos = { ...footSpot };
    let attempts = 0;

    while (attempts < 50) {
      let overlap = false;
      for (const other of this.physics.balls) {
        if (other.id === id || other.isPocketed) continue;
        if (vecLen(vecSub(pos, other.pos)) < BALL_RADIUS * 2.5) {
          overlap = true;
          break;
        }
      }
      if (!overlap) break;
      pos = vec2(
        footSpot.x + (Math.random() - 0.5) * BALL_RADIUS * 4,
        footSpot.y + attempts * BALL_RADIUS * 2.2
      );
      attempts++;
    }

    ball.pos = pos;
  }

  private resetGame(): void {
    const newBalls = createBalls();
    for (let i = 0; i < this.physics.balls.length; i++) {
      Object.assign(this.physics.balls[i], newBalls[i]);
    }

    this.activeBall = this.physics.balls[0];
    this.pyramidBroken = false;
    this.scores = [0, 0];
    this.currentPlayer = 1;
    this.renderer.updateScore(0, 0);
    this.renderer.updateTurn(1);
    this.gameState = 'waiting';
    this.input.resetToIdle();
    this.renderer.showMessage('Новая игра!', 2000);
  }
}
