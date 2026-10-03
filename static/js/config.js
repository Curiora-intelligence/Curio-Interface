export const config = Object.freeze(JSON.parse(document.querySelector('#curio-config').textContent));
export const storage = {
  read(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing remains usable. */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { } },
};
let identity = 'demo-sai';
try { identity = localStorage.getItem('curio_user_id') || identity; if (identity.length > 128) identity = 'demo-sai'; localStorage.setItem('curio_user_id', identity); } catch { }
export const userId = identity;
export const modes = { Personal: 'general', Food: 'discovery', Shopping: 'shopping', Research: 'general', Career: 'general', Interview: 'interview' };
export const $ = (selector) => document.querySelector(selector);
export const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
export function notice(message = '') { $('#notice').textContent = message; $('#notice').hidden = !message; }
export function element(tag, className, text) { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; }
