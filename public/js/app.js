// Theme
function toggleTheme(){document.body.classList.toggle('light');localStorage.setItem('theme',document.body.classList.contains('light')?'light':'dark')}
if(localStorage.getItem('theme')==='light') document.body.classList.add('light');

// IST clock — always live
function updateClock(){
  const ist=new Date(Date.now()+(5.5*60*60*1000));
  const p=n=>n.toString().padStart(2,'0');
  const el=document.getElementById('clock');
  if(el) el.textContent=`${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())} IST`;
}
updateClock();setInterval(updateClock,1000);

// P&L chart
function drawPnl(rawData){
  const canvas=document.getElementById('pnlChart'); if(!canvas||!rawData||!rawData.length) return;
  const ctx=canvas.getContext('2d');
  let cum=0;
  const vals=[0,...rawData.map(d=>{cum+=parseFloat(d.pnl||0);return Math.round(cum)})];
  const labels=['Start',...rawData.map(d=>(d.day||'').toString().slice(5))];
  const W=canvas.parentElement.offsetWidth-32; canvas.width=W; canvas.height=60;
  const min=Math.min(...vals)-80,max=Math.max(...vals)+80,range=max-min||1;
  const pts=vals.map((v,i)=>[i/(vals.length-1)*W,60-(v-min)/range*55]);
  const isDark=!document.body.classList.contains('light');
  ctx.clearRect(0,0,W,60);
  const lastVal=vals[vals.length-1];
  const lineColor=lastVal>=0?'#22c55e':'#ef4444';
  ctx.beginPath();ctx.moveTo(pts[0][0],60);
  pts.forEach(p=>ctx.lineTo(p[0],p[1]));
  ctx.lineTo(pts[pts.length-1][0],60);ctx.closePath();
  ctx.fillStyle=lastVal>=0?'rgba(34,197,94,0.08)':'rgba(239,68,68,0.08)';ctx.fill();
  ctx.beginPath();pts.forEach((p,i)=>i===0?ctx.moveTo(p[0],p[1]):ctx.lineTo(p[0],p[1]));
  ctx.strokeStyle=lineColor;ctx.lineWidth=1.5;ctx.stroke();
  const zY=60-(0-min)/range*55;
  ctx.beginPath();ctx.moveTo(0,zY);ctx.lineTo(W,zY);
  ctx.strokeStyle=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)';ctx.lineWidth=0.5;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);
}
window.addEventListener('resize',()=>{if(window._pnlData) drawPnl(window._pnlData)});

