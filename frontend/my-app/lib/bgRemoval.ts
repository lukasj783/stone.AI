let _mod: any = null;

async function loadModule() {
  if (_mod) return _mod;
  // dynamic import to avoid SSR and large initial bundles
  _mod = await import('@imgly/background-removal');
  return _mod;
}

export async function preload(config?: any) {
  const mod = await loadModule();
  if (mod && typeof mod.preload === 'function') {
    return mod.preload(config);
  }
  return Promise.resolve();
}

export async function removeBackgroundFromSource(imageSrc: any, config?: any): Promise<Blob> {
  const mod = await loadModule();
  // default export in the package is the main removal function
  const remover = mod && (mod.default || mod.removeBackground || mod);
  if (typeof remover !== 'function') throw new Error('Background removal module not available');
  const result = await remover(imageSrc, config);
  return result;
}

export default {
  preload,
  removeBackgroundFromSource,
};
