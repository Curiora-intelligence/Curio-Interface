checks.cameraDenied=false;checks.microphoneDenied=false;checks.spoken=[];checks.cancelled=0;checks.questions=0;checks.feedback=0;
localStorage.removeItem('curio_voice_replies');
checks.memories=[{id:'gap',kind:'skill_gap',key:'interview',value:'database indexing'}];
window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
  cancel(){checks.cancelled++;},getVoices(){return[{name:'English test voice',lang:'en-US',localService:true},{name:'India test voice',lang:'en-IN',localService:true}];},
  speak(utterance){checks.spoken.push(utterance);utterance.onstart?.();setTimeout(()=>utterance.onend?.(),15);}
}});
window.WebSocket=class {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=1;checks.sockets.push(this);setTimeout(()=>this.receive({type:'ready',frame_interval_seconds:5}),15);}
  receive(data){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(data)});}
  send(raw){const data=JSON.parse(raw);checks.liveSent.push(data);
    if(data.type==='configure')setTimeout(()=>this.receive({type:'configured',mode:'interview',frame_interval_seconds:5}),5);
    if(data.type==='frame')setTimeout(()=>this.receive({type:'observation',mode:'interview',observation:{gaze_direction:'toward_camera',head_orientation:'forward',posture:'upright'}}),20);
    if(data.type==='transcript'){
      let answer;
      if(data.text.startsWith('Start a mock interview') || data.text.startsWith('Ask exactly one new')){checks.questions++;answer=`Question ${checks.questions}: How does a database index affect reads and writes?`;}
      else{checks.feedback++;answer='Your explanation covered faster reads. Include the write-cost tradeoff and a concrete example.';}
      setTimeout(()=>this.receive({type:'response',answer,conversation_id:'interview-cid',user_id:'demo-sai'}),35);
    }
  }
  close(){this.readyState=3;this.onclose?.();}
};
