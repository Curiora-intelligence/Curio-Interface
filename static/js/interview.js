import {$, userId, element} from './config.js';
import {websocketUrl, listMemories} from './api.js';
import {captureJPEG, AudioMeter} from './live.js';
import {renderAnswer} from './chat.js';
import {speakCurio, cancelCurioSpeech, bindVoiceToggle} from './voice.js';

let socket=null, configured=false, ended=true, phase='idle', question=1, questionText='', conversationId=null;
let stream=null, meter=null, recognition=null, listening=false, frameTimer=null, metricsTimer=null, connectTimer=null;
let inFlight=null, interval=5000, nextFrame=0, encoding=false, pending=null, lastRequest=null, lastMetrics=null, generation=0, speechDone=Promise.resolve();
const status=text=>{$('#interview-status').textContent=text;};
function error(text=''){$('#interview-error').textContent=text;$('#interview-error').hidden=!text;}
function controls(){const canAnswer=phase==='answering' && configured && !ended;$('#interview-mic').disabled=!canAnswer;$('#interview-finish').disabled=!canAnswer;$('#interview-role').disabled=!ended;$('#read-question').disabled=!questionText;}
function send(payload){if(!socket || socket.readyState!==WebSocket.OPEN)return false;socket.send(JSON.stringify(payload));return true;}
function ask(kind,text,metrics=null){
  cancelCurioSpeech();pending={kind,text,metrics};phase=kind==='feedback'?'evaluating':'question';controls();
  status(kind==='feedback'?'Curio is considering your answer…':'Curio is preparing one question…');flush();
}
function flush(){
  if(!pending || !configured || inFlight || ended)return;
  const request=pending;pending=null;lastRequest=request;inFlight=request.kind;
  if(!send({type:'transcript',text:request.text,...(request.metrics?{metrics:request.metrics}:{})})){inFlight=null;error('The connection closed. Start a new session when Curio is available.');}
}
function firstQuestion(){ask('first',`Start a mock interview for a ${$('#interview-role').value}. Ask one question at a time. Use my remembered goals and skill gaps. Begin with one question only. Keep it brief and speak directly to me; do not supply an answer. When I answer, evaluate technical correctness, completeness, clarity and structure using relevant saved skill gaps and only supplied observable delivery measurements. Give at most three sentences of feedback, then stop; I will explicitly request the next question. Do not infer psychological state or temporal changes from a single camera sample.`);}
async function loadContext(){
  try{const {memories}=await listMemories();const relevant=memories.filter(item=>['skill_gap','goal'].includes(item.kind));$('#interview-memory').textContent=relevant.length?relevant.map(item=>item.value).join(' · '):'Share a career goal or a skill to practice with Curio in chat. Your interview can start without saved context.';}
  catch{$('#interview-memory').textContent='Saved context could not be loaded here. Curio will retrieve available memory when it asks a question.';}
}
async function requestMedia(){
  const mine=generation;$('#retry-media').hidden=true;
  if(!navigator.mediaDevices?.getUserMedia){error('Camera and microphone need a supported browser on localhost or HTTPS. You can still type answers.');return;}
  $('#interview-start').textContent='Waiting for camera permission…';
  const waitingMessage='Camera or microphone permission is still pending. Check the browser prompt; typed answers remain available.';
  const waiting=setTimeout(()=>{if(mine===generation && !ended)error(waitingMessage);},12000);
  const camera=navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false}).then(async value=>{
    if(mine!==generation || ended){value.getTracks().forEach(track=>track.stop());return;}
    stream?.getTracks().forEach(track=>track.stop());stream=value;$('#interview-camera').srcObject=stream;await $('#interview-camera').play();$('#interview-intro').hidden=true;$('#interview-camera-state').textContent='LIVE · local preview';$('.interview-live').classList.add('active');
  }).catch(()=>{if(mine!==generation || ended)return;$('#interview-camera-state').textContent='Camera unavailable';$('#interview-start').textContent='Camera unavailable';$('#retry-media').hidden=false;error('Camera is unavailable. You can still answer, or retry permissions.');});
  const audio=navigator.mediaDevices.getUserMedia({audio:true}).then(value=>{
    value.getTracks().forEach(track=>track.stop());if(mine!==generation || ended)return;$('#interview-mic-state').textContent='Microphone ready';
  }).catch(()=>{if(mine!==generation || ended)return;$('#interview-mic-state').textContent='Type your answer';$('#retry-media').hidden=false;error('Microphone is unavailable. Type your answer, or retry permissions.');});
  await Promise.allSettled([camera,audio]);clearTimeout(waiting);
  if(mine===generation && !ended && $('#interview-error').textContent===waitingMessage)error();
}
async function sampleFrame(){
  if(ended || document.hidden || !stream || !configured || inFlight || pending || encoding || phase!=='answering' || Date.now()<nextFrame)return;
  const mine=generation;encoding=true;
  try{const frame=await captureJPEG($('#interview-camera'));if(frame && mine===generation && !ended && !inFlight && !pending){inFlight='frame';send({type:'frame',...frame});}}
  catch{ /* Preview and typed answers remain usable if a frame fails. */ }
  finally{encoding=false;nextFrame=Date.now()+interval;}
}
function showObservation(observation){
  if(observation.unavailable){$('#interview-observation').textContent='That frame did not give a reliable view. Try another angle or continue with your answer.';return;}
  const fields={gaze_direction:'Visible gaze',head_orientation:'Head orientation',posture:'Visible posture',facial_expressiveness:'Facial movement'};
  $('#interview-observation').replaceChildren();for(const [key,label] of Object.entries(fields))if(observation[key])$('#interview-observation').append(element('div','',`${label}: ${String(observation[key]).replaceAll('_',' ')}`));
}
function showMetrics(metrics){
  if(!metrics)return;const count=$('#interview-transcript').value.trim().split(/\s+/).filter(Boolean).length;
  const values=[['Speaking pace',`${Math.round(count/metrics.duration_seconds*60)} wpm`],['Pauses',metrics.pause_count],['Speaking ratio',`${Math.round(metrics.speaking_seconds/metrics.duration_seconds*100)}%`]];
  $('#interview-metrics').replaceChildren();for(const [label,value] of values){const cell=element('span','',label);cell.append(element('strong','',String(value)));$('#interview-metrics').append(cell);}
}
function mergeMetrics(previous,current){
  if(!previous)return current;if(!current)return previous;
  const duration=Math.min(3600,previous.duration_seconds+current.duration_seconds);
  return {duration_seconds:duration,speaking_seconds:Math.min(duration,previous.speaking_seconds+current.speaking_seconds),pause_count:Math.min(10000,previous.pause_count+current.pause_count),rms:[...previous.rms,...current.rms].slice(-600)};
}
function stopRecognition(){const current=recognition;recognition=null;listening=false;current?.stop();$('#interview-mic').textContent='Start answering';$('#interview-mic-state').textContent='Microphone paused';}
async function stopAnswer(){stopRecognition();clearInterval(metricsTimer);const current=meter;meter=null;await current?.stop();lastMetrics=mergeMetrics(lastMetrics,current?.metrics());showMetrics(lastMetrics);}
async function startAnswer(){
  cancelCurioSpeech();error();
  if(listening){await stopAnswer();return;}
  listening=true;await meter?.stop();meter=new AudioMeter();const mine=generation;
  const currentMeter=meter;
  try{await currentMeter.start();if(mine!==generation || ended || phase!=='answering' || meter!==currentMeter){await currentMeter.stop();return;}metricsTimer=setInterval(()=>showMetrics(mergeMetrics(lastMetrics,meter?.metrics())),500);}
  catch{error('Microphone measurements are unavailable. You can type your answer and use Finish Answer.');}
  if(mine!==generation || ended || phase!=='answering' || !listening)return;
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){$('#interview-mic-state').textContent='Audio sample active';error('This browser does not support dictation. Type your answer; available timing measurements can still be included.');return;}
  const current=new Recognition();recognition=current;current.lang='en-IN';current.continuous=true;current.interimResults=true;
  const original=$('#interview-transcript').value;
  current.onresult=event=>{if(recognition!==current)return;let text='';for(let i=0;i<event.results.length;i++)text+=event.results[i][0].transcript+' ';$('#interview-transcript').value=(original+' '+text).trim().slice(0,12000);};
  current.onerror=event=>{
    const messages={'not-allowed':'Microphone permission was declined. Type your answer instead.','service-not-allowed':'This browser does not allow its speech recognition service. Type your answer instead.','network':'The browser speech recognition service is unavailable. Type your answer, or try a supported browser.','no-speech':'No speech was heard. Try Start answering again, or type your answer.','audio-capture':'The microphone could not capture audio. Check the input device or type your answer.'};
    error(messages[event.error] || 'Dictation stopped. Your transcript is preserved; you can edit it and finish.');stopAnswer();
  };
  current.onend=()=>{if(recognition===current)stopAnswer();};
  try{current.start();listening=true;$('#interview-mic').textContent='Pause microphone';$('#interview-mic-state').textContent='Listening';}
  catch{error('Dictation could not start. Type your answer or try again.');await stopAnswer();}
}
function connect(){
  const current=new WebSocket(websocketUrl());socket=current;
  connectTimer=setTimeout(()=>{if(!configured && socket===current){error('Curio did not connect. Check the backend and start again.');endSession();}},15000);
  current.onmessage=async event=>{
    if(socket!==current || ended)return;let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='ready'){interval=Math.max(5000,Number(data.frame_interval_seconds)*1000||5000);inFlight='configure';send({type:'configure',mode:'interview'});return;}
    if(data.type==='configured'){clearTimeout(connectTimer);configured=true;inFlight=null;firstQuestion();return;}
    if(data.type==='observation'){showObservation(data.observation||{});inFlight=null;nextFrame=Date.now()+interval;flush();return;}
    if(data.type==='frame_skipped' || data.type==='busy'){
      const rejected=inFlight;inFlight='backoff';nextFrame=Date.now()+interval;
      if(rejected!=='frame' && rejected!=='backoff'){pending=lastRequest;status('Curio is busy. Waiting before retrying the unaccepted request…');}
      const mine=generation;setTimeout(()=>{if(mine===generation && !ended){inFlight=null;flush();controls();}},interval);return;
    }
    if(data.type==='metrics'){return;}
    if(data.type==='pong')return;
    if(data.type==='error'){const rejected=inFlight;inFlight=null;nextFrame=Date.now()+interval;error(data.message||'Curio could not process that request.');if(rejected==='frame')flush();else{$('#retry-interview').hidden=false;}return;}
    if(data.type==='response'){
      const kind=inFlight;inFlight=null;conversationId=data.conversation_id;
      if(typeof data.answer!=='string' || data.user_id!==userId){error('Curio returned an incomplete response.');return;}
      if(kind==='feedback'){
        renderAnswer($('#interview-feedback'),data.answer);$('#interview-feedback-section').hidden=false;
        speechDone=speakCurio(data.answer,{defaultOn:true});
        if(question>=5){phase='complete';status('Five questions complete. Take your feedback into the next conversation.');controls();await stopAnswer();stopCamera();return;}
        phase='question';pending={kind:'next',text:`Ask exactly one new interview question for the ${$('#interview-role').value}. Build on the previous answer and my remembered skill gaps. This will be question ${question+1} of 5. Only the question, no feedback or answer. After my next answer, give at most three sentences of technical and observable-delivery feedback, without another question until I request it.`,metrics:null};status('Preparing your next question…');flush();
      }else{
        if(kind==='next')question++;questionText=data.answer;$('#interview-count').textContent=`Question ${question} of 5`;
        renderAnswer($('#interview-question'),data.answer);$('#interview-transcript').value='';lastMetrics=null;phase='answering';controls();status('Press Start answering, then Finish Answer when you’re ready.');
        const mine=generation;await speechDone;if(mine===generation && !ended && !listening)speechDone=speakCurio(questionText,{defaultOn:true});
        nextFrame=Date.now()+interval;
      }
    }
  };
  current.onerror=()=>{if(socket===current)error('Curio Live is unavailable. Check that the backend is running.');};
  current.onclose=()=>{if(socket!==current || ended)return;error('The connection closed. Your transcript is preserved. End and start again to reconnect; submitted answers are not silently resent.');configured=false;controls();};
}
function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;$('#interview-camera-state').textContent='Camera stopped';$('.interview-live').classList.remove('active');}
async function endSession(){
  ended=true;++generation;cancelCurioSpeech();clearTimeout(connectTimer);clearInterval(frameTimer);await stopAnswer();stopCamera();
  const current=socket;socket=null;current?.close();configured=false;inFlight=null;pending=null;phase='ended';controls();
  $('#interview-start').disabled=false;$('#interview-start').textContent='Start a new interview ↗';$('#interview-intro').hidden=false;status('Interview ended. Your memories are still with you.');
}
async function startSession(){
  if(!ended)return;ended=false;++generation;question=1;questionText='';conversationId=null;lastMetrics=null;phase='connecting';inFlight=null;pending=null;error();
  $('#interview-start').disabled=true;$('#interview-count').textContent='Question 1 of 5';$('#interview-feedback-section').hidden=true;$('#interview-transcript').value='';$('#retry-interview').hidden=true;controls();status('Connecting to Curio and preparing your first question…');
  requestMedia();connect();frameTimer=setInterval(sampleFrame,500);
}
$('#interview-profile').textContent=`Personal space · ${userId}`;bindVoiceToggle($('#interview-voice'),true);loadContext();
$('#interview-start').onclick=startSession;$('#interview-end').onclick=endSession;$('#retry-media').onclick=requestMedia;$('#interview-mic').onclick=startAnswer;
$('#interview-finish').onclick=async()=>{
  const answer=$('#interview-transcript').value.trim();if(ended || phase!=='answering' || !answer)return;
  phase='evaluating';controls();await stopAnswer();
  ask('feedback',answer,lastMetrics);
};
$('#retry-interview').onclick=()=>{if(lastRequest && !inFlight){$('#retry-interview').hidden=true;error();pending=lastRequest;flush();}};
$('#read-question').onclick=()=>speakCurio(questionText,{defaultOn:true,force:true});
document.addEventListener('curio-speaking',event=>{$('#interview-status').classList.toggle('speaking',event.detail);if(event.detail)status('Curio is speaking…');else if(phase==='answering')status('Press Start answering, then Finish Answer when you’re ready.');});
window.addEventListener('pagehide',()=>{ended=true;++generation;cancelCurioSpeech();clearInterval(frameTimer);clearInterval(metricsTimer);stream?.getTracks().forEach(track=>track.stop());meter?.stop();recognition?.stop();socket?.close();});
