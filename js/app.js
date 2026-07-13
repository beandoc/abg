document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const num = id => { const el=$(id); if(!el) return null; const v = parseFloat(el.value); return isNaN(v) ? null : v; };
  const f1 = x => (Math.round(x*10)/10).toFixed(1);

  ABG.Davenport.init('#davenport');

  function collect(){
    return {
      ph:num('ph'),pco2:num('pco2'),hco3:num('hco3'),na:num('na'),k:num('k'),cl:num('cl'),
      lactate:num('lactate'),albumin:num('albumin'),bun:num('bun'),glucose:num('glucose'),
      measuredOsm:num('measuredOsm'),ethanol:num('ethanol'),uNa:num('uNa'),uK:num('uK'),uCl:num('uCl'),
      vent:{mode:$('ventMode').value,fio2:num('fio2'),pao2:num('pao2'),weight:num('weight'),
            tidalVolume:num('tidalVolume'),respRate:num('respRate'),peep:num('peep')}
    };
  }

  function collectPatient(){
    ABG.Patient.set({
      name: $('patientName').value.trim(), id: $('patientId').value.trim(), bed: $('patientBed').value.trim(),
      age: num('patientAge'), sex: $('patientSex').value
    });
  }

  let lastAnalysis = null;

  function run(logIt){
    collectPatient();
    const d = collect();
    if(d.ph===null||d.pco2===null||d.hco3===null){
      $('dx').innerHTML=''; $('out').innerHTML=`<p class="err">Enter pH, pCO₂ and HCO₃⁻ to analyze.</p>`;
      ABG.Davenport.draw(null, ABG.Trend.log);
      return;
    }
    if(d.ph<6.5||d.ph>8.0||d.pco2<=0||d.hco3<=0){
      $('dx').innerHTML=''; $('out').innerHTML=`<p class="err">Values out of physiological range — check pH, pCO₂ and HCO₃⁻.</p>`;
      ABG.Davenport.draw(null, ABG.Trend.log);
      return;
    }
    const r = ABG.Interpreter.analyze(d);
    if(r.invalid){
      $('dx').innerHTML=''; $('out').innerHTML=`<p class="err">${r.msg}</p>`;
      $('rec').innerHTML=`<p class="placeholder">Resolve the inconsistency before generating guidance.</p>`;
      ABG.Davenport.draw(null, ABG.Trend.log);
      return;
    }
    $('dx').innerHTML = `<div class="dx ${r.dxClass}">${r.integrated}<small>Primary: ${r.primary}</small></div>`;
    $('out').innerHTML = r.steps.map(s=>`<div class="step"><div class="h">${s.h}</div><div class="b">${s.b}</div></div>`).join('');

    const R = ABG.Interpreter.recommend(r, d.vent);
    $('rec').innerHTML = `<ul class="rec">${R.map(([c,t])=>`<li class="${c}">${t}</li>`).join('')}</ul>`;

    lastAnalysis = { d, r };

    if(logIt){
      ABG.Trend.add({ph:d.ph,pco2:d.pco2,hco3:d.hco3,lactate:d.lactate,ag:r.cAG,dx:r.integrated,t:new Date()});
    }
    ABG.Trend.render($('trend'), () => ABG.Davenport.draw(null, ABG.Trend.log));
    ABG.Davenport.draw({ph:d.ph,hco3:d.hco3,pco2:d.pco2,integrated:r.integrated}, ABG.Trend.log);
  }

  function runNephro(){
    const d = lastAnalysis ? lastAnalysis.d : collect();
    let calcOsm = null;
    if(d.na!=null && d.glucose!=null && d.bun!=null) calcOsm = ABG.Calculators.calcOsm(d.na, d.glucose, d.bun, d.ethanol);
    ABG.Nephro.render($('nephroOut'), {
      ph:d.ph, pco2:d.pco2, hco3:d.hco3, na:d.na, k:d.k, cl:d.cl, lactate:d.lactate,
      albumin:d.albumin, bun:d.bun, glucose:d.glucose, calcOsm
    });
  }

  $('f').addEventListener('submit', e => { e.preventDefault(); run(false); });
  $('logBtn').addEventListener('click', () => run(true));
  $('f').addEventListener('reset', () => {
    $('dx').innerHTML=''; $('out').innerHTML=`<p class="placeholder">Enter values and analyze.</p>`;
    $('rec').innerHTML=`<p class="placeholder">Analyze to generate guidance.</p>`;
    lastAnalysis = null;
    ABG.Trend.clear();
    ABG.Trend.render($('trend'), () => ABG.Davenport.draw(null, ABG.Trend.log));
    ABG.Davenport.draw(null, []);
  });

  $('nephroBtn').addEventListener('click', runNephro);
  $('printBtn').addEventListener('click', () => ABG.Export.printReport());

  ABG.Trend.render($('trend'), () => ABG.Davenport.draw(null, ABG.Trend.log));
});
