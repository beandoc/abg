window.ABG = window.ABG || {};

ABG.VentSim = (function(){
  'use strict';
  const C = ABG.Calculators;
  const f1 = x => x==null||isNaN(x) ? '—' : (Math.round(x*10)/10).toFixed(1);
  const f0 = x => x==null||isNaN(x) ? '—' : Math.round(x).toString();

  // current: {rr, vt, fio2, pao2, pco2, hco3, peep, compliance, vdvt}  target: {rr, vt, fio2, peep}
  function simulate(current, target){
    const warnings = [];
    if(current.rr==null || current.vt==null){
      return { error: 'Enter the current RR and Vt (in the Ventilator section) to simulate a parameter change.' };
    }
    if(current.pco2==null || current.hco3==null){
      return { error: 'Enter the current pCO₂ and HCO₃⁻ (in the ABG form) so the new pH can be predicted.' };
    }

    const rrNew = target.rr!=null ? target.rr : current.rr;
    const vtNew = target.vt!=null ? target.vt : current.vt;
    const fio2Old = current.fio2!=null ? current.fio2 : 21;
    const fio2New = target.fio2!=null ? target.fio2 : fio2Old;
    const peepOld = current.peep;
    const peepNew = target.peep!=null ? target.peep : peepOld;
    const vdvt = current.vdvt!=null ? current.vdvt : 0.30;

    // Alveolar ventilation: hold the absolute (anatomic+equipment) dead-space volume
    // constant across the change, rather than the fraction — a Vt change alters VD/VT.
    const deadSpaceMl = vdvt * current.vt;
    const vaOld = C.alveolarVentilation(current.vt, deadSpaceMl, current.rr);
    const vaNew = C.alveolarVentilation(vtNew, deadSpaceMl, rrNew);
    const pco2New = C.predictedPCO2FromVE(current.pco2, vaOld, vaNew);

    // Acute (minutes-scale) non-renal buffering shift in HCO3, not the days-scale renal one.
    const hco3New = C.acuteHCO3Shift(current.pco2, pco2New, current.hco3);
    const phNew = C.hendersonHasselbalchPH(pco2New, hco3New);

    const vaRatio = vaNew / vaOld;
    if(vaRatio > 2 || vaRatio < 0.5){
      warnings.push('The alveolar-ventilation change is large (>2× or <0.5×) — the inverse-proportionality model is least reliable far from baseline. Treat this as a directional estimate and recheck with a repeat gas.');
    }
    if(pco2New < 15 || pco2New > 100){
      warnings.push('Predicted pCO₂ is physiologically extreme — CO₂ production and dead-space fraction are unlikely to stay constant at this magnitude of change.');
    }

    let pao2New = null, aaOld = null, aaNew = null, PAO2Old = null, PAO2New = null;
    if(current.pao2 != null){
      const gOld = C.aaGradient(current.pco2, fio2Old, current.pao2);
      PAO2Old = gOld.PAO2; aaOld = gOld.aa;
      PAO2New = (fio2New/100) * (760-47) - pco2New/0.8;

      aaNew = aaOld;
      if(peepOld != null && peepNew != null && peepNew !== peepOld){
        const peepDelta = peepNew - peepOld;
        const shuntFactor = Math.max(-0.5, Math.min(0.5, (peepDelta/2) * 0.04));
        aaNew = Math.max(5, aaOld * (1 - shuntFactor));
        if(peepNew > 15){
          warnings.push('New PEEP exceeds 15 cmH₂O — beyond this, falling cardiac output/venous return can drop PaO₂ despite an improving shunt fraction on paper. This simplified recruitment model does not account for that; use with caution.');
        }
      } else if(peepOld == null && target.peep != null){
        warnings.push('Enter the current PEEP to model the effect of a PEEP change on oxygenation — the A–a gradient is otherwise assumed unchanged.');
      }
      pao2New = PAO2New - aaNew;

      if(aaOld > 300){
        warnings.push('Baseline A–a gradient is very wide — with a large true shunt, PaO₂ becomes relatively FiO₂-unresponsive and this linear estimate will overstate the benefit of raising FiO₂.');
      }
    }

    let mech = null;
    if(current.compliance){
      const pplatOld = C.plateauPressure(peepOld||0, current.vt, current.compliance);
      const dpOld = C.drivingPressure(pplatOld, peepOld||0);
      const mpOld = C.mechanicalPower(current.rr, current.vt, pplatOld, dpOld);
      const pplatNew = C.plateauPressure(peepNew||0, vtNew, current.compliance);
      const dpNew = C.drivingPressure(pplatNew, peepNew||0);
      const mpNew = C.mechanicalPower(rrNew, vtNew, pplatNew, dpNew);
      mech = { pplatOld, dpOld, mpOld, pplatNew, dpNew, mpNew };
      if(dpNew > 15) warnings.push(`Predicted driving pressure (${f1(dpNew)} cmH₂O) exceeds 15 — associated with higher mortality risk in ARDS; consider limiting Vt instead.`);
      if(pplatNew > 30) warnings.push(`Predicted plateau pressure (${f1(pplatNew)} cmH₂O) exceeds 30 — conventional barotrauma threshold.`);
      if(mpNew > 12) warnings.push(`Predicted mechanical power (${f1(mpNew)} J/min) is above the ~12 J/min range some observational studies associate with higher VILI risk (simplified estimate, excludes the resistive/flow component — treat as directional).`);
    }

    let protectiveNote = null;
    if(current.ibw){
      const mlPerKgNew = vtNew / current.ibw;
      if(mlPerKgNew > 8 || mlPerKgNew < 4){
        protectiveNote = `New Vt ≈ ${f1(mlPerKgNew)} mL/kg IBW — outside the conventional 4–8 mL/kg protective-ventilation range.`;
      }
    }

    warnings.push('Models an acute change only (minutes), using non-renal buffering for the HCO₃⁻ shift — renal compensation (days) has not yet occurred. Confirm with a repeat blood gas.');

    return {
      vaOld, vaNew, rrNew, vtNew, fio2Old, fio2New, peepOld, peepNew,
      pco2Old: current.pco2, pco2New,
      hco3Old: current.hco3, hco3New,
      phNew,
      pao2Old: current.pao2, pao2New, aaOld, aaNew, PAO2Old, PAO2New,
      mech, protectiveNote,
      warnings
    };
  }

  function render(container, result){
    if(result.error){
      container.innerHTML = `<p class="err">${result.error}</p>`;
      return;
    }
    const rows = [];
    rows.push(`<div class="step"><div class="h">Alveolar ventilation</div><div class="b">
      <span class="val">${f0(result.vaOld)}</span> → <span class="val">${f0(result.vaNew)}</span> mL/min
      <div class="why">RR ${f0(result.rrNew)} bpm · Vt ${f0(result.vtNew)} mL in the new state.</div></div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted pCO₂</div><div class="b">
      ${f1(result.pco2Old)} → <span class="val">${f1(result.pco2New)}</span> mmHg</div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted HCO₃⁻ (acute buffering)</div><div class="b">
      ${f1(result.hco3Old)} → <span class="val">${f1(result.hco3New)}</span> mEq/L
      <div class="why">Fast, non-renal buffering only (~0.1 mEq/L per mmHg rise, ~0.2 per mmHg fall) — not the multi-day renal response.</div></div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted pH</div><div class="b">
      <span class="val">${result.phNew.toFixed(2)}</span></div></div>`);
    if(result.pao2New != null){
      rows.push(`<div class="step"><div class="h">Predicted PaO₂</div><div class="b">
        ${f1(result.pao2Old)} → <span class="val">${f1(result.pao2New)}</span> mmHg
        <div class="why">FiO₂ ${f0(result.fio2Old)}% → ${f0(result.fio2New)}%. Alveolar PO₂ ${f1(result.PAO2Old)} → ${f1(result.PAO2New)} mmHg; A–a gradient ${f1(result.aaOld)} → ${f1(result.aaNew)}${result.peepOld!=null&&result.peepNew!==result.peepOld?' (adjusted for the PEEP change, simplified model)':' (assumed unchanged)'}.</div></div></div>`);
    }
    if(result.mech){
      const m = result.mech;
      rows.push(`<div class="step"><div class="h">Plateau / driving pressure / mechanical power</div><div class="b">
        Pplat ${f1(m.pplatOld)} → <span class="val">${f1(m.pplatNew)}</span> cmH₂O ·
        DP ${f1(m.dpOld)} → <span class="val">${f1(m.dpNew)}</span> cmH₂O ·
        MP ${f1(m.mpOld)} → <span class="val">${f1(m.mpNew)}</span> J/min
        <div class="why">Static estimate from compliance alone (Pplat = PEEP + Vt/Compliance); excludes the resistive component.</div></div></div>`);
    }
    if(result.protectiveNote) rows.push(`<div class="why">${result.protectiveNote}</div>`);
    result.warnings.forEach(w => rows.push(`<div class="why">${w}</div>`));
    container.innerHTML = rows.join('');
  }

  return { simulate, render };
})();
