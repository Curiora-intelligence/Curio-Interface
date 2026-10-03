import {speakCurio, cancelCurioSpeech} from './voice.js';
import {$, emit, modes, notice, element, storage, userId} from './config.js';
import {request, runForm, validateImage} from './api.js';
import {watchRun} from './sse.js';

const historyKey = `curio_chats:${userId}`, pendingKey = `curio_pending:${userId}`;
const stageLabels = {understanding:'Understanding your request…', memory:'Checking relevant context…', reasoning:'Reasoning…', tool_execution:'Checking available options…', verification:'Verifying the result…', response:'Preparing response…'};
const toolLabels = {'memory.search':'Memory search', 'memory.remember':'Save memory', 'services.search':'Service discovery', 'services.explain_match':'Match explanation', 'web.search':'Web search', 'web.open':'Read source', 'web.find':'Find in source'};
export const state = {conversationId:null, localId:crypto.randomUUID(), messages:[], mode:'Personal', busy:false, location:null};
let image = null, stopWatching = null;
const nodes = new Map();
let history = storage.read(historyKey, []);
if (!Array.isArray(history)) history = [];
history = history.filter(item => item && typeof item.id === "string" && Array.isArray(item.messages));

function save() {
  if (!state.messages.length) return;
  const item = {id:state.localId, conversationId:state.conversationId, mode:state.mode, messages:state.messages.slice(-100), title:state.messages.find(m => m.role === 'user')?.text.slice(0,60) || 'Live conversation', updated:Date.now()};
  history = [item, ...history.filter(c => c.id !== item.id)].slice(0,30);
  storage.write(historyKey, history); renderHistory();
}
function renderHistory() {
  const list = $('#history-list'); list.replaceChildren();
  if (!history.length) list.append(element('p','sidebar-empty','A new thought starts a new conversation.'));
  for (const item of history) {
    const button = element('button','history-entry',item.title); button.disabled = state.busy;
    button.onclick = () => { if (state.busy) return; state.localId=item.id; state.conversationId=item.conversationId; state.messages=item.messages; setMode(item.mode); renderAll(); $('#scrim').click(); emit('conversation-changed'); };
    list.append(button);
  }
}
export function setBusy(busy) {
  state.busy = busy; $('#send').disabled = busy; $('#new-chat').disabled = busy; $('#open-live').disabled = busy;
  $('#message').setAttribute('aria-busy', String(busy));
  for (const button of document.querySelectorAll('.mode-tabs button, #interview-toggle, .history-entry')) button.disabled = busy;
  $('#composer-note').textContent = busy ? 'Local inference can take a little time. You can keep writing while Curio works.' : 'A conversation that can carry forward. By Curiora.';
}
function renderActivity(message, node) {
  const container = node.querySelector('.message-activity'); container.replaceChildren();
  if (!message.activity?.length) return;
  const details = $('#progress-template').content.firstElementChild.cloneNode(true);
  for (const entry of message.activity) {
    const row=element('li','activity-step');
    if(typeof entry==='string')row.append(element('span','',entry));
    else row.append(element('strong','activity-label',entry.label),element('span','',entry.detail));
    details.querySelector('ol').append(row);
  }
  details.open=message.pending || !!message.activity.some(entry=>typeof entry!=='string');
  container.append(details);
}
function updateMessage(message) {
  const node = nodes.get(message.id); if (!node) return;
  node.className = `message ${message.role} ${message.pending ? 'pending' : ''} ${message.error ? 'failed' : ''}`;
  const body = node.querySelector('.message-body');
  if (message.role === 'assistant' && !message.pending && !message.error) renderAnswer(body, message.text);
  else body.textContent = message.text;
  node.querySelector('.message-label').textContent = message.role === 'user' ? 'YOU' : 'CURIO';
  renderActivity(message,node);
}
export function addMessage(role, text, pending = false) {
  const message = {id:crypto.randomUUID(),role,text,pending,activity:[]}; state.messages.push(message);
  const node = $('#message-template').content.firstElementChild.cloneNode(true); nodes.set(message.id,node); $('#messages').append(node); updateMessage(message);
  $('#page-label').textContent = 'Your conversation'; $('#welcome').hidden = true; $('#chat-stage').classList.remove('empty');
  node.scrollIntoView({behavior:'smooth',block:'end'}); return message;
}
function renderAll() {
  $('#messages').replaceChildren(); nodes.clear();
  for (const message of state.messages) { const node=$('#message-template').content.firstElementChild.cloneNode(true); nodes.set(message.id,node); $('#messages').append(node); updateMessage(message); }
  $('#welcome').hidden = !!state.messages.length; $('#chat-stage').classList.toggle('empty',!state.messages.length);
  $('#page-label').textContent = state.messages.length ? 'Your conversation' : 'A fresh conversation'; renderHistory();
}
export function setMode(mode) {
  state.mode = modes[mode] ? mode : 'Personal';
  for (const button of document.querySelectorAll('.mode-tabs button')) { const selected = button.dataset.mode === state.mode || (state.mode === 'Interview' && button.dataset.mode === 'Career'); button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected)); }
  $('#interview-toggle').hidden = !['Career','Interview'].includes(state.mode);
  $('#interview-toggle').textContent = state.mode === 'Interview' ? 'Mock interview selected ✓' : 'Practice a mock interview ↗';
  emit('mode-changed', modes[state.mode]);
}
export function completeReply(reply, data) {
  if (typeof data.answer !== 'string' || !data.conversation_id || data.user_id !== userId) { failReply(reply, 'Curio returned an incomplete response. Reopen this chat to check again.'); return; }
  reply.text = data.answer; reply.pending = false; reply.error = false; state.conversationId = data.conversation_id;
  updateMessage(reply); save(); storage.remove(pendingKey); setBusy(false); emit('memory-refresh'); speakCurio(data.answer,{defaultOn:state.mode==='Interview'});
}
export function failReply(reply, message) { reply.text=message; reply.pending=false; reply.error=true; updateMessage(reply); save(); storage.remove(pendingKey); setBusy(false); }
function follow(id, reply) {
  stopWatching?.();
  stopWatching = watchRun(id, {
    stage(data) { if (!stageLabels[data.stage]) return; reply.text=stageLabels[data.stage]; if(data.stage==='memory' && data.remembered?.length)reply.activity.push({label:'Remembered',detail:data.remembered.join(' • ')}); else if(!['verification','response'].includes(data.stage))reply.activity.push({label:'Stage',detail:reply.text}); updateMessage(reply); },
    tool(data) { if (!['started','finished','failed'].includes(data.status)) return; reply.activity.push({label:data.status==='started'?'Using tool':data.status==='finished'?'Verified':'Tool unavailable',detail:data.status==='finished'?`${data.tool} · Tool result returned`:data.tool}); updateMessage(reply); },
    connection(text) { $('#composer-note').textContent = text; },
    final(data) { completeReply(reply,data); },
    error(message) { failReply(reply,message); },
    done() { stopWatching = null; },
  });
}
async function accept(form, reply) {
  setBusy(true); reply.pending=true; reply.error=false; reply.text='Connecting to Curio…'; updateMessage(reply); notice();
  try {
    const result = await request('/curio/runs',{method:'POST',body:form});
    if (!result.request_id) throw new Error('Curio did not return a request ID.');
    reply.text = 'Request accepted. Waiting for Curio…'; updateMessage(reply); save();
    storage.write(pendingKey, {runId:result.request_id, localId:state.localId, replyId:reply.id}); follow(result.request_id,reply);
  } catch (error) {
    failReply(reply,error.message);
    const retry=element('button','text-button','Retry this submission');
    retry.onclick = () => { retry.remove(); accept(form,reply); };
    nodes.get(reply.id).querySelector('.message-activity').append(retry);
  }
}
export function initChat() {
  $('#chat-form').onsubmit = (event) => {
    event.preventDefault(); if (state.busy) return; cancelCurioSpeech();
    const text=$('#message').value.trim(); if (!text && !image) return;
    const form=runForm({text, image, conversationId:state.conversationId, mode:modes[state.mode], location:state.location, requestId:crypto.randomUUID()});
    addMessage('user',text + (image ? `\n[Image: ${image.name}]` : '')); const reply=addMessage('assistant','Connecting to Curio…',true);
    $('#message').value=''; clearImage(); accept(form,reply);
  };
  $('#message').onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } };
  $('#new-chat').onclick = () => { if (state.busy) return; stopWatching?.(); state.conversationId=null; state.localId=crypto.randomUUID(); state.messages=[]; $('#message').value=''; clearImage(); notice(); renderAll(); emit('conversation-changed'); emit('memory-refresh'); $('#scrim').click(); $('#message').focus(); };
  $('#history-button').onclick = () => { $('#history-list').scrollIntoView({block:'nearest'}); };
  for (const button of document.querySelectorAll('.mode-tabs button')) button.onclick = () => { if (!state.busy) setMode(button.dataset.mode); };
  $('#interview-toggle').onclick = () => { window.location.href='/interview'; };
  for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { if(state.busy) return; setMode(button.dataset.mode); $('#message').value=button.dataset.prompt; $('#message').focus(); };
  $('#attach-image').onclick = () => $('#image-file').click();
  $('#image-file').onchange = () => { const file=$('#image-file').files[0]; if (!file) return; try { validateImage(file); image=file; $('#attachment span').textContent=file.name; $('#attachment').hidden=false; notice(); } catch(error) { clearImage(); notice(error.message); } };
  $('#remove-image').onclick = clearImage;
  renderHistory();
  const pending=storage.read(pendingKey), conversation=history.find(c=>c.id===pending?.localId);
  if (conversation && pending?.runId) { Object.assign(state,{localId:conversation.id,conversationId:conversation.conversationId,messages:conversation.messages}); setMode(conversation.mode); renderAll(); const reply=state.messages.find(m=>m.id===pending.replyId); if(reply) { setBusy(true); follow(pending.runId,reply); } }
}
function clearImage() { image=null; $('#image-file').value=''; $('#attachment').hidden=true; }

