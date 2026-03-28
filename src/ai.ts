import {
  Ball, Pocket, Vec2, vec2, vecSub, vecAdd, vecScale, vecNorm, vecLen, vecDist, vecDot,
  BALL_RADIUS, TABLE_WIDTH, TABLE_HEIGHT, SpinParams
} from './physics';

interface ShotCandidate {
  striker: Ball;       // ball to hit with
  target: Ball;        // ball to pocket (can be same as striker for свояк)
  pocket: Pocket;
  direction: Vec2;     // aim direction for the striker
  power: number;
  score: number;       // higher = better
}

export class AI {
  private difficulty: number; // 0-1, affects accuracy

  constructor(difficulty: number = 0.6) {
    this.difficulty = difficulty;
  }

  /**
   * Find the best shot given current ball positions.
   * Returns direction, power, chosen striker ball, and optional spin.
   */
  findBestShot(
    balls: Ball[],
    pockets: Pocket[],
    pyramidBroken: boolean
  ): { striker: Ball; direction: Vec2; power: number; spin: SpinParams } {
    const candidates: ShotCandidate[] = [];

    // Which balls can be used as strikers
    const strikers = balls.filter(b => {
      if (b.isPocketed) return false;
      if (!pyramidBroken) return b.isCue;
      return true;
    });

    // Which balls can be targets (all non-pocketed balls)
    const targets = balls.filter(b => !b.isPocketed);

    for (const striker of strikers) {
      for (const target of targets) {
        if (target.id === striker.id) continue; // skip self (can't pocket yourself directly)

        for (const pocket of pockets) {
          const shot = this.evaluateShot(striker, target, pocket, balls);
          if (shot) candidates.push(shot);
        }
      }

      // Evaluate свояк (direct pocket of striker)
      for (const pocket of pockets) {
        const shot = this.evaluateSvoyak(striker, pocket, balls);
        if (shot) candidates.push(shot);
      }
    }

    // Sort by score (best first)
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const best = candidates[0];
      // Add inaccuracy based on difficulty
      const inaccuracy = (1 - this.difficulty) * 0.08;
      const angle = Math.atan2(best.direction.y, best.direction.x);
      const randomAngle = angle + (Math.random() - 0.5) * inaccuracy;
      const dir = vec2(Math.cos(randomAngle), Math.sin(randomAngle));

      const powerJitter = 1 + (Math.random() - 0.5) * (1 - this.difficulty) * 0.2;
      const power = Math.max(0.1, Math.min(1, best.power * powerJitter));

      return {
        striker: best.striker,
        direction: dir,
        power,
        spin: { x: 0, y: 0 },
      };
    }

