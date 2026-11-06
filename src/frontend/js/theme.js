/** sunscrap v2 — tema (sistem/terang/gelap) & kepadatan tabel. */
import { $ } from './dom.js';
import { densityForWidth } from './helpers.js';

export function applyTheme(theme) {
  if (theme !== 'dark' && theme !== 'light' && theme !== 'system') theme = 'system';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('sa_theme', theme); } catch { /* non-kritis */ }
  try { if (window.sunscrap && window.sunscrap.setTheme) window.sunscrap.setTheme(dark ? 'dark' : 'light'); } catch { /* non-kritis */ }
  const radio = document.querySelector(`.theme-radio[data-theme="${theme}"]`);
  if (radio) radio.checked = true;
}

export function applyDensity(density) {
  const mode = density === 'auto' ? 'auto' : (['padat', 'normal', 'lapang'].includes(density) ? density : 'auto');
  const resolved = mode === 'auto' ? densityForWidth(window.innerWidth) : mode;
  document.documentElement.dataset.density = resolved;
  try { localStorage.setItem('sa_density', mode); } catch { /* non-kritis */ }
  const sel = $('#density-select');
  if (sel) sel.value = mode;
}

export function initThemeWatchers() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const t = document.documentElement.dataset.theme || 'system';
    if (t === 'system') applyTheme('system');
  });
  window.addEventListener('resize', () => {
    const sel = $('#density-select');
    if (sel && sel.value === 'auto') applyDensity('auto');
  });
}
