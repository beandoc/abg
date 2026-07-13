window.ABG = window.ABG || {};

ABG.VentSim = (function(){
  'use strict';
  const C = ABG.Calculators;
  const f1 = x => x==null||isNaN(x) ? '—' : (Math.round(x*10)/10).toFixed(1);
  const f0 = x => x==null||isNaN(x) ? '—' : Math.round(x).toString();
  const DEFAULT_RESISTANCE = 8; // cmH2O/L/s, mid-range for an intubated adult airway (ETT + lung)

  function buildBreathPoints(vt, peep, pplat, ti, te, tau, resistance){
    const flow = ti>0 ? (vt/1000)/ti : 0;
    const resP = Math.max(0, Math.min(pplat-peep, flow*resistance));
    const pts = [];
    const nI = 15, nE = 25;
    for(let i=0;i<=nI;i++){
      const t = ti*(i/nI);
      const p = i===0 ? peep : peep + resP + (pplat-peep-resP)*(i/nI);
      pts.push({t,p});
    }
    if(te>0){
      for(let j=1;j<=nE;j++){
        const dt = te*(j/nE);
        pts.push({t: ti+dt, p: peep + (pplat-peep)*Math.exp(-dt/(tau||1))});
      }
    }
    return pts;
  }

  // current: {rr, vt, fio2, pao2, pco2, hco3, peep, compliance, vdvt, resistance, ti, ibw, na, cl, albumin, lactate}
  // target:  {rr, vt, fio2, peep, pplatMeasured, mode, dpSet}
  function simulate(current, target){
    const warnings = [];
    if(current.rr==null || current.vt==null){
      return { error: 'Enter the current RR and Vt (in the Ventilator section) to simulate a parameter change.' };
    }
    if(current.pco2==null || current.hco3==null){
      return { error: 'Enter the current pCO₂ and HCO₃⁻ (in the ABG form) so the new pH can be predicted.' };
    }

    const rrNew = target.rr!=null ? target.rr : current.rr;
    const fio2Old = current.fio2!=null ? current.fio2 : 21;
    const fio2New = target.fio2!=null ? target.fio2 : fio2Old;
    const peepOld = current.peep;
    const peepNew = target.peep!=null ? target.peep : peepOld;
    const vdvt = current.vdvt!=null ? current.vdvt : 0.30;

    const resistance = current.resistance!=null ? current.resistance : DEFAULT_RESISTANCE;
    const resistanceAssumed = current.resistance==null;
    const ti = current.ti!=null ? current.ti : (60/current.rr)/3; // assumes a 1:2 I:E if Ti not entered
    const tiAssumed = current.ti==null;

    const mode = target.mode==='PC' ? 'PC' : 'VC';
    let vtNew, pcNote = null;
    if(mode==='PC' && target.dpSet!=null && current.compliance){
      const tauPc = C.timeConstant(current.compliance, resistance);
      vtNew = C.pcTidalVolume(target.dpSet, current.compliance, ti, tauPc);
      pcNote = `Pressure-control mode: ΔP ${f0(target.dpSet)} cmH₂O above PEEP delivered over Ti ${f1(ti)}s (τ≈${f1(tauPc)}s${resistanceAssumed?', resistance assumed 8 cmH₂O/L/s':''}) → derived Vt ≈ ${f0(vtNew)} mL, not set directly.`;
    } else {
      vtNew = target.vt!=null ? target.vt : current.vt;
      if(mode==='PC' && (target.dpSet==null || !current.compliance)){
        warnings.push('Pressure-control mode needs a new driving pressure (ΔP) and the current compliance to derive Vt — falling back to the entered/current Vt instead.');
      }
    }

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
    if(rrNew > 30 || (current.rr && rrNew > current.rr * 1.5)){
      warnings.push('New RR is substantially higher — shortened expiratory time raises the risk of dynamic hyperinflation and auto-PEEP, particularly with obstructive disease (COPD, asthma). Confirm adequate expiratory time (I:E) at the bedside.');
    }

    // I:E ratio & auto-PEEP: single-compartment (time-constant) model of passive exhalation.
    let autoPeep = null;
    if(current.compliance){
      const tau = C.timeConstant(current.compliance, resistance);
      const cycleOld = 60/current.rr, cycleNew = 60/rrNew;
      const teOld = cycleOld - ti, teNew = cycleNew - ti;
      if(teNew <= 0){
        warnings.push(`At RR ${f0(rrNew)} with an inspiratory time of ${f1(ti)}s there is no time left to exhale (Te ≤ 0) — this combination is not deliverable as configured; reduce RR or shorten Ti.`);
      } else {
        const peepOldAuto = C.autoPeepEstimate(current.vt, current.compliance, teOld, tau);
        const peepNewAuto = C.autoPeepEstimate(vtNew, current.compliance, teNew, tau);
        autoPeep = { tau, teOld, teNew, peepOldAuto, peepNewAuto, ti, resistanceAssumed, tiAssumed,
          ieOld: teOld>0 ? ti/teOld : null, ieNew: teNew>0 ? ti/teNew : null };
        if(peepNewAuto > 5){
          warnings.push(`Estimated auto-PEEP (single-compartment model) rises to ≈${f1(peepNewAuto)} cmH₂O at the new settings (τ≈${f1(tau)}s, Te≈${f1(teNew)}s) — incomplete exhalation/dynamic hyperinflation risk. True total PEEP exceeds the set value; this can drop venous return/cardiac output and overdistend alveoli. Consider a lower RR, shorter Ti, or accepting permissive hypercapnia.`);
        } else if(peepNewAuto > peepOldAuto + 2){
          warnings.push(`Estimated auto-PEEP rises from ≈${f1(peepOldAuto)} to ≈${f1(peepNewAuto)} cmH₂O with this change — expiratory time is shrinking relative to the lung's time constant; watch the flow waveform for failure to return to zero before the next breath.`);
        }
      }
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
      if(pao2New < 60){
        warnings.push('Predicted PaO₂ remains <60 mmHg — severe hypoxemia; consider a further increase in FiO₂ or PEEP, longer inspiratory time, or reassessing for a shunt-dominant process.');
      } else if(pao2New > 100 && fio2New > 21){
        warnings.push('Predicted PaO₂ is comfortably above the 80–100 mmHg target with FiO₂ still above room air — consider weaning FiO₂ toward the lowest level that maintains adequate oxygenation to limit oxygen-toxicity risk.');
      }
      if(peepOld != null && peepNew != null && peepNew > peepOld){
        const pfOld = C.pfRatio(current.pao2, fio2Old);
        const pfNew = C.pfRatio(pao2New, fio2New);
        warnings.push(`PaO₂/FiO₂ ${f0(pfOld)} → ${f0(pfNew)} with higher PEEP. A rising ratio suggests alveolar recruitment, but PEEP also raises intrathoracic pressure and can reduce venous return and cardiac output — a better PaO₂/FiO₂ does not guarantee better systemic O₂ delivery. This model tracks oxygenation only, not hemodynamics.`);
      }
    }

    // Run the predicted gas back through the same stepwise interpreter used for entered gases.
    let predictedDx = null;
    if(ABG.Interpreter){
      const analyzed = ABG.Interpreter.analyze({
        ph: phNew, pco2: pco2New, hco3: hco3New,
        na: current.na!=null?current.na:null, k: null, cl: current.cl!=null?current.cl:null,
        lactate: current.lactate!=null?current.lactate:null, albumin: current.albumin!=null?current.albumin:null,
        bun: null, glucose: null, measuredOsm: null, ethanol: null, uNa: null, uK: null, uCl: null,
        vent: { pao2: pao2New, fio2: fio2New }
      });
      if(!analyzed.invalid) predictedDx = analyzed;
    }

    let mech = null, bestPeep = null;
    if(current.compliance){
      const pplatOld = C.plateauPressure(peepOld||0, current.vt, current.compliance);
      const dpOld = C.drivingPressure(pplatOld, peepOld||0);
      const mpOld = C.mechanicalPower(current.rr, current.vt, pplatOld, dpOld);

      let pplatNew, complianceNew;
      const peepChanged = peepOld != null && peepNew != null && peepNew !== peepOld;
      if(target.pplatMeasured != null && peepChanged){
        pplatNew = target.pplatMeasured;
        complianceNew = C.staticCompliance(vtNew, pplatNew, peepNew);
      } else {
        pplatNew = C.plateauPressure(peepNew||0, vtNew, current.compliance);
        complianceNew = current.compliance;
      }
      const dpNew = C.drivingPressure(pplatNew, peepNew||0);
      const mpNew = C.mechanicalPower(rrNew, vtNew, pplatNew, dpNew);
      mech = { pplatOld, dpOld, mpOld, pplatNew, dpNew, mpNew, complianceOld: current.compliance, complianceNew };

      if(target.pplatMeasured != null && peepChanged){
        const compRising = complianceNew > current.compliance;
        const dpFalling = dpNew < dpOld;
        if(peepNew > peepOld){
          if(compRising && dpFalling){
            bestPeep = `Compliance rose (${f1(current.compliance)} → ${f1(complianceNew)} mL/cmH₂O) and driving pressure fell (${f1(dpOld)} → ${f1(dpNew)} cmH₂O) with higher PEEP — consistent with alveolar recruitment predominating. This PEEP level looks favorable; a further increase could be tried and re-checked the same way.`;
          } else if(!compRising && !dpFalling){
            bestPeep = `Compliance fell (${f1(current.compliance)} → ${f1(complianceNew)} mL/cmH₂O) and driving pressure rose (${f1(dpOld)} → ${f1(dpNew)} cmH₂O) with higher PEEP — consistent with alveolar overdistension predominating. Consider stepping back toward the previous PEEP.`;
          } else {
            bestPeep = `Compliance and driving pressure gave mixed signals with this PEEP increase (compliance ${f1(current.compliance)} → ${f1(complianceNew)}, driving pressure ${f1(dpOld)} → ${f1(dpNew)}) — re-check at the bedside rather than trusting either alone.`;
          }
        } else {
          if(compRising && dpFalling){
            bestPeep = `Lowering PEEP improved compliance (${f1(current.compliance)} → ${f1(complianceNew)} mL/cmH₂O) and reduced driving pressure — the prior, higher PEEP appears to have been overdistending; the lower level looks favorable.`;
          } else if(!compRising && !dpFalling){
            bestPeep = `Lowering PEEP worsened compliance (${f1(current.compliance)} → ${f1(complianceNew)} mL/cmH₂O) and raised driving pressure — the prior, higher PEEP appears to have been recruiting alveoli; consider returning to it.`;
          } else {
            bestPeep = `Compliance and driving pressure gave mixed signals with this PEEP decrease (compliance ${f1(current.compliance)} → ${f1(complianceNew)}, driving pressure ${f1(dpOld)} → ${f1(dpNew)}) — re-check at the bedside rather than trusting either alone.`;
          }
        }
      } else if(peepChanged){
        warnings.push('Enter the re-measured plateau pressure after this PEEP change to check whether compliance/driving pressure moved toward recruitment or overdistension (this model otherwise assumes compliance stays constant, which understates PEEP’s real effect on driving pressure).');
      }

      if(dpNew > 15) warnings.push(`Predicted driving pressure (${f1(dpNew)} cmH₂O) exceeds 15 — associated with higher mortality risk in ARDS; consider limiting Vt instead.`);
      if(pplatNew > 30) warnings.push(`Predicted plateau pressure (${f1(pplatNew)} cmH₂O) exceeds 30 — conventional barotrauma threshold.`);
      if(mpNew > 12) warnings.push(`Predicted mechanical power (${f1(mpNew)} J/min) is above the ~12 J/min range some observational studies associate with higher VILI risk (simplified estimate, excludes the resistive/flow component — treat as directional).`);
    }

    let waveform = null;
    if(mech && autoPeep && autoPeep.teOld>0 && autoPeep.teNew>0){
      waveform = {
        old: buildBreathPoints(current.vt, peepOld||0, mech.pplatOld, ti, autoPeep.teOld, autoPeep.tau, resistance),
        new: buildBreathPoints(vtNew, peepNew||0, mech.pplatNew, ti, autoPeep.teNew, autoPeep.tau, resistance),
        cycleOld: ti+autoPeep.teOld, cycleNew: ti+autoPeep.teNew
      };
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
      vaOld, vaNew, rrNew, vtNew, mode, pcNote, fio2Old, fio2New, peepOld, peepNew,
      pco2Old: current.pco2, pco2New,
      hco3Old: current.hco3, hco3New,
      phOld: C.hendersonHasselbalchPH(current.pco2, current.hco3), phNew,
      pao2Old: current.pao2, pao2New, aaOld, aaNew, PAO2Old, PAO2New,
      mech, bestPeep, protectiveNote, autoPeep, waveform, predictedDx,
      warnings
    };
  }

  function drawWaveform(el, result){
    if(!el || typeof d3 === 'undefined' || !result.waveform) return;
    el.innerHTML = '';
    const w = result.waveform;
    const width = 420, height = 170, padL = 34, padR = 10, padT = 10, padB = 24;
    const tMax = Math.max(w.cycleOld, w.cycleNew);
    const pAll = w.old.concat(w.new).map(d=>d.p);
    const pMin = Math.min(0, Math.min(...pAll)) - 2, pMax = Math.max(...pAll) + 3;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'xMinYMin meet');

    const x = d3.scaleLinear().domain([0, tMax]).range([padL, width-padR]);
    const y = d3.scaleLinear().domain([pMin, pMax]).range([height-padB, padT]);
    const line = d3.line().x(d=>x(d.t)).y(d=>y(d.p));

    svg.append('g').attr('transform', `translate(0,${height-padB})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(v=>v.toFixed(1)))
      .attr('font-size', 9);
    svg.append('g').attr('transform', `translate(${padL},0)`)
      .call(d3.axisLeft(y).ticks(5)).attr('font-size', 9);
    svg.append('text').attr('x', width/2).attr('y', height-2).attr('text-anchor','middle')
      .attr('font-size', 9).attr('fill', '#5b6b78').text('time in breath cycle (s)');
    svg.append('text').attr('x', 4).attr('y', 12).attr('font-size', 9).attr('fill', '#5b6b78')
      .text('cmH₂O');

    svg.append('path').datum(w.old).attr('d', line).attr('fill','none')
      .attr('stroke', '#9aa6ae').attr('stroke-width', 1.8).attr('stroke-dasharray', '4,3');
    svg.append('path').datum(w.new).attr('d', line).attr('fill','none')
      .attr('stroke', '#0d6a8c').attr('stroke-width', 2.2);

    const legend = svg.append('g').attr('transform', `translate(${width-150},${padT})`);
    legend.append('line').attr('x1',0).attr('x2',16).attr('y1',0).attr('y2',0)
      .attr('stroke','#9aa6ae').attr('stroke-width',1.8).attr('stroke-dasharray','4,3');
    legend.append('text').attr('x',20).attr('y',3).attr('font-size',9).text('current');
    legend.append('line').attr('x1',0).attr('x2',16).attr('y1',13).attr('y2',13)
      .attr('stroke','#0d6a8c').attr('stroke-width',2.2);
    legend.append('text').attr('x',20).attr('y',16).attr('font-size',9).text('new');
  }

  function render(container, result){
    if(result.error){
      container.innerHTML = `<p class="err">${result.error}</p>`;
      return;
    }
    const rows = [];
    if(result.mode==='PC' && result.pcNote){
      rows.push(`<div class="why">${result.pcNote}</div>`);
    }
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
    if(result.predictedDx){
      rows.push(`<div class="step"><div class="h">Predicted overall acid–base status</div><div class="b">
        <span class="dx ${result.predictedDx.dxClass}" style="display:inline-block;padding:4px 10px;font-size:.92rem;border-radius:6px;margin:2px 0">${result.predictedDx.integrated}</span>
        <div class="why">The predicted pH/pCO₂/HCO₃⁻ (and PaO₂/FiO₂ if entered) were run back through the same stepwise interpreter used above. Na⁺/Cl⁻/albumin/lactate are carried over unchanged from the current ABG form — this shows ventilation's isolated effect, not a change in the underlying metabolic disorder.</div></div></div>`);
    }
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
      if(m.complianceNew !== m.complianceOld){
        rows.push(`<div class="why">Static compliance ${f1(m.complianceOld)} → <span class="val">${f1(m.complianceNew)}</span> mL/cmH₂O, from the measured Pplateau you entered.</div>`);
      }
    }
    if(result.autoPeep){
      const a = result.autoPeep;
      rows.push(`<div class="step"><div class="h">I:E ratio &amp; auto-PEEP (single-compartment estimate)</div><div class="b">
        I:E ${a.ieOld?('1:'+f1(1/a.ieOld)):'—'} → <span class="val">${a.ieNew?('1:'+f1(1/a.ieNew)):'—'}</span> ·
        Te ${f1(a.teOld)} → <span class="val">${f1(a.teNew)}</span> s ·
        est. auto-PEEP ${f1(a.peepOldAuto)} → <span class="val">${f1(a.peepNewAuto)}</span> cmH₂O
        <div class="why">τ (time constant) ≈ ${f1(a.tau)}s from compliance × resistance.${a.resistanceAssumed?' Resistance not entered — assumed 8 cmH₂O/L/s (typical intubated adult).':''}${a.tiAssumed?` Ti not entered — assumed ${f1(a.ti)}s from a 1:2 I:E ratio.`:''} Full exhalation needs Te ≳ 3τ; below that, gas is trapped and true PEEP exceeds the set value.</div></div></div>`);
    }
    if(result.waveform){
      rows.push(`<div class="step"><div class="h">Simulated airway-pressure waveform (one breath)</div><div class="b">
        <div id="ventWaveformBox"></div>
        <div class="why">Single-compartment approximation: linear pressure rise during a constant-flow inspiration, exponential decay toward PEEP during passive exhalation. Illustrative, not a substitute for the real ventilator's waveform display.</div></div></div>`);
    }
    if(result.bestPeep) rows.push(`<div class="step"><div class="h">Best-PEEP check</div><div class="b">${result.bestPeep}</div></div>`);
    if(result.protectiveNote) rows.push(`<div class="why">${result.protectiveNote}</div>`);
    result.warnings.forEach(w => rows.push(`<div class="why">${w}</div>`));
    container.innerHTML = rows.join('');
    if(result.waveform){
      drawWaveform(container.querySelector('#ventWaveformBox'), result);
    }
  }

  return { simulate, render };
})();
