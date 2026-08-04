window.ABG = window.ABG || {};

ABG.VentSim = (function(){
  'use strict';
  const C = ABG.Calculators;
  const f1 = x => x==null||isNaN(x) ? '—' : (Math.round(x*10)/10).toFixed(1);
  const f0 = x => x==null||isNaN(x) ? '—' : Math.round(x).toString();
  // ETT alone is ~8-10 cmH2O/L/s; airway disease pushes total resistance to 15-25. A mid
  // default of 8 made the time constant so short that auto-PEEP never registered.
  const DEFAULT_RESISTANCE = 12; // cmH2O/L/s
  const DEFAULT_VDVT = 0.30;

  // Plausibility bounds. Nothing enforces the input min/max attributes at click time, so a
  // mistyped value used to propagate silently into a confidently-rendered result.
  const LIMITS = {
    rr:         [4, 60,   'bpm'],
    vt:         [50, 1500,'mL'],
    fio2:       [21, 100, '%'],
    peep:       [0, 30,   'cmH₂O'],
    ti:         [0.2, 3,  's'],
    resistance: [2, 50,   'cmH₂O/L/s'],
    compliance: [5, 200,  'mL/cmH₂O'],
    dp:         [1, 60,   'cmH₂O'],
    pplat:      [5, 80,   'cmH₂O'],
    pco2:       [5, 150,  'mmHg'],
    hco3:       [2, 60,   'mEq/L'],
    pao2:       [20, 600, 'mmHg']
  };

  function outOfRange(label, key, v){
    if(v == null) return null;
    const [lo, hi, unit] = LIMITS[key];
    if(isNaN(v)) return `${label} is not a valid number.`;
    if(v < lo || v > hi){
      return `${label} of ${v} ${unit} is outside the plausible range (${lo}–${hi} ${unit}). Check the entry before simulating.`;
    }
    return null;
  }

  function validate(current, target){
    const checks = [
      ['Current RR','rr',current.rr],                 ['Current Vt','vt',current.vt],
      ['Current FiO₂','fio2',current.fio2],            ['Current PEEP','peep',current.peep],
      ['Current PaO₂','pao2',current.pao2],            ['Current pCO₂','pco2',current.pco2],
      ['Current HCO₃⁻','hco3',current.hco3],           ['Compliance','compliance',current.compliance],
      ['Airway resistance','resistance',current.resistance], ['Inspiratory time (Ti)','ti',current.ti],
      ['New RR','rr',target.rr],                      ['New Vt','vt',target.vt],
      ['New FiO₂','fio2',target.fio2],                ['New PEEP','peep',target.peep],
      ['New ΔP','dp',target.dpSet],                   ['New plateau pressure','pplat',target.pplatMeasured]
    ];
    for(let i=0;i<checks.length;i++){
      const msg = outOfRange(checks[i][0], checks[i][1], checks[i][2]);
      if(msg) return msg;
    }
    if(current.vdvt != null){
      if(current.vdvt > 1){
        return `Dead-space fraction (Vd/Vt) of ${current.vdvt} looks like a percentage — enter it as a fraction (0.30), not a percent (30).`;
      }
      if(current.vdvt < 0 || current.vdvt > 0.9){
        return `Dead-space fraction (Vd/Vt) of ${current.vdvt} is outside the plausible range (0–0.9).`;
      }
    }
    return null;
  }

  // One breath of airway pressure under constant (square-wave) inspiratory flow:
  // an immediate resistive step, a linear elastic ramp to Ppeak, the zero-flow drop to
  // Pplat, then exponential decay toward PEEP during passive exhalation.
  function buildBreathPoints(vt, peep, pplat, ti, te, tau, resistance){
    const flow = ti>0 ? (vt/1000)/ti : 0;
    const resP = Math.max(0, flow*resistance);
    const ppeak = pplat + resP;
    const pts = [];
    const nI = 15, nE = 25;
    for(let i=0;i<=nI;i++){
      const t = ti*(i/nI);
      const p = i===0 ? peep : peep + resP + (pplat-peep)*(i/nI);
      pts.push({t,p});
    }
    pts.push({t: ti, p: pplat}); // flow stops: pressure falls by the resistive component
    if(te>0){
      for(let j=1;j<=nE;j++){
        const dt = te*(j/nE);
        pts.push({t: ti+dt, p: peep + (pplat-peep)*Math.exp(-dt/(tau||1))});
      }
    }
    return { pts, ppeak, resP, flow };
  }

  function analyzeGas(pco2, hco3, chem, pao2, fio2){
    if(!ABG.Interpreter) return null;
    const nn = x => x==null ? null : x;
    const r = ABG.Interpreter.analyze({
      ph: C.hendersonHasselbalchPH(pco2, hco3), pco2: pco2, hco3: hco3,
      na: nn(chem.na), k: null, cl: nn(chem.cl),
      lactate: nn(chem.lactate), albumin: nn(chem.albumin),
      bun: null, glucose: null, measuredOsm: null, uNa: null, uK: null, uCl: null,
      vent: { pao2: nn(pao2), fio2: nn(fio2) }
    });
    return (r && !r.invalid) ? r : null;
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
    const badInput = validate(current, target);
    if(badInput) return { error: badInput };

    const rrNew = target.rr!=null ? target.rr : current.rr;
    const fio2Assumed = current.fio2==null;
    const fio2Old = fio2Assumed ? 21 : current.fio2;
    const fio2New = target.fio2!=null ? target.fio2 : fio2Old;
    const peepOld = current.peep;
    const peepNew = target.peep!=null ? target.peep : peepOld;
    const vdvtAssumed = current.vdvt==null;
    const vdvt = vdvtAssumed ? DEFAULT_VDVT : current.vdvt;

    const resistance = current.resistance!=null ? current.resistance : DEFAULT_RESISTANCE;
    const resistanceAssumed = current.resistance==null;
    const ti = current.ti!=null ? current.ti : (60/current.rr)/3; // assumes a 1:2 I:E if Ti not entered
    const tiAssumed = current.ti==null;

    const mode = target.mode==='PC' ? 'PC' : 'VC';
    let vtNew, pcNote = null;
    if(mode==='PC' && target.dpSet!=null && current.compliance){
      const tauPc = C.timeConstant(current.compliance, resistance);
      vtNew = C.pcTidalVolume(target.dpSet, current.compliance, ti, tauPc);
      pcNote = `Pressure-control mode: ΔP ${f0(target.dpSet)} cmH₂O above PEEP delivered over Ti ${f1(ti)}s (τ≈${f1(tauPc)}s${resistanceAssumed?`, resistance assumed ${DEFAULT_RESISTANCE} cmH₂O/L/s`:''}) → derived Vt ≈ ${f0(vtNew)} mL, not set directly.`;
    } else {
      vtNew = target.vt!=null ? target.vt : current.vt;
      if(mode==='PC' && (target.dpSet==null || !current.compliance)){
        warnings.push('Pressure-control mode needs a new driving pressure (ΔP) and the current compliance to derive Vt — falling back to the entered/current Vt instead.');
      }
    }

    // Alveolar ventilation: hold the absolute (anatomic+equipment) dead-space volume
    // constant across the change, rather than the fraction — a Vt change alters VD/VT.
    const deadSpaceMl = vdvt * current.vt;
    if(vtNew <= deadSpaceMl){
      return { error: `The new tidal volume (${f0(vtNew)} mL) is at or below the dead-space volume (${f0(deadSpaceMl)} mL at Vd/Vt ${f1(vdvt)}${vdvtAssumed?', assumed':''}) — no alveolar ventilation would reach the alveoli, so pCO₂ and pH cannot be predicted. Raise the new Vt, or enter the measured Vd/Vt.` };
    }
    const vaOld = C.alveolarVentilation(current.vt, deadSpaceMl, current.rr);
    const vaNew = C.alveolarVentilation(vtNew, deadSpaceMl, rrNew);
    const pco2New = C.predictedPCO2FromVE(current.pco2, vaOld, vaNew);

    // Acute (minutes-scale) non-renal buffering shift in HCO3, not the days-scale renal one.
    const hco3New = C.acuteHCO3Shift(current.pco2, pco2New, current.hco3);
    const phNew = (pco2New!=null && hco3New>0) ? C.hendersonHasselbalchPH(pco2New, hco3New) : null;

    if(pco2New==null || !isFinite(pco2New) || pco2New<=0 || hco3New<=0 || phNew==null || !isFinite(phNew)){
      return { error: 'These settings drive alveolar ventilation to zero (or beyond), so no predicted gas can be computed. Re-check the new RR, Vt and Vd/Vt.' };
    }
    if(phNew < 6.5 || phNew > 8.0){
      return { error: `These settings predict a pH of ${phNew.toFixed(2)} — outside the range compatible with life (6.5–8.0) and outside the range this model is valid over. Make a smaller change and re-simulate.` };
    }

    const vaRatio = vaNew / vaOld;
    if(vaRatio > 2 || vaRatio < 0.5){
      warnings.push('The alveolar-ventilation change is large (>2× or <0.5×) — the inverse-proportionality model is least reliable far from baseline. Treat this as a directional estimate and recheck with a repeat gas.');
    }
    if(pco2New < 15 || pco2New > 100){
      warnings.push('Predicted pCO₂ is physiologically extreme — CO₂ production and dead-space fraction are unlikely to stay constant at this magnitude of change.');
    }
    if(rrNew > current.rr && (rrNew > 30 || rrNew > current.rr * 1.5)){
      warnings.push('New RR is substantially higher — shortened expiratory time raises the risk of dynamic hyperinflation and auto-PEEP, particularly with obstructive disease (COPD, asthma). Confirm adequate expiratory time (I:E) at the bedside.');
    }

    // ---- I:E ratio & auto-PEEP: single-compartment (time-constant) model of passive exhalation.
    let autoPeep = null;
    if(current.compliance){
      const tau = C.timeConstant(current.compliance, resistance);
      const cycleOld = 60/current.rr, cycleNew = 60/rrNew;
      const teOld = cycleOld - ti, teNew = cycleNew - ti;
      if(teNew <= 0){
        warnings.push(`At RR ${f0(rrNew)} with an inspiratory time of ${f1(ti)}s there is no time left to exhale (Te ≤ 0) — this combination is not deliverable as configured; reduce RR or shorten Ti.`);
      } else {
        const cap = v => Math.min(60, v);
        const peepOldAuto = cap(C.autoPeepEstimate(current.vt, current.compliance, teOld, tau));
        const peepNewAuto = cap(C.autoPeepEstimate(vtNew, current.compliance, teNew, tau));
        autoPeep = { tau, teOld, teNew, peepOldAuto, peepNewAuto, ti, resistanceAssumed, tiAssumed,
          ieOld: teOld>0 ? ti/teOld : null, ieNew: teNew>0 ? ti/teNew : null };
        if(peepNewAuto > 5){
          warnings.push(`Estimated auto-PEEP (single-compartment, steady-state model) rises to ≈${f1(peepNewAuto)} cmH₂O at the new settings (τ≈${f1(tau)}s, Te≈${f1(teNew)}s) — incomplete exhalation/dynamic hyperinflation risk. True total PEEP exceeds the set value; this can drop venous return/cardiac output and overdistend alveoli. Consider a lower RR, shorter Ti, or accepting permissive hypercapnia.`);
        } else if(peepNewAuto > peepOldAuto + 2){
          warnings.push(`Estimated auto-PEEP rises from ≈${f1(peepOldAuto)} to ≈${f1(peepNewAuto)} cmH₂O with this change — expiratory time is shrinking relative to the lung's time constant; watch the flow waveform for failure to return to zero before the next breath.`);
        }
      }
    }

    // ---- Mechanics. Auto-PEEP is folded into total PEEP: plateau pressure is measured from
    // the true end-expiratory pressure, not the set one, and compliance is Vt/(Pplat - PEEPtotal).
    let mech = null, bestPeep = null, overdistended = false;
    if(current.compliance){
      if(peepOld == null){
        warnings.push('Current PEEP was left blank and has been taken as 0 cmH₂O for the pressure calculations — plateau and total PEEP below are correspondingly understated. Enter the set PEEP for usable mechanics.');
      }
      const autoOld = autoPeep ? autoPeep.peepOldAuto : 0;
      const autoNew = autoPeep ? autoPeep.peepNewAuto : 0;
      const peepTotalOld = (peepOld||0) + autoOld;
      const peepTotalNew = (peepNew||0) + autoNew;

      const pplatOld = C.plateauPressure(peepTotalOld, current.vt, current.compliance);
      const dpOld = C.drivingPressure(pplatOld, peepTotalOld);
      const ppeakOld = C.peakPressure(pplatOld, current.vt, ti, resistance);
      const mpOld = C.mechanicalPower(current.rr, current.vt, ppeakOld, dpOld);

      let pplatNew, complianceNew, measuredUsed = false;
      const peepChanged = peepOld != null && peepNew != null && peepNew !== peepOld;
      if(target.pplatMeasured != null && target.pplatMeasured > peepTotalNew){
        pplatNew = target.pplatMeasured;
        complianceNew = C.staticCompliance(vtNew, pplatNew, peepTotalNew);
        measuredUsed = true;
      } else {
        if(target.pplatMeasured != null){
          warnings.push(`The measured plateau pressure entered (${f1(target.pplatMeasured)} cmH₂O) is at or below the estimated total PEEP (${f1(peepTotalNew)} cmH₂O), which would imply a negative compliance — it has been ignored and compliance assumed unchanged. Re-check the measurement.`);
        }
        pplatNew = C.plateauPressure(peepTotalNew, vtNew, current.compliance);
        complianceNew = current.compliance;
      }
      const dpNew = C.drivingPressure(pplatNew, peepTotalNew);
      const ppeakNew = C.peakPressure(pplatNew, vtNew, ti, resistance);
      const mpNew = C.mechanicalPower(rrNew, vtNew, ppeakNew, dpNew);
      mech = { pplatOld, dpOld, mpOld, ppeakOld, pplatNew, dpNew, mpNew, ppeakNew,
               complianceOld: current.compliance, complianceNew, measuredUsed,
               peepTotalOld, peepTotalNew, autoOld, autoNew, resistanceAssumed, tiAssumed };

      overdistended = measuredUsed && peepChanged && peepNew > peepOld && complianceNew < current.compliance;

      if(measuredUsed && peepChanged){
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
      if(pplatNew > 30) warnings.push(`Predicted plateau pressure (${f1(pplatNew)} cmH₂O, including ≈${f1(autoNew)} cmH₂O of estimated auto-PEEP) exceeds 30 — conventional barotrauma threshold.`);
      if(mpNew > 12) warnings.push(`Predicted mechanical power (${f1(mpNew)} J/min) is above the ~12 J/min range some observational studies associate with higher VILI risk (Becher/Gattinoni surrogate; the resistive component uses ${resistanceAssumed?'an assumed':'the entered'} airway resistance — treat as directional).`);
    }

    // ---- Oxygenation. Predicted on a constant arterial/alveolar (a/A) ratio rather than a
    // constant A-a difference: with shunt physiology the A-a gradient widens as FiO2 rises,
    // so holding it fixed grossly overstates the PaO2 gain from turning the oxygen up.
    let pao2New = null, aaOld = null, aaNew = null, PAO2Old = null, PAO2New = null;
    let aAOld = null, aANew = null, peepO2Suppressed = false;
    if(current.pao2 != null){
      if(fio2Assumed){
        warnings.push('FiO₂ was left blank and has been taken as 21% (room air). If the patient is on supplemental oxygen the predicted PaO₂ below is meaningless — enter the delivered FiO₂.');
      }
      PAO2Old = C.alveolarPO2(current.pco2, fio2Old);
      aaOld = PAO2Old - current.pao2;
      aAOld = C.aAratio(current.pao2, PAO2Old);
      PAO2New = C.alveolarPO2(pco2New, fio2New);

      if(aAOld == null || aAOld <= 0){
        warnings.push('The entered PaO₂ is at or above the calculated alveolar PO₂, which is not physiologically possible — check the PaO₂, FiO₂ and pCO₂ entries. Oxygenation has not been predicted.');
      } else {
        aANew = aAOld;
        if(peepOld != null && peepNew != null && peepNew !== peepOld){
          const peepDelta = peepNew - peepOld;
          const recruit = Math.max(-0.5, Math.min(0.5, (peepDelta/2) * 0.04));
          if(overdistended && recruit > 0){
            peepO2Suppressed = true;
          } else {
            aANew = Math.max(0.02, Math.min(0.99, aAOld * (1 + recruit)));
          }
          if(peepNew > 15){
            warnings.push('New PEEP exceeds 15 cmH₂O — beyond this, falling cardiac output/venous return can drop PaO₂ despite an improving shunt fraction on paper. This simplified recruitment model does not account for that; use with caution.');
          }
        } else if(peepOld == null && target.peep != null){
          warnings.push('Enter the current PEEP to model the effect of a PEEP change on oxygenation — the a/A ratio is otherwise assumed unchanged.');
        }
        pao2New = aANew * PAO2New;
        aaNew = PAO2New - pao2New;

        if(peepO2Suppressed){
          warnings.push('No oxygenation gain has been credited to this PEEP increase: the plateau pressure you measured implies falling compliance, i.e. overdistension rather than recruitment. Raising PEEP into an overdistending zone typically worsens dead space and does not improve PaO₂.');
        }
        if(aAOld < 0.2){
          warnings.push(`Baseline a/A ratio is very low (${aAOld.toFixed(2)}) — a large true shunt. PaO₂ is relatively FiO₂-unresponsive here; the predicted gain from raising FiO₂ is small by design, and recruitment (PEEP, prone positioning) is the more effective lever.`);
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
    }

    // ---- Run the predicted gas back through the same stepwise interpreter used for entered
    // gases. Cl- is shifted reciprocally with HCO3- so the anion gap is preserved: buffering
    // titrates non-bicarbonate buffers, it does not create unmeasured anions. Any metabolic
    // label that appears only in the prediction is a model artifact, not a new disorder.
    const chemOld = { na: current.na, cl: current.cl, albumin: current.albumin, lactate: current.lactate };
    const chemNew = Object.assign({}, chemOld, {
      cl: current.cl != null ? current.cl + (current.hco3 - hco3New) : null
    });
    const baselineDx = analyzeGas(current.pco2, current.hco3, chemOld, current.pao2, fio2Old);
    const rawPredDx  = analyzeGas(pco2New, hco3New, chemNew, pao2New, fio2New);

    let predictedDx = null, dxArtifacts = [];
    if(rawPredDx){
      const isMetabolic = d => /metabolic/i.test(d);
      const baseMet = baselineDx ? baselineDx.disorders.filter(isMetabolic) : [];
      dxArtifacts = rawPredDx.disorders.filter(d => isMetabolic(d) && baseMet.indexOf(d) === -1);
      const kept = rawPredDx.disorders.filter(d => dxArtifacts.indexOf(d) === -1);
      const integrated = kept.length === 0 ? rawPredDx.primary
        : (kept.length === 1 ? kept[0] : 'Mixed disorder: ' + kept.join(' + '));
      predictedDx = { integrated, dxClass: rawPredDx.dxClass, disorders: kept,
                      baseline: baselineDx ? baselineDx.integrated : null, artifacts: dxArtifacts };
    }

    let waveform = null;
    if(mech && autoPeep && autoPeep.teOld>0 && autoPeep.teNew>0){
      const oldB = buildBreathPoints(current.vt, mech.peepTotalOld, mech.pplatOld, ti, autoPeep.teOld, autoPeep.tau, resistance);
      const newB = buildBreathPoints(vtNew, mech.peepTotalNew, mech.pplatNew, ti, autoPeep.teNew, autoPeep.tau, resistance);
      waveform = { old: oldB, new: newB, cycleOld: ti+autoPeep.teOld, cycleNew: ti+autoPeep.teNew };
    }

    let protectiveNote = null;
    if(current.ibw){
      const mlPerKgNew = vtNew / current.ibw;
      if(mlPerKgNew > 8 || mlPerKgNew < 4){
        protectiveNote = `New Vt ≈ ${f1(mlPerKgNew)} mL/kg IBW — outside the conventional 4–8 mL/kg protective-ventilation range.`;
      }
    }

    if(tiAssumed){
      warnings.push(`Inspiratory time was not entered — ${f1(ti)}s has been assumed from a 1:2 I:E at the current RR and held constant across the change. In volume control at a fixed flow, Ti actually scales with Vt; enter the set Ti for exact I:E, auto-PEEP and peak-pressure figures.`);
    }
    warnings.push('Models an acute change only (minutes), using non-renal buffering for the HCO₃⁻ shift — renal compensation (days) has not yet occurred. Confirm with a repeat blood gas.');

    return {
      vaOld, vaNew, rrNew, vtNew, mode, pcNote, fio2Old, fio2New, fio2Assumed, peepOld, peepNew,
      vdvt, vdvtAssumed, deadSpaceMl, resistance, resistanceAssumed, ti, tiAssumed,
      pco2Old: current.pco2, pco2New,
      hco3Old: current.hco3, hco3New,
      phOld: C.hendersonHasselbalchPH(current.pco2, current.hco3), phNew,
      pao2Old: current.pao2, pao2New, aaOld, aaNew, aAOld, aANew, PAO2Old, PAO2New, peepO2Suppressed,
      mech, bestPeep, protectiveNote, autoPeep, waveform, predictedDx,
      warnings
    };
  }

  function themeColors(){
    const dark = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return dark
      ? { axis:'#98989E', label:'#98989E', old:'#6E6E73', now:'#34D399' }
      : { axis:'#5b6b78', label:'#5b6b78', old:'#9aa6ae', now:'#0d6a8c' };
  }

  function drawWaveform(el, result){
    if(!el || typeof d3 === 'undefined' || !result.waveform) return;
    el.innerHTML = '';
    const w = result.waveform;
    const co = themeColors();
    const width = 420, height = 170, padL = 34, padR = 10, padT = 10, padB = 24;
    const tMax = Math.max(w.cycleOld, w.cycleNew);
    const pAll = w.old.pts.concat(w.new.pts).map(d=>d.p);
    const pMin = Math.min(0, Math.min(...pAll)) - 2, pMax = Math.max(...pAll) + 3;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'xMinYMin meet');

    const x = d3.scaleLinear().domain([0, tMax]).range([padL, width-padR]);
    const y = d3.scaleLinear().domain([pMin, pMax]).range([height-padB, padT]);
    const line = d3.line().x(d=>x(d.t)).y(d=>y(d.p));

    svg.append('g').attr('transform', `translate(0,${height-padB})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(v=>v.toFixed(1)))
      .attr('font-size', 9).attr('color', co.axis).attr('fill', co.axis);
    svg.append('g').attr('transform', `translate(${padL},0)`)
      .call(d3.axisLeft(y).ticks(5))
      .attr('font-size', 9).attr('color', co.axis).attr('fill', co.axis);
    svg.append('text').attr('x', width/2).attr('y', height-2).attr('text-anchor','middle')
      .attr('font-size', 9).attr('fill', co.label).text('time in breath cycle (s)');
    svg.append('text').attr('x', 4).attr('y', 12).attr('font-size', 9).attr('fill', co.label)
      .text('cmH₂O');

    svg.append('path').datum(w.old.pts).attr('d', line).attr('fill','none')
      .attr('stroke', co.old).attr('stroke-width', 1.8).attr('stroke-dasharray', '4,3');
    svg.append('path').datum(w.new.pts).attr('d', line).attr('fill','none')
      .attr('stroke', co.now).attr('stroke-width', 2.2);

    const legend = svg.append('g').attr('transform', `translate(${width-150},${padT})`);
    legend.append('line').attr('x1',0).attr('x2',16).attr('y1',0).attr('y2',0)
      .attr('stroke',co.old).attr('stroke-width',1.8).attr('stroke-dasharray','4,3');
    legend.append('text').attr('x',20).attr('y',3).attr('font-size',9).attr('fill',co.label).text('current');
    legend.append('line').attr('x1',0).attr('x2',16).attr('y1',13).attr('y2',13)
      .attr('stroke',co.now).attr('stroke-width',2.2);
    legend.append('text').attr('x',20).attr('y',16).attr('font-size',9).attr('fill',co.label).text('new');
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
      <div class="why">RR ${f0(result.rrNew)} bpm · Vt ${f0(result.vtNew)} mL in the new state. Dead space held at ${f0(result.deadSpaceMl)} mL (Vd/Vt ${f1(result.vdvt)}${result.vdvtAssumed?', assumed':''}) rather than at a fixed fraction, so a Vt change alters Vd/Vt.</div></div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted pCO₂</div><div class="b">
      ${f1(result.pco2Old)} → <span class="val">${f1(result.pco2New)}</span> mmHg</div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted HCO₃⁻ (acute buffering)</div><div class="b">
      ${f1(result.hco3Old)} → <span class="val">${f1(result.hco3New)}</span> mEq/L
      <div class="why">Fast, non-renal buffering only (~0.1 mEq/L per mmHg rise, ~0.2 per mmHg fall) — not the multi-day renal response.</div></div></div>`);
    rows.push(`<div class="step"><div class="h">Predicted pH</div><div class="b">
      <span class="val">${result.phNew.toFixed(2)}</span></div></div>`);
    if(result.predictedDx){
      const d = result.predictedDx;
      const artifactNote = d.artifacts.length
        ? `<div class="why"><b>Suppressed as model artifact:</b> ${d.artifacts.join(', ')}. These labels appear only because the acute buffering shift moves HCO₃⁻ and, once the predicted pH lands in the normal band, the delta-gap step reads that respiratory shift as a metabolic one. The patient's underlying metabolic picture is unchanged by a ventilator adjustment.</div>`
        : '';
      rows.push(`<div class="step"><div class="h">Predicted overall acid–base status</div><div class="b">
        ${d.baseline ? `<div class="why" style="margin-bottom:6px">Current: ${d.baseline}</div>` : ''}
        <span class="dx ${d.dxClass}" style="display:inline-block;padding:4px 10px;font-size:.92rem;border-radius:6px;margin:2px 0">${d.integrated}</span>
        ${artifactNote}
        <div class="why">The predicted pH/pCO₂/HCO₃⁻ (and PaO₂/FiO₂ if entered) were run back through the same stepwise interpreter used above. Cl⁻ is shifted reciprocally with HCO₃⁻ to hold the anion gap constant; albumin and lactate are carried over unchanged. This shows ventilation's isolated effect, not a change in the underlying metabolic disorder.</div></div></div>`);
    }
    if(result.pao2New != null){
      const peepTxt = result.peepO2Suppressed
        ? ' (no recruitment credited — measured plateau implies overdistension)'
        : (result.peepOld!=null && result.peepNew!==result.peepOld ? ' (adjusted for the PEEP change, illustrative non-validated heuristic)' : ' (assumed unchanged)');
      rows.push(`<div class="step"><div class="h">Predicted PaO₂</div><div class="b">
        ${f1(result.pao2Old)} → <span class="val">${f1(result.pao2New)}</span> mmHg
        <div class="why">FiO₂ ${f0(result.fio2Old)}%${result.fio2Assumed?' (assumed — not entered)':''} → ${f0(result.fio2New)}%. Alveolar PO₂ ${f1(result.PAO2Old)} → ${f1(result.PAO2New)} mmHg. Predicted from a constant a/A ratio ${result.aAOld.toFixed(2)} → ${result.aANew.toFixed(2)}${peepTxt}; the A–a gradient (${f1(result.aaOld)} → ${f1(result.aaNew)} mmHg) follows from that rather than being held fixed, because A–a widens with rising FiO₂ whenever shunt is present.</div></div></div>`);
    }
    if(result.mech){
      const m = result.mech;
      rows.push(`<div class="step"><div class="h">Plateau / driving pressure / mechanical power</div><div class="b">
        Pplat ${f1(m.pplatOld)} → <span class="val">${f1(m.pplatNew)}</span> cmH₂O ·
        DP ${f1(m.dpOld)} → <span class="val">${f1(m.dpNew)}</span> cmH₂O ·
        MP ${f1(m.mpOld)} → <span class="val">${f1(m.mpNew)}</span> J/min
        <div class="why">Measured from total PEEP ${f1(m.peepTotalOld)} → ${f1(m.peepTotalNew)} cmH₂O (set PEEP plus ≈${f1(m.autoOld)} → ${f1(m.autoNew)} cmH₂O estimated auto-PEEP). Peak pressure ${f1(m.ppeakOld)} → ${f1(m.ppeakNew)} cmH₂O; mechanical power includes the resistive component via that peak${m.resistanceAssumed?', using the assumed airway resistance':''}.</div></div></div>`);
      if(m.measuredUsed){
        rows.push(`<div class="why">Static compliance ${f1(m.complianceOld)} → <span class="val">${f1(m.complianceNew)}</span> mL/cmH₂O, recomputed from the measured plateau pressure you entered.</div>`);
      }
    }
    if(result.autoPeep){
      const a = result.autoPeep;
      rows.push(`<div class="step"><div class="h">I:E ratio &amp; auto-PEEP (single-compartment estimate)</div><div class="b">
        I:E ${a.ieOld?('1:'+f1(1/a.ieOld)):'—'} → <span class="val">${a.ieNew?('1:'+f1(1/a.ieNew)):'—'}</span> ·
        Te ${f1(a.teOld)} → <span class="val">${f1(a.teNew)}</span> s ·
        est. auto-PEEP ${f1(a.peepOldAuto)} → <span class="val">${f1(a.peepNewAuto)}</span> cmH₂O
        <div class="why">τ (time constant) ≈ ${f1(a.tau)}s from compliance × resistance.${a.resistanceAssumed?` Resistance not entered — assumed ${f0(result.resistance)} cmH₂O/L/s (ETT plus airway, typical intubated adult).`:''}${a.tiAssumed?` Ti not entered — assumed ${f1(a.ti)}s from a 1:2 I:E ratio.`:''} Steady-state (breath-stacking) estimate, not the residue of a single breath. Full exhalation needs Te ≳ 3τ; below that, gas is trapped and true PEEP exceeds the set value.</div></div></div>`);
    }
    if(result.waveform){
      const w = result.waveform;
      rows.push(`<div class="step"><div class="h">Simulated airway-pressure waveform (one breath)</div><div class="b">
        <div id="ventWaveformBox"></div>
        <div class="why">Constant-flow inspiration: an immediate resistive step, a linear elastic ramp to peak pressure, then the zero-flow drop to plateau and exponential decay toward PEEP on exhalation. Peak−plateau gradient ${f1(w.old.resP)} → <span class="val">${f1(w.new.resP)}</span> cmH₂O at a flow of ${f1(w.old.flow)} → ${f1(w.new.flow)} L/s — this is the resistive load, and a widening gap points to bronchospasm or a blocked/kinked tube rather than stiffening lungs. The plateau drop is drawn as instantaneous because no inspiratory pause time is modelled. Illustrative, not a substitute for the real ventilator's waveform display.</div></div></div>`);
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
