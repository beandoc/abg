window.ABG = window.ABG || {};

ABG.Alkalosis = (function(){
  'use strict';
  const C = ABG.Calculators;
  const f1 = x => x==null||isNaN(x) ? '—' : (Math.round(x*10)/10).toFixed(1);

  // Table 33.1: classification by urine chloride (extracellular volume status is inferred clinically)
  function classifyByUCl(uCl){
    if(uCl==null) return null;
    if(uCl<20) return {label:'Chloride-sensitive (low urine Cl⁻)', detail:'Consistent with a low extracellular volume — vomiting/NG suction, post-diuretic effect, or laxative abuse. Responds to volume + chloride repletion.'};
    if(uCl>20) return {label:'Chloride-resistant (high urine Cl⁻)', detail:'Consistent with an expanded/normal extracellular volume — primary hyperaldosteronism, exogenous mineralocorticoid, or licorice. Saline is not the fix; treat the underlying cause.'};
    return {label:'Indeterminate (urine Cl⁻ ≈ 20 mEq/L)', detail:'Borderline value — repeat once any diuretic effect has dissipated.'};
  }

  function render(container, {hco3, cl, ph, uCl, weight}){
    const rows=[];
    const row=(label,value,unit,note)=>rows.push(
      `<div class="step"><div class="h">${label}</div><div class="b"><span class="val">${value}</span>${unit?(' '+unit):''}${note?`<div class="why">${note}</div>`:''}</div></div>`);

    const cls = classifyByUCl(uCl);
    if(cls) row('Classification (Table 33.1)', cls.label, '', cls.detail);
    else row('Classification (Table 33.1)', 'Not determined', '', 'Enter urine Cl⁻ (Additional labs section) to classify as chloride-sensitive (&lt;20 mEq/L) vs chloride-resistant (&gt;20 mEq/L).');

    if(weight!=null && cl!=null){
      const deficit = C.clDeficit(weight, cl);
      if(deficit>0){
        const vol = C.salineVolumeL(deficit);
        row('Chloride deficit', f1(deficit), 'mEq', `0.2 × ${f1(weight)} kg × (100 − ${f1(cl)}) — Eq. 33.2.`);
        row('Isotonic saline needed', f1(vol), 'L', `Deficit ÷ 154 mEq/L (Cl⁻ in 0.9% NaCl) — Eq. 33.3. Infuse with KCl (check Mg²⁺ first — hypomagnesemia can make hypokalemia refractory to K⁺ replacement); no need to rush — ~100 mL/hr above hourly fluid losses is sufficient.`);
      } else {
        row('Chloride deficit', '0', 'mEq', `Plasma Cl⁻ (${f1(cl)}) is already ≥ 100 mEq/L — no deficit by this formula.`);
      }
    } else {
      row('Chloride deficit / saline volume', 'Not calculated', '', 'Enter weight (kg) in the Patient section above and ensure plasma Cl⁻ is entered in the ABG form.');
    }

    const severe = (hco3>50) || (ph!=null && ph>7.55);
    if(severe){
      if(weight!=null){
        const hDef = C.hPlusDeficit(weight, hco3);
        const hclVol = C.hclVolumeL(hDef);
        row('<span class="fa">Severe alkalosis</span> — H⁺ deficit', f1(hDef), 'mEq',
          `HCO₃⁻ ${f1(hco3)}${ph!=null?` / pH ${ph.toFixed(2)}`:''} exceeds the threshold for HCl infusion (HCO₃⁻ &gt; 50 or pH &gt; 7.55) — Eq. 33.4: 0.5 × ${f1(weight)} kg × (${f1(hco3)} − 24).`);
        row('0.1N HCl volume', f1(hclVol), 'L', `H⁺ deficit ÷ 100 mEq/L (0.1N HCl = 100 mL of 1N HCl in 900 mL saline/water). Infuse via a large central vein at ≤0.2 mEq/kg/hr; stop once pH falls to an acceptable level (e.g. &lt;7.5) — the full deficit need not be replaced. Extravasation causes tissue necrosis.`);
      } else {
        row('<span class="fa">Severe alkalosis</span> (HCO₃⁻ &gt; 50 or pH &gt; 7.55)', 'HCl infusion may be indicated', '', 'Enter weight (kg) in the Patient section above to calculate the H⁺ deficit and required 0.1N HCl volume (Eq. 33.4).');
      }
    }

    row('Acetazolamide (edematous states)', '250–375 mg', 'IV/PO, 1–2×/day', 'For metabolic alkalosis with an expanded ECV (heart failure, cirrhosis, cor pulmonale) where saline would be counterproductive — inhibits proximal HCO₃⁻ reabsorption and acts as a diuretic.');
    row('Neurologic manifestations', 'Usually not from metabolic alkalosis', '', 'Depressed consciousness, seizures, paresthesias and carpopedal spasm are classically attributed to alkalosis but are usually seen with respiratory, not metabolic, alkalosis.');

    container.innerHTML = rows.join('');
  }

  return { classifyByUCl, render };
})();
