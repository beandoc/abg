window.ABG = window.ABG || {};

ABG.Trend = (function(){
  'use strict';
  const f1 = x => (Math.round(x*10)/10).toFixed(1);

  const log = [];

  function add(entry){ log.push(entry); }
  function clear(){ log.length = 0; }

  function arrow(cur, prev, goodDir){
    if(prev==null||cur==null) return '';
    const diff=cur-prev;
    if(Math.abs(diff)<0.01) return '<span class="arrow">→</span>';
    const up=diff>0;
    const good = (up && goodDir>0)||(!up && goodDir<0);
    if(goodDir===0) return `<span class="arrow">${up?'▲':'▼'}</span>`;
    return `<span class="arrow ${good?'up':'dn'}">${up?'▲':'▼'}</span>`;
  }

  function render(container, onClear){
    if(!log.length){
      container.innerHTML = `<p class="placeholder">No logged gases yet. Use “Analyze &amp; log to trend”.</p>`;
      return;
    }
    const rows = log.map((g,i)=>{
      const p = i>0 ? log[i-1] : null;
      const tm = g.t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      const lac = g.lactate!=null ? `${f1(g.lactate)} ${p&&p.lactate!=null?arrow(g.lactate,p.lactate,-1):''}` : '—';
      const agc = g.ag!=null ? f1(g.ag) : '—';
      return `<tr><td>#${i+1} · ${tm}</td>
        <td>${g.ph.toFixed(2)} ${p?arrow(g.ph,p.ph, g.ph<7.4?1:-1):''}</td>
        <td>${f1(g.pco2)} ${p?arrow(g.pco2,p.pco2,0):''}</td>
        <td>${f1(g.hco3)} ${p?arrow(g.hco3,p.hco3,0):''}</td>
        <td>${agc}</td><td>${lac}</td>
        <td style="text-align:left;font-size:.8rem">${g.dx}</td></tr>`;
    }).join('');

    let verdict = '';
    if(log.length>1){
      const a=log[0], b=log[log.length-1];
      const dpH = Math.abs(b.ph-7.4)-Math.abs(a.ph-7.4);
      const dLac = (a.lactate!=null&&b.lactate!=null) ? b.lactate-a.lactate : null;
      let cls, txt;
      if(dpH < -0.02 && (dLac===null||dLac<=0)){cls='improving'; txt='Improving — pH is trending toward normal'+(dLac!=null?' and lactate is falling':'')+'.';}
      else if(dpH > 0.02 || (dLac!=null&&dLac>1)){cls='deteriorating'; txt='Deteriorating — pH is moving away from normal'+(dLac!=null&&dLac>1?' and lactate is rising':'')+'. Reassess the driver and escalate.';}
      else {cls='mixed'; txt='Broadly stable / no clear directional change yet.';}
      verdict = `<div class="verdict ${cls}">${txt}</div>`;
    }

    container.innerHTML = `<div class="trend"><table>
      <thead><tr><th>Gas</th><th>pH</th><th>pCO₂</th><th>HCO₃⁻</th><th>AG</th><th>Lactate</th><th>Interpretation</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${verdict}
      <div class="btns">
        <button type="button" class="rst" id="clearTrend">Clear trend log</button>
        <button type="button" class="exp" id="exportTrendCsv">Export CSV</button>
      </div>`;

    const clearBtn = container.querySelector('#clearTrend');
    if(clearBtn) clearBtn.addEventListener('click', ()=>{ clear(); if(onClear) onClear(); });

    const exportBtn = container.querySelector('#exportTrendCsv');
    if(exportBtn) exportBtn.addEventListener('click', ()=>{ ABG.Export.downloadTrendCSV(log); });
  }

  return { log, add, clear, arrow, render };
})();
