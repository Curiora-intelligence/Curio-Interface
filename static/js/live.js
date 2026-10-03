import {cancelCurioSpeech} from './voice.js';
import { $, emit, modes, notice, element } from './config.js';
import { websocketUrl } from './api.js';
import { state, setMode, setBusy, addMessage, completeReply, failReply, renderAnswer } from './chat.js';

// Pure frame sizing is shared with the browser checks.
export function frameSize(width, height, maximum = 1280) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function captureJPEG(video) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  for (const limit of [1280, 960]) {
    Object.assign(canvas, frameSize(video.videoWidth, video.videoHeight, limit));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .6));
    if (blob && blob.size <= 512 * 1024) {
      const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { jpeg: url.split(',')[1], captured_at: Date.now() / 1000 };
    }
  }
  return null;
}

export class AudioMeter {
  constructor() { this.generation = 0; this.rms = []; this.speaking = 0; this.pauses = 0; this.duration = 0; }
  async start() {
    cancelCurioSpeech();
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw Error('Microphone access is not available in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw Error('Audio measurements are not supported in this browser.');
      this.context = new Context(); await this.context.resume();
      if (generation !== this.generation) { await this.stop(); return false; }
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
      this.values = new Float32Array(this.analyser.fftSize); this.rms = []; this.speaking = 0; this.pauses = 0; this.duration = 0; this.last = performance.now(); this.silent = 0; this.wasSpeaking = false;
      this.timer = setInterval(() => this.sample(), 100); return true;
    } catch (error) { await this.stop(); throw error; }
  }
  sample() {
    const now = performance.now(), dt = Math.min((now - this.last) / 1000, .5); this.last = now;
    this.analyser.getFloatTimeDomainData(this.values);
    const rms = Math.min(1, Math.sqrt(this.values.reduce((sum, v) => sum + v * v, 0) / this.values.length));
    this.rms.push(rms); if (this.rms.length > 600) this.rms.shift(); this.duration = Math.min(3600, this.duration + dt);
    if (rms > .015) { this.speaking = Math.min(this.duration, this.speaking + dt); this.wasSpeaking = true; this.silent = 0; }
    else { this.silent += dt; if (this.wasSpeaking && this.silent > .35) { this.pauses++; this.wasSpeaking = false; } }
    $('#metrics-help').textContent = `Sampling your answer · ${Math.round(this.duration)}s · ${this.pauses} pauses. No audio recording is uploaded.`;
    if (this.duration >= 3600) this.stop();
  }
  metrics() { return this.duration > 0 ? { duration_seconds: this.duration, speaking_seconds: Math.min(this.speaking, this.duration), pause_count: this.pauses, rms: this.rms.slice(-600) } : null; }
  async stop() { ++this.generation; clearInterval(this.timer); this.timer = null; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; const context = this.context; this.context = null; if (context && context.state !== 'closed') await context.close(); }
}

