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
    if(cls) row('Classification', cls.label, '', cls.detail);
    else row('Classification', 'Not determined', '', 'Enter urine Cl⁻ (Additional labs section) to classify as chloride-sensitive (&lt;20 mEq/L) vs chloride-resistant (&gt;20 mEq/L).');

    // Chloride-resistant alkalosis does not respond to saline, so a saline volume must not be
    // rendered next to a classification that has just said saline is the wrong treatment.
    const chlorideResistant = uCl != null && uCl > 20;

    if(weight!=null && cl!=null){
      const deficit = C.clDeficit(weight, cl);
      if(deficit>0 && chlorideResistant){
        row('Chloride deficit (not the treatment target here)', f1(deficit), 'mEq',
          `0.2 × ${f1(weight)} kg × (100 − ${f1(cl)}). <b>Saline volume deliberately not calculated:</b> urine Cl⁻ is ${f1(uCl)} mEq/L, i.e. <b>chloride-resistant</b> — the kidney is excreting chloride, so this is a mineralocorticoid/potassium problem, not a volume-chloride deficit. Loading with saline expands an already-normal or expanded ECV and worsens hypertension without correcting the alkalosis. Treat the cause and replete K⁺ (± spironolactone/amiloride, or acetazolamide).`);
      } else if(deficit>0){
        const vol = C.salineVolumeL(deficit);
        row('Chloride deficit', f1(deficit), 'mEq', `0.2 × ${f1(weight)} kg × (100 − ${f1(cl)})`);
        row('Isotonic saline needed', f1(vol), 'L', `Deficit ÷ 154 mEq/L (Cl⁻ in 0.9% NaCl). Infuse with KCl (check Mg²⁺ first — hypomagnesemia can make hypokalemia refractory to K⁺ replacement); ~100 mL/hr above hourly fluid losses is sufficient.${uCl==null?' <b>Confirm urine Cl⁻ &lt; 20 mEq/L before volume-loading</b> — this calculation assumes a chloride-responsive alkalosis.':''}`);
      } else {
        row('Chloride deficit', '0', 'mEq', `Plasma Cl⁻ (${f1(cl)}) is already ≥ 100 mEq/L — no deficit by this formula, so there is no saline/chloride dose to give. Correct K⁺ and volume, and reconsider whether the alkalosis is chloride-responsive at all.`);
      }
    } else {
      row('Chloride deficit / saline volume', 'Not calculated', '', 'Enter weight (kg) in the Patient section above and ensure plasma Cl⁻ is entered in the ABG form.');
    }

    // The H+ deficit formula is 0.5 x wt x (HCO3 - 24) and is only meaningful when HCO3 is
    // genuinely elevated. Triggering on pH alone let a respiratory alkalaemia (with a LOW HCO3)
    // reach this block, where the formula returned a negative deficit and a negative litre volume.
    const severe = (hco3>50) || (ph!=null && ph>7.55 && hco3>30);
    if(severe){
      if(weight!=null){
        const hDef = C.hPlusDeficit(weight, hco3);
        const hclVol = C.hclVolumeL(hDef);
        const maxRate = 0.2 * weight;                 // mEq/hr
        const hours = maxRate>0 ? hDef/maxRate : null; // at the stated ceiling
        row('<span class="fa">Severe alkalosis</span> — H⁺ deficit', f1(hDef), 'mEq',
          `HCO₃⁻ ${f1(hco3)}${ph!=null?` / pH ${ph.toFixed(2)}`:''} exceeds the threshold for HCl infusion (HCO₃⁻ &gt; 50, or pH &gt; 7.55 with HCO₃⁻ &gt; 30): 0.5 × ${f1(weight)} kg × (${f1(hco3)} − 24).`);
        row('0.1N HCl volume', f1(hclVol), 'L',
          `H⁺ deficit ÷ 100 mEq/L (0.1N HCl = 100 mL of 1N HCl in 900 mL saline/water). Infuse via a large central vein at ≤0.2 mEq/kg/hr — for this patient ≈ <b>${f1(maxRate)} mEq/hr (${f1(maxRate/100*1000)} mL/hr)</b>.` +
          (hours!=null ? ` <b>This is a full-replacement figure, not a prescription:</b> the whole ${f1(hDef)} mEq at the maximum safe rate would take ≈ ${f1(hours)} hours. Do not aim to give it — stop once pH falls below ~7.50, rechecking the gas every 4 hours, and correct chloride/potassium first.` : '') +
          ` Extravasation causes tissue necrosis.`);
      } else {
        row('<span class="fa">Severe alkalosis</span> (HCO₃⁻ &gt; 50, or pH &gt; 7.55 with HCO₃⁻ &gt; 30)', 'HCl infusion may be indicated', '', 'Enter weight (kg) in the Patient section above to calculate the H⁺ deficit and required 0.1N HCl volume.');
      }
    } else if(ph!=null && ph>7.55){
      row('<span class="fa">pH &gt; 7.55 but HCO₃⁻ is not elevated</span>', 'HCl infusion NOT indicated', '',
        `HCO₃⁻ is ${f1(hco3)} mEq/L, so this alkalaemia is not metabolically driven and the H⁺-deficit formula (which assumes an excess of HCO₃⁻ above 24) does not apply — applying it here yields a negative, meaningless dose. Correct the respiratory driver instead.`);
    }

    row('Acetazolamide (edematous states)', '250–375 mg', 'IV/PO, 1–2×/day', 'For metabolic alkalosis with an expanded ECV (heart failure, cirrhosis, cor pulmonale) where saline would be counterproductive — inhibits proximal HCO₃⁻ reabsorption and acts as a diuretic.');
    row('Neurologic manifestations', 'Usually not from metabolic alkalosis', '', 'Depressed consciousness, seizures, paresthesias and carpopedal spasm are classically attributed to alkalosis but are usually seen with respiratory, not metabolic, alkalosis.');

    container.innerHTML = rows.join('');
  }

  return { classifyByUCl, render };
})();
