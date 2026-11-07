/**
 * sunscrap v2 — dom (ESM)
 * Utilitas DOM bersama: selektor, debounce, toast, dan modal (focus-trap + restore).
 */
import { esc } from './helpers.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- toast ----------
export function toast(message, kind = '') {
  const root = $('#toast-root');
  if (!root) return;
  const icons = {
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/></svg>',
    ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  };
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.setAttribute('role', 'status');
  node.innerHTML = (icons[kind] || icons.info) + '<span>' + esc(message) + '</span>';
  root.appendChild(node);
  while (root.children.length > 3) root.removeChild(root.firstChild);
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4200);
}

// ---------- modal ----------
let lastFocusElement = null;

export function openModal(html) {
  const root = $('#modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
  const backdrop = $('.modal-backdrop', root);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  lastFocusElement = document.activeElement;
  const first = $('.modal [data-close], .modal input, .modal select, .modal textarea, .modal button', root);
  if (first) first.focus();
  document.body.classList.add('modal-open');
}

export function closeModal() {
  const root = $('#modal-root');
  if (!root) return;
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (lastFocusElement && typeof lastFocusElement.focus === 'function') lastFocusElement.focus();
  lastFocusElement = null;
}

/** Kerangka modal standar: head (title + tombol tutup) + body + foot. */
export function modalShell({ title, body, foot }) {
  return `
    <div class="modal-head"><h3>${title}</h3><button class="iconbtn" data-close aria-label="Tutup"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
}

// Delegasi global: klik [data-close] menutup modal.
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

// Keyboard modal: Escape menutup; Tab menjebak fokus di dalam dialog.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); return; }
  const modal = document.querySelector('#modal-root.open .modal');
  if (!modal) return;
  if (e.key === 'Tab') {
    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
