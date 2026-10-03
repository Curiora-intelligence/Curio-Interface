import {storage, emit} from './config.js';

const key='curio_voice_replies';
let active=null, finishActive=null;
export const voiceRepliesEnabled=(defaultOn=false)=>storage.read(key,null) ?? defaultOn;
export function setVoiceReplies(enabled){storage.write(key,!!enabled);if(!enabled)cancelCurioSpeech();emit('voice-preference',!!enabled);}
export function speechText(text){return String(text).replace(/```[\s\S]*?```/g,' Code example omitted. ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/[*_`#>|]/g,'').replace(/^\s*[-+]\s+/gm,'').replace(/\s+/g,' ').trim();}
export function cancelCurioSpeech(){
  if('speechSynthesis' in window)window.speechSynthesis.cancel();
  active=null;finishActive?.();finishActive=null;emit('curio-speaking',false);
}
export function speakCurio(text,{defaultOn=false,force=false}={}){
  cancelCurioSpeech();
  if((!force && !voiceRepliesEnabled(defaultOn)) || !window.speechSynthesis || !window.SpeechSynthesisUtterance)return Promise.resolve(false);
  const clean=speechText(text);if(!clean)return Promise.resolve(false);
  return new Promise(resolve=>{
    const utterance=new SpeechSynthesisUtterance(clean);active=utterance;
    const voices=window.speechSynthesis.getVoices().filter(voice=>/^en[-_]/i.test(voice.lang));
    const score=voice=>(/^en[-_]IN$/i.test(voice.lang)?40:/^en[-_]US$/i.test(voice.lang)?30:10)+(voice.localService?3:0)+(/natural|enhanced|samantha|ava|siri/i.test(voice.name)?2:0);
    voices.sort((a,b)=>score(b)-score(a));if(voices[0])utterance.voice=voices[0];utterance.lang=voices[0]?.lang || 'en-US';utterance.rate=1;utterance.pitch=1;
    let done=false;const timer=setTimeout(()=>finish(false),Math.min(120000,10000+clean.length*100));
    function finish(ok){if(done)return;done=true;clearTimeout(timer);if(active===utterance){active=null;finishActive=null;emit('curio-speaking',false);}resolve(ok);}
    finishActive=()=>finish(false);utterance.onstart=()=>emit('curio-speaking',true);utterance.onend=()=>finish(true);utterance.onerror=()=>finish(false);
    try{window.speechSynthesis.speak(utterance);}catch{finish(false);}
  });
}
export function bindVoiceToggle(button,defaultOn=false){
  if(!button)return;
  const update=()=>{const enabled=voiceRepliesEnabled(defaultOn);button.textContent=`Voice replies ${enabled?'ON':'OFF'}`;button.setAttribute('aria-pressed',String(enabled));};
  button.onclick=()=>{setVoiceReplies(!voiceRepliesEnabled(defaultOn));update();};document.addEventListener('voice-preference',update);update();
}
window.addEventListener('pagehide',cancelCurioSpeech);
