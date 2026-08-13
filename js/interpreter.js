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

    const {na=null,k=null,cl=null,lactate=null,albumin=null,creatinine=null,urea=null,bun=null,glucose=null,measuredOsm=null,pvco2=null,uNa=null,uK=null,uCl=null,vent={},iCa=null,pao2=null,po2=null,fio2=null,isPregnant=false}=d;
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

    if(ph < 7.10){
      S('Critical Hemodynamic Warning (pH < 7.10)',
        `<span class="fa">Severe Acidemia (pH ${ph.toFixed(2)} &lt; 7.10): High risk of myocardial depression, refractory peripheral vasodilation (vasoplegic shock), and blunted responsiveness to vasopressors.</span>` +
        `<div class="why">At pH &lt; 7.10, beta-adrenergic receptor binding drops and intracellular calcium handling is impaired, precipitating cardiovascular collapse. Target pH ≥ 7.20 with etiology control, alkalinization, or RRT.</div>`);
    }

    let ag=null,cAG=null,agState='n/a';
    if(na!==null&&cl!==null){
      ag=C.anionGap(na,cl,hco3);
      let agNote = '';
      if(glucose !== null && glucose > 200){
        agNote = `<div class="why"><b>Hyperglycemia Rule (Glucose ${glucose} mg/dL):</b> Measured Na⁺ (${na}) is used to calculate the AG. Do <b>NOT</b> use glucose-corrected Na⁺ for AG calculation, as osmotic fluid shift dilutes Na⁺, Cl⁻, and HCO₃⁻ equally — using corrected Na⁺ overestimates the AG and falsely implies high-AG acidosis.</div>`;
      }
      if(albumin!==null){
        cAG=C.correctedAnionGap(ag,albumin,N_ALB);
        // Albumin-correction threshold calibration:
        // When albumin is near-normal (≥3.5 g/dL), the correction adds ≤2.5 mEq/L —
        // a borderline raw AG (e.g. 16) gets inflated to 17.25–17.5 but is NOT a true
        // HAGMA. Raise the 'high' threshold to ≥18 in this case.
        // When albumin is genuinely low (<3.5 g/dL), correction is clinically meaningful
        // and the threshold remains ≥17.
        // This prevents contradictory recommendations (metAcid triggered by correction artifact).
        const highThreshold = albumin >= 3.5 ? 18 : 17;
        agState = cAG>=highThreshold?'high':(cAG>12?'borderline':(cAG<6?'low':'normal'));
        S('Step 4 · Anion gap',
          `AG = ${na} − (${cl} + ${f1(hco3)}) = <span class="val">${f1(ag)}</span>. Albumin ${f1(albumin)} → corrected AG <span class="val">${f1(cAG)}</span> (${agState}).`
          + `<div class="why">Correcting for albumin matters: each 1 g/dL fall in albumin lowers the measured gap by ~2.5, so a "normal" AG can hide an organic acidosis in a hypoalbuminaemic patient.</div>` + agNote);
      } else {
        cAG=ag; agState = cAG>16?'high':(cAG>12?'borderline':(cAG<6?'low':'normal'));
        S('Step 4 · Anion gap',
          `AG = ${na} − (${cl} + ${f1(hco3)}) = <span class="val">${f1(ag)}</span> (${agState}). Albumin not entered — correction not applied.`
          + (agState==='low'?`<div class="why">A low AG is itself abnormal — consider hypoalbuminaemia (commonest), or unmeasured cations (e.g. IgG paraproteinaemia, lithium, severe hypercalcaemia).</div>`:'') + agNote);
      }
      const nacl = C.naClRatio(na, cl);
      if(nacl){
        let naclMsg = `Na⁺:Cl⁻ ratio = ${na} / ${cl} = <span class="val">${nacl.ratio.toFixed(2)}</span> (normal baseline 1.40:1).`;
        if(nacl.state === 'high'){
          naclMsg += ` <span class="fa">High ratio (&gt; 1.45) → Disproportionate hypochloremia relative to Na⁺ (points to Metabolic Alkalosis or Chronic Respiratory Acidosis).</span>`;
        } else if(nacl.state === 'low'){
          naclMsg += ` <span class="fa">Low ratio (&lt; 1.35) → Disproportionate hyperchloremia relative to Na⁺ (points to Normal-AG Metabolic Acidosis or Chronic Respiratory Alkalosis).</span>`;
        } else {
          naclMsg += ` Normal ratio (1.35–1.45) → Na⁺ and Cl⁻ move proportionately, reflecting pure hydration status (overhydration/dehydration) rather than primary acid–base chloride shift.`;
        }
        S('Na⁺:Cl⁻ ratio (Hydration vs. Acid-Base Shift)',
          naclMsg + `<div class="why">In pure hydration disorders, Na⁺ and Cl⁻ decrease or increase proportionately to preserve the 1.4:1 ratio. Disproportionate chloride shifts indicate primary acid-base disturbances.</div>`);
      }
    } else {
      S('Step 4 · Anion gap', `Not calculated (Na⁺ or Cl⁻ missing). The AG is the single most important step for uncovering hidden acidosis — enter electrolytes.`);
    }

    // Severe NAGMA & dRTA Triad Detection
    if (hco3 < 15 && cl !== null && cl > 110 && k !== null && k < 3.5) {
      S('Serum Electrolyte Clue · Distal RTA (Type 1)',
        `<span class="fa">Triad of Severe NAGMA (HCO₃⁻ ${f1(hco3)}), Hyperchloremia (Cl⁻ ${cl}), and Hypokalemia (K⁺ ${f1(k)}):</span> Normal saline resuscitation alone rarely lowers HCO₃⁻ below 15 mEq/L. This pattern strongly points to <b>Distal (Type 1) Renal Tubular Acidosis (dRTA)</b> or severe GI losses. Note: Hypokalemia is masked by acidemia (pH ${ph.toFixed(2)}) and total-body potassium depletion is severe.`);
    }

    // Critical Ionized Hypocalcemia Alert
    if (iCa !== null && iCa < 0.90) {
      S('Hemodynamic Risk · Severe Ionized Hypocalcemia',
        `<span class="fa">Severe Ionized Hypocalcemia (iCa²⁺ ${f1(iCa)} mmol/L &lt; 1.12):</span> Directly impairs vascular tone and myocardial inotropy, exacerbating vasoplegic shock and vasopressor resistance. Urgent IV calcium repletion required.`);
    }
    const highAG = agState==='high';
    const veryHighAG = cAG!==null && cAG>24;

    const disorders=[]; let compLine='';

    // Structured mirror of the same conclusions. recommend() reasons over this instead of
    // substring-matching the display strings, so it can tell a primary disorder from a
    // secondary one, and a substantial deviation from a marginal one.
    const flags = {respAcid:null, respAlk:null, metAcid:null, metAlk:null};

    // A secondary respiratory disorder sitting only just outside the predicted band is within
    // the noise of the compensation rules themselves. Flag it for completeness, but never let
    // it drive ventilatory management — a pCO2 0.4 mmHg past the band is not an intubation.
    const MARGINAL_PCO2 = 5;

    // The gap is a three-state finding, not a binary. Collapsing 'borderline' into
    // 'Normal-anion-gap' asserted a hyperchloraemic acidosis (and sent the user off to a
    // urine-AG RTA-vs-diarrhoea workup) for what may be an evolving or partly-treated HAGMA;
    // collapsing 'n/a' into it claimed a normal gap with no electrolytes entered at all.
    const agLabel = base =>
        highAG                   ? 'High-anion-gap ' + base.toLowerCase()
      : agState === 'n/a'        ? base + ' (anion gap not calculated)'
      : agState === 'borderline' ? base + ' with a borderline anion gap'
      :                            'Normal-anion-gap ' + base.toLowerCase();

    if(primary==='Metabolic acidosis'){
      disorders.push(agLabel('Metabolic acidosis'));
      flags.metAcid = {role:'primary', highAG, agState};
      const exp=C.metAcidExpectedPCO2(hco3);
      compLine=`Expected pCO₂ (Winter's formula) = 1.5 × ${f1(hco3)} + 8 = <span class="val">${f1(exp)}</span> ± 2 (i.e. ${f1(exp-2)}–${f1(exp+2)}).`;
      if(pco2>exp+2){
        const excess=pco2-exp, marginal=excess<=MARGINAL_PCO2;
        disorders.push('concurrent respiratory acidosis');
        flags.respAcid={role:'secondary', deviation:excess, marginal};
        compLine+=` Measured pCO₂ ${f1(pco2)} is <span class="fa">above</span> expected → superimposed <b>respiratory acidosis</b>.`;
        if(marginal) compLine+=` <span class="why" style="display:inline">Only ${f1(excess)} mmHg beyond the predicted band — within the scatter of the compensation rule. Treat as a hint to watch the respiratory drive, not as an independent indication for ventilatory support.</span>`;
      }
      else if(pco2<exp-2){
        const deficit=exp-pco2, marginal=deficit<=MARGINAL_PCO2;
        disorders.push('concurrent respiratory alkalosis');
        flags.respAlk={role:'secondary', deviation:deficit, marginal};
        compLine+=` Measured pCO₂ ${f1(pco2)} is <span class="fk">below</span> expected → superimposed <b>respiratory alkalosis</b>.`;
        if(marginal) compLine+=` <span class="why" style="display:inline">Only ${f1(deficit)} mmHg below the predicted band — within the scatter of the compensation rule.</span>`;
      }
      else compLine+=` Measured pCO₂ ${f1(pco2)} is within range → appropriate respiratory compensation (simple disorder).`;
    }
    else if(primary==='Metabolic alkalosis'){
      disorders.push('Metabolic alkalosis');
      flags.metAlk={role:'primary'};
      const exp=C.metAlkExpectedPCO2(hco3);
      compLine=`Expected pCO₂ = 40 + 0.7 × (${f1(hco3)} − 24) = <span class="val">${f1(exp)}</span> ± 2.`;
      if(pco2<exp-2){
        const deficit=exp-pco2;
        disorders.push('concurrent respiratory alkalosis');
        flags.respAlk={role:'secondary', deviation:deficit, marginal:deficit<=MARGINAL_PCO2};
        compLine+=` Measured pCO₂ ${f1(pco2)} <span class="fk">below</span> expected → superimposed <b>respiratory alkalosis</b>.`;
      }
      else if(pco2>exp+2){
        // Do NOT run the acute/chronic HCO3 discrimination here. respAcidAcuteHCO3/
        // respAcidChronicHCO3 assume the hypercapnia is PRIMARY and the HCO3 is its renal
        // answer. When the alkalosis is primary the HCO3 is the cause, not the response, so
        // the chronic curve always "fits" better and every compensating met-alkalosis got
        // labelled chronic respiratory acidosis — which then fired the COPD post-hypercapnia
        // ventilator pearl at an alkalaemic patient.
        const excess=pco2-exp, marginal=excess<=MARGINAL_PCO2;
        disorders.push('concurrent respiratory acidosis');
        flags.respAcid={role:'secondary', deviation:excess, marginal};
        compLine+=` Measured pCO₂ ${f1(pco2)} <span class="fa">above</span> expected → superimposed <b>respiratory acidosis</b>.`;
        compLine+=` <div class="why">Acute-vs-chronic staging is deliberately not applied to a <i>secondary</i> hypercapnia: those rules read HCO₃⁻ as the renal response to CO₂, and here HCO₃⁻ is the primary abnormality. ${marginal?`This pCO₂ is also only ${f1(excess)} mmHg past the predicted band — compensatory hypoventilation is limited by hypoxaemia and rarely exceeds ~55–60 mmHg, so near-miss values are usually still compensation.`:'Decide acute vs chronic from the history and prior gases, not from this HCO₃⁻.'}</div>`;
      }
      else compLine+=` pCO₂ ${f1(pco2)} within range → appropriate compensation.`;
      if(veryHighAG){disorders.push('hidden high-anion-gap metabolic acidosis'); flags.metAcid={role:'secondary', highAG:true, agState}; compLine+=` AG ${f1(cAG)} markedly high → coexisting <b>high-AG metabolic acidosis</b>.`;}
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG mildly high (${f1(cAG)}); a mild rise is common in alkalaemia itself.</span>`;
    }
    else if(primary==='Respiratory acidosis'){
      const rise=pco2-N_PCO2, acute=C.respAcidAcuteHCO3(pco2), chronic=C.respAcidChronicHCO3(pco2);
      const isChronic=Math.abs(hco3-chronic)<Math.abs(hco3-acute);
      disorders.push(isChronic?'Chronic respiratory acidosis':'Acute respiratory acidosis');
      flags.respAcid={role:'primary', chronic:isChronic};
      compLine=`Renal compensation: acute expects HCO₃⁻ ≈ <span class="val">${f1(acute)}</span> (+0.1/mmHg), chronic ≈ <span class="val">${f1(chronic)}</span> (+0.4/mmHg). Measured ${f1(hco3)} → best fits <b>${isChronic?'chronic':'acute'}</b>.`;
      if(hco3<acute-3){disorders.push('superimposed metabolic acidosis'); flags.metAcid={role:'secondary', highAG, agState}; compLine+=` HCO₃⁻ lower than either prediction → added <span class="fa">metabolic acidosis</span>.`;}
      else if(hco3>chronic+3){disorders.push('superimposed metabolic alkalosis'); flags.metAlk={role:'secondary'}; compLine+=` HCO₃⁻ higher than chronic → added <span class="fk">metabolic alkalosis</span>.`;}
      else if(!isChronic && rise>=15 && hco3<chronic-3){
        compLine+=` <span class="why" style="display:inline">Caveat: with this degree of chronic hypercapnia (e.g. known COPD), HCO₃⁻ ${f1(hco3)} is well below the chronic expectation of ${f1(chronic)} — if the process is in fact chronic, a superimposed <b>metabolic acidosis</b> (e.g. diarrhoea, renal) is likely. History decides.</span>`;
      }
      const expectedRA=isChronic?chronic:acute;
      if(isChronic){
        compLine+=`<div class="why" style="margin-top:6px;"><b>Ventilator &amp; Management Safety Pearl:</b> In Chronic Respiratory Acidosis (e.g. COPD/OHS), do NOT rapidly blow off pCO₂ to 40 mmHg during mechanical ventilation! Normalizing pCO₂ while serum HCO₃⁻ is chronically elevated (${f1(hco3)}) precipitates severe <b>Post-Hypercapnic Metabolic Alkalosis</b> (pH &gt; 7.55 with risk of seizures, arrhythmias, and vasospasm). Target the patient's baseline pH (7.35–7.38) and pCO₂. Also, minimize high-carbohydrate TPN/feedings (RQ = 1.0) to reduce excess CO₂ production.</div>`;
      }
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG is mildly high (${f1(cAG)}); interpret alongside the clinical picture rather than as a definite second disorder.</span>`;
    }
    else if(primary==='Respiratory alkalosis'){
      const fall=N_PCO2-pco2, acute=C.respAlkAcuteHCO3(pco2), chronic=C.respAlkChronicHCO3(pco2);
      const isChronic=Math.abs(hco3-chronic)<Math.abs(hco3-acute);
      const expected=isChronic?chronic:acute;
      disorders.push(isChronic?'Chronic respiratory alkalosis':'Acute respiratory alkalosis');
      flags.respAlk={role:'primary', chronic:isChronic};
      compLine=`Renal compensation: acute expects HCO₃⁻ ≈ <span class="val">${f1(acute)}</span> (−0.2/mmHg), chronic ≈ <span class="val">${f1(chronic)}</span> (−0.4/mmHg). Measured ${f1(hco3)} → best fits <b>${isChronic?'chronic':'acute'}</b>.`;
      if(highAG && hco3 < expected-3){compLine+=` HCO₃⁻ ${f1(hco3)} is well below the expected ${f1(expected)} and the AG is high (${f1(cAG)}) → superimposed <b>high-AG metabolic acidosis</b> (classic salicylate/lactate picture); see the Delta Gap ratio below.`;}
      else if(highAG) compLine+=` <span class="why" style="display:inline">Note: AG is high (${f1(cAG)}); HCO₃⁻ being close to the expected compensation does not clear the gap — a high AG needs its own workup regardless of how well the HCO₃⁻ fits compensation. See the Delta Gap ratio below for quantification.</span>`;
    }
    else {
      if(highAG){
        disorders.push('hidden high-anion-gap metabolic acidosis');
        flags.metAcid={role:'primary', highAG:true, agState, hidden:true};
        compLine=`Gas looks normal, but the anion gap is elevated — this is the textbook trap: a high AG at normal pH means a metabolic acidosis is masked by a second, offsetting process.`;
        const {dAG,dHCO3,ratio}=C.deltaRatio(cAG,hco3,N_AG,N_HCO3);
        if(dHCO3<=0 || ratio>2){disorders.push('concurrent metabolic alkalosis'); flags.metAlk={role:'secondary'}; compLine+=` ΔAG/ΔHCO₃⁻ ${dHCO3>0?('= '+ratio.toFixed(2)):'undefined'} (≫2) → superimposed <b>metabolic alkalosis</b> raising HCO₃⁻ back to normal.`;}
        else if(dHCO3>0 && ratio<1){disorders.push('concurrent normal-AG metabolic acidosis'); compLine+=` ΔAG/ΔHCO₃⁻ = ${ratio.toFixed(2)} (<1) → additional <b>normal-AG acidosis</b>.`;}
        dxClass='warn';
      } else {
        disorders.push('Normal acid–base status');
        compLine=`pH, HCO₃⁻, pCO₂ and anion gap all within normal limits.`;
      }
    }
    S('Step 6 · Expected compensation & mixed check', compLine);

    if(forcedMixed && !disorders.some(x=>x.toLowerCase().includes(forcedMixed.toLowerCase()))){
      const isPregnancyPattern = (isPregnant || (ph >= 7.38 && ph <= 7.45 && pco2 >= 26 && pco2 <= 33 && hco3 >= 17 && hco3 <= 22)) && forcedMixed === 'Metabolic acidosis';
      if(isPregnancyPattern){
        S('Step 6b · Pregnancy Physiology Adaptation',
          `pH ${ph.toFixed(2)} is normal with PaCO₂ ${f1(pco2)} mmHg and HCO₃⁻ ${f1(hco3)} mEq/L. In pregnancy (2nd/3rd trimester), progesterone-driven hyperventilation creates a baseline chronic respiratory alkalosis. The renal response lowers serum HCO₃⁻ to 18–21 mEq/L and Base Excess to −2 to −5 mEq/L. <b>This is expected physiological renal compensation, NOT a true co-existing metabolic acidosis.</b>`);
      } else {
        disorders.push(forcedMixed);
        if(forcedMixed==='Metabolic acidosis' && !flags.metAcid) flags.metAcid={role:'secondary', highAG, agState};
        else if(forcedMixed==='Metabolic alkalosis' && !flags.metAlk) flags.metAlk={role:'secondary'};
        else if(forcedMixed==='Respiratory acidosis' && !flags.respAcid) flags.respAcid={role:'secondary', deviation:null, marginal:false};
        else if(forcedMixed==='Respiratory alkalosis' && !flags.respAlk) flags.respAlk={role:'secondary', deviation:null, marginal:false};
        S('Step 6b · Normal pH with a deranged PaCO₂/HCO₃⁻',
          `pH ${ph.toFixed(2)} is within the normal range despite an abnormal ${primary.includes('Respiratory')?'PaCO₂':'HCO₃⁻'} — compensation limits but never fully normalizes pH, so a normal pH here proves a second, offsetting disorder: <b>${forcedMixed}</b>.`);
      }
    }

    let delta = null;
    if(highAG){
      if(!disorders.some(x=>x.toLowerCase().includes('anion-gap'))){
        disorders.push('concurrent high-anion-gap metabolic acidosis');
      }
      if(!flags.metAcid) flags.metAcid={role:'secondary', highAG:true, agState};
      const {dAG,dHCO3,ratio}=C.deltaRatio(cAG,hco3,N_AG,N_HCO3);
      // Published so the summary card and tutor gauges display THIS ratio and THIS label
      // rather than each re-deriving one from raw inputs against a different threshold.
      delta = {dAG, dHCO3, ratio,
        label: dHCO3<=0 ? 'HCO₃⁻ not low — concurrent metabolic alkalosis'
             : ratio<1.0 ? 'Mixed HAGMA + normal-AG (<1.0)'
             : ratio<=1.6 ? 'Pure HAGMA (1.0–1.6)'
             : ratio<=2.0 ? 'Pure HAGMA (1.6–2.0)'
             : 'Concurrent metabolic alkalosis (>2.0)'};
      if(dHCO3<=0){
        if(dAG>10 && !disorders.some(x=>x.toLowerCase().includes('alkalosis'))){
          disorders.push('concurrent metabolic alkalosis');
          flags.metAlk = flags.metAlk || {role:'secondary'};
        }
        S('Step 8 · ΔAG/ΔHCO₃⁻ ratio (Delta Gap)',
          `ΔAG ${f1(dAG)} with serum HCO₃⁻ ${f1(hco3)} (no HCO₃⁻ deficit) — <b>concurrent metabolic alkalosis</b> is elevating bicarbonate back to normal or high levels despite unmeasured acid accumulation.`);
      } else {
        let txt;
        if(ratio<0.4){txt='ratio < 0.4 → mainly a normal-anion-gap (hyperchloremic) acidosis'; if(!disorders.includes('concurrent normal-AG metabolic acidosis')) disorders.push('concurrent normal-AG metabolic acidosis');}
        else if(ratio<1.0){txt='ratio 0.4–1.0 → mixed high-AG + normal-AG (hyperchloremic) metabolic acidosis (e.g. diarrhea + lactic acidosis)'; if(!disorders.includes('concurrent normal-AG metabolic acidosis')) disorders.push('concurrent normal-AG metabolic acidosis');}
        else if(ratio<=1.6){txt='ratio 1.0–1.6 → pure high-AG metabolic acidosis (ratio 1.6 specifically typical of pure lactic acidosis due to intracellular non-HCO₃⁻ buffering & low renal clearance)';}
        else if(ratio<=2.0){
          const isHypoCl = cl!==null && na!==null && (na/cl > 1.48 || cl < 90);
          if(isHypoCl){
            txt=`ratio ${ratio.toFixed(2)} with disproportionate hypochloremia (Cl⁻ ${cl} mEq/L) → concurrent metabolic alkalosis (e.g. vomiting / diuretics)`;
            if(!disorders.includes('concurrent metabolic alkalosis')) disorders.push('concurrent metabolic alkalosis');
            flags.metAlk = flags.metAlk || {role:'secondary'};
            delta.label = 'Concurrent metabolic alkalosis (hypochloraemic)';
          } else {
            txt='ratio 1.6–2.0 → pure high-AG metabolic acidosis';
          }
        }
        else {txt='ratio > 2.0 → concurrent metabolic alkalosis (or pre-existing chronic hypercapnia with high baseline HCO₃⁻)'; if(!disorders.includes('concurrent metabolic alkalosis')) disorders.push('concurrent metabolic alkalosis'); flags.metAlk = flags.metAlk || {role:'secondary'};}
        S('Step 8 · ΔAG/ΔHCO₃⁻ ratio (Delta Gap)',
          `ΔAG ${f1(dAG)} / ΔHCO₃⁻ ${f1(dHCO3)} = <span class="val">${ratio.toFixed(2)}</span> — ${txt}.`
          + `<div class="why"><b>Clinical Interpretation:</b> Ratio 1.0–1.6 indicates pure HAGMA (1.6 specifically typical for pure Lactic Acidosis). Ratio &lt; 1.0 indicates mixed HAGMA + Normal-AG (hyperchloremic) acidosis. Ratio &gt; 2.0 indicates mixed HAGMA + Metabolic Alkalosis (HCO₃⁻ inappropriately high).</div>`);
      }
    }

    if(lactate!==null){
      if(lactate>4){
        S('Lactate', `<span class="fa">${f1(lactate)} mmol/L — markedly elevated.</span> A dominant driver of a high-AG acidosis and a marker of tissue hypoperfusion; trend it with resuscitation.`);
        // Lactate–AG Sensitivity Rule: If Lactate > 4.0 but AG is normal/low, force recognition of Masked HAGMA
        if(!highAG){
          if(!disorders.some(x=>x.toLowerCase().includes('high-anion-gap')||x.toLowerCase().includes('lactic'))){
            disorders.push('concurrent high-anion-gap (lactic) acidosis (masked by normal AG)');
          }
          // Must also register structurally: this IS a metabolic acidosis, and recommend()
          // has to know that before it can safely say anything about minute ventilation.
          if(!flags.metAcid) flags.metAcid={role:'secondary', highAG:true, agState, masked:true};
          S('Step 8 · Lactate–AG Mismatch (Masked HAGMA)',
            `Lactate is markedly high (${f1(lactate)} mmol/L) despite a normal AG (${f1(cAG)}). Anion gap calculation is only ~50% sensitive for HAGMA (often masked by hypoalbuminemia or heavy hyperchloremia). <b>Diagnosis: Triple Acid-Base Disorder (NAGMA + HAGMA + Respiratory Acidosis).</b>`);
        }
      }
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

    let uag = null;
    if(uNa!==null&&uK!==null&&uCl!==null){
      uag=C.urineAnionGap(uNa,uK,uCl);
      // Case-sensitive matching used to miss the PURE normal-AG acidosis: the primary label is
      // 'Normal-anion-gap metabolic acidosis' (capital N), so only the 'concurrent normal-AG ...'
      // secondary ever matched and the UAG printed as a bare number exactly when it mattered most.
      const isNAG = disorders.some(x=>/normal-(ag|anion)/i.test(x));
      let line=`Urine AG = (${uNa} + ${uK}) − ${uCl} = <span class="val">${f1(uag)}</span>.`;
      if(isNAG) line+= uag>0
        ? ` Positive with a normal-AG acidosis → impaired renal NH₄⁺ excretion → <b>renal tubular acidosis</b>.`
        : ` Negative with a normal-AG acidosis → intact NH₄⁺ excretion → <b>GI HCO₃⁻ loss</b> (e.g. diarrhoea).`;
      S('Urine anion gap', line);
    }

    const pao2Val = (vent && vent.pao2 != null) ? vent.pao2 : (pao2 != null ? pao2 : (po2 != null ? po2 : null));
    if(pao2Val !== null){
      const fio2Pct = (vent && vent.fio2 != null) ? vent.fio2 : (fio2 != null ? fio2 : 21);
      const {PAO2,aa}=C.aaGradient(pco2, fio2Pct, pao2Val);
      let aaLine = `A–a = ${f1(PAO2)} − ${f1(pao2Val)} = <span class="val">${f1(aa)}</span> mmHg (FiO₂ ${fio2Pct}%).`;
      if(fio2Pct > 21){
        const pf = C.pfRatio(pao2Val, fio2Pct);
        let pfState = pf >= 300 ? 'Normal' : (pf >= 200 ? 'Mild ARDS / Acute Lung Injury' : (pf >= 100 ? 'Moderate ARDS' : 'Severe ARDS'));
        aaLine += `<br><b>P/F Ratio (PaO₂/FiO₂):</b> ${f1(pao2Val)} / ${(fio2Pct/100).toFixed(2)} = <span class="val">${f1(pf)}</span> mmHg — <span class="${pf<300?'fa':''}">${pfState}</span>.`;
      }
      S('A–a gradient & P/F Ratio',
        aaLine + `<div class="why">Room-air upper limit ≈ (age/4)+4. P/F ratio &lt; 300 mmHg on elevated FiO₂ indicates acute lung injury / ARDS (e.g. pneumonia, sepsis, TRALI).</div>`);
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

    // Counterpart to the pH < 7.10 block above. Severe alkalaemia was previously only ever
    // mentioned inside the metabolic-alkalosis management text, so a pH of 7.65 driven by
    // hyperventilation produced no warning at all.
    if(ph > 7.55){
      S('Critical Warning · Severe Alkalaemia (pH > 7.55)',
        `<span class="fa">Severe alkalaemia (pH ${ph.toFixed(2)}): risk of cerebral and coronary vasoconstriction, refractory arrhythmia, seizures, and a fall in ionised calcium with tetany/paraesthesiae.</span>` +
        `<div class="why">Alkalaemia shifts the oxyhaemoglobin curve left (impairing tissue O₂ offloading) and drives K⁺ and Ca²⁺ intracellularly. Correct the <b>dominant</b> mechanism: ${flags.metAlk&&flags.metAlk.role==='primary' ? 'this is metabolically driven — restore chloride/potassium/volume (see management below).' : flags.respAlk&&flags.respAlk.role==='primary' ? 'this is <b>respiratory</b> — the fix is the ventilation/drive, not acid administration.' : 'establish whether the dominant driver is respiratory or metabolic before treating.'}</div>`);
    }

    const uniq=[...new Set(disorders)];
    let integrated = uniq.length===1 ? uniq[0] : 'Mixed disorder: '+uniq.join(' + ');
    return {primary, integrated, disorders:uniq, dxClass, steps, ag, cAG, agState, ph, pco2, hco3, lactate, uCl, iCa, k, cl, na, flags, delta, uag};
  }

  function recommend(r, vent){
    const R=[]; const d=r.disorders.join(' ; ').toLowerCase();
    const vented = vent.mode!=='Not Set' && vent.mode!=='Spontaneous';

    // Dispatch on the structured findings, not on substrings of the display text. The old
    // substring form could not tell a primary disorder from a secondary one, could not tell a
    // 0.4 mmHg deviation from a 25 mmHg one, and never consulted the pH — which is how an
    // alkalaemic patient came to be offered intubation "for refractory acidaemia".
    const F = r.flags || {};
    const respAcid = F.respAcid, respAlk = F.respAlk, metAcid = F.metAcid, metAlk = F.metAlk;
    const acidaemic = r.ph < 7.35, alkalaemic = r.ph > 7.45;

    if(respAcid){
      R.push(['a','<b>Respiratory acidosis</b> — CO₂ retention from inadequate alveolar ventilation. Pathophysiology: minute ventilation is failing to clear CO₂ (airway obstruction, respiratory fatigue, sedation, or neuromuscular weakness).']);

      if(respAcid.role === 'secondary' && respAcid.marginal){
        R.push(['',`This is a <b>marginal secondary</b> finding — pCO₂ is only ${f1(respAcid.deviation)} mmHg outside the range predicted for the primary disorder, which is within the scatter of the compensation formulas. Note it and watch the respiratory drive; it is <b>not</b> on its own an indication for NIV, intubation, or a minute-ventilation change.`]);
      } else if(alkalaemic){
        // Hypoventilation in an alkalaemic patient is nearly always compensation for, or
        // secondary to, a metabolic alkalosis. Telling this patient to escalate ventilation
        // "for refractory acidaemia" inverts the actual problem.
        R.push(['',`<b>Do not treat this as ventilatory failure.</b> The patient is <b>alkalaemic</b> (pH ${r.ph.toFixed(2)}), so the raised pCO₂ is a response to — or coexists with — the alkalosis, not the cause of an acidaemia. Raising minute ventilation here drives the pH higher still. Correct the metabolic side first (chloride/potassium/volume) and let the pCO₂ follow; reserve ventilatory support for hypoxaemia or a falling conscious level.`]);
      } else {
        R.push(['', vented
          ? `On the ventilator, minute ventilation = Vt × RR. To lower pCO₂, raise RR first, then Vt (target ~6 mL/kg IBW${vent.tidalVolume!==null&&vent.weight?`; current ≈ ${f1(C.ibwPerKg(vent.tidalVolume,vent.weight))} mL/kg`:''}). Watch plateau pressure and auto-PEEP; permissive hypercapnia is acceptable in ARDS/severe asthma if pH is tolerated.`
          : 'Support ventilation: treat the reversible cause, consider NIV; escalate to intubation for fatigue, falling GCS, or refractory acidaemia.']);
      }

      // Only a PRIMARY chronic hypercapnia earns the post-hypercapnic-alkalosis pearl. It was
      // previously fired by any disorder string containing 'chronic respiratory acidosis',
      // including the spurious one the metabolic-alkalosis branch used to generate.
      if(respAcid.role === 'primary' && respAcid.chronic){
        const atTarget = r.ph >= 7.35 && r.ph <= 7.45;
        R.push(['a',`<b>Ventilator &amp; Management Safety Pearl:</b> In Chronic Respiratory Acidosis (e.g. COPD/OHS), do NOT rapidly blow off pCO₂ to 40 mmHg during mechanical ventilation! Normalizing pCO₂ while serum HCO₃⁻ is chronically elevated (${f1(r.hco3)}) precipitates severe <b>Post-Hypercapnic Metabolic Alkalosis</b> (pH &gt; 7.55 with risk of seizures, arrhythmias, and vasospasm). Target the patient's baseline pH (7.35–7.38) and pCO₂ — <b>not</b> a normal pCO₂. Also, minimize high-carbohydrate TPN/feedings (RQ = 1.0) to reduce excess CO₂ production.`]);
        if(atTarget) R.push(['',`<b>This patient is already at that target</b> (pH ${r.ph.toFixed(2)}). The hypercapnia is chronic and compensated — leave the minute ventilation alone unless there is hypoxaemia, rising pCO₂, or fatigue. Do not increase RR or Vt to "correct" the pCO₂ of ${f1(r.pco2)} mmHg.`]);
      }
    }
    if(respAlk){
      R.push(['k','<b>Respiratory alkalosis</b> — CO₂ blown off by excess ventilation. Pathophysiology: a stimulus (hypoxaemia, pain, anxiety, sepsis, PE, CNS drive) is driving hyperventilation.']);

      if(metAcid){
        // NEVER emit "reduce RR/Vt" when a metabolic acidosis coexists. The hyperventilation is
        // holding the pH up; cutting minute ventilation drops it precipitously. This previously
        // appeared as the lead action with the contradicting warning only underneath it.
        R.push(['a',`<span class="fa">Do not reduce minute ventilation.</span> A metabolic acidosis is also present, so this hyperventilation is largely <b>protective compensation</b>${vented?' — including any ventilator-delivered portion':''}. Lowering the RR or Vt (or over-sedating the drive) removes that compensation and precipitates dangerous acidaemia within minutes; this is the classic post-intubation deterioration in salicylate poisoning and DKA.`]);
        R.push(['', vented
          ? `On the ventilator, <b>match the patient's own minute ventilation</b> rather than normalising pCO₂ — keep pCO₂ near its pre-intubation value until the metabolic acidosis is corrected. Check for breath-stacking/auto-PEEP at the higher rates this requires, and sedate for comfort without suppressing drive.`
          : `Do not suppress the respiratory drive. Find and treat the driver of any <i>independent</i> respiratory stimulus — check oxygenation, exclude PE and sepsis, address pain/anxiety — while correcting the metabolic acidosis.`]);
        R.push(['','Compensation and a second primary respiratory process are not mutually exclusive: if the pCO₂ is well below what the metabolic acidosis alone predicts, an independent driver (sepsis, salicylate, CNS, PE) is present and needs its own treatment — but the treatment is still the driver, not the ventilation.']);
      } else {
        R.push(['', vented
          ? 'Reduce set RR or Vt and confirm the patient is not over-triggering; ensure adequate sedation/analgesia.'
          : 'Find and treat the driver — check oxygenation, exclude PE and sepsis, address pain/anxiety.']);
      }
    }
    if(metAcid){
      R.push(['a','<b>Metabolic acidosis</b> — identify and treat the source.']);
      if(r.lactate!==null && r.lactate>2) R.push(['','Lactic acidosis: restore perfusion (fluids, source control of sepsis, treat shock). Bicarbonate is reserved for severe acidaemia by judgement — it does not replace treating the cause.']);
      if(d.includes('high-anion-gap')||d.includes('high-ag')) R.push(['','High-AG: work through the GOLD-MARK / MUDPILES differential — lactate, ketones (DKA/starvation/alcoholic), urate (renal failure), salicylate, toxic alcohols. Use the osmolal gap and ketones to narrow it.']);
      // A borderline gap is neither, and must not be routed down the normal-AG (RTA vs diarrhoea)
      // pathway as though the gap had been excluded.
      if(metAcid.agState === 'borderline'){
        R.push(['',`The anion gap is <b>borderline</b> (corrected AG ${f1(r.cAG)}), not clearly normal — do not commit to a hyperchloraemic aetiology yet. Send lactate, ketones (β-hydroxybutyrate, not just dipstick acetoacetate) and an osmolal gap to exclude an evolving or partly-treated high-AG acidosis; a urine AG only becomes interpretable once the gap is confirmed normal.`]);
      } else if(metAcid.agState === 'n/a'){
        R.push(['','The anion gap could not be calculated — enter Na⁺ and Cl⁻. Until then the acidosis cannot be classified as high-AG or normal-AG, and neither the delta ratio nor the urine AG can be interpreted.']);
      } else if(d.includes('normal-ag')||d.includes('normal-anion')){
        R.push(['','Normal-AG: use the urine AG to separate renal (RTA — positive UAG) from GI bicarbonate loss (diarrhoea — negative UAG).']);
      }
      if(acidaemic && r.ph < 7.20 && metAlk){
        R.push(['','<b>Mixed picture:</b> a metabolic alkalosis is also present and is currently blunting the acidaemia. Treating the alkalosis (chloride/HCl) while the acid load is uncorrected will drop the pH further — correct the acidosis first.']);
      }
      // Guards: (a) `null < 3.5` is TRUE in JS, so an unentered potassium used to satisfy the
      // hypokalaemia criterion and this fired on any hyperchloraemic acidosis; (b) it must not
      // assert a distal RTA when the gap is only borderline (the line above says not to commit
      // to a hyperchloraemic aetiology at all); (c) a measured NEGATIVE urine AG points to GI
      // bicarbonate loss and argues against RTA, so it must not be offered alongside one.
      const uagNeg = r.uag != null && r.uag < 0;
      if(r.hco3 < 15 && r.cl != null && r.cl > 110 && r.k != null && r.k < 3.5
         && metAcid.agState === 'normal' && !uagNeg){
        R.push(['a','<b>Suspected Distal (Type 1) RTA:</b> Severe NAGMA (HCO₃⁻ &lt; 15 mEq/L) with hyperchloremia and hypokalemia. Confirm with urine pH (&gt;5.5) and positive Urine Anion Gap. Initiate alkali therapy (bicarbonate / citrate) once potassium is repleted.']);
      } else if(r.hco3 < 15 && r.cl != null && r.cl > 110 && metAcid.agState === 'normal' && uagNeg){
        R.push(['',`Severe hyperchloraemic acidosis, but the measured urine AG is <b>negative (${f1(r.uag)})</b> → NH₄⁺ excretion is intact, which argues <b>against</b> a distal RTA and for <b>GI bicarbonate loss</b> (diarrhoea, high-output stoma, ureteric diversion). Treat the losses; do not start long-term alkali as for RTA.`]);
      }
    }
    if(r.iCa !== null && r.iCa < 0.90){
      R.push(['a','<b>Severe Ionized Hypocalcemia (iCa²⁺ < 0.90 mmol/L):</b> Replete urgently with IV Calcium Gluconate (or Calcium Chloride via central line) to restore vascular responsiveness to vasopressors and improve cardiac contractility.']);
    }
    if(metAlk){
      R.push(['k','<b>Metabolic alkalosis</b> — assess volume and chloride status. Pathophysiology: HCO₃⁻ gain or H⁺/Cl⁻ loss, sustained by volume/chloride/potassium depletion.']);
      const uCl = r.uCl;
      const clDeficit = r.cl != null && r.cl < 100;
      if(uCl!=null) R.push(['', uCl<20
        ? `Urine Cl⁻ ${f1(uCl)} mEq/L (&lt;20) → <b>chloride-sensitive</b> (vomiting, NG suction, diuretic after-effect, laxative abuse) → replace with isotonic saline + KCl${clDeficit?'; see the dosing calculation below.':`. Note plasma Cl⁻ is already ${f1(r.cl)} mEq/L, so there is no chloride deficit to replace by the standard formula — correct potassium and volume instead, and re-check whether the alkalosis is really chloride-responsive.`}`
        : `Urine Cl⁻ ${f1(uCl)} mEq/L (&gt;20) → <b>chloride-resistant</b> (primary hyperaldosteronism, exogenous mineralocorticoid, licorice) → <b>saline will not correct this and may worsen the hypertension/volume state</b>; treat the underlying cause and replace K⁺. Ignore any chloride/saline volume shown below.`]);
      else R.push(['','Check urine Cl⁻: &lt; 20 = chloride-sensitive (vomiting, NG suction, diuretics) → normal saline + KCl; &gt; 20 = chloride-resistant (mineralocorticoid excess) → treat the cause, do not volume-load.']);
      // Requires the bicarbonate to actually be high. Gating on `ph > 7.55` alone recruited the
      // acid-infusion pathway for alkalaemia that was entirely RESPIRATORY, where HCO3 may be
      // low — the deficit formula 0.5 x wt x (HCO3 - 24) then returned a negative "dose".
      const severeMetAlk = r.hco3 > 50 || (r.ph > 7.55 && r.hco3 > 30);
      if(severeMetAlk){
        R.push(['a',`<span class="fa">Severe metabolic alkalosis</span> (HCO₃⁻ ${f1(r.hco3)}${r.hco3>50?' &gt;50':''}${r.ph>7.55?`, pH ${r.ph.toFixed(2)} &gt;7.55`:''}) — consider an HCl infusion if K⁺/acetazolamide are insufficient; see the dosing calculation below. Reserve for refractory severe cases and infuse via a large central vein.`]);
      } else if(r.ph > 7.55){
        R.push(['a',`<span class="fa">pH ${r.ph.toFixed(2)} is severely alkalaemic, but HCO₃⁻ is only ${f1(r.hco3)} mEq/L</span> — the alkalaemia is <b>not</b> metabolically driven, so acid (HCl) infusion is <b>not</b> indicated and the H⁺-deficit formula does not apply here. Correct the respiratory driver; the metabolic alkalosis flagged above is a secondary/relative finding.`]);
      }
      R.push(['','Expanded-volume states (heart failure, cirrhosis, cor pulmonale) where saline is counterproductive can be treated with acetazolamide 250–375 mg IV/PO instead. Check magnesium before/while replacing K⁺ — hypomagnesemia can make diuretic-induced hypokalemia refractory to K⁺ alone.']);
    }
    if(r.agState==='low') R.push(['','Low anion gap is abnormal — check albumin first, then consider paraproteinaemia (myeloma), lithium, or severe hypercalcaemia.']);
    if(r.primary.includes('indeterminate')) R.push(['a','pH is deranged but neither HCO₃⁻ nor pCO₂ explains it in the expected direction — recheck the sample and the electrolytes.']);
    if(!R.length) R.push(['','Values within normal limits — no specific acid–base intervention indicated.']);

    return R;
  }

  return { analyze, recommend };
})();
