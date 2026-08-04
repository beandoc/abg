document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const num = id => { const el=$(id); if(!el) return null; const v = parseFloat(el.value); return isNaN(v) ? null : v; };
  const f1 = x => (Math.round(x*10)/10).toFixed(1);

  ABG.Davenport.init('#davenport');
  if(ABG.Tutor && ABG.Tutor.init) ABG.Tutor.init();

  function collect(){
    return {
      ph:num('ph'),pco2:num('pco2'),hco3:num('hco3'),na:num('na'),k:num('k'),cl:num('cl'),
      lactate:num('lactate'),albumin:num('albumin'),bun:num('bun'),glucose:num('glucose'),
      measuredOsm:num('measuredOsm'),uNa:num('uNa'),uK:num('uK'),uCl:num('uCl'),
      vent:{mode:$('ventMode').value,fio2:num('fio2'),pao2:num('pao2'),weight:num('weight'),
            tidalVolume:num('tidalVolume'),respRate:num('respRate'),peep:num('peep')}
    };
  }

  function collectPatient(){
    ABG.Patient.set({
      name: $('patientName').value.trim(), id: $('patientId').value.trim(), bed: $('patientBed').value.trim(),
      age: num('patientAge'), sex: $('patientSex').value, height: num('patientHeight'), weight: num('patientWeight')
    });
  }

  function autoComputeIBW(){
    const height = num('patientHeight');
    const sex = $('patientSex').value;
    const actualWt = num('patientWeight');

    let ibw = ABG.Calculators.calcIBW(height, sex);
    if(!ibw && actualWt){
      ibw = actualWt;
    }
    if(!ibw){
      const isMale = !sex || sex === 'M';
      ibw = isMale ? 70 : 55;
    }

    const rounded = Math.round(ibw);
    $('weight').value = rounded;
    return rounded;
  }

  let lastAnalysis = null;

  function renderTrend(){
    ABG.Trend.render($('trend'), renderTrend);
    ABG.Davenport.draw(null, ABG.Trend.log);
  }

  function autoSaveSession(){
    collectPatient();
    const patientInfo = ABG.Patient.get();
    const d = collect();
    if(patientInfo.name || patientInfo.id || ABG.Trend.log.length > 0){
      ABG.PatientVault.saveCurrentCase(patientInfo, ABG.Trend.log, d);
    }
  }

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

    if(ABG.Tutor && ABG.Tutor.updateTutorView) ABG.Tutor.updateTutorView(r, d);

    const R = ABG.Interpreter.recommend(r, d.vent);
    $('rec').innerHTML = `<ul class="rec">${R.map(([c,t])=>`<li class="${c}">${t}</li>`).join('')}</ul>`;

    if(r.disorders.some(x=>x.toLowerCase().includes('metabolic alkalosis'))){
      const wrap = document.createElement('div');
      ABG.Alkalosis.render(wrap, { hco3:d.hco3, cl:d.cl, ph:d.ph, uCl:d.uCl, weight:num('patientWeight') });
      $('rec').innerHTML += `<div class="subhead">Chloride/HCl dosing</div>${wrap.innerHTML}`;
    }

    lastAnalysis = { d, r };

    if(logIt){
      ABG.Trend.add({ph:d.ph,pco2:d.pco2,hco3:d.hco3,lactate:d.lactate,ag:r.cAG,dx:r.integrated,t:new Date()});
      autoSaveSession();
    }
    ABG.Trend.render($('trend'), renderTrend);
    ABG.Davenport.draw({ph:d.ph,hco3:d.hco3,pco2:d.pco2,integrated:r.integrated}, ABG.Trend.log);
  }

  function populateForm(d){
    if(!d) return;
    const setVal = (id, val) => { const el=$(id); if(el) el.value = (val!=null ? val : ''); };
    setVal('ph', d.ph); setVal('pco2', d.pco2); setVal('hco3', d.hco3);
    setVal('na', d.na); setVal('k', d.k); setVal('cl', d.cl);
    setVal('lactate', d.lactate); setVal('albumin', d.albumin);
    setVal('bun', d.bun); setVal('glucose', d.glucose);
    setVal('measuredOsm', d.measuredOsm);
    setVal('uNa', d.uNa); setVal('uK', d.uK); setVal('uCl', d.uCl);
    if(d.vent){
      setVal('ventMode', d.vent.mode || 'Not Set');
      setVal('fio2', d.vent.fio2); setVal('pao2', d.vent.pao2);
      setVal('weight', d.vent.weight); setVal('tidalVolume', d.vent.tidalVolume);
      setVal('respRate', d.vent.respRate); setVal('peep', d.vent.peep);
    }
  }

  function loadCaseRecord(caseId){
    const record = ABG.PatientVault.loadCase(caseId);
    if(!record) return;

    // Restore Patient Info
    const p = record.patient || {};
    $('patientName').value = p.name || '';
    $('patientId').value = p.id || '';
    $('patientBed').value = p.bed || '';
    $('patientAge').value = p.age != null ? p.age : '';
    $('patientSex').value = p.sex || '';
    $('patientHeight').value = p.height != null ? p.height : '';
    $('patientWeight').value = p.weight != null ? p.weight : '';
    ABG.Patient.set(p);

    // Restore Trend Log
    ABG.Trend.clear();
    if(record.logs && record.logs.length){
      record.logs.forEach(l => ABG.Trend.add(l));
    }

    // Restore Form Data
    if(record.form){
      populateForm(record.form);
    }

    closeVault();
    run(false);
  }

  function openVault(){
    const modal = $('vaultModal');
    const backdrop = $('vaultBackdrop');
    const body = $('vaultModalBody');
    if(!modal || !backdrop || !body) return;

    ABG.PatientVault.renderVaultModal(body, (selectedId) => {
      loadCaseRecord(selectedId);
    }, () => {
      renderTrend();
    });

    modal.classList.add('open');
    backdrop.classList.add('open');
  }

  function closeVault(){
    const modal = $('vaultModal');
    const backdrop = $('vaultBackdrop');
    if(modal) modal.classList.remove('open');
    if(backdrop) backdrop.classList.remove('open');
  }

  function runNephro(){
    const d = lastAnalysis ? lastAnalysis.d : collect();
    let calcOsm = null;
    if(d.na!=null && d.glucose!=null && d.bun!=null) calcOsm = ABG.Calculators.calcOsm(d.na, d.glucose, d.bun);
    ABG.Nephro.render($('nephroOut'), {
      ph:d.ph, pco2:d.pco2, hco3:d.hco3, na:d.na, k:d.k, cl:d.cl, lactate:d.lactate,
      albumin:d.albumin, bun:d.bun, glucose:d.glucose, calcOsm
    });
  }

  function runVentSim(){
    const current = {
      rr: num('respRate'), vt: num('tidalVolume'), fio2: num('fio2'), pao2: num('pao2'),
      pco2: num('pco2'), hco3: num('hco3'), peep: num('peep'),
      compliance: num('compliance'), vdvt: num('vdvt'), ibw: num('weight'),
      resistance: num('resistance'), ti: num('ti'),
      na: num('na'), cl: num('cl'), albumin: num('albumin'), lactate: num('lactate')
    };
    const target = {
      rr: num('simRR'), vt: num('simVt'), fio2: num('simFio2'), peep: num('simPeep'), pplatMeasured: num('simPplat'),
      mode: $('simMode').value, dpSet: num('simDP')
    };
    const result = ABG.VentSim.simulate(current, target);
    const out = $('ventSimOut');
    ABG.VentSim.render(out, result);
    // Mark the card so the print stylesheet keeps this result slot while hiding the input chrome.
    const card = out.closest('.card');
    if(card) card.classList.toggle('print-keep', !result.error);
  }

  $('f').addEventListener('submit', e => { e.preventDefault(); run(false); });
  $('logBtn').addEventListener('click', () => run(true));
  $('f').addEventListener('reset', () => {
    $('dx').innerHTML=''; $('out').innerHTML=`<p class="placeholder">Enter values and analyze.</p>`;
    $('rec').innerHTML=`<p class="placeholder">Analyze to generate guidance.</p>`;
    lastAnalysis = null;
    ABG.Trend.clear();
    renderTrend();
  });

  const saveBtn = $('saveCaseBtn');
  if(saveBtn) saveBtn.addEventListener('click', () => {
    autoSaveSession();
    alert('Patient case record saved successfully.');
  });

  const calcIbwBtn = $('calcIbwBtn');
  if(calcIbwBtn) calcIbwBtn.addEventListener('click', () => {
    const ibwVal = autoComputeIBW();
    alert(`Calculated IBW: ${ibwVal} kg (Devine Formula / Target)`);
  });

  const openVaultBtn = $('openVaultBtn');
  if(openVaultBtn) openVaultBtn.addEventListener('click', openVault);

  const vaultCloseBtn = $('vaultCloseBtn');
  if(vaultCloseBtn) vaultCloseBtn.addEventListener('click', closeVault);

  const vaultBackdrop = $('vaultBackdrop');
  if(vaultBackdrop) vaultBackdrop.addEventListener('click', closeVault);

  $('nephroBtn').addEventListener('click', runNephro);
  $('ventSimBtn').addEventListener('click', runVentSim);
  $('printBtn').addEventListener('click', () => ABG.Export.printReport());

  renderTrend();
});