    // Fallback: random safety shot with cue ball
    const cue = balls.find(b => b.isCue && !b.isPocketed) || strikers[0];
    const angle = Math.random() * Math.PI * 2;
    return {
      striker: cue,
      direction: vec2(Math.cos(angle), Math.sin(angle)),
      power: 0.3 + Math.random() * 0.3,
      spin: { x: 0, y: 0 },
    };
  }

  /**
   * Evaluate a shot: striker hits target, target goes into pocket.
   * Uses ghost ball aiming.
   */
  private evaluateShot(
    striker: Ball, target: Ball, pocket: Pocket, allBalls: Ball[]
  ): ShotCandidate | null {
    // Direction from target to pocket
    const targetToPocket = vecSub(pocket.pos, target.pos);
    const distToPocket = vecLen(targetToPocket);
    if (distToPocket < BALL_RADIUS) return null; // too close

    const targetToPocketDir = vecNorm(targetToPocket);

    // Ghost ball position: where striker needs to be to send target toward pocket
    const ghostPos = vecSub(target.pos, vecScale(targetToPocketDir, BALL_RADIUS * 2));

    // Direction from striker to ghost ball
    const strikerToGhost = vecSub(ghostPos, striker.pos);
    const distToGhost = vecLen(strikerToGhost);
    if (distToGhost < BALL_RADIUS) return null; // already overlapping

    const direction = vecNorm(strikerToGhost);

    // Check if path from striker to ghost is clear
    if (!this.isPathClear(striker.pos, ghostPos, allBalls, [striker.id, target.id])) {
      return null;
    }

    // Check if path from target to pocket is clear
    if (!this.isPathClear(target.pos, pocket.pos, allBalls, [striker.id, target.id])) {
      return null;
    }

    // Score the shot
    let score = 100;

    // Closer target-to-pocket is better
    score -= distToPocket * 0.02;

    // Closer striker-to-target is better
    score -= distToGhost * 0.01;

    // Straighter cut angle is better
    const cutAngle = Math.acos(Math.max(-1, Math.min(1, vecDot(
      vecNorm(vecSub(ghostPos, target.pos)),
      vecNorm(vecSub(pocket.pos, target.pos))
    ))));
    // cutAngle near PI means straight shot (ghost behind target relative to pocket)
    const straightness = Math.abs(cutAngle - Math.PI) / Math.PI;
    score -= straightness * 40;

    // Tight pockets penalty for wide angles
    if (straightness > 0.3) score -= 20;

    // Corner pockets slightly preferred (bigger opening)
    const isCorner = pocket.pos.x < 100 || pocket.pos.x > TABLE_WIDTH - 100;
    if (isCorner) score += 5;

    if (score < 0) return null;

    // Power: based on distances
    const totalDist = distToGhost + distToPocket;
    const power = Math.max(0.15, Math.min(0.85, totalDist / 4000));

    return { striker, target, pocket, direction, power, score };
  }

  /**
   * Evaluate a свояк: striker goes directly into pocket.
   */
  private evaluateSvoyak(
    striker: Ball, pocket: Pocket, allBalls: Ball[]
  ): ShotCandidate | null {
    const toPocket = vecSub(pocket.pos, striker.pos);
    const dist = vecLen(toPocket);
    if (dist < BALL_RADIUS * 2 || dist > 2500) return null;

    const direction = vecNorm(toPocket);

    // Need to hit another ball first in свободная пирамида
    // Find the closest ball in the general direction
    let hitsAnyBall = false;
    for (const b of allBalls) {
      if (b.id === striker.id || b.isPocketed) continue;
      // Check if ball is roughly on the way or near
      const toBall = vecSub(b.pos, striker.pos);
      const proj = vecDot(toBall, direction);
      if (proj > 0 && proj < dist) {
        const perpDist = vecLen(vecSub(toBall, vecScale(direction, proj)));
        if (perpDist < BALL_RADIUS * 2.5) {
          hitsAnyBall = true;
          break;
        }
      }
    }

    // Свояк needs to touch another ball first (or after)
    // For simplicity, only consider if there's a ball in the path
    if (!hitsAnyBall) return null;

    // Check clear path to pocket (except for the ball we'll hit)
    let score = 60; // свояк is riskier, lower base score
    score -= dist * 0.02;

    // Corner pockets easier
    const isCorner = pocket.pos.x < 100 || pocket.pos.x > TABLE_WIDTH - 100;
    if (isCorner) score += 5;

    if (score < 10) return null;

    const power = Math.max(0.2, Math.min(0.7, dist / 3500));

    return { striker, target: striker, pocket, direction, power, score };
  }

  /**
   * Check if path between two points is clear of other balls.
   */
  private isPathClear(from: Vec2, to: Vec2, allBalls: Ball[], excludeIds: number[]): boolean {
    const dir = vecSub(to, from);
    const dist = vecLen(dir);
    if (dist < 1) return true;
    const normDir = vecNorm(dir);

    for (const ball of allBalls) {
      if (ball.isPocketed || excludeIds.includes(ball.id)) continue;

      const toBall = vecSub(ball.pos, from);
      const proj = vecDot(toBall, normDir);

      // Only check balls between from and to
      if (proj < BALL_RADIUS || proj > dist - BALL_RADIUS) continue;

      const perpDist = vecLen(vecSub(toBall, vecScale(normDir, proj)));
      if (perpDist < BALL_RADIUS * 2.2) {
        return false; // blocked
      }
    }
    return true;
  }

  /**
   * Find a good position to place the cue ball (ball in hand).
   */
  findBallInHandPosition(balls: Ball[], pockets: Pocket[]): Vec2 {
    let bestPos = vec2(TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2);
    let bestScore = -Infinity;

    // Try several candidate positions
    for (let i = 0; i < 30; i++) {
      const x = BALL_RADIUS * 2 + Math.random() * (TABLE_WIDTH - BALL_RADIUS * 4);
      const y = BALL_RADIUS * 2 + Math.random() * (TABLE_HEIGHT - BALL_RADIUS * 4);
      const pos = vec2(x, y);

      // Check not overlapping other balls
      let valid = true;
      for (const b of balls) {
        if (b.isPocketed || b.isCue) continue;
        if (vecDist(pos, b.pos) < BALL_RADIUS * 2.5) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;

      // Score: closer to non-pocketed balls + good angles to pockets
      let score = 0;
      for (const b of balls) {
        if (b.isPocketed || b.isCue) continue;
        const dist = vecDist(pos, b.pos);
        if (dist < 300) score += 10; // close to balls is good
        for (const p of pockets) {
          const toPocket = vecNorm(vecSub(p.pos, b.pos));
          const ghostPos = vecSub(b.pos, vecScale(toPocket, BALL_RADIUS * 2));
          const toGhost = vecDist(pos, ghostPos);
          if (toGhost < 500) score += 20 - toGhost * 0.02;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }

    return bestPos;
  }
}
