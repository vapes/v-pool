import {
  Ball, PhysicsEngine, createBalls, createPockets,
  shootCueBall, isMoving, vec2, vecSub, vecNorm, vecLen,
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, SpinParams
} from './physics';
import { Renderer } from './renderer';
import { InputHandler, InputState } from './input';

type GameState = 'waiting' | 'shooting' | 'simulating' | 'ball_in_hand' | 'game_over';

export class Game {
  private physics: PhysicsEngine;
  private renderer: Renderer;
  private input: InputHandler;

  private gameState: GameState = 'waiting';
  private currentPlayer: number = 1;
  private scores: [number, number] = [0, 0];
  private cueBall!: Ball;

  constructor() {
    const balls = createBalls();
    const pockets = createPockets();
    this.physics = new PhysicsEngine(balls, pockets);
    this.renderer = new Renderer();
    this.input = new InputHandler(this.renderer);
    this.cueBall = balls[0];
  }

  async start(): Promise<void> {
    await this.renderer.init();
    this.renderer.drawTable(this.physics.pockets);
    this.renderer.createBallGraphics(this.physics.balls);
    this.renderer.updateScore(0, 0);
    this.renderer.updateTurn(1);
    this.renderer.showMessage('Русский бильярд - Нажмите на биток', 3000);

    this.setupInputCallbacks();

    // Main game loop
    this.renderer.app.ticker.add(() => this.update());
  }

  private setupInputCallbacks(): void {
    this.input.onShoot = (direction, power) => {
      if (this.gameState !== 'waiting') return;

      const spin: SpinParams = {
        x: this.input.spinX,
        y: this.input.spinY,
      };

      this.physics.resetTurnTracking();
      shootCueBall(this.cueBall, direction, power, spin);
      this.gameState = 'simulating';
      this.renderer.clearAimLine();
      this.renderer.drawPowerBar(0);
    };

    this.input.onAimUpdate = (direction, power) => {
      if (this.gameState !== 'waiting') return;

      // Show aim line
      const trajectory = this.physics.predictTrajectory(
        this.cueBall.pos, direction, power
      );
      this.renderer.drawAimLine(trajectory, power);
      this.renderer.drawPowerBar(power);
    };

    this.input.onBallInHandPlace = (pos) => {
      if (this.gameState !== 'ball_in_hand') return;

      // Validate position - must be behind head string for Russian billiards
      const headString = TABLE_HEIGHT * 0.65;
      let placeY = Math.max(headString + BALL_RADIUS, Math.min(TABLE_HEIGHT - BALL_RADIUS, pos.y));
      let placeX = Math.max(BALL_RADIUS, Math.min(TABLE_WIDTH - BALL_RADIUS, pos.x));

      // Check no overlap with other balls
      let valid = true;
      for (const ball of this.physics.balls) {
        if (ball.isPocketed || ball.isCue) continue;
        if (vecLen(vecSub(vec2(placeX, placeY), ball.pos)) < BALL_RADIUS * 2.5) {
          valid = false;
          break;
        }
      }

      if (valid) {
        this.cueBall.pos = vec2(placeX, placeY);
        this.cueBall.isPocketed = false;
        this.cueBall.vel = vec2(0, 0);
        this.cueBall.spin = vec2(0, 0);
        this.gameState = 'waiting';
        this.input.resetToIdle();
        this.renderer.showMessage('Биток установлен', 1500);
      } else {
        this.renderer.showMessage('Нельзя поставить здесь!', 1500);
      }
    };
  }

  private update(): void {
    const dt = 1; // Fixed timestep

    if (this.gameState === 'simulating') {
      this.physics.update(dt);

      if (!isMoving(this.physics.balls)) {
        this.onTurnEnd();
      }
    }

    // Update cue ball position for input handler
    if (!this.cueBall.isPocketed) {
      this.input.setCueBallPos(this.cueBall.pos);
    }

    this.renderer.updateBalls(this.physics.balls);
  }

  private onTurnEnd(): void {
    const pocketed = this.physics.pocketedThisTurn;
    const cuePocketed = pocketed.includes(0);
    const objectBallsPocketed = pocketed.filter(id => id !== 0);

    // Russian billiards scoring:
    // Each pocketed ball counts as 1 point
    // First to 8 wins
    let foul = false;
    let scored = false;

    // Foul: cue ball pocketed
    if (cuePocketed) {
      foul = true;
      this.renderer.showMessage('Фол! Биток в лузе', 2500);
    }

    // Foul: no ball hit
    if (!foul && this.physics.firstHitBallId === -1 && !cuePocketed) {
      foul = true;
      this.renderer.showMessage('Фол! Нет касания', 2500);
    }

    if (foul) {
      // Any pocketed object balls on a foul get re-spotted
      for (const id of objectBallsPocketed) {
        this.respotBall(id);
      }

      if (cuePocketed) {
        // Ball in hand behind head string
        this.gameState = 'ball_in_hand';
        this.input.enableBallInHand();
        this.cueBall.isPocketed = false;
        this.cueBall.pos = vec2(TABLE_WIDTH / 2, TABLE_HEIGHT * 0.75);
        this.cueBall.vel = vec2(0, 0);
        this.cueBall.spin = vec2(0, 0);
        this.renderer.showMessage('Поставьте биток', 0);
      }

      this.switchPlayer();
    } else if (objectBallsPocketed.length > 0) {
      // Scored!
      scored = true;
      this.scores[this.currentPlayer - 1] += objectBallsPocketed.length;
      this.renderer.updateScore(this.scores[0], this.scores[1]);

      const ballWord = objectBallsPocketed.length === 1 ? 'шар' : 'шара';
      this.renderer.showMessage(
        `Игрок ${this.currentPlayer}: ${objectBallsPocketed.length} ${ballWord}!`, 2000
      );

      // Check win condition (first to 8)
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

    // Find a free spot near the foot spot
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
    // Reset all balls
    const newBalls = createBalls();
    for (let i = 0; i < this.physics.balls.length; i++) {
      Object.assign(this.physics.balls[i], newBalls[i]);
    }

    this.cueBall = this.physics.balls[0];
    this.scores = [0, 0];
    this.currentPlayer = 1;
    this.renderer.updateScore(0, 0);
    this.renderer.updateTurn(1);
    this.gameState = 'waiting';
    this.input.resetToIdle();
    this.renderer.showMessage('Новая игра!', 2000);
  }
}
