#!/usr/bin/env node
const WebSocket = require('ws');
// Minimal argument parsing to avoid extra deps
const argv = {};
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (!a || !a.startsWith('--')) continue;
  const key = a.replace(/^--/, '');
  const next = rawArgs[i + 1];
  if (next && !next.startsWith('--')) {
    argv[key] = next;
    i++;
  } else {
    argv[key] = true;
  }
}


const SIGNALING_URL = process.env.SIGNALING_URL || argv.url || 'ws://localhost:8080';
const CLIENTS = parseInt(argv.clients || process.env.CLIENTS || '4', 10);
const DURATION = parseInt(argv.duration || process.env.DURATION || '15', 10);

function delay(ms){return new Promise(r=>setTimeout(r,ms));}

async function runClient(id){
  return new Promise((resolve)=>{
    const ws = new WebSocket(SIGNALING_URL);
    ws.on('open', ()=>{
      console.log(JSON.stringify({event:'client_connect', client:id, ts:Date.now()}));
      ws.send(JSON.stringify({type:'join', clientId:`client-${id}`, room:'pilot-room'}));
      const interval = setInterval(()=>{
        const telemetry = {
          type:'telemetry',
          clientId:`client-${id}`,
          timestamp:Date.now(),
          metrics:{ rtt: Math.round(Math.random()*200), jitter: Math.round(Math.random()*50), packetLoss: parseFloat((Math.random()*3).toFixed(2)) }
        };
        ws.send(JSON.stringify(telemetry));
      }, 2000);

      setTimeout(()=>{
        clearInterval(interval);
        ws.send(JSON.stringify({type:'leave', clientId:`client-${id}`, room:'pilot-room'}));
        ws.close();
      }, DURATION*1000);
    });

    ws.on('message', (msg)=>{
      try{ const d = JSON.parse(msg.toString()); console.log(JSON.stringify({event:'client_message', client:id, data:d})); }catch(e){ console.log('[client] raw', msg.toString()); }
    });

    ws.on('close', ()=>{ console.log(JSON.stringify({event:'client_disconnect', client:id, ts:Date.now()})); resolve(); });
    ws.on('error', (err)=>{ console.error(JSON.stringify({event:'client_error', client:id, error: String(err)})); resolve(); });
  });
}

(async ()=>{
  const seeds = [];
  for(let i=0;i<CLIENTS;i++){
    seeds.push(runClient(i+1));
    await delay(200);
  }
  await Promise.all(seeds);
  console.log(JSON.stringify({event:'simulate_complete', clients:CLIENTS, duration:DURATION}));
})();
