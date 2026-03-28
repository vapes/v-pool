import { Game } from './game';

async function main(): Promise<void> {
  const game = new Game();
  await game.start();
}

main().catch(console.error);
