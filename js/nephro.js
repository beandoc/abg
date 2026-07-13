window.ABG = window.ABG || {};

ABG.Nephro = (function(){
  'use strict';
  const f1 = x => x==null||isNaN(x) ? '—' : (Math.round(x*10)/10).toFixed(1);
  const f2 = x => x==null||isNaN(x) ? '—' : (Math.round(x*100)/100).toFixed(2);

  function egfrCKDEPI2021(age, sex, scr){
    if(age==null||sex==null||scr==null) return null;
    const isF = sex === 'F';
    const kappa = isF ? 0.7 : 0.9;
    const alpha = isF ? -0.241 : -0.302;
    const minT = Math.pow(Math.min(scr/kappa, 1), alpha);
    const maxT = Math.pow(Math.max(scr/kappa, 1), -1.200);
    let egfr = 142 * minT * maxT * Math.pow(0.9938, age);
    if(isF) egfr *= 1.012;
    return egfr;
  }

  function bunCrRatio(bun, cr){ return (bun!=null&&cr) ? bun/cr : null; }
  function correctedCalcium(ca, albumin){ return (ca!=null&&albumin!=null) ? ca + 0.8*(4.0-albumin) : null; }
  function effectiveOsm(na, glucose){ return (na!=null&&glucose!=null) ? 2*na + glucose/18 : null; }
  function correctedSodium(na, glucose){ return (na!=null&&glucose!=null) ? na + 1.6*((glucose-100)/100) : null; }
  function correctedPotassium(k, ph){ return (k!=null&&ph!=null) ? k - 0.6*((7.4-ph)/0.1) : null; }

  function urr(preBUN, postBUN){ return (preBUN&&postBUN!=null) ? 100*(preBUN-postBUN)/preBUN : null; }

  function spKtV(preBUN, postBUN, tHours, ufLiters, postWeightKg){
    if(!preBUN||postBUN==null||!tHours||ufLiters==null||!postWeightKg) return null;
    const R = postBUN/preBUN;
    return -Math.log(R - 0.008*tHours) + (4 - 3.5*R) * (ufLiters/postWeightKg);
  }

  function stdKtV(spktv, tMinutes, sessionsPerWeek){
    if(spktv==null||!tMinutes||!sessionsPerWeek) return null;
    const oneMinusE = 1 - Math.exp(-spktv);
    const denom = (spktv * tMinutes / oneMinusE === 0 ? 0 : (tMinutes*oneMinusE)/spktv) + (10080/sessionsPerWeek) - tMinutes;
    return (10080 * oneMinusE) / denom;
  }

  function nPCR(preBUN, ktv, ufLiters, postWeightKg){
    if(!preBUN||!ktv||ufLiters==null||!postWeightKg) return null;
    return preBUN / (36.3 + (5.48/ktv) + (53.5/ktv)*(ufLiters/postWeightKg)) + 0.168;
  }

  function ttkg(uK, uOsm, pK, pOsm){
    if(uK==null||!uOsm||!pK||!pOsm) return null;
    return (uK * pOsm) / (pK * uOsm);
  }

  function feUrea(uUrea, pCr, pUrea, uCr){
    if(uUrea==null||!pCr||!pUrea||!uCr) return null;
    return 100 * (uUrea*pCr)/(pUrea*uCr);
  }
  function feNa(uNa, pCr, pNa, uCr){
    if(uNa==null||!pCr||!pNa||!uCr) return null;
    return 100 * (uNa*pCr)/(pNa*uCr);
  }
  function fePhos(uPhos, pCr, pPhos, uCr){
    if(uPhos==null||!pCr||!pPhos||!uCr) return null;
    return 100 * (uPhos*pCr)/(pPhos*uCr);
  }

  function freeWaterClearance(uVolMl, uTimeHr, uNa, uK, pNa){
    if(!uVolMl||!uTimeHr||uNa==null||uK==null||!pNa) return null;
    const vMlPerMin = uVolMl / (uTimeHr*60);
    return vMlPerMin * (1 - (uNa+uK)/pNa) * 60; // mL/hr
  }

  function stewart({na,k,ca,mg,cl,lactate,albumin,phosphate,hco3,ph}){
    if(na==null||k==null||cl==null) return null;
    const sidA = na + k + (ca||0) + (mg||0) - (cl + (lactate||0));
    if(hco3==null||ph==null||albumin==null) return { sidA, sidE:null, sig:null };
    const albGL = albumin*10;
    const phosMmol = phosphate!=null ? phosphate/3.1 : 0;
    const sidE = hco3 + albGL*(0.123*ph - 0.631) + phosMmol*(0.309*ph - 0.469);
    return { sidA, sidE, sig: sidA - sidE };
  }

  function collect(){
    const num = id => { const el=document.getElementById(id); if(!el) return null; const v=parseFloat(el.value); return isNaN(v)?null:v; };
    return {
      age: num('nAge'), sex: (document.getElementById('nSex')||{}).value || null,
      creatinine: num('nCreatinine'), calcium: num('nCalcium'), phosphate: num('nPhosphate'), magnesium: num('nMagnesium'),
      uCr: num('nUCr'), uUrea: num('nUUrea'), uPhos: num('nUPhos'), uOsm: num('nUOsm'),
      uVol: num('nUVol'), uTime: num('nUTime'),
      preBUN: num('nPreBUN'), postBUN: num('nPostBUN'), hdTime: num('nHdTime'),
      ufVolume: num('nUfVolume'), postWeight: num('nPostWeight'), sessionsPerWeek: num('nSessions')
    };
  }

  function render(container, abgVals){
    const n = collect();
    const rows = [];
    const row = (label, value, unit, note) => rows.push(
      `<div class="step"><div class="h">${label}</div><div class="b"><span class="val">${value}</span>${unit?(' '+unit):''}${note?`<div class="why">${note}</div>`:''}</div></div>`);

    const egfr = egfrCKDEPI2021(n.age, n.sex, n.creatinine);
    if(egfr!=null) row('eGFR (CKD-EPI 2021, race-free)', f1(egfr), 'mL/min/1.73m²',
      egfr<15?'Consistent with kidney failure (G5).': egfr<30?'G4 — severe reduction.': egfr<60?'G3 — moderate reduction.':null);

    const bcr = bunCrRatio(abgVals.bun, n.creatinine);
    if(bcr!=null) row('BUN : Creatinine ratio', f1(bcr), '', bcr>20?'Ratio &gt;20 suggests a pre-renal process (or GI bleed / high protein load / steroids).':null);

    const cCa = correctedCalcium(n.calcium, abgVals.albumin);
    if(cCa!=null) row('Corrected calcium', f1(cCa), 'mg/dL', 'Corrects total calcium for hypoalbuminaemia (+0.8 mg/dL per 1 g/dL albumin below 4.0).');

    const effOsm = effectiveOsm(abgVals.na, abgVals.glucose);
    if(effOsm!=null) row('Effective osmolality', f1(effOsm), 'mOsm/kg', 'Tonicity-relevant osmolality — excludes urea/ethanol, which cross membranes freely.');

    const cNa = correctedSodium(abgVals.na, abgVals.glucose);
    if(cNa!=null && abgVals.glucose>100) row('Corrected sodium (for hyperglycaemia)', f1(cNa), 'mEq/L', 'Katz correction: +1.6 mEq/L per 100 mg/dL glucose above 100.');

    const cK = correctedPotassium(abgVals.k, abgVals.ph);
    if(cK!=null) row('pH-adjusted potassium estimate', f1(cK), 'mEq/L', 'Rough bedside estimate only (~0.6 mEq/L per 0.1 pH unit) — do not use to guide replacement in isolation.');

    const uNaVal = (document.getElementById('uNa')||{}).value; const uNaNum = uNaVal? parseFloat(uNaVal): null;
    const feNaVal = feNa(uNaNum, n.creatinine, abgVals.na, n.uCr);
    if(feNaVal!=null) row('FENa', f2(feNaVal), '%', feNaVal<1?'&lt;1% — suggests pre-renal azotaemia (or AKI with intact tubular Na reabsorption, e.g. contrast/early sepsis).':'&gt;1% — suggests intrinsic renal injury (ATN) if oliguric AKI; unreliable if on diuretics.');

    const feUreaVal = feUrea(n.uUrea, n.creatinine, abgVals.bun, n.uCr);
    if(feUreaVal!=null) row('FEUrea', f2(feUreaVal), '%', feUreaVal<35?'&lt;35% — supports pre-renal physiology; remains valid on diuretics (unlike FENa).':'&gt;35% — favours intrinsic renal injury.');

    const fePhosVal = fePhos(n.uPhos, n.creatinine, n.phosphate, n.uCr);
    if(fePhosVal!=null) row('Fractional excretion of phosphate', f2(fePhosVal), '%', fePhosVal>20?'&gt;20% — consider renal phosphate wasting (e.g. hyperparathyroidism, FGF23-mediated, Fanconi syndrome).':null);

    const uKVal = (document.getElementById('uK')||{}).value; const uKNum = uKVal? parseFloat(uKVal): null;
    const pOsmForTTKG = n.uOsm!=null && abgVals.calcOsm!=null ? abgVals.calcOsm : null;
    const ttkgVal = ttkg(uKNum, n.uOsm, abgVals.k, pOsmForTTKG);
    if(ttkgVal!=null) row('TTKG', f1(ttkgVal), '', 'Only interpretable if urine osmolality ≥ plasma osmolality. Low TTKG in hyperkalaemia suggests hypoaldosteronism; largely superseded in current practice but still commonly taught.');

    const fwc = freeWaterClearance(n.uVol, n.uTime, uNaNum, uKNum, abgVals.na);
    if(fwc!=null) row('Free water clearance', f1(fwc), 'mL/hr', fwc<0?'Negative — the kidney is generating electrolyte-free water retention (concentrating urine relative to plasma tonicity).':'Positive — the kidney is excreting free water (diluting urine relative to plasma tonicity).');

    const urrVal = urr(n.preBUN, n.postBUN);
    if(urrVal!=null) row('Urea reduction ratio (URR)', f1(urrVal), '%', urrVal<65?'Below the KDOQI target of ≥65% — consider access recirculation, reduced blood/dialysate flow, or shortened treatment time.':'Meets the KDOQI adequacy target (≥65%).');

    const spktv = spKtV(n.preBUN, n.postBUN, n.hdTime, n.ufVolume, n.postWeight);
    if(spktv!=null){
      row('spKt/V (Daugirdas 2nd-generation)', f2(spktv), '', spktv<1.2?'Below the KDOQI single-pool target of ≥1.2 for thrice-weekly haemodialysis.':'Meets the KDOQI single-pool target (≥1.2).');
      const stdktv = stdKtV(spktv, n.hdTime*60, n.sessionsPerWeek);
      if(stdktv!=null) row('Standard Kt/V (Leypoldt, weekly)', f2(stdktv), '', 'Target ≥2.1/week for thrice-weekly schedules; cross-check against a dedicated dosing calculator before acting on this for prescription changes.');
      const pcr = nPCR(n.preBUN, spktv, n.ufVolume, n.postWeight);
      if(pcr!=null) row('nPCR (protein catabolic rate)', f2(pcr), 'g/kg/day', pcr<0.8?'Below 0.8 g/kg/day — suggests inadequate protein intake; assess nutrition.':null);
    }

    const sw = stewart({na:abgVals.na, k:abgVals.k, ca:n.calcium, mg:n.magnesium, cl:abgVals.cl, lactate:abgVals.lactate, albumin:abgVals.albumin, phosphate:n.phosphate, hco3:abgVals.hco3, ph:abgVals.ph});
    if(sw){
      row('Apparent strong ion difference (SIDa)', f1(sw.sidA), 'mEq/L', '(Na+K+Ca+Mg) − (Cl+Lactate). A falling SIDa is itself a strong (Stewart) acidifying process.');
      if(sw.sidE!=null){
        row('Effective SID (Figge–Fencl)', f1(sw.sidE), 'mEq/L', 'Charge carried by buffer anions (albumin + phosphate) at the measured pH.');
        row('Strong ion gap (SIG)', f1(sw.sig), 'mEq/L', Math.abs(sw.sig)>2?'|SIG| &gt; 2 — unmeasured strong ions present (ketoacids, sulfates/uraemic anions, exogenous toxins) beyond what the conventional anion gap captures.':'Within the usual range — no important unmeasured strong ion excess by this method.');
      }
    }

    if(!rows.length){
      container.innerHTML = `<p class="placeholder">Enter nephrology labs above and click “Calculate nephrology panel” to see eGFR, corrected electrolytes, urine indices, dialysis adequacy and Stewart parameters.</p>`;
      return;
    }
    container.innerHTML = rows.join('');
  }

  return {
    egfrCKDEPI2021, bunCrRatio, correctedCalcium, effectiveOsm, correctedSodium, correctedPotassium,
    urr, spKtV, stdKtV, nPCR, ttkg, feUrea, feNa, fePhos, freeWaterClearance, stewart,
    collect, render
  };
})();