// Drawer
function showDrawer(id){document.getElementById('drawer-overlay').style.display='block';document.getElementById(id).style.display='block'}
function closeDrawer(){document.getElementById('drawer-overlay').style.display='none';['match-drawer','player-drawer'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none'})}

// Bet tabs
function showBets(id,btn){
  document.querySelectorAll('.toggle-pill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const vb=document.getElementById('valuebets'),tr=document.getElementById('tradeable'),lbl=document.getElementById('found-label');
  if(!vb||!tr) return;
  if(id==='valuebets'){
    vb.style.display='block';tr.style.display='none';
    if(lbl) lbl.innerHTML='<span style="color:var(--green);font-weight:600">'+vb.dataset.count+'</span> found · 15%+ edge';
  } else {
    vb.style.display='none';tr.style.display='block';
    if(lbl) lbl.innerHTML='<span style="color:var(--amber);font-weight:600">'+tr.dataset.count+'</span> found · T1/T3/T4/T6';
  }
}

// Match drawer — called with inline JSON from EJS
function openMatchDrawer(data){
  const m=data;
  const p1=m.p1data||{}, p2=m.p2data||{};
  const eKey=m.surface==='Hard'?'elo_hard':m.surface==='Clay'?'elo_clay':'elo_grass';
  const form=p=>(p.form||[]).map(r=>`<span class="form-pip form-${r.toLowerCase()}">${r}</span>`).join('');
  const sc=(label,v1,v2,n1,n2,low=false)=>{
    const b1=low?n1<n2:n1>n2,max=Math.max(n1||0,n2||0)||1;
    const p1p=Math.round(((n1||0)/max)*100),p2p=Math.round(((n2||0)/max)*100);
    return `<div class="sc-row"><div><div class="sc-val">${v1}</div><div class="sc-bar-wrap"><div class="sc-bar" style="width:${p1p}%;background:${b1?'var(--green)':'var(--text3)'}"></div></div></div><div class="sc-label">${label}</div><div style="text-align:right"><div class="sc-val">${v2}</div><div class="sc-bar-wrap"><div class="sc-bar" style="width:${p2p}%;background:${!b1?'var(--green)':'var(--text3)'}"></div></div></div></div>`;
  };
  const h2h=(m.h2h||[]).length?m.h2h.map(h=>`<div class="h2h-row"><span class="h2h-winner">${h.winner}</span><span style="color:var(--text3);font-size:11px">def.</span><span style="color:var(--text2)">${h.loser||''}</span><span style="color:var(--text3);margin-left:auto;font-family:var(--mono);font-size:11px">${h.surface||''} · ${h.year||''}</span></div>`).join(''):`<div style="color:var(--text3);font-size:12px;padding:8px 0">No previous meetings</div>`;
  const oddsHtml=m.odds_p1?`<div class="compute-row"><span class="compute-label">Odds for ${m.player1}</span><input class="compute-input" id="ci-p1" type="number" step="0.01" value="${m.odds_p1}" oninput="recompute()"></div><div class="compute-row"><span class="compute-label">Odds for ${m.player2}</span><input class="compute-input" id="ci-p2" type="number" step="0.01" value="${m.odds_p2}" oninput="recompute()"></div><div class="compute-result" id="cres">Loading...</div>`:`<div style="color:var(--text3);font-size:12px">No odds available yet</div>`;
  window._matchDrawerData=m;
  document.getElementById('drawer-title').textContent=`${m.player1} vs ${m.player2}`;
  document.getElementById('drawer-content').innerHTML=`
    <div class="drawer-sec">
      <div style="display:flex;gap:8px;font-size:12px;color:var(--text2);margin-bottom:12px;flex-wrap:wrap">
        <span style="font-weight:600;color:var(--text)">${m.tournament||''}</span><span>·</span><span>${m.surface||''}</span><span>·</span><span>${m.round||''}</span><span>·</span><span style="font-family:var(--mono)">${m.time_ist||''}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:start;margin-bottom:16px">
        <div><div style="font-size:16px;font-weight:600">${m.player1}</div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);margin-top:2px">Rank #${p1.ranking||'—'} · Elo ${p1.elo_overall||m.p1_elo||'—'}</div><div style="display:flex;gap:3px;margin-top:6px">${form(p1)}</div></div>
        <div style="color:var(--text3);font-size:12px;text-align:center;padding-top:4px">vs</div>
        <div style="text-align:right"><div style="font-size:16px;font-weight:600">${m.player2}</div><div style="font-family:var(--mono);font-size:11px;color:var(--text2);margin-top:2px">Elo ${p2.elo_overall||m.p2_elo||'—'} · Rank #${p2.ranking||'—'}</div><div style="display:flex;gap:3px;margin-top:6px;justify-content:flex-end">${form(p2)}</div></div>
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Elo by surface</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:5px">${m.player1}</div>
          <div class="elo-surf-grid"><div class="elo-surf-box"><div class="elo-surf-label">Hard</div><div class="elo-surf-val">${p1.elo_hard||'—'}</div></div><div class="elo-surf-box"><div class="elo-surf-label">Clay</div><div class="elo-surf-val">${p1.elo_clay||'—'}</div></div><div class="elo-surf-box"><div class="elo-surf-label">Grass</div><div class="elo-surf-val">${p1.elo_grass||'—'}</div></div></div>
        </div>
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:5px">${m.player2}</div>
          <div class="elo-surf-grid"><div class="elo-surf-box"><div class="elo-surf-label">Hard</div><div class="elo-surf-val">${p2.elo_hard||'—'}</div></div><div class="elo-surf-box"><div class="elo-surf-label">Clay</div><div class="elo-surf-val">${p2.elo_clay||'—'}</div></div><div class="elo-surf-box"><div class="elo-surf-label">Grass</div><div class="elo-surf-val">${p2.elo_grass||'—'}</div></div></div>
        </div>
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Stats comparison</div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        ${sc('Elo ('+m.surface+')',p1[eKey]||m.p1_elo||'—',p2[eKey]||m.p2_elo||'—',p1[eKey]||m.p1_elo,p2[eKey]||m.p2_elo)}
        ${sc('Serve hold %',p1.serve_hold_pct?Math.round(p1.serve_hold_pct*100)+'%':'—',p2.serve_hold_pct?Math.round(p2.serve_hold_pct*100)+'%':'—',p1.serve_hold_pct,p2.serve_hold_pct)}
        ${sc('Break rate %',p1.break_rate?Math.round(p1.break_rate*100)+'%':'—',p2.break_rate?Math.round(p2.break_rate*100)+'%':'—',p1.break_rate,p2.break_rate)}
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Model probability</div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px"><span style="font-weight:600">${m.player1}</span><span style="font-family:var(--mono);color:var(--text2)">${m.elo_prob_p1}% vs ${m.elo_prob_p2}%</span><span style="font-weight:600">${m.player2}</span></div>
        <div class="prob-bar" style="height:32px;border-radius:8px">
          <div class="prob-fill model-g" style="width:${m.elo_prob_p1}%;font-size:13px">${m.elo_prob_p1}%</div>
          <div class="prob-fill book" style="width:${m.elo_prob_p2}%;font-size:13px">${m.elo_prob_p2}%</div>
        </div>
        ${m.odds_p1?`<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--text3)"><span>Bookie implies ${Math.round(100/m.odds_p1)}%</span><span>Bookie implies ${Math.round(100/m.odds_p2)}%</span></div>`:''}
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Compute your own edge</div>
      <div class="compute-box">${oddsHtml}</div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Head to head · ${(m.h2h||[]).length} meetings</div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:8px 12px">${h2h}</div>
    </div>`;
  if(m.odds_p1) setTimeout(recompute,50);
  showDrawer('match-drawer');
}

function recompute(){
  const m=window._matchDrawerData; if(!m) return;
  const o1=parseFloat(document.getElementById('ci-p1')?.value)||m.odds_p1;
  const o2=parseFloat(document.getElementById('ci-p2')?.value)||m.odds_p2;
  const r1=1/o1,r2=1/o2,sum=r1+r2;
  const i1=r1/sum,i2=r2/sum;
  const mo1=parseFloat(m.elo_prob_p1)/100,mo2=parseFloat(m.elo_prob_p2)/100;
  const e1=((mo1-i1)*100).toFixed(1),e2=((mo2-i2)*100).toFixed(1);
  const best=Math.max(parseFloat(e1),parseFloat(e2));
  const betOn=parseFloat(e1)>parseFloat(e2)?m.player1:m.player2;
  const betOdds=parseFloat(e1)>parseFloat(e2)?o1:o2;
  const ovr=((sum-1)*100).toFixed(1);
  const el=document.getElementById('cres'); if(!el) return;
  if(best>15) el.innerHTML=`<span style="color:var(--green);font-weight:600">Back ${betOn} @ ${betOdds.toFixed(2)}</span> — edge <span style="color:var(--green);font-family:var(--mono)">+${best.toFixed(1)}%</span> · overround ${ovr}% removed`;
  else if(best>0) el.innerHTML=`<span style="color:var(--amber)">Marginal edge on ${betOn}</span> — +${best.toFixed(1)}% · below 15% threshold`;
  else el.innerHTML=`<span style="color:var(--text3)">No value at these odds — skip.</span>`;
}

function openPlayerDrawer(data){
  const p=data;
  const psr=(label,val,num,max)=>{
    const bar=num!=null?`<div style="height:3px;border-radius:2px;background:var(--bg4);margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.min(100,Math.round((num/max)*100))}%;background:var(--green);border-radius:2px"></div></div>`:'';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text2)">${label}</span><div style="text-align:right"><div style="font-family:var(--mono);font-size:13px;font-weight:500">${val}</div>${bar}</div></div>`;
  };
  window._playerElo=p.elo_overall;
  document.getElementById('player-drawer-title').textContent=p.fullName||p.name;
  document.getElementById('player-drawer-content').innerHTML=`
    <div style="margin-bottom:20px">
      <div style="font-size:22px;font-weight:600;letter-spacing:-.5px">${p.fullName||p.name}</div>
      <div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text2)">${p.country||''}</span>
        ${p.tour?`<span style="color:var(--text3)">·</span><span style="font-size:12px;color:var(--text2)">${p.tour}</span>`:''}
        ${p.ranking?`<span style="color:var(--text3)">·</span><span style="font-family:var(--mono);font-size:13px;font-weight:600;color:var(--green)">Rank #${p.ranking}</span>`:''}
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Elo ratings</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
        <div class="elo-surf-box"><div class="elo-surf-label">Overall</div><div class="elo-surf-val" style="color:var(--green)">${p.elo_overall||'—'}</div></div>
        <div class="elo-surf-box"><div class="elo-surf-label">Hard</div><div class="elo-surf-val">${p.elo_hard||'—'}</div></div>
        <div class="elo-surf-box"><div class="elo-surf-label">Clay</div><div class="elo-surf-val">${p.elo_clay||'—'}</div></div>
        <div class="elo-surf-box"><div class="elo-surf-label">Grass</div><div class="elo-surf-val">${p.elo_grass||'—'}</div></div>
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Performance stats</div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        ${p.serve_hold_pct!=null?psr('Serve hold %',Math.round(p.serve_hold_pct*100)+'%',p.serve_hold_pct,1):''}
        ${p.break_rate!=null?psr('Break rate %',Math.round(p.break_rate*100)+'%',p.break_rate,0.4):''}
        ${p.match_count!=null?psr('Career matches',p.match_count):''}
        ${p.last_match_date?psr('Last played',p.last_match_date):''}
      </div>
    </div>
    <div class="drawer-sec">
      <div class="drawer-sec-title">Quick edge calculator</div>
      <div class="compute-box">
        <div class="compute-row"><span class="compute-label">Bookmaker odds</span><input class="compute-input" id="pk-odds" type="number" step="0.01" placeholder="e.g. 2.10" oninput="calcEdge()"></div>
        <div class="compute-row"><span class="compute-label">Opponent Elo</span><input class="compute-input" id="pk-opp" type="number" placeholder="e.g. 1650" oninput="calcEdge()"></div>
        <div class="compute-result" id="pk-res" style="color:var(--text3)">Enter odds and opponent Elo above</div>
      </div>
    </div>`;
  showDrawer('player-drawer');
}

function calcEdge(){
  const elo=window._playerElo;
  const odds=parseFloat(document.getElementById('pk-odds')?.value);
  const opp=parseFloat(document.getElementById('pk-opp')?.value);
  const el=document.getElementById('pk-res'); if(!el||!odds||!opp) return;
  const diff=elo-opp;
  const mp=1/(1+Math.pow(10,-diff/400));
  const ip=1/odds;
  const edge=((mp-ip)*100).toFixed(1);
  if(parseFloat(edge)>15) el.innerHTML=`<span style="color:var(--green);font-weight:600">+${edge}% edge</span> — model says ${(mp*100).toFixed(0)}%, odds imply ${(ip*100).toFixed(0)}%. Back at these odds.`;
  else if(parseFloat(edge)>0) el.innerHTML=`<span style="color:var(--amber)">+${edge}% — marginal.</span> Below 15% threshold.`;
  else el.innerHTML=`<span style="color:var(--red)">${edge}% — no value.</span> Skip.`;
}
