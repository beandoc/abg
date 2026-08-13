window.ABG = window.ABG || {};

ABG.Calculators = (function(){
  'use strict';

  // AG 12 and ALB 4.5 match the reference values used in Marino's delta-gap (Eq. 31.16)
  // and corrected-AG (Eq. 31.15) equations, respectively (ICU Book 5E, Ch.31).
  const NORMALS = { HCO3: 24, PCO2: 40, AG: 12, ALB: 4.5 };

  function hendersonH(pco2, hco3){ return 24 * pco2 / hco3; }
  function phFromH(h){ return 9 - Math.log10(h); }
  function hFromPh(ph){ return Math.pow(10, 9 - ph); }
  function pctDiff(a, b){ return 100 * Math.abs(a - b) / b; }

  function hendersonHasselbalchPH(pco2, hco3){
    return 6.1 + Math.log10(hco3 / (0.03 * pco2));
  }

  // Adrogué–Madias secondary-response rule for metabolic acidosis (ICU Book Eq. 31.3/31.4):
  // Expected PaCO2 = 40 - [1.2 x (24 - current HCO3)]
  // Classic Winter's formula (Winter et al., 1967): PaCO2 = 1.5 x [HCO3] + 8 (+/- 2).
  function metAcidExpectedPCO2(hco3){ return 1.5 * hco3 + 8; }
  function metAlkExpectedPCO2(hco3){ return 40 + 0.7 * (hco3 - NORMALS.HCO3); }
  function respAcidAcuteHCO3(pco2){ return NORMALS.HCO3 + 0.1 * (pco2 - NORMALS.PCO2); }
  function respAcidChronicHCO3(pco2){ return NORMALS.HCO3 + 0.4 * (pco2 - NORMALS.PCO2); }
  function respAlkAcuteHCO3(pco2){ return NORMALS.HCO3 - 0.2 * (NORMALS.PCO2 - pco2); }
  function respAlkChronicHCO3(pco2){ return NORMALS.HCO3 - 0.4 * (NORMALS.PCO2 - pco2); }

  function anionGap(na, cl, hco3){ return na - (cl + hco3); }
  function correctedAnionGap(ag, albumin, normalAlb){
    normalAlb = normalAlb == null ? NORMALS.ALB : normalAlb;
    return ag + 2.5 * (normalAlb - albumin);
  }
  function deltaRatio(cAG, hco3, normalAG, normalHCO3){
    normalAG = normalAG == null ? NORMALS.AG : normalAG;
    normalHCO3 = normalHCO3 == null ? NORMALS.HCO3 : normalHCO3;
    const dAG = cAG - normalAG;
    const dHCO3 = normalHCO3 - hco3;
    return { dAG, dHCO3, ratio: dHCO3 > 0 ? dAG / dHCO3 : null };
  }

  function calcOsm(na, glucose, bun){
    return 2 * na + glucose / 18 + bun / 2.8;
  }
  function osmolalGap(measured, calc){ return measured - calc; }

  function urineAnionGap(uNa, uK, uCl){ return (uNa + uK) - uCl; }

  // Urine Osmolal Gap (UOG): Used to estimate urinary NH4+ excretion (approx UOG / 2) when unmeasured urine anions (e.g. ketoanions, hippurate) distort the Urine Anion Gap.
  function urineOsmolalGap(uOsmMeasured, uNa, uK, uBUN, uGlucose){
    if(uOsmMeasured == null || uNa == null || uK == null) return null;
    const calc = 2 * (uNa + uK) + (uBUN != null ? uBUN / 2.8 : 0) + (uGlucose != null ? uGlucose / 18 : 0);
    const gap = uOsmMeasured - calc;
    const estNH4 = Math.max(0, gap / 2);
    return {
      calcOsm: Math.round(calc * 10) / 10,
      gap: Math.round(gap * 10) / 10,
      estNH4: Math.round(estNH4 * 10) / 10,
      isLow: gap < 100
    };
  }

  // Stool Osmolal Gap: Stool Osm (measured) - [2 * (Stool Na + Stool K)]. Gap >= 50 mOsm/kg -> Osmotic diarrhea; Gap < 50 mOsm/kg -> Secretory diarrhea.
  function stoolOsmolalGap(measuredOsm, stoolNa, stoolK){
    if(measuredOsm == null || stoolNa == null || stoolK == null) return null;
    const calc = 2 * (stoolNa + stoolK);
    const gap = Math.round((measuredOsm - calc) * 10) / 10;
    const isOsmotic = gap >= 50;
    return {
      calcOsm: Math.round(calc * 10) / 10,
      gap,
      isOsmotic,
      type: isOsmotic ? 'Osmotic diarrhea (laxatives / lactulose / unabsorbed carbohydrates)' : 'Secretory diarrhea (enterotoxins / VIPoma / cholera / bile acids)'
    };
  }

  // Alveolar gas equation at sea level (Patm 760, PH2O 47, R 0.8).
  function alveolarPO2(pco2, fio2Pct){
    return (fio2Pct / 100) * (760 - 47) - pco2 / 0.8;
  }

  function aaGradient(pco2, fio2Pct, pao2){
    const PAO2 = alveolarPO2(pco2, fio2Pct);
    return { PAO2, aa: PAO2 - pao2 };
  }

  // VBG to ABG conversion (standard clinical offset: pH +0.03, pCO2 -6, HCO3 -1.5)
  function vbgToAbg(vbgPh, vbgPco2, vbgHco3){
    return {
      ph: vbgPh != null ? Math.round((vbgPh + 0.03)*100)/100 : null,
      pco2: vbgPco2 != null ? Math.max(10, Math.round((vbgPco2 - 6)*10)/10) : null,
      hco3: vbgHco3 != null ? Math.max(1, Math.round((vbgHco3 - 1.5)*10)/10) : null
    };
  }

  // Venous-to-Arterial pCO2 gap (P(v-a)CO2): normal <= 6 mmHg. >6 mmHg indicates low cardiac output / shock.
  function pvPaCO2Gap(pvCO2, paCO2){
    if(pvCO2 == null || paCO2 == null) return null;
    const gap = pvCO2 - paCO2;
    return {
      gap: Math.round(gap * 10) / 10,
      isHigh: gap > 6.0
    };
  }

  // Na+:Cl- ratio analysis (normal baseline 1.4:1). Distinguishes pure hydration state changes (1.4:1 preserved) from primary acid-base chloride disturbances.
  function naClRatio(na, cl){
    if(na == null || cl == null || cl === 0) return null;
    const ratio = Math.round((na / cl) * 100) / 100;
    let state = 'normal';
    if(ratio > 1.45) state = 'high'; // Disproportionate hypochloremia -> Met Alk or Chronic Resp Acid
    else if(ratio < 1.35) state = 'low'; // Disproportionate hyperchloremia -> NAGMA or Chronic Resp Alk
    return { ratio, state };
  }

  // Devine Formula for Ideal Body Weight (ARDSNet Standard)
  function calcIBW(heightCm, sex){
    if(!heightCm || heightCm < 100) return null;
    const isMale = !sex || sex.toUpperCase() === 'M' || sex.toUpperCase() === 'MALE';
    const base = isMale ? 50 : 45.5;
    const ibw = base + 0.91 * (heightCm - 152.4);
    return Math.max(30, Math.round(ibw * 10) / 10);
  }

  function ibwPerKg(vt, weight){ return vt / weight; }

  function minuteVentilation(vt, rr){ return vt * rr; }

  function predictedPCO2FromVE(pco2Old, veOld, veNew){
    if(!veOld || !veNew) return null;
    return pco2Old * veOld / veNew;
  }

  function alveolarVentilation(vt, deadSpaceMl, rr){ return Math.max(0, vt - deadSpaceMl) * rr; }

  function acuteHCO3Shift(pco2Old, pco2New, hco3Old){
    const slope = pco2New >= pco2Old ? 0.1 : 0.2; // mEq/L per mmHg, acute non-renal buffering
    return hco3Old + slope * (pco2New - pco2Old);
  }

  // Metabolic alkalosis management (ICU Book Ch.33, Eq. 33.2-33.4 / Tables 33.2-33.3)
  function clDeficit(weightKg, plasmaCl){ return 0.2 * weightKg * (100 - plasmaCl); }
  function salineVolumeL(clDeficitMeq){ return clDeficitMeq / 154; }
  function hPlusDeficit(weightKg, hco3){ return 0.5 * weightKg * (hco3 - NORMALS.HCO3); }
  function hclVolumeL(hDeficitMeq){ return hDeficitMeq / 100; }

  function plateauPressure(peep, vt, compliance){ return peep + vt / compliance; }
  function drivingPressure(pplat, peep){ return pplat - peep; }
  function staticCompliance(vt, pplat, peepTotal){ return vt / (pplat - peepTotal); }
  function pfRatio(pao2, fio2Pct){ return pao2 / (fio2Pct / 100); }
  // Arterial/alveolar O2 ratio. Unlike the A-a difference, this stays roughly constant as
  // FiO2 changes, so it is the safer basis for predicting PaO2 after an FiO2 adjustment.
  function aAratio(pao2, PAO2){ return PAO2 > 0 ? pao2 / PAO2 : null; }
  // Peak inspiratory pressure under constant (square-wave) flow: plateau plus the
  // resistive drop across the airway/ETT.
  function peakPressure(pplat, vtMl, tiSec, resistanceCmH2OPerLps){
    if(!tiSec || resistanceCmH2OPerLps == null) return pplat;
    return pplat + inspFlowLps(vtMl, tiSec) * resistanceCmH2OPerLps;
  }
  // Becher/Gattinoni surrogate: MP = 0.098 x RR x Vt x (Ppeak - dP/2). Passing the plateau
  // rather than the peak pressure yields the elastic-only power (no resistive component).
  function mechanicalPower(rr, vtMl, pTop, dp){
    return 0.098 * rr * (vtMl / 1000) * (pTop - dp / 2);
  }

  // Single-compartment (Riggs) respiratory-mechanics model: passive exhalation is an
  // exponential decay toward PEEP with time constant tau = compliance x resistance.
  function timeConstant(complianceMlPerCmH2O, resistanceCmH2OPerLps){
    return (complianceMlPerCmH2O / 1000) * resistanceCmH2OPerLps; // seconds
  }
  function inspFlowLps(vtMl, tiSec){ return (vtMl / 1000) / tiSec; }
  function resistivePressure(flowLps, resistance){ return flowLps * resistance; }
  // Fraction of the inspired volume still trapped in the lung after expiratory time te.
  function retainedVolumeFraction(teSec, tau){ return tau > 0 ? Math.exp(-teSec / tau) : 0; }
  // Steady-state (breath-stacking) trapped volume, not the single-breath residue: each breath
  // starts from the volume left by the last one, so Vtrap converges on Vt.e^-x/(1-e^-x).
  // The single-breath form understates auto-PEEP by ~58% at te = tau, i.e. exactly where it matters.
  function autoPeepEstimate(vtMl, complianceMlPerCmH2O, teSec, tau){
    const retained = retainedVolumeFraction(teSec, tau);
    if(retained >= 0.995) return 200; // exhalation is effectively absent; caller clamps/warns
    const trapped = vtMl * retained / (1 - retained);
    return trapped / complianceMlPerCmH2O; // cmH2O above the set PEEP
  }
  // Pressure-control tidal volume for a step change in driving pressure, single-compartment
  // model with a decaying-flow (pressure-limited) inspiration: Vt = deltaP x C x (1 - e^-Ti/tau).
  function pcTidalVolume(deltaP, complianceMlPerCmH2O, tiSec, tau){
    const rise = tau > 0 ? (1 - Math.exp(-tiSec / tau)) : 1;
    return deltaP * complianceMlPerCmH2O * rise;
  }

  return {
    NORMALS,
    hendersonH, phFromH, hFromPh, pctDiff, hendersonHasselbalchPH,
    metAcidExpectedPCO2, metAlkExpectedPCO2,
    respAcidAcuteHCO3, respAcidChronicHCO3, respAlkAcuteHCO3, respAlkChronicHCO3,
    anionGap, correctedAnionGap, deltaRatio,
    calcOsm, osmolalGap, urineAnionGap, urineOsmolalGap, stoolOsmolalGap, alveolarPO2, aaGradient, calcIBW, ibwPerKg, vbgToAbg, pvPaCO2Gap, naClRatio,
    minuteVentilation, predictedPCO2FromVE, alveolarVentilation, acuteHCO3Shift,
    clDeficit, salineVolumeL, hPlusDeficit, hclVolumeL,
    plateauPressure, drivingPressure, staticCompliance, pfRatio, aAratio, peakPressure, mechanicalPower,
    timeConstant, inspFlowLps, resistivePressure, retainedVolumeFraction, autoPeepEstimate, pcTidalVolume
  };
})();
