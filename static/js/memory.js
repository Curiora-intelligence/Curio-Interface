import {$, element} from './config.js';
import {listMemories} from './api.js';

const categories={preference:'Preference',constraint:'Constraint',goal:'Goal',skill_gap:'Skill gap',fact:'Remembered detail'};
const labels={food:'Food preference',food_preference:'Food preference',food_budget:'Food budget',budget:'Budget',shopping_budget:'Shopping budget',style:'Shopping style',shopping_style:'Shopping style',career:'Career goal',career_goal:'Career goal',skill_gap:'Interview focus'};
let generation=0;
export async function refreshMemories() {
  const mine=++generation, cards=$('#memory-cards');
  if($('#memory-dialog').open && !cards.children.length) cards.append(element('p','helper','Loading what matters…'));
  try {
    const result=await listMemories(); if(mine!==generation)return;
    cards.replaceChildren(); const memories=Array.isArray(result.memories)?result.memories:[];
    $('#memory-count').textContent=`${memories.length} ${memories.length===1?'memory':'memories'}`;
    if(!memories.length){cards.append(element('div','memory-empty','A little context makes a difference. Tell Curio a preference, a goal, or something you’d like to work on.'));return;}
    for(const memory of memories) {
      const card=element('article','memory-card');
      card.append(element('span','memory-category',categories[memory.kind] || 'Remembered detail'));
      const label=labels[memory.key] || (memory.kind==='skill_gap' ? 'Interview focus' : String(memory.key || 'About you').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()));
      const value = /budget/.test(memory.key) && /^\d+(\.\d+)?$/.test(String(memory.value)) ? `₹${Number(memory.value).toLocaleString('en-IN')}` : String(memory.value);
      card.append(element('h3','',label),element('p','',value));cards.append(card);
    }
  } catch(error) { if(mine!==generation)return; cards.replaceChildren(element('p','notice error',error.message)); $('#memory-count').textContent='Unable to refresh'; }
}
export function initMemory() {
  $('#memories-button').onclick=()=>{$('#memory-dialog').showModal();refreshMemories();};
  $('#refresh-memory').onclick=refreshMemories;
  document.addEventListener('memory-refresh',refreshMemories);
}
