// Development-only browser fixtures. Production never loads this file.
window.checks = { posts: [], watches: [], sockets: [], memories: [], unavailable: false, failStream: false, pending: false, cid: 0 };
window.fetch = async (url, options = {}) => {
  if (checks.unavailable) throw new TypeError('offline');
  const path = new URL(url, location.href).pathname;
  if (path === '/curio/runs') {
    const fields = Object.fromEntries(options.body.entries()); checks.posts.push(fields); checks.cid++;
    if (fields.message.includes('biryani')) checks.memories = [{ id: 'm1', kind: 'preference', key: 'food', value: 'spicy chicken biryani' }, { id: 'm2', kind: 'constraint', key: 'food_budget', value: '300' }];
    checks.answer = { status: 'completed', answer: 'Your preferences can carry forward.', conversation_id: 'cid-' + checks.cid, user_id: 'demo-sai' };
    return Response.json({ request_id: 'run-' + checks.cid, status: 'accepted' }, { status: 202 });
  }
  if (path.startsWith('/curio/runs/')) return Response.json(checks.answer);
  if (path.startsWith('/memory/')) return Response.json({ memories: checks.memories });
  if (path === '/health') return Response.json({ status: 'ok', postgres: 'ok' });
  if (path === '/discovery/') return Response.json({ fictional: true, notice: 'Fictional demo catalogue', recommendations: [{ name: 'Demo Saffron Kitchen', price: 280, currency: 'INR', rating: 4.5, reasons: ['Within your budget', 'Matches spicy preference'], distance_km: null }] });
  throw new Error('Unexpected fixture request ' + path);
};
window.EventSource = class extends EventTarget {
  constructor(url) { super(); this.url = url; this.closed = false; checks.watches.push(this); setTimeout(() => this.deliver(), 35); }
  close() { this.closed = true; }
  async deliver() {
    if (this.closed) return;
    if (checks.failStream) { for (let i = 0; i < 3; i++)this.onerror?.(new Event('error')); return; }
    this.onopen?.();
    let id = 0;
    const send = (kind, data) => this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(data), lastEventId: String(++id) + '-0' }));
    send('stage', { stage: 'memory', message: 'Checking relevant context…' });
    send('tool_started', { tool: 'memory.search', status: 'started' });
    await new Promise(r => setTimeout(r, 100)); if (this.closed || checks.pending) return;
    send('tool_finished', { tool: 'memory.search', status: 'finished' });
    send('final', checks.answer); send('done', {});
  }
};
checks.cameraDenied = true; checks.microphoneDenied = false; checks.liveSent = []; checks.holdFrames = false;
window.WebSocket = class {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 1; checks.sockets.push(this); setTimeout(() => this.receive({ type: 'ready', frame_interval_seconds: 5 }), 20); }
  receive(data) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(data) }); }
  send(raw) {
    const data = JSON.parse(raw); checks.liveSent.push(data);
    if (data.type === 'configure') setTimeout(() => this.receive({ type: 'configured', mode: data.mode, frame_interval_seconds: 5 }), 5);
    if (data.type === 'frame' && !checks.holdFrames) setTimeout(() => this.receive({ type: 'observation', mode: 'shopping', observation: { objects: ['bag'], colors: ['black'], visible_details: ['minimal shape'] } }), 30);
    if (data.type === 'transcript') setTimeout(() => this.receive({ type: 'response', answer: 'A useful next step.', conversation_id: 'live-cid', user_id: 'demo-sai' }), 200);
  }
  close() { this.readyState = 3; this.onclose?.(); }
};
const testMedia = {
  async getUserMedia(constraints) {
    if ((constraints.video && checks.cameraDenied) || (constraints.audio && checks.microphoneDenied)) throw new DOMException('Denied for test', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d'); context.fillStyle = '#98b8e8'; context.fillRect(0, 0, 1920, 1080); context.fillStyle = '#193151'; context.fillRect(600, 350, 600, 400);
    const stream = canvas.captureStream(30); checks.mediaStream = stream; return stream;
  }
};
Object.defineProperty(navigator, 'mediaDevices', { value: testMedia, configurable: true });
window.SpeechRecognition = class {
  start() {
    checks.recognition = this; if (checks.microphoneDenied) { setTimeout(() => this.onerror?.({ error: 'not-allowed' }), 1); return; }
    setTimeout(() => this.onresult?.({ results: [[{ transcript: 'A dictated answer' }]] }), 1);
  }
  stop() { }
};
window.AudioContext = class {
  constructor() { this.state = 'running'; }
  async resume() { }
  async close() { this.state = 'closed'; }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(values) { values.fill(checks.silent ? 0 : .1); } }; }
  createMediaStreamSource() { return { connect() { } }; }
};
