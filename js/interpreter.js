window.ABG = window.ABG || {};

ABG.Interpreter = (function(){
  'use strict';
  const C = ABG.Calculators;
  const N_HCO3 = C.NORMALS.HCO3, N_PCO2 = C.NORMALS.PCO2, N_AG = C.NORMALS.AG, N_ALB = C.NORMALS.ALB;
  const f1 = x => (Math.round(x*10)/10).toFixed(1);

  function analyze(d){
    const isVBG = d.sampleType && d.sampleType.startsWith('VBG');
    const rawPh = d.ph, rawPco2 = d.pco2, rawHco3 = d.hco3;

    let ph = rawPh, pco2 = rawPco2, hco3 = rawHco3;
    if(isVBG && rawPh !== null && rawPco2 !== null && rawHco3 !== null){
      const conv = C.vbgToAbg(rawPh, rawPco2, rawHco3);
      ph = conv.ph; pco2 = conv.pco2; hco3 = conv.hco3;
    }

    const {na,k,cl,lactate,albumin,bun,glucose,measuredOsm,pvco2,uNa,uK,uCl,vent}=d;
    const steps=[]; let dxClass='';
    const S=(h,b)=>steps.push({h,b});

    if(isVBG && rawPh !== null && rawPco2 !== null && rawHco3 !== null){
      S('Sample Source · Venous Blood Gas (VBG)',
        `Entered VBG values: pH ${rawPh.toFixed(2)}, pCO₂ ${rawPco2} mmHg, HCO₃⁻ ${rawHco3} mEq/L.<br>` +
        `<b>Estimated ABG Equivalent:</b> pH <span class="val">${ph.toFixed(2)}</span> (+0.03), pCO₂ <span class="val">${f1(pco2)}</span> mmHg (−6.0), HCO₃⁻ <span class="val">${f1(hco3)}</span> mEq/L (−1.5).` +
        `<div class="why">In normal physiology, arteriovenous blood gas differences are minor. However, in severe low cardiac output states, tissue CO₂ stagnation elevates venous pCO₂ while arterial pCO₂ remains normal due to intact pulmonary ventilation.</div>`);
    }

    const Hcalc = C.hendersonH(pco2, hco3);
    const Hmeas = C.hFromPh(ph);
    const phFromHcalc = C.phFromH(Hcalc);
    const pctDiff = C.pctDiff(Hcalc, Hmeas);
    S('Step 1 · Internal consistency (Henderson Equation)',
      `Henderson [H⁺] = 24 × ${f1(pco2)}/${f1(hco3)} = <span class="val">${f1(Hcalc)}</span> nmol/L → predicts pH <span class="val">${phFromHcalc.toFixed(2)}</span>; entered pH implies [H⁺] <span class="val">${f1(Hmeas)}</span> nmol/L. `
      + (pctDiff<=20
          ? `Within ${pctDiff.toFixed(0)}% — values are internally consistent.`
          : `<span class="fa">Differ by ${pctDiff.toFixed(0)}% — inconsistent.</span>`)
      + `<div class="why"><b>Clinical [H⁺] Reference Scale:</b> pH 7.50 = 30 · 7.40 = 40 · 7.30 = 50 · 7.20 = 60 · 7.10 = 80 · 7.00 = 100 nmol/L.<br>`
      + `<i>Lab Note:</i> ABG HCO₃⁻ is calculated via the Henderson equation and is normally 1–2 mEq/L <i>lower</i> than measured serum chemistry TCO₂ (which includes dissolved CO₂ &amp; H₂CO₃). A mismatch &gt; 2–3 mEq/L warrants repeating labs simultaneously.</div>`);
    if(pctDiff>20){
      return {invalid:true, msg:`The pH, pCO₂ and HCO₃⁻ are internally inconsistent — the Henderson equation predicts [H⁺] ${f1(Hcalc)} (pH ${phFromHcalc.toFixed(2)}) but the entered pH implies [H⁺] ${f1(Hmeas)}, a ${pctDiff.toFixed(0)}% mismatch. Per the textbook method, repeat the electrolytes and ABG a few minutes apart before interpreting — this points to a pre-analytical or transcription error, not a real disorder.`};
    }

    let primary = '', forcedMixed = null;
    const isAcidemia = ph < 7.35;
    const isAlkalemia = ph > 7.45;
    const isNormalPH = !isAcidemia && !isAlkalemia;

    const lowHCO3 = hco3 < 22;
    const highHCO3 = hco3 > 26;
    const lowPCO2 = pco2 < 35;
    const highPCO2 = pco2 > 45;

    const normHCO3 = hco3 >= 22 && hco3 <= 26;
    const normPCO2 = pco2 >= 35 && pco2 <= 45;

    if (isAcidemia) {
      if (lowHCO3 && highPCO2) {
        primary = 'Metabolic acidosis';
      } else if (lowHCO3) {
        primary = 'Metabolic acidosis';
      } else if (highPCO2) {
        primary = 'Respiratory acidosis';
      } else {
        const metDev = (24 - hco3) / 24;
        const respDev = (pco2 - 40) / 40;
        primary = metDev >= respDev ? 'Metabolic acidosis' : 'Respiratory acidosis';
      }
    } else if (isAlkalemia) {
      if (highHCO3 && lowPCO2) {
        const metDev = (hco3 - 24) / 24;
        const respDev = (40 - pco2) / 40;
        primary = metDev >= respDev ? 'Metabolic alkalosis' : 'Respiratory alkalosis';
      } else if (highHCO3) {
        primary = 'Metabolic alkalosis';
      } else if (lowPCO2) {
        primary = 'Respiratory alkalosis';
      } else {
        const metDev = (hco3 - 24) / 24;
        const respDev = (40 - pco2) / 40;
        if (respDev > metDev && pco2 < 40) primary = 'Respiratory alkalosis';
        else if (metDev > respDev && hco3 > 24) primary = 'Metabolic alkalosis';
        else primary = 'Alkalemia (indeterminate)';
      }
    } else {
      // Normal pH (7.35 <= pH <= 7.45)
      if (normHCO3 && normPCO2) {
        primary = 'Normal acid–base status';
      } else {
        if (ph < 7.40) {
          if (lowHCO3) primary = 'Metabolic acidosis';
          else if (highPCO2) primary = 'Respiratory acidosis';
          else if (hco3 < 24) primary = 'Metabolic acidosis';
          else if (pco2 > 40) primary = 'Respiratory acidosis';
          else primary = 'Normal acid–base status';
        } else {
          if (lowPCO2) primary = 'Respiratory alkalosis';
          else if (highHCO3) primary = 'Metabolic alkalosis';
          else if (pco2 < 40) primary = 'Respiratory alkalosis';
          else if (hco3 > 24) primary = 'Metabolic alkalosis';
          else primary = 'Normal acid–base status';
        }

        // Stage I, Rule 2 (Marino Ch.31): pH is normal but PaCO2/HCO3 is not — compensation
        // never fully normalizes pH, so this can only be a mixed disorder, never a simple one.
        if (highPCO2) forcedMixed = 'Metabolic alkalosis';
        else if (lowPCO2) forcedMixed = 'Metabolic acidosis';
        else if (highHCO3) forcedMixed = 'Respiratory acidosis';
        else if (lowHCO3) forcedMixed = 'Respiratory alkalosis';
      }
    }
    if(primary.includes('acidosis')||primary.includes('Acidemia')) dxClass='acid';
    else if(primary.includes('alkalosis')||primary.includes('Alkalemia')) dxClass='alk';
    S('Step 3 · Primary disorder',
      `pH ${ph.toFixed(2)} (pivot 7.40), HCO₃⁻ ${f1(hco3)}, pCO₂ ${f1(pco2)} → <b>${primary}</b>.`);

    let ag=null,cAG=null,agState='n/a';
    if(na!==null&&cl!==null){
      ag=C.anionGap(na,cl,hco3);
      let agNote = '';
      if(glucose !== null && glucose > 200){
        agNote = `<div class="why"><b>Hyperglycemia Rule (Glucose ${glucose} mg/dL):</b> Measured Na⁺ (${na}) is used to calculate the AG. Do <b>NOT</b> use glucose-corrected Na⁺ for AG calculation, as osmotic fluid shift dilutes Na⁺, Cl⁻, and HCO₃⁻ equally — using corrected Na⁺ overestimates the AG and falsely implies high-AG acidosis.</div>`;
      }
      if(albumin!==null){
        cAG=C.correctedAnionGap(ag,albumin,N_ALB);
        agState = cAG>16?'high':(cAG>12?'borderline':(cAG<6?'low':'normal'));
        S('Step 4 · Anion gap',
          `AG = ${na} − (${cl} + ${f1(hco3)}) = <span class="val">${f1(ag)}</span>. Albumin ${f1(albumin)} → corrected AG <span class="val">${f1(cAG)}</span> (${agState}).`
          + `<div class="why">Correcting for albumin matters: each 1 g/dL fall in albumin lowers the measured gap by ~2.5, so a "normal" AG can hide an organic acidosis in a hypoalbuminaemic patient.</div>` + agNote);
      } else {
        cAG=ag; agState = cAG>16?'high':(cAG>12?'borderline':(cAG<6?'low':'normal'));
        S('Step 4 · Anion gap',
          `AG = ${na} − (${cl} + ${f1(hco3)}) = <span class="val">${f1(ag)}</span> (${agState}). Albumin not entered — correction not applied.`
          + (agState==='low'?`<div class="why">A low AG is itself abnormal — consider hypoalbuminaemia (commonest), or unmeasured cations (e.g. IgG paraproteinaemia, lithium, severe hypercalcaemia).</div>`:'') + agNote);
      }
    } else {
      S('Step 4 · Anion gap', `Not calculated (Na⁺ or Cl⁻ missing). The AG is the single most important step for uncovering hidden acidosis — enter electrolytes.`);
    }
    const highAG = agState==='high';
    const veryHighAG = cAG!==null && cAG>24;

    const disorders=[]; let compLine='';
    if(primary==='Metabolic acidosis'){
      disorders.push(highAG?'High-anion-gap metabolic acidosis':'Normal-anion-gap metabolic acidosis');
      const exp=C.metAcidExpectedPCO2(hco3);
      compLine=`Expected pCO₂ = 40 − [1.2 × (24 − ${f1(hco3)})] = <span class="val">${f1(exp)}</span> ± 2 (i.e. ${f1(exp-2)}–${f1(exp+2)}).`;
      if(pco2>exp+2){disorders.push('concurrent respiratory acidosis'); compLine+=` Measured pCO₂ ${f1(pco2)} is <span class="fa">above</span> expected → superimposed <b>respiratory acidosis</b>.`;}
      else if(pco2<exp-2){disorders.push('concurrent respiratory alkalosis'); compLine+=` Measured pCO₂ ${f1(pco2)} is <span class="fk">below</span> expected → superimposed <b>respiratory alkalosis</b>.`;}
      else compLine+=` Measured pCO₂ ${f1(pco2)} is within range → appropriate respiratory compensation (simple disorder).`;
    }
    else if(primary==='Metabolic alkalosis'){
      disorders.push('Metabolic alkalosis');
      const exp=C.metAlkExpectedPCO2(hco3);
      compLine=`Expected pCO₂ = 40 + 0.7 × (${f1(hco3)} − 24) = <span class="val">${f1(exp)}</span> ± 2.`;
      if(pco2<exp-2){disorders.push('concurrent respiratory alkalosis'); compLine+=` Measured pCO₂ ${f1(pco2)} <span class="fk">below</span> expected → superimposed <b>respiratory alkalosis</b>.`;}
      else if(pco2>exp+2){disorders.push('concurrent respiratory acidosis'); compLine+=` Measured pCO₂ ${f1(pco2)} <span class="fa">above</span> expected → superimposed <b>respiratory acidosis</b>.`;}
      else compLine+=` pCO₂ ${f1(pco2)} within range → appropriate compensation.`;
      if(veryHighAG){disorders.push('hidden high-AG metabolic acidosis'); compLine+=` AG ${f1(cAG)} markedly high → coexisting <b>high-AG metabolic acidosis</b>.`;}
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG mildly high (${f1(cAG)}); a mild rise is common in alkalaemia itself.</span>`;
    }
    else if(primary==='Respiratory acidosis'){
      const rise=pco2-N_PCO2, acute=C.respAcidAcuteHCO3(pco2), chronic=C.respAcidChronicHCO3(pco2);
      const isChronic=Math.abs(hco3-chronic)<Math.abs(hco3-acute);
      disorders.push(isChronic?'Chronic respiratory acidosis':'Acute respiratory acidosis');
      compLine=`Renal compensation: acute expects HCO₃⁻ ≈ <span class="val">${f1(acute)}</span> (+0.1/mmHg), chronic ≈ <span class="val">${f1(chronic)}</span> (+0.4/mmHg). Measured ${f1(hco3)} → best fits <b>${isChronic?'chronic':'acute'}</b>.`;
      if(hco3<acute-3){disorders.push('superimposed metabolic acidosis'); compLine+=` HCO₃⁻ lower than either prediction → added <span class="fa">metabolic acidosis</span>.`;}
      else if(hco3>chronic+3){disorders.push('superimposed metabolic alkalosis'); compLine+=` HCO₃⁻ higher than chronic → added <span class="fk">metabolic alkalosis</span>.`;}
      else if(!isChronic && rise>=15 && hco3<chronic-3){
        compLine+=` <span class="why" style="display:inline">Caveat: with this degree of chronic hypercapnia (e.g. known COPD), HCO₃⁻ ${f1(hco3)} is well below the chronic expectation of ${f1(chronic)} — if the process is in fact chronic, a superimposed <b>metabolic acidosis</b> (e.g. diarrhoea, renal) is likely. History decides.</span>`;
      }
      const expectedRA=isChronic?chronic:acute;
      if(highAG && hco3<expectedRA-3 && !disorders.includes('superimposed metabolic acidosis')){disorders.push('concurrent high-AG metabolic acidosis'); compLine+=` AG is high (${f1(cAG)}) with HCO₃⁻ below expected → coexisting <b>high-AG metabolic acidosis</b>.`;}
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG is mildly high (${f1(cAG)}); interpret alongside the clinical picture rather than as a definite second disorder.</span>`;
    }
    else if(primary==='Respiratory alkalosis'){
      const fall=N_PCO2-pco2, acute=C.respAlkAcuteHCO3(pco2), chronic=C.respAlkChronicHCO3(pco2);
      const isChronic=Math.abs(hco3-chronic)<Math.abs(hco3-acute);
      const expected=isChronic?chronic:acute;
      disorders.push(isChronic?'Chronic respiratory alkalosis':'Acute respiratory alkalosis');
      compLine=`Renal compensation: acute expects HCO₃⁻ ≈ <span class="val">${f1(acute)}</span> (−0.2/mmHg), chronic ≈ <span class="val">${f1(chronic)}</span> (−0.4/mmHg). Measured ${f1(hco3)} → best fits <b>${isChronic?'chronic':'acute'}</b>.`;
      if(highAG && hco3 < expected-3){disorders.push('concurrent high-AG metabolic acidosis'); compLine+=` HCO₃⁻ ${f1(hco3)} is well below the expected ${f1(expected)} and the AG is high (${f1(cAG)}) → superimposed <b>high-AG metabolic acidosis</b> (classic salicylate/lactate picture).`;}
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG is high (${f1(cAG)}) but HCO₃⁻ sits near the expected compensation, so the gap is not dragging bicarbonate down — investigate the gap clinically, but it is not a definite second disorder here.</span>`;
    }
    else {
      if(highAG){
        disorders.push('hidden high-AG metabolic acidosis');
        compLine=`Gas looks normal, but the anion gap is elevated — this is the textbook trap: a high AG at normal pH means a metabolic acidosis is masked by a second, offsetting process.`;
        const {dAG,dHCO3,ratio}=C.deltaRatio(cAG,hco3,N_AG,N_HCO3);
        if(dHCO3<=0 || ratio>2){disorders.push('concurrent metabolic alkalosis'); compLine+=` ΔAG/ΔHCO₃⁻ ${dHCO3>0?('= '+ratio.toFixed(2)):'undefined'} (≫2) → superimposed <b>metabolic alkalosis</b> raising HCO₃⁻ back to normal.`;}
        else if(dHCO3>0 && ratio<1){disorders.push('concurrent normal-AG metabolic acidosis'); compLine+=` ΔAG/ΔHCO₃⁻ = ${ratio.toFixed(2)} (<1) → additional <b>normal-AG acidosis</b>.`;}
        dxClass='warn';
      } else {
        disorders.push('Normal acid–base status');
        compLine=`pH, HCO₃⁻, pCO₂ and anion gap all within normal limits.`;
      }
    }
    S('Step 6 · Expected compensation & mixed check', compLine);

    if(forcedMixed && !disorders.some(x=>x.toLowerCase().includes(forcedMixed.toLowerCase()))){
      disorders.push(forcedMixed);
      S('Step 6b · Normal pH with a deranged PaCO₂/HCO₃⁻',
        `pH ${ph.toFixed(2)} is within the normal range despite an abnormal ${primary.includes('Respiratory')?'PaCO₂':'HCO₃⁻'} — compensation limits but never fully normalizes pH, so a normal pH here proves a second, offsetting disorder: <b>${forcedMixed}</b>.`);
    }

    if(highAG && primary==='Metabolic acidosis'){
      const {dAG,dHCO3,ratio}=C.deltaRatio(cAG,hco3,N_AG,N_HCO3);
      if(dHCO3>0){
        let txt;
        if(ratio<0.4){txt='ratio < 0.4 → mainly a normal-AG acidosis'; disorders.push('concurrent normal-AG metabolic acidosis');}
        else if(ratio<1){txt='ratio 0.4–1 → mixed high-AG + normal-AG acidosis'; disorders.push('concurrent normal-AG metabolic acidosis');}
        else if(ratio<=2){txt='ratio 1–2 → pure high-AG metabolic acidosis';}
        else {txt='ratio > 2 → concurrent metabolic alkalosis (or chronic respiratory acidosis)'; disorders.push('concurrent metabolic alkalosis');}
        S('Step 8 · ΔAG/ΔHCO₃⁻ ratio',
          `ΔAG ${f1(dAG)} / ΔHCO₃⁻ ${f1(dHCO3)} = <span class="val">${ratio.toFixed(2)}</span> — ${txt}.`);
      }
    }

    if(lactate!==null){
      if(lactate>4) S('Lactate', `<span class="fa">${f1(lactate)} mmol/L — markedly elevated.</span> A dominant driver of a high-AG acidosis and a marker of tissue hypoperfusion; trend it with resuscitation.`);
      else if(lactate>2) S('Lactate', `<span class="fa">${f1(lactate)} mmol/L — elevated.</span> Contributes to the anion gap; look for hypoperfusion, sepsis, ischaemia, metformin, or medication causes.`);
      else S('Lactate', `${f1(lactate)} mmol/L — normal. If a high AG persists without lactate, pursue ketones, urate, salicylate, or toxic alcohols.`);
    }

    if(na!==null&&glucose!==null&&bun!==null){
      let calcOsm=C.calcOsm(na,glucose,bun);
      let line=`Calculated osmolality = <span class="val">${f1(calcOsm)}</span> mOsm/kg.`;
      if(measuredOsm!==null){
        const og=C.osmolalGap(measuredOsm,calcOsm);
        line+=` Osmolal gap = <span class="val">${f1(og)}</span> (normal &lt; 10 mOsm/kg H₂O).`;
        if(og>10) line+= highAG
          ? ` <span class="fa">High gap + high AG → suspect toxic alcohol</span> (methanol, ethylene glycol).`
          : ` <span class="fa">High gap without acidosis → isopropanol, mannitol, or early toxic-alcohol.</span>`;
        else if(highAG) line+=` A normal osmolal gap does <b>not</b> exclude late methanol/ethylene-glycol (the gap closes as the parent alcohol is metabolised to acid).`;
        S('Osmolal gap', line);
      }
    }

    if(uNa!==null&&uK!==null&&uCl!==null){
      const uag=C.urineAnionGap(uNa,uK,uCl);
      const isNAG = disorders.some(x=>x.includes('normal-AG')||x.includes('normal-anion'));
      let line=`Urine AG = (${uNa} + ${uK}) − ${uCl} = <span class="val">${f1(uag)}</span>.`;
      if(isNAG) line+= uag>0
        ? ` Positive with a normal-AG acidosis → impaired renal NH₄⁺ excretion → <b>renal tubular acidosis</b>.`
        : ` Negative with a normal-AG acidosis → intact NH₄⁺ excretion → <b>GI HCO₃⁻ loss</b> (e.g. diarrhoea).`;
      S('Urine anion gap', line);
    }

    if(vent.pao2!==null){
      const fio2Pct = vent.fio2!==null?vent.fio2:21;
      const {PAO2,aa}=C.aaGradient(pco2, fio2Pct, vent.pao2);
      S('A–a gradient',
        `A–a = ${f1(PAO2)} − ${f1(vent.pao2)} = <span class="val">${f1(aa)}</span> mmHg (FiO₂ ${fio2Pct}%).`
        +`<div class="why">Room-air upper limit ≈ (age/4)+4. A widened gradient points to V/Q mismatch, shunt, or diffusion defect rather than pure hypoventilation — useful when hypercapnia is present but the lungs may also be the problem.</div>`);
    }

    if(pvco2 !== null && pco2 !== null){
      const gapRes = C.pvPaCO2Gap(pvco2, pco2);
      if(gapRes){
        let line = `P(v-a)CO₂ gap = ${pvco2} − ${f1(pco2)} = <span class="val">${f1(gapRes.gap)}</span> mmHg (normal ≤ 6.0 mmHg).`;
        if(gapRes.isHigh){
          line += ` <span class="fa">Elevated P(v-a)CO₂ gap (&gt; 6.0 mmHg) → Suspect Low Cardiac Output / Circulatory Shock / Tissue Hypoperfusion State.</span>` +
                  `<div class="why">In low cardiac output / shock states, arterial pCO₂ may remain deceptively normal (due to lung hyperventilation), while central venous pCO₂ (PvCO₂) is markedly elevated due to tissue CO₂ stagnation and sluggish tissue perfusion.</div>`;
        } else {
          line += ` Normal P(v-a)CO₂ gap (≤ 6.0 mmHg) → indicates adequate tissue perfusion &amp; cardiac output.`;
        }
        S('Arteriovenous pCO₂ gap', line);
      }
    }

    const uniq=[...new Set(disorders)];
    let integrated = uniq.length===1 ? uniq[0] : 'Mixed disorder: '+uniq.join(' + ');
    return {primary, integrated, disorders:uniq, dxClass, steps, ag, cAG, agState, ph, pco2, hco3, lactate, uCl};
  }

  function recommend(r, vent){
    const R=[]; const d=r.disorders.join(' ; ').toLowerCase();
    const vented = vent.mode!=='Not Set' && vent.mode!=='Spontaneous';
    const respAcid = d.includes('respiratory acidosis');
    const respAlk = d.includes('respiratory alkalosis');
    const metAcid = d.includes('metabolic acidosis')||d.includes('anion-gap');
    const metAlk = d.includes('metabolic alkalosis');
    const compensating = metAcid && respAlk;

    if(respAcid){
      R.push(['a','<b>Respiratory acidosis</b> — CO₂ retention from inadequate alveolar ventilation. Pathophysiology: minute ventilation is failing to clear CO₂ (airway obstruction, respiratory fatigue, sedation, or neuromuscular weakness).']);
      R.push(['', vented
        ? `On the ventilator, minute ventilation = Vt × RR. To lower pCO₂, raise RR first, then Vt (target ~6 mL/kg IBW${vent.tidalVolume!==null&&vent.weight?`; current ≈ ${f1(C.ibwPerKg(vent.tidalVolume,vent.weight))} mL/kg`:''}). Watch plateau pressure and auto-PEEP; permissive hypercapnia is acceptable in ARDS/severe asthma if pH is tolerated.`
        : 'Support ventilation: treat the reversible cause, consider NIV; escalate to intubation for fatigue, falling GCS, or refractory acidaemia.']);
    }
    if(respAlk && !compensating){
      R.push(['k','<b>Respiratory alkalosis</b> — CO₂ blown off by excess ventilation. Pathophysiology: a stimulus (hypoxaemia, pain, anxiety, sepsis, PE, CNS drive) is driving hyperventilation.']);
      R.push(['', vented
        ? 'Reduce set RR or Vt and confirm the patient is not over-triggering; ensure adequate sedation/analgesia.'
        : 'Find and treat the driver — check oxygenation, exclude PE and sepsis, address pain/anxiety.']);
    }
    if(compensating){
      R.push(['','<b>Note:</b> the low pCO₂ here is <i>appropriate compensation</i> for the metabolic acidosis, not a primary respiratory alkalosis. Do not suppress the respiratory drive — treating the acidosis is what corrects the pCO₂. If this patient were intubated, matching their spontaneous minute ventilation is essential; dropping it precipitates dangerous acidaemia.']);
    }
    if(metAcid){
      R.push(['a','<b>Metabolic acidosis</b> — identify and treat the source.']);
      if(r.lactate!==null && r.lactate>2) R.push(['','Lactic acidosis: restore perfusion (fluids, source control of sepsis, treat shock). Bicarbonate is reserved for severe acidaemia by judgement — it does not replace treating the cause.']);
      if(d.includes('high-anion-gap')||d.includes('high-ag')) R.push(['','High-AG: work through the GOLD-MARK / MUDPILES differential — lactate, ketones (DKA/starvation/alcoholic), urate (renal failure), salicylate, toxic alcohols. Use the osmolal gap and ketones to narrow it.']);
      if(d.includes('normal-ag')||d.includes('normal-anion')) R.push(['','Normal-AG: use the urine AG to separate renal (RTA — positive UAG) from GI bicarbonate loss (diarrhoea — negative UAG).']);
    }
    if(metAlk){
      R.push(['k','<b>Metabolic alkalosis</b> — assess volume and chloride status. Pathophysiology: HCO₃⁻ gain or H⁺/Cl⁻ loss, sustained by volume/chloride/potassium depletion.']);
      const uCl = r.uCl;
      if(uCl!=null) R.push(['', uCl<20
        ? `Urine Cl⁻ ${f1(uCl)} mEq/L (&lt;20) → <b>chloride-sensitive</b> (vomiting, NG suction, diuretic after-effect, laxative abuse) → replace with isotonic saline + KCl; see the dosing calculation below.`
        : `Urine Cl⁻ ${f1(uCl)} mEq/L (&gt;20) → <b>chloride-resistant</b> (primary hyperaldosteronism, exogenous mineralocorticoid, licorice) → saline will not correct this; treat the underlying cause instead.`]);
      else R.push(['','Check urine Cl⁻: &lt; 20 = chloride-sensitive (vomiting, NG suction, diuretics) → normal saline + KCl; &gt; 20 = chloride-resistant (mineralocorticoid excess) → treat the cause, do not volume-load.']);
      if(r.hco3>50 || r.ph>7.55) R.push(['a',`<span class="fa">Severe alkalosis</span> (HCO₃⁻ ${f1(r.hco3)}${r.hco3>50?' &gt;50':''}${r.ph>7.55?`, pH ${r.ph.toFixed(2)} &gt;7.55`:''}) — consider an HCl infusion if K⁺/acetazolamide are insufficient; see the dosing calculation below. Reserve for refractory severe cases and infuse via a large central vein.`]);
      R.push(['','Expanded-volume states (heart failure, cirrhosis, cor pulmonale) where saline is counterproductive can be treated with acetazolamide 250–375 mg IV/PO instead. Check magnesium before/while replacing K⁺ — hypomagnesemia can make diuretic-induced hypokalemia refractory to K⁺ alone.']);
    }
    if(r.agState==='low') R.push(['','Low anion gap is abnormal — check albumin first, then consider paraproteinaemia (myeloma), lithium, or severe hypercalcaemia.']);
    if(r.primary.includes('indeterminate')) R.push(['a','pH is deranged but neither HCO₃⁻ nor pCO₂ explains it in the expected direction — recheck the sample and the electrolytes.']);
    if(!R.length) R.push(['','Values within normal limits — no specific acid–base intervention indicated.']);

    return R;
  }

  return { analyze, recommend };
})();
