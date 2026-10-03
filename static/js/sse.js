import {runUrl, runStatus} from './api.js';

// One POST creates a run. This watcher only reads the existing run thereafter.
export function watchRun(id, callbacks) {
  let source, pollTimer, reconnectTimer, stopped = false, finished = false, errors = 0, polling = false, last = 0;
  const stop = () => { stopped = true; source?.close(); clearTimeout(pollTimer); clearTimeout(reconnectTimer); };
  const final = (data) => { if (!finished) { finished = true; callbacks.final(data); } };
  const fail = (message) => { if (!finished) { finished = true; callbacks.error(message); } stop(); callbacks.done?.(); };
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const status = await runStatus(id);
      if (stopped) return;
      if (status.status === 'completed') { final(status); stop(); callbacks.done?.(); return; }
      if (status.status === 'failed') { fail('Curio could not finish this request. Please try again.'); return; }
      callbacks.connection?.('Your request is still running. You can keep writing.');
    } catch (error) { if (!stopped) callbacks.connection?.(`${error.message} Your accepted request is saved; reconnecting…`); }
    finally { polling = false; if (!stopped) pollTimer = setTimeout(poll, 3000); }
  }
  function fallback() {
    if (stopped) return;
    source?.close(); clearTimeout(reconnectTimer);
    callbacks.connection?.('Reconnecting through saved request status…');
    clearTimeout(pollTimer); poll();
  }
  if (!('EventSource' in window)) { fallback(); return stop; }
  try {
    source = new EventSource(runUrl(id, true));
    source.onopen = () => { errors = 0; clearTimeout(reconnectTimer); };
    for (const kind of ['run_started','stage','tool_started','tool_finished','tool_failed','final','error','done']) {
      source.addEventListener(kind, (event) => {
        // Native connection failures also dispatch error without data.
        if (!('data' in event) || stopped) return;
        let data; try { data = JSON.parse(event.data); } catch { fallback(); return; }
        const sequence = Number(event.lastEventId.split('-')[0]);
        if (sequence && sequence <= last) return;
        last = sequence || last;
        if (kind === 'final') final(data);
        else if (kind === 'error') fail(data.message || 'Curio could not finish this request.');
        else if (kind === 'done') { if (finished) { stop(); callbacks.done?.(); } else fallback(); }
        else if (!finished && kind === 'stage') callbacks.stage?.(data);
        else if (!finished && kind.startsWith('tool_')) callbacks.tool?.(data);
      });
    }
    source.onerror = (event) => {
      if ('data' in event || stopped) return;
      callbacks.connection?.('Connection interrupted. Reconnecting to the same request…');
      if (++errors >= 3) fallback();
      else { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(fallback, 15000); }
    };
    // A read-only safety check also recovers results if a proxy silently stalls SSE.
    pollTimer = setTimeout(poll, 10000);
  } catch { fallback(); }
  return stop;
}