// Safe, small Markdown renderer. Source buttons never open automatically.
export function renderAnswer(container, text) {
  container.replaceChildren();const sources=new Map();
  function link(label,url){
    const anchor=element('a','',label);
    try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password)throw Error();
      anchor.href=parsed.href;anchor.target='_blank';anchor.rel='noopener noreferrer';sources.set(parsed.href,parsed.hostname);
    }catch{return document.createTextNode(label);}
    return anchor;
  }
  function inline(parent,value){
    const pattern=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*[^*]+\*)/g;let cursor=0;
    for(const match of value.matchAll(pattern)){
      parent.append(document.createTextNode(value.slice(cursor,match.index)));const token=match[0];let node;
      if(token.startsWith('**'))node=element('strong','',token.slice(2,-2));
      else if(token.startsWith('*'))node=element('em','',token.slice(1,-1));
      else if(token.startsWith('`'))node=element('code','',token.slice(1,-1));
      else if(token.startsWith('[')){const split=token.indexOf('](');node=link(token.slice(1,split),token.slice(split+2,-1));}
      else {const url=token.replace(/[.,;!?)]+$/,'');node=link(url,url);}
      parent.append(node);cursor=match.index+token.length;
    }parent.append(document.createTextNode(value.slice(cursor)));
  }
  let list=null,code=null;const lines=String(text).split('\n');
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(value=>value.trim());
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(line.trim().startsWith('```')){if(code)code=null;else{code=element('pre','answer-code','');container.append(code);}list=null;continue;}
    if(code){code.textContent+=line+'\n';continue;}if(!line.trim()){list=null;continue;}
    if(line.trim().startsWith('|') && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index+1]||'')){
      const scroll=element('div','answer-table-scroll'),table=element('table','answer-table'),head=element('thead'),body=element('tbody'),row=element('tr');
      scroll.tabIndex=0;scroll.setAttribute('aria-label','Answer table');
      for(const value of cells(line)){const cell=element('th');cell.scope='col';inline(cell,value);row.append(cell);}head.append(row);table.append(head,body);index++;
      while(index+1<lines.length && lines[index+1].trim().startsWith('|')){const row=element('tr');for(const value of cells(lines[++index])){const cell=element('td');inline(cell,value);row.append(cell);}body.append(row);}
      scroll.append(table);container.append(scroll);list=null;continue;
    }
    const bullet=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if(bullet){if(!list){list=element('ul');container.append(list);}const item=element('li');inline(item,bullet[1]);list.append(item);}
    else{list=null;const heading=line.match(/^#{1,4}\s+(.+)/);const paragraph=element(heading?'h3':'p');inline(paragraph,heading?heading[1]:line);container.append(paragraph);}
  }
  if(sources.size){const cards=element('div','source-links');for(const [url,host] of sources){const zomato=host==='zomato.com'||host.endsWith('.zomato.com');const button=link(zomato?'Open on Zomato ↗':`Open ${host} ↗`,url);button.className='source-link'+(zomato?' zomato':'');cards.append(button);}container.append(cards);}
}
