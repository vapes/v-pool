// Russian billiards physics engine
// Table: 3550mm x 1775mm (12-foot table)
// Balls: 68mm diameter (vs 57.2mm in pool)
// Pockets: 72-73mm (barely larger than balls!)

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vecSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vecScale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vecLen(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vecNorm(v: Vec2): Vec2 {
  const l = vecLen(v);
  if (l < 0.0001) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function vecDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vecDist(a: Vec2, b: Vec2): number {
  return vecLen(vecSub(a, b));
}

export function vecRotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// Physics constants (all in game units where 1 unit ≈ 1mm)
export const TABLE_WIDTH = 3550;   // mm (playing surface)
export const TABLE_HEIGHT = 1775;  // mm
export const BALL_RADIUS = 34;     // mm (68mm diameter)
export const BALL_MASS = 0.280;    // kg (280g for Russian billiards)

// Pocket positions and size
// Russian billiards pockets are notoriously tight: ~72-73mm opening
export const POCKET_RADIUS = 37;   // slightly larger than ball radius (34mm)

// Cushion elasticity
export const CUSHION_RESTITUTION = 0.75;
// Ball-ball restitution
export const BALL_RESTITUTION = 0.95;

// Friction: deceleration in velocity-units per frame
// At max power ball should roll ~4-5 seconds (240-300 frames)
export const FRICTION_DECEL = 0.15;
export const SPIN_DECAY = 0.985;

// Maximum shot power (velocity in mm/frame at 60fps)
// Real break shot: ~8-10 m/s = 480-600 mm/s ÷ 60fps = 8-10 mm/frame
// But we use higher value for game feel on a 3550mm table
export const MAX_SHOT_POWER = 200;

export interface Ball {
  id: number;
  pos: Vec2;
  vel: Vec2;
  spin: Vec2;       // x = side spin, y = top/back spin
  angularVel: Vec2;  // angular velocity from spin
  radius: number;
  mass: number;
  isPocketed: boolean;
  isCue: boolean;
}

export interface Pocket {
  pos: Vec2;
  radius: number;
}

export interface SpinParams {
  x: number; // -1 to 1, side spin (english)
  y: number; // -1 to 1, top/back spin
}

// Russian billiards: 15 white numbered balls + 1 cue ball (yellow/ivory)
// In the pyramid game, all 15 balls are white/ivory, cue ball is slightly different
export function createBalls(): Ball[] {
  const balls: Ball[] = [];

  // Cue ball - at bottom of screen (small X → bottom in portrait with -90° rotation)
  balls.push({
    id: 0,
    pos: vec2(TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2),
    vel: vec2(0, 0),
    spin: vec2(0, 0),
    angularVel: vec2(0, 0),
    radius: BALL_RADIUS,
    mass: BALL_MASS,
    isPocketed: false,
    isCue: true,
  });

  // 15 balls in triangle (pyramid) at top of screen
  // Large X → top of screen in portrait with -90° rotation
  const startX = TABLE_WIDTH * 0.73;
  const startY = TABLE_HEIGHT / 2;
  const spacing = BALL_RADIUS * 2 + 1; // tight rack
  let id = 1;

  for (let row = 0; row < 5; row++) {
    const ballsInRow = row + 1;
    const rowOffsetY = -(row * spacing * Math.sin(Math.PI / 6));
    const rowX = startX + row * spacing * Math.cos(Math.PI / 6);
    for (let col = 0; col < ballsInRow; col++) {
      const x = rowX;
      const y = startY + rowOffsetY + col * spacing;
      balls.push({
        id,
        pos: vec2(x, y),
        vel: vec2(0, 0),
        spin: vec2(0, 0),
        angularVel: vec2(0, 0),
        radius: BALL_RADIUS,
        mass: BALL_MASS,
        isPocketed: false,
        isCue: false,
      });
      id++;
    }
  }

  return balls;
}

export function createPockets(): Pocket[] {
  // 6 pockets: 4 corners + 2 side
  const cushion = 0; // pockets are at the edge
  return [
    { pos: vec2(cushion, cushion), radius: POCKET_RADIUS },                          // top-left
    { pos: vec2(TABLE_WIDTH / 2, cushion - 5), radius: POCKET_RADIUS - 2 },          // top-center (tighter)
    { pos: vec2(TABLE_WIDTH - cushion, cushion), radius: POCKET_RADIUS },             // top-right
    { pos: vec2(cushion, TABLE_HEIGHT - cushion), radius: POCKET_RADIUS },            // bottom-left
    { pos: vec2(TABLE_WIDTH / 2, TABLE_HEIGHT - cushion + 5), radius: POCKET_RADIUS - 2 }, // bottom-center (tighter)
    { pos: vec2(TABLE_WIDTH - cushion, TABLE_HEIGHT - cushion), radius: POCKET_RADIUS },   // bottom-right
  ];
}

export function shootCueBall(ball: Ball, direction: Vec2, power: number, spin: SpinParams): void {
  const vel = vecScale(direction, power * MAX_SHOT_POWER);
  ball.vel = vel;

  // Apply spin - side spin affects angular velocity
  // top/back spin affects forward roll
  ball.spin = vec2(spin.x * power * 40, spin.y * power * 40);
  ball.angularVel = vec2(spin.x * power * 20, spin.y * power * 20);
}

export function isMoving(balls: Ball[]): boolean {
  for (const b of balls) {
    if (b.isPocketed) continue;
    if (vecLen(b.vel) > 0.05 || vecLen(b.spin) > 0.1) return true;
  }
  return false;
}

export interface TrajectoryResult {
  cuePath: Vec2[];           // cue ball path until collision
  objectBallDir: Vec2[];     // [contact point, end point] of object ball
  cueDeflection: Vec2[];     // cue ball path after collision
}

export class PhysicsEngine {
  balls: Ball[];
  pockets: Pocket[];
  pocketedThisTurn: number[] = [];
  firstHitBallId: number = -1;
  cushionHits: number = 0;
  firstContactMade: boolean = false;
  cushionHitsAfterContact: number = 0;
  activeBallId: number = 0; // which ball is being struck (any ball in Russian billiards)
  private substeps = 8;

  constructor(balls: Ball[], pockets: Pocket[]) {
    this.balls = balls;
    this.pockets = pockets;
  }

  resetTurnTracking(): void {
    this.pocketedThisTurn = [];
    this.firstHitBallId = -1;
    this.cushionHits = 0;
    this.firstContactMade = false;
    this.cushionHitsAfterContact = 0;
  }

  update(dt: number): void {
    const subDt = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      this.stepPhysics(subDt);
    }
  }

  private stepPhysics(dt: number): void {
    for (const ball of this.balls) {
      if (ball.isPocketed) continue;

      // Apply velocity
      ball.pos.x += ball.vel.x * dt;
      ball.pos.y += ball.vel.y * dt;

      // Apply spin effect on velocity (curved trajectory from side spin)
      const speed = vecLen(ball.vel);
      if (speed > 0.5) {
        // Side spin causes gradual curve
        const spinForce = ball.spin.x * 0.002 * dt;
        const perpDir = vecNorm({ x: -ball.vel.y, y: ball.vel.x });
        ball.vel.x += perpDir.x * spinForce * speed;
        ball.vel.y += perpDir.y * spinForce * speed;

        // Top/back spin transfers to velocity over time
        const velDir = vecNorm(ball.vel);
        const spinTransfer = ball.spin.y * 0.003 * dt;
        ball.vel.x += velDir.x * spinTransfer;
        ball.vel.y += velDir.y * spinTransfer;
      }

      // Friction
      if (speed > 0.1) {
        const frictionDecel = FRICTION_DECEL * dt;
        const newSpeed = Math.max(0, speed - frictionDecel);
        ball.vel = vecScale(vecNorm(ball.vel), newSpeed);
      } else {
        ball.vel = vec2(0, 0);
      }

      // Spin decay
      ball.spin = vecScale(ball.spin, Math.pow(SPIN_DECAY, dt * 60));
      if (vecLen(ball.spin) < 0.05) {
        ball.spin = vec2(0, 0);
      }
    }

    // Ball-ball collisions
    this.resolveBallCollisions();

    // Cushion collisions
    this.resolveCushionCollisions();

    // Pocket detection
    this.checkPockets();
  }

  private resolveBallCollisions(): void {
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i];
        const b = this.balls[j];
        if (a.isPocketed || b.isPocketed) continue;

        const dist = vecDist(a.pos, b.pos);
        const minDist = a.radius + b.radius;

        if (dist < minDist) {
          // Track first hit for the active (struck) ball
          if (this.firstHitBallId === -1) {
            if (a.id === this.activeBallId) {
              this.firstHitBallId = b.id;
              this.firstContactMade = true;
            } else if (b.id === this.activeBallId) {
              this.firstHitBallId = a.id;
              this.firstContactMade = true;
            }
          }

          // Separate overlapping balls
          const normal = vecNorm(vecSub(b.pos, a.pos));
          const overlap = minDist - dist;
          a.pos = vecSub(a.pos, vecScale(normal, overlap / 2));
          b.pos = vecAdd(b.pos, vecScale(normal, overlap / 2));

          // Elastic collision
          const relVel = vecSub(a.vel, b.vel);
          const relVelAlongNormal = vecDot(relVel, normal);

          // Only resolve if balls are moving towards each other
          if (relVelAlongNormal > 0) {
            const impulse = (relVelAlongNormal * (1 + BALL_RESTITUTION)) / (1 / a.mass + 1 / b.mass);
            const impulseVec = vecScale(normal, impulse);

            a.vel = vecSub(a.vel, vecScale(impulseVec, 1 / a.mass));
            b.vel = vecAdd(b.vel, vecScale(impulseVec, 1 / b.mass));

            // Transfer some spin on collision (throw effect)
            if (a.id === this.activeBallId && vecLen(a.spin) > 0.1) {
              const spinTransfer = 0.3;
              b.spin = vecAdd(b.spin, vecScale(a.spin, spinTransfer));
              a.spin = vecScale(a.spin, 1 - spinTransfer);
            } else if (b.id === this.activeBallId && vecLen(b.spin) > 0.1) {
              const spinTransfer = 0.3;
              a.spin = vecAdd(a.spin, vecScale(b.spin, spinTransfer));
              b.spin = vecScale(b.spin, 1 - spinTransfer);
            }
          }
        }
      }
    }
  }

  private resolveCushionCollisions(): void {
    for (const ball of this.balls) {
      if (ball.isPocketed) continue;

      // Check if ball is near a pocket - if so, don't bounce off cushion
      let nearPocket = false;
      for (const pocket of this.pockets) {
        if (vecDist(ball.pos, pocket.pos) < pocket.radius + ball.radius * 1.5) {
          nearPocket = true;
          break;
        }
      }
      if (nearPocket) continue;

      let bounced = false;

      // Left cushion
      if (ball.pos.x - ball.radius < 0) {
        ball.pos.x = ball.radius;
        ball.vel.x = -ball.vel.x * CUSHION_RESTITUTION;
        // Side spin affects bounce angle
        ball.vel.y += ball.spin.x * 0.4;
        bounced = true;
      }
      // Right cushion
      if (ball.pos.x + ball.radius > TABLE_WIDTH) {
        ball.pos.x = TABLE_WIDTH - ball.radius;
        ball.vel.x = -ball.vel.x * CUSHION_RESTITUTION;
        ball.vel.y -= ball.spin.x * 0.4;
        bounced = true;
      }
      // Top cushion
      if (ball.pos.y - ball.radius < 0) {
        ball.pos.y = ball.radius;
        ball.vel.y = -ball.vel.y * CUSHION_RESTITUTION;
        ball.vel.x += ball.spin.x * 0.4;
        bounced = true;
      }
      // Bottom cushion
      if (ball.pos.y + ball.radius > TABLE_HEIGHT) {
        ball.pos.y = TABLE_HEIGHT - ball.radius;
        ball.vel.y = -ball.vel.y * CUSHION_RESTITUTION;
        ball.vel.x -= ball.spin.x * 0.4;
        bounced = true;
      }

      if (bounced) {
        this.cushionHits++;
        if (this.firstContactMade) this.cushionHitsAfterContact++;
        // Cushion absorbs some spin
        ball.spin = vecScale(ball.spin, 0.6);
      }
    }
  }

  private checkPockets(): void {
    for (const ball of this.balls) {
      if (ball.isPocketed) continue;

      for (const pocket of this.pockets) {
        const dist = vecDist(ball.pos, pocket.pos);
        // Russian billiards: very tight pockets, ball must enter cleanly
        if (dist < pocket.radius) {
          // Check if ball is entering pocket at a reasonable angle for corner/side
          const toPocket = vecNorm(vecSub(pocket.pos, ball.pos));
          const ballDir = vecNorm(ball.vel);
          const alignment = vecDot(toPocket, ballDir);

          // Ball needs some velocity toward pocket to fall in (unless very close)
          if (dist < pocket.radius * 0.5 || alignment > 0.1 || vecLen(ball.vel) < 1) {
            ball.isPocketed = true;
            ball.vel = vec2(0, 0);
            ball.spin = vec2(0, 0);
            ball.pos = vec2(-100, -100);
            this.pocketedThisTurn.push(ball.id);
          }
        }
      }
    }
  }

  // Predict trajectory for aim line
  predictTrajectory(startPos: Vec2, direction: Vec2, power: number, maxSteps: number = 200, skipBallId: number = 0): TrajectoryResult {
    const cuePath: Vec2[] = [{ ...startPos }];
    const vel = vecScale(direction, power * MAX_SHOT_POWER);
    let pos = { ...startPos };
    let currentVel = { ...vel };
    const stepDt = 0.125;

    let objectBallDir: Vec2[] = [];
    let cueDeflection: Vec2[] = [];

    for (let i = 0; i < maxSteps; i++) {
      pos = vecAdd(pos, vecScale(currentVel, stepDt));

      // Check ball collision
      for (const ball of this.balls) {
        if (ball.isPocketed || ball.id === skipBallId) continue;
        if (vecDist(pos, ball.pos) < BALL_RADIUS * 2) {
          // Contact point: position the cue ball just touching the object ball
          const normal = vecNorm(vecSub(pos, ball.pos));
          const contactPos = vecAdd(ball.pos, vecScale(normal, BALL_RADIUS * 2));
          cuePath.push(contactPos);

          // Object ball goes in the direction from cue ball to object ball center
          const hitDir = vecNorm(vecSub(ball.pos, contactPos));
          const objSpeed = vecDot(currentVel, hitDir) * BALL_RESTITUTION;
          const objVel = vecScale(hitDir, objSpeed);
          const objEnd = vecAdd(ball.pos, vecScale(vecNorm(objVel), 600));
          objectBallDir = [{ ...ball.pos }, objEnd];

          // Cue ball deflects: subtract the component transferred to object ball
          const cueAfter = vecSub(currentVel, vecScale(hitDir, vecDot(currentVel, hitDir)));
          if (vecLen(cueAfter) > 0.5) {
            const deflEnd = vecAdd(contactPos, vecScale(vecNorm(cueAfter), 400));
            cueDeflection = [{ ...contactPos }, deflEnd];
          }

          return { cuePath, objectBallDir, cueDeflection };
        }
      }

      // Check cushion bounce
      if (pos.x - BALL_RADIUS < 0 || pos.x + BALL_RADIUS > TABLE_WIDTH) {
        currentVel.x = -currentVel.x * CUSHION_RESTITUTION;
        pos.x = Math.max(BALL_RADIUS, Math.min(TABLE_WIDTH - BALL_RADIUS, pos.x));
      }
      if (pos.y - BALL_RADIUS < 0 || pos.y + BALL_RADIUS > TABLE_HEIGHT) {
        currentVel.y = -currentVel.y * CUSHION_RESTITUTION;
        pos.y = Math.max(BALL_RADIUS, Math.min(TABLE_HEIGHT - BALL_RADIUS, pos.y));
      }

      // Friction
      const speed = vecLen(currentVel);
      if (speed > 0.3) {
        const frictionDecel = FRICTION_DECEL * stepDt;
        const newSpeed = Math.max(0, speed - frictionDecel);
        currentVel = vecScale(vecNorm(currentVel), newSpeed);
      } else {
        break;
      }

      cuePath.push({ ...pos });
    }

    return { cuePath, objectBallDir, cueDeflection };
  }
}
