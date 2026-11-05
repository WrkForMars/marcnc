// Integración con la app de escritorio (Tauri). En el navegador estas funciones no se usan.

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Pide la ruta con el diálogo nativo de "Guardar como" y escribe el texto.
 * @returns {Promise<string|null>} ruta guardada, o null si el usuario canceló
 */
export async function saveTextDesktop(name, text) {
  const [{ save }, { invoke }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core')]);
  const ruta = await save({ defaultPath: name, filters: [{ name: 'Código G', extensions: ['txt', 'nc', 'gcode'] }] });
  if (!ruta) return null;
  await invoke('guardar_texto', { ruta, texto: text });
  return ruta;
}
