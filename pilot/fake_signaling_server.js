#!/usr/bin/env node
const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port }, ()=> console.log(JSON.stringify({event:'server_start', port}))); 

const rooms = {};

wss.on('connection', (ws)=>{
  ws.on('message', (msg)=>{
    try{
      const data = JSON.parse(msg.toString());
      if (data.type === 'join'){
        ws.clientId = data.clientId || 'unknown';
        ws.room = data.room || 'default';
        rooms[ws.room] = rooms[ws.room] || new Set();
        rooms[ws.room].add(ws);
        console.log(JSON.stringify({event:'join', clientId: ws.clientId, room: ws.room, ts: Date.now()}));
        // notify peers
        for(const peer of rooms[ws.room]){
          if (peer !== ws && peer.readyState === WebSocket.OPEN){
            peer.send(JSON.stringify({type:'peer-joined', clientId: ws.clientId}));
          }
        }
        // echo server timestamp and any client-provided joinTs for measuring join latency
        ws.send(JSON.stringify({type:'joined', clientId: ws.clientId, serverTs: Date.now(), joinEcho: data.joinTs || null}));
      } else if (data.type === 'telemetry'){
        console.log(JSON.stringify({event:'telemetry', data}));
      } else if (data.type === 'leave'){
        if (rooms[ws.room]) rooms[ws.room].delete(ws);
        console.log(JSON.stringify({event:'leave', clientId: data.clientId, room: ws.room}));
      } else {
        console.log(JSON.stringify({event:'unknown', raw: data}));
      }
    } catch(e){
      console.log(JSON.stringify({event:'invalid', raw: msg.toString()}));
    }
  });
  ws.on('close', ()=>{
    if (ws.room && rooms[ws.room]) rooms[ws.room].delete(ws);
    console.log(JSON.stringify({event:'disconnect', clientId: ws.clientId || 'unknown'}));
  });
});
