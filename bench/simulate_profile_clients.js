#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Minimal arg parsing
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

const PROFILES = {
  good: { rttMean: 40, rttStd: 10, packetLoss: 0.001, jitter: 10 },
  moderate: { rttMean: 80, rttStd: 30, packetLoss: 0.005, jitter: 20 },
  constrained: { rttMean: 150, rttStd: 50, packetLoss: 0.015, jitter: 40 },
  lossy: { rttMean: 300, rttStd: 100, packetLoss: 0.05, jitter: 100 }
};

const PROFILE = argv.profile || 'good';
const SIGNALING_URL = argv.url || process.env.SIGNALING_URL || 'ws://localhost:9090';
const CLIENTS = parseInt(argv.clients || process.env.CLIENTS || '8', 10);
const DURATION = parseInt(argv.duration || process.env.DURATION || '20', 10);
const OUT = argv.out || path.join(process.cwd(), 'bench', 'results', `${PROFILE}-${Date.now()}.json`);
const TELEMETRY_INTERVAL = parseInt(argv.telemetryInterval || '2000', 10);
const JOIN_TIMEOUT = parseInt(argv.joinTimeout || '5000', 10);

if (!PROFILES[PROFILE]) {
  console.error(`Unknown profile: ${PROFILE}`);
  process.exit(2);
}

function sampleNormal(mean, std) {
  // Box-Muller
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(1, Math.round(num * std + mean));
}

const profileCfg = PROFILES[PROFILE];

function now(){return Date.now();}

(async function main(){
  const results = { profile: PROFILE, clients: CLIENTS, duration: DURATION, startedAt: now(), joinResults: [], telemetry: [] };

  function logEvent(obj){
    console.log(JSON.stringify(obj));
  }

  function recordTelemetry(sample){
    results.telemetry.push(sample);
    logEvent({ event: 'telemetry_sample', profile: PROFILE, sample });
  }

  function recordJoin(result){
    results.joinResults.push(result);
    logEvent({ event: 'join_result', profile: PROFILE, result });
  }

  function scheduleTelemetry(ws, clientId){
    const tInt = TELEMETRY_INTERVAL;
    let stopped = false;
    const iv = setInterval(()=>{
      if (stopped) return;
      const rtt = sampleNormal(profileCfg.rttMean, profileCfg.rttStd);
      const packetLoss = parseFloat((Math.random() * profileCfg.packetLoss * 2).toFixed(4));
      const metrics = { rtt, jitter: profileCfg.jitter, packetLoss };
      const payload = { type: 'telemetry', clientId, timestamp: now(), metrics };
      try{ ws.send(JSON.stringify(payload)); }catch(e){}
      recordTelemetry({ clientId, ts: now(), metrics });
    }, tInt);
    return ()=>{ stopped = true; clearInterval(iv); };
  }

  const clients = [];
  for(let i=0;i<CLIENTS;i++){
    clients.push(new Promise((resolve)=>{
      const clientId = `client-${i+1}`;
      const ws = new WebSocket(SIGNALING_URL);
      let outbound = 0, inbound = 0, endToEndDrop = false;
      let stopTelemetry = ()=>{};
      let joined = false;
      let sendTs = null;
      let joinHandled = false;

      ws.on('open', ()=>{
        logEvent({ event: 'client_connect', clientId, ts: now() });
        // sample RTT and loss
        const rtt = sampleNormal(profileCfg.rttMean, profileCfg.rttStd);
        const jitter = Math.round((Math.random()-0.5) * profileCfg.jitter);
        // compute outbound/inbound so message handler can access inbound later
        outbound = Math.max(0, Math.round(rtt/2 + jitter));
        inbound = Math.max(0, rtt - outbound);
        endToEndDrop = (Math.random() < profileCfg.packetLoss);

        // schedule telemetry
        stopTelemetry = scheduleTelemetry(ws, clientId);

        if (endToEndDrop) {
          // simulate lost join: do not send join; record a failure after timeout
          logEvent({ event: 'join_drop_simulated', clientId, reason: 'simulated_packet_loss' });
          setTimeout(()=>{
            if (!joinHandled){
              joinHandled = true;
              recordJoin({ clientId, success: false, reason: 'simulated_packet_loss', sentTs: null, serverTs: null, recvTs: null, latencyMs: null });
              // leave and close
              try{ ws.send(JSON.stringify({ type: 'leave', clientId, room: 'bench-room' })); }catch(e){}
              ws.close();
              stopTelemetry();
              resolve();
            }
          }, JOIN_TIMEOUT);
        } else {
          // send join after outbound delay -- simulate uplink
          setTimeout(()=>{
            sendTs = now();
            const joinMsg = { type: 'join', clientId, room: 'bench-room', joinTs: sendTs };
            // Also send a modern join_room message so the real signaling server can handle rejoin tests
            const joinRoomMsg = { type: 'join_room', roomId: 'bench-room', participantId: clientId, role: 'viewer' };
            try{ ws.send(JSON.stringify(joinMsg)); }catch(e){}
            try{ ws.send(JSON.stringify(joinRoomMsg)); }catch(e){}
            // wait for server joined reply; fallback timeout
            const to = setTimeout(()=>{
              if (!joinHandled){
                joinHandled = true;
                recordJoin({ clientId, success: false, reason: 'timeout_no_join_reply', sentTs: sendTs, serverTs: null, recvTs: null, latencyMs: null });
                try{ ws.send(JSON.stringify({ type: 'leave', clientId, room: 'bench-room' })); }catch(e){}
                ws.close();
                stopTelemetry();
                resolve();
              }
            }, JOIN_TIMEOUT + 2000);
          }, outbound);
        }

        // ensure we leave after test duration
        setTimeout(()=>{
          try{ ws.send(JSON.stringify({ type: 'leave', clientId, room: 'bench-room' })); }catch(e){}
          try{ ws.close(); }catch(e){}
        }, DURATION*1000 + 1000);
      });

      ws.on('message', (msg)=>{
        // simulate inbound delay by parsing then scheduling handling
        try{
          const d = JSON.parse(msg.toString());
          // handle 'joined' and 'joined_room' for latency measurement
          if (d.type === 'joined' || d.type === 'joined_room'){
            // apply inbound delay to approximate downlink latency
            const addedDelay = inbound || Math.max(0, Math.round((Math.random()-0.5) * profileCfg.jitter));
            setTimeout(()=>{
              if (!joinHandled){
                joinHandled = true;
                const recvTs = now();
                const latency = sendTs ? recvTs - sendTs : null;
                recordJoin({ clientId, success: true, reason: null, sentTs: sendTs, serverTs: d.serverTs || null, recvTs, latencyMs: latency });
              }
            }, addedDelay);
          }
        }catch(e){ console.error('client parse error', e); }
      });

      ws.on('close', ()=>{
        logEvent({ event: 'client_disconnect', clientId, ts: now() });
        stopTelemetry();
        resolve();
      });

      ws.on('error', (err)=>{
        logEvent({ event: 'client_error', clientId, error: String(err) });
        stopTelemetry();
        resolve();
      });
    }));

    // stagger start to avoid thundering herd
    await new Promise(r=>setTimeout(r, 150));
  }

  await Promise.all(clients);
  results.endedAt = now();

  // write results
  try{
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ event: 'results_written', path: OUT }));
  }catch(e){ console.error('failed to write results', e); }

  console.log(JSON.stringify({ event: 'simulate_complete', profile: PROFILE, clients: CLIENTS, duration: DURATION }));
  process.exit(0);
})();
