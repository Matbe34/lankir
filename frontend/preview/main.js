// Preview bootstrap: waits for the real app to finish starting, then runs the
// scene named by ?scene= against it and flags html[data-scene-ready].
import { appReadyPromise } from './backend.mock.js';
import { SCENES, nextFrame } from './scenes.js';

const name = new URLSearchParams(location.search).get('scene') || 'welcome';

(async () => {
  await appReadyPromise;
  await nextFrame();
  try {
    const scene = SCENES[name];
    if (!scene) throw new Error(`unknown scene "${name}"; known: ${Object.keys(SCENES).join(', ')}`);
    await scene();
  } catch (error) {
    console.error('preview scene failed:', error);
    document.documentElement.dataset.sceneError = String(error?.message ?? error);
  }
  document.documentElement.dataset.sceneReady = '1';
})();