let socket = null, configured = false, inFlight = null, interval = 5000, nextFrame = 0, frameTimer = null, cameraStream = null, cameraGeneration = 0, encoding = false, reply = null, meter = null, recognition = null, recognitionButton = null;
let connectionTimer = null;
function status(text) { $('#live-state').textContent = text; }
function controls() {
  $('#live-send').disabled = !configured || !!inFlight;
  $('#live-mode').disabled = !!inFlight;
  $('#close-live').disabled = false;
  $('#audio-metrics-toggle').disabled = inFlight === 'reason';
}
function send(payload) { if (socket?.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify(payload)); return true; }
function configure() {
  configured = false; inFlight = 'configure'; controls();
  send({ type: 'configure', mode: $('#live-mode').value, ...(state.conversationId ? { conversation_id: state.conversationId } : {}), ...(state.location || {}) });
}
async function sampleFrame() {
  if (document.hidden || !configured || inFlight || encoding || !cameraStream || !$('#live-dialog').open || Date.now() < nextFrame) return;
  encoding = true; const generation = cameraGeneration;
  try {
    const frame = await captureJPEG($('#camera'));
    if (frame && generation === cameraGeneration && !inFlight && configured && $('#live-dialog').open) {
      inFlight = 'frame'; controls(); status('Understanding what you showed me…');
      if (!send({ type: 'frame', ...frame })) { inFlight = null; controls(); }
    }
  } catch { status('That frame could not be captured. Trying again shortly.'); }
  finally { encoding = false; nextFrame = Date.now() + interval; }
}
async function enableCamera() {
  const generation = ++cameraGeneration;
  $('#enable-camera').disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera access needs a supported browser on localhost or HTTPS.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    if (generation !== cameraGeneration || !$('#live-dialog').open) { stream.getTracks().forEach(t => t.stop()); return; }
    cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = stream; $('#camera').srcObject = stream; await $('#camera').play();
    $('#camera-empty').hidden = true; $('#camera-caption').hidden = false; nextFrame = 0; status('Curio is observing…'); sampleFrame();
  } catch (error) {
    cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null;
    $('#live-observation').textContent = error.name === 'NotAllowedError' ? 'Camera access was declined. You can still ask Curio a question. Enable camera access in your browser to try again.' : error.name === 'NotFoundError' ? 'No camera was found. You can still use Live questions.' : error.message;
  } finally { $('#enable-camera').disabled = false; }
}
function showObservation(data) {
  const observation = data.observation || {};
  if (observation.unavailable) { $('#live-observation').textContent = 'Curio couldn’t make out that frame. Try better light or another angle.'; return; }
  if (data.mode === 'interview') {
    const labels = { gaze_direction: 'Visible gaze', head_orientation: 'Head orientation', posture: 'Visible posture', facial_expressiveness: 'Visible facial movement' };
    $('#live-observation').textContent = Object.entries(labels).filter(([key]) => observation[key]).map(([key, label]) => `${label}: ${String(observation[key]).replaceAll('_', ' ')}`).join(' · ') || 'Waiting for a clear view.';
  } else {
    const details = [...(observation.objects || []), ...(observation.colors || []), ...(observation.visible_details || [])].slice(0, 6);
    $('#live-observation').textContent = details.length ? `In view: ${details.join(' · ')}` : 'Waiting for a clearer view.';
    if (observation.visible_text?.length) $('#live-observation').textContent += ` · Visible text: ${observation.visible_text.join(' · ')}`;
  }
}
function showMetrics(metrics) {
  const panel = $('#live-metrics'); panel.replaceChildren();
  const labels = { words_per_minute: 'Words / minute', pause_count: 'Pauses', speaking_ratio: 'Speaking ratio', rms_mean: 'Mean volume', rms_standard_deviation: 'Volume variation' };
  for (const [key, label] of Object.entries(labels)) if (Number.isFinite(metrics[key])) { const value = key === 'speaking_ratio' ? `${Math.round(metrics[key] * 100)}%` : metrics[key].toFixed(key.startsWith('rms') ? 3 : 0); panel.append(element('span', 'metric', `${label} · ${value}`)); }
  panel.hidden = !panel.children.length;
}
function handle(event) {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  if (data.type === 'ready') { clearTimeout(connectionTimer); interval = Math.max(5000, Number(data.frame_interval_seconds) * 1000 || 5000); configure(); return; }
  if (data.type === 'configured') { configured = true; inFlight = null; interval = Math.max(5000, Number(data.frame_interval_seconds) * 1000 || interval); nextFrame = Math.max(nextFrame, Date.now() + interval); status(cameraStream ? 'Curio is observing…' : 'Waiting for your question…'); controls(); return; }
  if (data.type === 'observation') { showObservation(data); inFlight = null; nextFrame = Date.now() + interval; status('Waiting for your question…'); }
  if (data.type === 'response') {
    if (reply) { completeReply(reply, data); reply = null; }
    renderAnswer($('#live-answer'), data.answer); inFlight = null; nextFrame = Date.now() + interval; status('Waiting for your question…');
  }
  if (data.type === 'metrics') showMetrics(data.metrics || {});
  if (data.type === 'pong') return;
  if (data.type === 'busy' || data.type === 'frame_skipped') {
    if (inFlight === 'reason' && reply) { failReply(reply, 'Curio is still busy. Your question was not accepted; please send it again when ready.'); reply = null; }
    inFlight = 'backoff'; nextFrame = Date.now() + interval; status('Curio is busy. Pausing sampled frames…');
    const currentSocket = socket; setTimeout(() => { if (socket === currentSocket && inFlight === 'backoff') { inFlight = null; controls(); } }, interval);
  }
  if (data.type === 'error') {
    const message = data.message || 'Curio could not process that event.'; status(message);
    if (reply) { failReply(reply, message); reply = null; } inFlight = null; nextFrame = Date.now() + interval;
  }
  if (!$('#live-dialog').open && !inFlight) { const current = socket; socket = null; current?.close(); configured = false; }
  controls();
}
function connect() {
  clearTimeout(connectionTimer); configured = false; inFlight = null; controls(); status('Connecting to Curio…');
  const current = new WebSocket(websocketUrl()); socket = current;
  connectionTimer = setTimeout(() => { if (!configured && socket === current) { status('Curio is taking too long to connect. Close Live and try again.'); current.close(); } }, 15000);
  current.onmessage = event => { if (socket === current) handle(event); };
  current.onerror = () => { if (socket === current) status('Curio Live is unavailable. Check the backend connection.'); };
  current.onclose = () => {
    if (socket !== current) return; clearTimeout(connectionTimer); configured = false; inFlight = null; status('Connection closed. Close Live and reopen to reconnect.');
    if (reply) { failReply(reply, 'The Live connection closed. This question may have finished on the server; it has not been resent.'); reply = null; } controls();
  };
}
function applyLiveMode() {
  const interview = $('#live-mode').value === 'interview'; $('#audio-metrics-toggle').hidden = !interview; $('#metrics-help').hidden = !interview; $('#live-metrics').hidden = true;
  $('#live-observation').textContent = interview ? 'Practice an answer. Curio can describe visible posture, gaze, pace, and pauses.' : 'Show Curio something, then ask a question.';
  meter?.stop(); meter = null; $('#audio-metrics-toggle').textContent = 'Start communication sample';
}
function openLive() {
  if (state.busy) return;
  $('#live-dialog').showModal(); $('#live-mode').value = modes[state.mode]; $('#live-answer').textContent = ''; applyLiveMode();
  connect(); clearInterval(frameTimer); frameTimer = setInterval(sampleFrame, 500);
}
async function closeLive() {
  const waitingForAnswer = inFlight === 'reason';
  $('#live-dialog').close(); ++cameraGeneration; clearInterval(frameTimer); clearTimeout(connectionTimer); stopDictation();
  if (!waitingForAnswer) { const current = socket; socket = null; current?.close(); configured = false; inFlight = null; }
  cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null; $('#camera').srcObject = null; $('#camera-empty').hidden = false; $('#camera-caption').hidden = true;
  await meter?.stop(); meter = null;
}
function stopDictation() { recognition?.stop(); recognition = null; if (recognitionButton) { recognitionButton.setAttribute('aria-pressed', 'false'); recognitionButton.classList.remove('listening'); } recognitionButton = null; }
function dictate(target, button) {
  cancelCurioSpeech();
  if (recognition) { stopDictation(); return; }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { const message = 'Voice typing is not supported in this browser. You can type your question instead.'; if ($('#live-dialog').open) status(message); else notice(message); return; }
  const current = new Recognition(); recognition = current; recognitionButton = button; current.lang = navigator.language || 'en-IN'; current.continuous = true; current.interimResults = true;
  const original = target.value; button.classList.add('listening'); button.setAttribute('aria-pressed', 'true');
  current.onresult = event => { let text = ''; for (let i = 0; i < event.results.length; i++)text += event.results[i][0].transcript + ' '; target.value = (original + ' ' + text).trim().slice(0, 16000); };
  current.onerror = event => { const message = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Microphone access was declined. You can type your question instead.' : 'Voice typing stopped. You can keep typing or try again.'; if ($('#live-dialog').open) status(message); else notice(message); stopDictation(); };
  current.onend = () => { if (recognition === current) stopDictation(); };
  try { current.start(); } catch { stopDictation(); notice('Voice typing could not start. Please try again.'); }
}
export function initLive() {
  $('#open-live').onclick = openLive; $('#close-live').onclick = closeLive; $('#enable-camera').onclick = enableCamera;
  $('#live-dialog').addEventListener('cancel', event => { event.preventDefault(); closeLive(); });
  $('#live-mode').onchange = () => { if (inFlight) return; const map = { general: 'Personal', discovery: 'Food', shopping: 'Shopping', interview: 'Interview' }; setMode(map[$('#live-mode').value]); applyLiveMode(); if (configured) configure(); };
  $('#microphone').onclick = () => dictate($('#message'), $('#microphone')); $('#live-microphone').onclick = () => dictate($('#live-message'), $('#live-microphone'));
  $('#audio-metrics-toggle').onclick = async () => {
    const button = $('#audio-metrics-toggle'); button.disabled = true;
    try {
      if (meter?.timer) { await meter.stop(); button.textContent = 'Start a new sample'; $('#metrics-help').textContent = 'Sample ready. Send your answer to include timing and volume measurements.'; }
      else { await meter?.stop(); meter = new AudioMeter(); if (await meter.start()) button.textContent = 'Finish communication sample'; }
    }
    catch (error) { status(error.name === 'NotAllowedError' ? 'Microphone access was declined. You can continue without measurements.' : error.message); }
    finally { button.disabled = false; }
  };
  $('#live-form').onsubmit = async event => {
    event.preventDefault(); const text = $('#live-message').value.trim(); if (!text || !configured || inFlight) return;
    inFlight = 'reason'; controls(); stopDictation(); await meter?.stop(); const metrics = $('#live-mode').value === 'interview' ? meter?.metrics() : null; $('#audio-metrics-toggle').textContent = 'Start a new sample';
    addMessage('user', text); reply = addMessage('assistant', 'Considering your question…', true); setBusy(true); status('Reasoning…'); $('#live-answer').textContent = 'Curio is considering your question…';
    if (!send({ type: 'transcript', text, ...(metrics ? { metrics } : {}) })) { failReply(reply, 'Curio Live is disconnected. Reopen Live and try again.'); reply = null; inFlight = null; controls(); }
    else { $('#live-message').value = ''; if (metrics) { const mean = metrics.rms.reduce((sum, value) => sum + value, 0) / (metrics.rms.length || 1); const deviation = Math.sqrt(metrics.rms.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (metrics.rms.length || 1)); showMetrics({ rms_mean: mean, rms_standard_deviation: deviation, pause_count: metrics.pause_count, speaking_ratio: metrics.speaking_seconds / metrics.duration_seconds, words_per_minute: text.split(/\s+/).length / metrics.duration_seconds * 60 }); } }
  };
  document.addEventListener('conversation-changed', () => { if ($('#live-dialog').open) closeLive(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { nextFrame = Date.now() + interval; stopDictation(); } });
  window.addEventListener('pagehide', () => { cameraStream?.getTracks().forEach(t => t.stop()); meter?.stop(); socket?.close(); });
}
