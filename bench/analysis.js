#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const argv = {};
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (!a || !a.startsWith('--')) continue;
  const key = a.replace(/^--/, '');
  const next = rawArgs[i + 1];
  if (next && !next.startsWith('--')) { argv[key] = next; i++; } else { argv[key] = true; }
}

const RESULTS_DIR = argv.results_dir || path.join(process.cwd(), 'bench', 'results');
const OUT = argv.out || path.join(process.cwd(), 'bench', 'benchmark_results.md');

function median(arr){ if (!arr.length) return null; const s = arr.slice().sort((a,b)=>a-b); const mid = Math.floor(s.length/2); return s.length%2===1 ? s[mid] : (s[mid-1]+s[mid])/2; }
function percentile(arr, p){ if (!arr.length) return null; const s = arr.slice().sort((a,b)=>a-b); const idx = Math.ceil((p/100)*s.length)-1; return s[Math.min(Math.max(idx,0), s.length-1)]; }
function mean(arr){ if (!arr.length) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }

const THRESHOLDS = {
  good: { medianJoinMs: 300, avgPacketLoss: 0.005, dropRate: 0.02 },
  moderate: { medianJoinMs: 600, avgPacketLoss: 0.01, dropRate: 0.05 },
  constrained: { medianJoinMs: 1500, avgPacketLoss: 0.02, dropRate: 0.1 },
  lossy: { medianJoinMs: 3000, avgPacketLoss: 0.05, dropRate: 0.2 }
};

function evaluate(profile, metrics){
  const t = THRESHOLDS[profile] || {};
  return {
    medianJoinMs_pass: metrics.medianJoinMs != null ? metrics.medianJoinMs <= t.medianJoinMs : false,
    avgPacketLoss_pass: metrics.avgPacketLoss != null ? metrics.avgPacketLoss <= t.avgPacketLoss : false,
    dropRate_pass: metrics.dropRate != null ? metrics.dropRate <= t.dropRate : false
  };
}

function readJsonFiles(dir){
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  const data = [];
  for(const f of files){
    try{
      const txt = fs.readFileSync(path.join(dir,f),'utf8');
      const obj = JSON.parse(txt);
      obj.__file = f;
      data.push(obj);
    }catch(e){ console.error('failed parse', f, e); }
  }
  return data;
}

const datasets = readJsonFiles(RESULTS_DIR);
if (!datasets.length){ console.error('No result JSON files found in', RESULTS_DIR); process.exit(2); }

let md = '# Benchmark Results\n\n';
md += `Generated: ${new Date().toISOString()}\n\n`;

for(const d of datasets){
  md += `## ${d.profile} — ${d.__file}\n\n`;
  const joinResults = d.joinResults || [];
  const total = d.clients || (joinResults.length);
  const successes = joinResults.filter(j=>j && j.success);
  const failures = joinResults.filter(j=>!j || !j.success);
  const latencies = successes.map(s=>s.latencyMs).filter(v=>v!=null);
  const telemetry = d.telemetry || [];
  const packetLossSamples = telemetry.map(t=>t.metrics && t.metrics.packetLoss).filter(v=>typeof v === 'number');
  const rttSamples = telemetry.map(t=>t.metrics && t.metrics.rtt).filter(v=>typeof v === 'number');

  const metrics = {
    totalClients: total,
    successCount: successes.length,
    failureCount: failures.length,
    dropRate: total ? (failures.length/total) : null,
    medianJoinMs: median(latencies),
    avgPacketLoss: packetLossSamples.length ? mean(packetLossSamples) : null,
    rtt_median: rttSamples.length ? median(rttSamples) : null,
    rtt_95: rttSamples.length ? percentile(rttSamples,95) : null,
    joinsPerSecond: d.duration ? (successes.length / d.duration) : null
  };

  md += '| Metric | Value |\n|---|---:|\n';
  md += `| Total clients | ${metrics.totalClients} |\n`;
  md += `| Successful joins | ${metrics.successCount} |\n`;
  md += `| Failed joins | ${metrics.failureCount} |\n`;
  md += `| Drop rate | ${metrics.dropRate!=null ? (metrics.dropRate*100).toFixed(2)+'%' : 'n/a'} |\n`;
  md += `| Median join latency (ms) | ${metrics.medianJoinMs!=null ? metrics.medianJoinMs.toFixed(2) : 'n/a'} |\n`;
  md += `| Average reported packet loss | ${metrics.avgPacketLoss!=null ? metrics.avgPacketLoss.toFixed(4) : 'n/a'} |\n`;
  md += `| RTT median (ms) | ${metrics.rtt_median!=null ? metrics.rtt_median.toFixed(2) : 'n/a'} |\n`;
  md += `| RTT 95th (ms) | ${metrics.rtt_95!=null ? metrics.rtt_95.toFixed(2) : 'n/a'} |\n`;
  md += `| Joins per second | ${metrics.joinsPerSecond!=null ? metrics.joinsPerSecond.toFixed(2) : 'n/a'} |\n`;

  const pass = evaluate(d.profile, metrics);
  md += '\n### Pass/Fail\n\n';
  md += `- Median join latency: ${pass.medianJoinMs_pass ? 'PASS' : 'FAIL'}\n`;
  md += `- Avg packet loss: ${pass.avgPacketLoss_pass ? 'PASS' : 'FAIL'}\n`;
  md += `- Drop rate: ${pass.dropRate_pass ? 'PASS' : 'FAIL'}\n`;

  md += '\n---\n\n';
}

try{
  fs.writeFileSync(OUT, md);
  console.log('Wrote', OUT);
} catch(e){ console.error('Failed to write', OUT, e); process.exit(2); }

console.log('Analysis complete.');
process.exit(0);
