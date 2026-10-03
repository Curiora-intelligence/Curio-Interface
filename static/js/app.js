import {$, userId} from './config.js';
import {initChat} from './chat.js';
import {initMemory} from './memory.js';
import {initLive} from './live.js';
import {element, notice, storage, emit} from './config.js';
import {jsonPost, listMemories, request} from './api.js';
import {state} from './chat.js';

$('#profile-id').textContent = userId;
$('#user-id').value = userId;
$('#menu').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('visible'); };
$('#scrim').onclick = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('visible'); };
$('#settings-button').onclick = () => $('#settings-dialog').showModal();
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => document.getElementById(button.dataset.close).close();
initChat();
initMemory();
initLive();

const inspector=storage.read('curio_inspector',true);
$('#show-inspector').checked=inspector;document.body.classList.toggle('hide-inspector',!inspector);
$('#show-inspector').onchange=()=>{const enabled=$('#show-inspector').checked;document.body.classList.toggle('hide-inspector',!enabled);storage.write('curio_inspector',enabled);};
let checking=false;
async function checkConnection(){
  if(checking)return;checking=true;const badge=$('#connection-status');
  try{const health=await request('/health');badge.textContent=health.status==='ok'?'Curio connected':'Curio needs attention';badge.classList.toggle('offline',health.status!=='ok');}
  catch{badge.textContent='Curio offline';badge.classList.add('offline');}
  finally{checking=false;}
}
$('#connection-status').onclick=checkConnection;checkConnection();
setInterval(()=>{if(!document.hidden)checkConnection();},30000);
$('#location-button').onclick=()=>{
  if(!navigator.geolocation){$('#location-status').textContent='Location is not supported. Curio can still find matches without distance.';return;}
  $('#location-status').textContent='Waiting for location permission…';
  navigator.geolocation.getCurrentPosition(position=>{
    state.location={latitude:position.coords.latitude,longitude:position.coords.longitude};
    $('#location-status').textContent='Location enabled for this tab. Curio can use it for nearby requests.';
    $('#location-button').textContent='Update my location';emit('location-changed');
  },()=>{$('#location-status').textContent='Location was not available. Matches will show distance as unknown.';},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
};
let discoveryBusy=false;
let discoveryGeneration = 0;
async function fillDiscoveryDefaults() {
  const generation = ++discoveryGeneration, category = $('#category').value;
  $('#budget').value = ''; $('#preferences').value = ''; $('#discovery-results').replaceChildren();
  try {
    const {memories} = await listMemories();
    if (generation !== discoveryGeneration) return;
    const key = category === 'food' ? 'food_budget' : category === 'shopping' ? 'shopping_budget' : 'budget';
    const budget = memories.find(m => m.key === key) || memories.find(m => m.key === 'budget');
    const preference = memories.find(m => m.kind === 'preference' && m.key === (category === 'food' ? 'food' : category === 'shopping' ? 'style' : 'service'));
    if (budget && /^\d+(\.\d+)?$/.test(budget.value) && !$('#budget').value) $('#budget').value = budget.value;
    if (preference && !$('#preferences').value) $('#preferences').value = preference.value;
  } catch { /* Explicit criteria remain usable if memory is offline. */ }
}
$('#discovery-button').onclick = () => {
  $('#discovery-dialog').showModal(); $('#category').value = state.mode === 'Shopping' ? 'shopping' : 'food';
  fillDiscoveryDefaults();
};
$('#category').onchange = fillDiscoveryDefaults;
$('#discovery-form').onsubmit=async event=>{
  event.preventDefault();if(discoveryBusy)return;discoveryBusy=true;
  const results=$('#discovery-results'),button=event.target.querySelector('button[type=submit]');button.disabled=true;results.replaceChildren(element('p','helper','Checking available options…'));
  const budget=Number($('#budget').value), preferences=$('#preferences').value.trim();
  try{
    // Discovery is stateless: identity travels in the common header, never an unsupported JSON field.
    const data=await jsonPost('/discovery/',{category:$('#category').value,...(budget>0?{budget_max:budget}:{}),preferences:preferences?[preferences]:[],availability:$('#available-today').checked?'today':'any',...(state.location||{})});
    results.replaceChildren(element('p','helper',data.notice || 'Fictional demo catalogue.'));
    for(const match of data.recommendations || []){
      const card=element('article','recommendation');card.append(element('span','badge','Fictional demo'),element('h3','',match.name));
      const price=Number.isFinite(match.price)?new Intl.NumberFormat('en-IN',{style:'currency',currency:match.currency || 'INR',maximumFractionDigits:0}).format(match.price):'Price unknown';
      card.append(element('p','price',price));const reasons=element('ul');for(const reason of match.reasons || [])reasons.append(element('li','',reason));card.append(reasons);results.append(card);
    }
    if(!data.recommendations?.length)results.append(element('p','helper','No matches for those constraints. Try a different budget or category.'));
  }catch(error){results.replaceChildren(element('p','notice error',error.message));}
  finally{discoveryBusy=false;button.disabled=false;}
};
