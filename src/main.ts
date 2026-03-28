import { Game } from './game';

async function main(): Promise<void> {
  try {
    const game = new Game();
    await game.start();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    document.body.style.color = 'white';
    document.body.style.padding = '20px';
    document.body.style.fontFamily = 'monospace';
    document.body.innerText = 'Error: ' + msg + '\n\n' + (e instanceof Error ? e.stack || '' : '');
    console.error(e);
  }
}

main();
