import {
  Ball, PhysicsEngine, createBalls, createPockets,
  shootCueBall, isMoving, vec2, vecSub, vecLen,
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, SpinParams, Vec2
} from './physics';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { AI } from './ai';
import type { GameMode } from './main';

// penalty_selection: opponent chooses a штрафной ball after foul
type GameState = 'waiting' | 'simulating' | 'penalty_selection' | 'game_over' | 'ai_thinking';

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
    this.renderer.clearPenaltyHighlight();
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

  // AI selects a штрафной ball (takes any non-pocketed ball as penalty)
  private triggerAiPenaltySelection(): void {
    if (!this.ai) return;
    this.gameState = 'ai_thinking';
    this.renderer.showMessage('Компьютер берёт штрафной шар...', 0);

    this.aiTimeoutId = window.setTimeout(() => {
      this.aiTimeoutId = null;
      const available = this.physics.balls.filter(b => !b.isPocketed);
      if (available.length > 0) {
        // AI picks a random available ball
        const chosen = available[Math.floor(Math.random() * available.length)];
        this.handlePenaltyBallSelected(chosen.id);
      } else {
        this.startTurn();
      }
    }, 800);
  }

  private setupInputCallbacks(): void {
    // Which ball to use as биток (striker)
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

    // Which ball to take as штрафной during penalty selection
    this.input.findBallIdAtScreen = (screenPos: Vec2): number | null => {
      if (this.gameState !== 'penalty_selection' || this.isAiTurn()) return null;

      const hitRadius = Math.max(30, BALL_RADIUS * this.renderer.camZoom + 20);

      for (const ball of this.physics.balls) {
        if (ball.isPocketed) continue;
        const ballScreen = this.renderer.tableToScreen(ball.pos.x, ball.pos.y);
        const dist = vecLen(vecSub(screenPos, ballScreen));
        if (dist < hitRadius) {
          return ball.id;
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

    this.input.onCancelAim = () => {};

    this.input.onAimUpdate = (direction, power) => {
      if (this.gameState !== 'waiting') return;

      const traj = this.physics.predictTrajectory(
        this.activeBall.pos, direction, power, 200, this.activeBall.id
      );
      this.renderer.drawAimLine(traj, power);
      this.renderer.drawPowerBar(power);
    };

    // Callback when opponent selects a штрафной ball
    this.input.onPenaltyBallSelect = (ballId: number) => {
      this.handlePenaltyBallSelected(ballId);
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
    const hadContact = this.physics.firstHitBallId !== -1;
    // Valid shot (правильный удар, п.20): биток коснулся прицельного И
    // после касания хотя бы один шар упал в лузу ИЛИ коснулся борта
    const hadResultAfterContact = pocketed.length > 0 || this.physics.cushionHitsAfterContact > 0;
    const isValidShot = hadContact && hadResultAfterContact;

    if (!isValidShot) {
      // ФОЛ — штраф: неправильно забитые шары возвращаются,
      // соперник снимает любой шар со стола (штрафной шар)
      const foulMsg = !hadContact
        ? 'Фол! Нет касания прицельного шара'
        : 'Фол! После касания нет результата';

      // Вернуть неправильно забитые шары на стол
      if (pocketed.length > 0) {
        this.returnBallsToTable(pocketed);
      }

      // Передать ход сопернику
      this.switchPlayer();
      this.renderer.showMessage(foulMsg, 2000);

      // Заблокировать ввод на время сообщения, потом — выбор штрафного шара
      this.gameState = 'ai_thinking';
      this.aiTimeoutId = window.setTimeout(() => {
        this.aiTimeoutId = null;
        this.enterPenaltySelection();
      }, 2000);
      return;
    }

    // Правильный удар: засчитать все забитые шары
    if (pocketed.length > 0) {
      for (const id of pocketed) {
        this.pocketedByPlayer[this.currentPlayer - 1].push(id);
      }

      this.renderer.updatePocketed(
        this.pocketedByPlayer[0],
        this.pocketedByPlayer[1],
        this.mode === 'vs_computer'
      );

      const playerName = this.isAiTurn() ? 'Компьютер' : (this.mode === 'vs_computer' ? 'Вы' : `Игрок ${this.currentPlayer}`);
      const count = pocketed.length;
      const word = count === 1 ? 'шар' : (count < 5 ? 'шара' : 'шаров');
      this.renderer.showMessage(`${playerName}: +${count} ${word}!`, 2000);

      // Проверка победы (8 очков)
      if (this.pocketedByPlayer[this.currentPlayer - 1].length >= 8) {
        this.gameState = 'game_over';
        const winner = this.isAiTurn() ? 'Компьютер победил!' : 'Вы победили!';
        const winMsg = this.mode === 'vs_computer' ? winner : `Игрок ${this.currentPlayer} победил!`;
        this.renderer.showMessage(winMsg, 0);
        setTimeout(() => this.resetGame(), 5000);
        return;
      }

      // Забитые шары → продолжить ход (право выбора битка)
      this.continueTurn();
    } else {
      // Правильный удар, ничего не забито → смена хода
      this.switchPlayer();
      this.startTurn();
    }
  }

  // Выставить шары обратно на стол после фола (п.25 Общих правил)
  private returnBallsToTable(ballIds: number[]): void {
    const baseX = TABLE_WIDTH * 0.73; // зона пирамиды
    const baseY = TABLE_HEIGHT / 2;

    for (let i = 0; i < ballIds.length; i++) {
      const ball = this.physics.balls.find(b => b.id === ballIds[i]);
      if (!ball) continue;

      let placed = false;
      for (let attempt = 0; attempt < 64 && !placed; attempt++) {
        const angle = (attempt / 8) * Math.PI * 2;
        const radius = (Math.floor(attempt / 8) + 1) * BALL_RADIUS * 2.5;
        const x = Math.max(BALL_RADIUS, Math.min(TABLE_WIDTH - BALL_RADIUS, baseX + Math.cos(angle) * radius));
        const y = Math.max(BALL_RADIUS, Math.min(TABLE_HEIGHT - BALL_RADIUS, baseY + Math.sin(angle) * radius));

        let overlap = false;
        for (const other of this.physics.balls) {
          if (other.isPocketed || other.id === ball.id) continue;
          const dx = other.pos.x - x;
          const dy = other.pos.y - y;
          if (Math.sqrt(dx * dx + dy * dy) < BALL_RADIUS * 2.2) {
            overlap = true;
            break;
          }
        }

        if (!overlap) {
          ball.pos = vec2(x, y);
          ball.isPocketed = false;
          ball.vel = vec2(0, 0);
          ball.spin = vec2(0, 0);
          placed = true;
        }
      }

      if (!placed) {
        ball.pos = vec2(Math.min(TABLE_WIDTH - BALL_RADIUS, baseX + i * BALL_RADIUS * 3), baseY);
        ball.isPocketed = false;
        ball.vel = vec2(0, 0);
        ball.spin = vec2(0, 0);
      }
    }
  }

  // Соперник выбирает штрафной шар (п.6 Свободной пирамиды)
  private enterPenaltySelection(): void {
    if (this.gameState === 'game_over') return;

    const available = this.physics.balls.filter(b => !b.isPocketed);
    if (available.length === 0) {
      this.startTurn();
      return;
    }

    if (this.isAiTurn()) {
      this.triggerAiPenaltySelection();
    } else {
      this.gameState = 'penalty_selection';
      this.input.enablePenaltySelection();
      this.renderer.drawPenaltyHighlight(this.physics.balls);
      const playerName = this.mode === 'vs_computer' ? 'Вы' : `Игрок ${this.currentPlayer}`;
      this.renderer.showMessage(`${playerName}: выберите штрафной шар`, 0);
    }
  }

  // Обработка выбора штрафного шара
  private handlePenaltyBallSelected(ballId: number): void {
    if (this.gameState === 'game_over') return;

    const ball = this.physics.balls.find(b => b.id === ballId);
    if (!ball || ball.isPocketed) return;

    this.renderer.clearPenaltyHighlight();

    // Снять шар со стола, занести на полку победителя (+1 очко)
    ball.isPocketed = true;
    ball.pos = vec2(-100, -100);
    ball.vel = vec2(0, 0);
    ball.spin = vec2(0, 0);

    this.pocketedByPlayer[this.currentPlayer - 1].push(ballId);
    this.renderer.updatePocketed(
      this.pocketedByPlayer[0],
      this.pocketedByPlayer[1],
      this.mode === 'vs_computer'
    );

    const playerName = this.isAiTurn() ? 'Компьютер' : (this.mode === 'vs_computer' ? 'Вы' : `Игрок ${this.currentPlayer}`);
    this.renderer.showMessage(`${playerName} взял штрафной шар! +1 очко`, 2000);

    // Проверка победы
    if (this.pocketedByPlayer[this.currentPlayer - 1].length >= 8) {
      this.gameState = 'game_over';
      const winner = this.isAiTurn() ? 'Компьютер победил!' : 'Вы победили!';
      const winMsg = this.mode === 'vs_computer' ? winner : `Игрок ${this.currentPlayer} победил!`;
      this.renderer.showMessage(winMsg, 0);
      setTimeout(() => this.resetGame(), 5000);
      return;
    }

    // После получения штрафного — текущий игрок бьёт
    this.gameState = 'ai_thinking';
    this.aiTimeoutId = window.setTimeout(() => {
      this.aiTimeoutId = null;
      this.startTurn();
    }, 2000);
  }

  // Найти первый доступный шар (предпочтительно желтый биток)
  private getDefaultActiveBall(): Ball {
    const cue = this.physics.balls[0];
    if (!cue.isPocketed) return cue;
    return this.physics.balls.find(b => !b.isPocketed) || cue;
  }

  private startTurn(): void {
    this.renderer.clearPenaltyHighlight();
    this.activeBall = this.getDefaultActiveBall();
    if (this.isAiTurn()) {
      this.triggerAiTurn();
    } else {
      this.gameState = 'waiting';
      this.input.resetToIdle();
    }
  }

  private continueTurn(): void {
    this.renderer.clearPenaltyHighlight();
    this.activeBall = this.getDefaultActiveBall();
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
