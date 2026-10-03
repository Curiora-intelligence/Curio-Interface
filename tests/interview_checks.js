import {speechText} from '/static/js/voice.js';
const report=document.createElement('pre');report.id='interview-check-results';report.style='position:fixed;right:8px;top:8px;background:white;padding:14px;z-index:9999;max-width:440px;font-size:11px;white-space:pre-wrap;border:1px solid #dde';document.body.append(report);
let passes=0;const pause=ms=>new Promise(r=>setTimeout(r,ms));
function ok(value,label){if(!value)throw Error(label);passes++;report.textContent+=`PASS ${label}\n`;}
async function until(fn){for(let i=0;i<240;i++){if(fn())return;await pause(30);}throw Error('Browser wait timed out');}
try{
  document.querySelector('#interview-start').click();await until(()=>document.querySelector('#interview-question').textContent.includes('Question 1:'));
  ok(checks.liveSent[0].type==='configure' && checks.liveSent[0].mode==='interview','ready then configure uses current interview protocol');
  ok(checks.sockets[0].url.endsWith('/demo-sai'),'interview shares stable identity');
  await until(()=>checks.spoken.length===1);
  ok(checks.spoken[0].voice.lang==='en-IN' && checks.spoken[0].text.includes('Question 1'),'first question uses browser English TTS');
  ok(document.querySelector('#interview-memory').textContent.includes('database indexing'),'saved skill gap appears');
  await until(()=>document.querySelector('#interview-camera').videoWidth>0);
  ok(document.querySelector('#interview-intro').hidden,'camera preview plays');
  const before=checks.liveSent.filter(e=>e.type==='transcript').length;
  document.querySelector('#interview-mic').click();await until(()=>document.querySelector('#interview-transcript').value.includes('dictated'));
  ok(checks.liveSent.filter(e=>e.type==='transcript').length===before,'dictation does not invoke GPT per segment');
  ok(checks.cancelled>0,'recording cancels previous speech');
  await pause(250); // Let the real 100 ms AudioMeter sampler collect measurements.
  document.querySelector('#interview-transcript').value='Indexes speed reads but add work to writes. A B-tree helps a selective WHERE condition.';
  document.querySelector('#interview-finish').click();document.querySelector('#interview-finish').click();
  await until(()=>document.querySelector('#interview-count').textContent==='Question 2 of 5');
  ok(checks.feedback===1,'Finish Answer submits only once');
  const payload=checks.liveSent.filter(e=>e.type==='transcript')[1];
  ok(payload.text.startsWith('Indexes speed reads') && !payload.text.includes('Evaluate my answer'),'metrics count only the actual answer, not instructions');
  ok(payload.metrics && payload.metrics.rms.length<=600 && !('audio' in payload),'answer sends bounded observable metrics without raw audio');
  await until(()=>checks.spoken.length>=3);
  ok(checks.spoken[1].text.includes('write-cost') && checks.spoken[2].text.includes('Question 2'),'feedback and next question both speak');
  ok(document.querySelector('#interview-feedback').textContent.includes('write-cost'),'feedback renders separately from question');
  for(let number=2;number<=5;number++){
    await until(()=>!document.querySelector('#interview-finish').disabled);
    document.querySelector('#interview-transcript').value=`Answer ${number}: a selective index speeds reads and increases write costs.`;
    document.querySelector('#interview-finish').click();
    if(number<5)await until(()=>document.querySelector('#interview-count').textContent===`Question ${number+1} of 5`);
  }
  await until(()=>document.querySelector('#interview-status').textContent.includes('Five questions complete'));
  ok(checks.questions===5 && checks.feedback===5,'session stops at five evaluated questions');
  ok(checks.liveSent.filter(e=>e.type==='transcript' && e.text.startsWith('Answer ')).every(e=>!e.metrics),'typed later answers do not reuse an earlier microphone sample');
  ok(document.querySelector('#interview-finish').disabled,'completed session cannot submit a sixth answer');
  ok(speechText('**Hello** [source](https://example.com)')==='Hello source','TTS strips Markdown and URLs');
  document.querySelector('#interview-end').click();await until(()=>checks.sockets.at(-1).readyState===3);
  ok(true,'End Interview releases the connection');
  report.textContent+=`\n${passes} interview checks passed`;
}catch(error){report.textContent+=`\nFAIL ${error.stack}`;}
