import { Game } from './game';
import { Renderer } from './renderer';

export type GameMode = 'free_play' | 'vs_computer' | 'puzzles';

async function main(): Promise<void> {
  try {
    const renderer = new Renderer();
    await renderer.init();
    showMenu(renderer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    document.body.style.color = 'white';
    document.body.style.padding = '20px';
    document.body.style.fontFamily = 'monospace';
    document.body.innerText = 'Error: ' + msg + '\n\n' + (e instanceof Error ? e.stack || '' : '');
    console.error(e);
  }
}

function showMenu(renderer: Renderer): void {
  renderer.showMenu();

  const canvas = renderer.app.view as HTMLCanvasElement;

  const handleClick = (screenX: number, screenY: number) => {
    const mode = renderer.getMenuButtonAt({ x: screenX, y: screenY });
    if (!mode) return;

    canvas.removeEventListener('touchstart', onTouch);
    canvas.removeEventListener('mousedown', onMouse);
    renderer.hideMenu();

    startGame(renderer, mode as GameMode);
  };

  const onTouch = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    handleClick(t.clientX, t.clientY);
  };
  const onMouse = (e: MouseEvent) => {
    handleClick(e.clientX, e.clientY);
  };

  canvas.addEventListener('touchstart', onTouch, { passive: false });
  canvas.addEventListener('mousedown', onMouse);
}

function startGame(renderer: Renderer, mode: GameMode): void {
  if (mode === 'vs_computer' || mode === 'puzzles') {
    renderer.showMessage('Скоро! Пока доступна свободная игра.', 3000);
    // Fall back to free play after a short delay
    setTimeout(() => {
      const game = new Game(renderer, 'free_play', () => showMenu(renderer));
      game.start();
    }, 1500);
    return;
  }

  const game = new Game(renderer, mode, () => showMenu(renderer));
  game.start();
}

main();
