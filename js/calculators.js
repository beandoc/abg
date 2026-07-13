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
  function metAcidExpectedPCO2(hco3){ return 40 - 1.2 * (NORMALS.HCO3 - hco3); }
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

  function calcOsm(na, glucose, bun, ethanol){
    let osm = 2 * na + glucose / 18 + bun / 2.8;
    if (ethanol != null) osm += ethanol / 3.7;
    return osm;
  }
  function osmolalGap(measured, calc){ return measured - calc; }

  function urineAnionGap(uNa, uK, uCl){ return (uNa + uK) - uCl; }

  function aaGradient(pco2, fio2Pct, pao2){
    const fio2 = fio2Pct / 100;
    const PAO2 = fio2 * (760 - 47) - pco2 / 0.8;
    return { PAO2, aa: PAO2 - pao2 };
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
  function mechanicalPower(rr, vtMl, pplat, dp){
    return 0.098 * rr * (vtMl / 1000) * (pplat - dp / 2);
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
  function autoPeepEstimate(vtMl, complianceMlPerCmH2O, teSec, tau){
    const retained = retainedVolumeFraction(teSec, tau);
    return (vtMl * retained) / complianceMlPerCmH2O; // cmH2O added above set PEEP
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
    calcOsm, osmolalGap, urineAnionGap, aaGradient, ibwPerKg,
    minuteVentilation, predictedPCO2FromVE, alveolarVentilation, acuteHCO3Shift,
    clDeficit, salineVolumeL, hPlusDeficit, hclVolumeL,
    plateauPressure, drivingPressure, staticCompliance, pfRatio, mechanicalPower,
    timeConstant, inspFlowLps, resistivePressure, retainedVolumeFraction, autoPeepEstimate, pcTidalVolume
  };
})();
