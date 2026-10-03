import {config, userId} from './config.js';

export function apiUrl(path) { return `${config.apiBase}${path}`; }
export function runUrl(id, events = false) { return apiUrl(`/curio/runs/${encodeURIComponent(id)}${events ? '/events' : ''}?user_id=${encodeURIComponent(userId)}`); }
export function websocketUrl() { return `${config.wsBase}/live/ws/${encodeURIComponent(userId)}`; }
export async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path.startsWith('http') ? path : apiUrl(path), {...options, signal: controller.signal, headers:{'X-Curio-User-Id': userId, ...options.headers}});
    let data; try { data = await response.json(); } catch { throw new Error('Curio returned an unreadable response. Please try again.'); }
    if (!response.ok) {
      const details = typeof data.detail === 'string' ? data.detail : null;
      throw new Error(details || ({404:'This request could not be found.', 422:'Please check the fields and try again.', 503:'Curio’s storage is unavailable. Please try again shortly.'}[response.status]) || 'Curio could not process this request. Please try again.');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Curio is taking too long to connect. Check that the backend is running.');
    if (error instanceof TypeError) throw new Error('Curio is offline. Check the backend connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const runStatus = (id) => request(runUrl(id));
export const listMemories = () => request(`/memory/${encodeURIComponent(userId)}`);
export const jsonPost = (path, body) => request(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
export function runForm({text, image, conversationId, mode, location, requestId}) {
  const data = new FormData(); data.set('message', text); data.set('user_id', userId); data.set('request_id', requestId); data.set('mode', mode);
  if (conversationId) data.set('conversation_id', conversationId);
  if (image) data.set('image', image);
  if (location) { data.set('latitude', String(location.latitude)); data.set('longitude', String(location.longitude)); }
  return data;
}
export function validateImage(file) {
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WEBP, or GIF image.');
  if (!file.size) throw new Error('That image is empty.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
}
