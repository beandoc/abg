window.ABG = window.ABG || {};

ABG.Calculators = (function(){
  'use strict';

  const NORMALS = { HCO3: 24, PCO2: 40, AG: 10, ALB: 4.0 };

  function hendersonH(pco2, hco3){ return 24 * pco2 / hco3; }
  function phFromH(h){ return 9 - Math.log10(h); }
  function hFromPh(ph){ return Math.pow(10, 9 - ph); }
  function pctDiff(a, b){ return 100 * Math.abs(a - b) / b; }

  function hendersonHasselbalchPH(pco2, hco3){
    return 6.1 + Math.log10(hco3 / (0.03 * pco2));
  }

  function wintersExpectedPCO2(hco3){ return 1.5 * hco3 + 8; }
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

  return {
    NORMALS,
    hendersonH, phFromH, hFromPh, pctDiff, hendersonHasselbalchPH,
    wintersExpectedPCO2, metAlkExpectedPCO2,
    respAcidAcuteHCO3, respAcidChronicHCO3, respAlkAcuteHCO3, respAlkChronicHCO3,
    anionGap, correctedAnionGap, deltaRatio,
    calcOsm, osmolalGap, urineAnionGap, aaGradient, ibwPerKg
  };
})();
