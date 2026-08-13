window.ABG = window.ABG || {};

ABG.Tutor = (function(){
  'use strict';

  const PRESETS = {
    case1: {
      title: 'Case 1: Sepsis & Recurrent DKA (72M Nursing Home Resident)',
      description: 'Sepsis + AKI presenting with HAGMA (AG 19), which recurs on Day 4 due to DKA/starvation ketoacidosis (Beta-hydroxybutyrate 5.3 mg/dL).',
      labs: {
        patientName: 'Case 1 (72M)', patientAge: 72, patientSex: 'M', patientWeight: 70,
        ph: 7.22, pco2: 24, hco3: 10, na: 131, k: 3.5, cl: 102, lactate: 1.7, albumin: 2.5,
        bun: 48, glucose: 240, measuredOsm: 310
      }
    },
    case2: {
      title: 'Case 2: Salicylate Toxicity & Post-Intubation Trap (55F)',
      description: 'Aspirin overdose presenting post-intubation with severe Triple Disorder: HAGMA + NAGMA/pseudohyperchloremia + Post-intubation Respiratory Acidosis.',
      labs: {
        patientName: 'Case 2 (55F)', patientAge: 55, patientSex: 'F', patientWeight: 62,
        ph: 7.05, pco2: 37, hco3: 10, na: 147, k: 4.2, cl: 115, lactate: 1.6, albumin: 4.0,
        bun: 28, glucose: 130, measuredOsm: 317
      }
    },
    case3: {
      title: 'Case 3: Linezolid-Induced Type B Lactic Acidosis (41F Post-Op)',
      description: '4-week Linezolid therapy causing mitochondrial Complex I/IV inhibition and severe Type B Lactic Acidosis (Lactate 12.2) + Opioid Resp Acidosis.',
      labs: {
        patientName: 'Case 3 (41F)', patientAge: 41, patientSex: 'F', patientWeight: 58,
        ph: 7.16, pco2: 35, hco3: 12, na: 146, k: 3.8, cl: 105, lactate: 12.2, albumin: 4.0,
        bun: 18, glucose: 105, measuredOsm: 295
      }
    },
    case4: {
      title: 'Case 4: Chronic COPD Exacerbation with Diuretic Use (68M)',
      description: 'Chronic hypercapnic respiratory acidosis with metabolic compensation and mild secondary metabolic alkalosis.',
      labs: {
        patientName: 'Case 4 (68M)', patientAge: 68, patientSex: 'M', patientWeight: 75,
        ph: 7.37, pco2: 56, hco3: 31, na: 139, k: 3.2, cl: 96, lactate: 1.1, albumin: 4.2,
        bun: 22, glucose: 110
      }
    },
    case5: {
      title: 'Case 5: Warburg Effect Type B Lactic Acidosis (45F Metastatic Ductal Carcinoma)',
      description: 'Metastatic breast cancer (liver, bone, peritoneum) causing aerobic glycolysis (Warburg effect) with severe Type B Lactic Acidosis (Lactate 10.0), HAGMA (AG 24, corrected 26.8), and post-Zoledronic Acid Hypophosphatemia.',
      labs: {
        patientName: 'Case 5 (45F)', patientAge: 45, patientSex: 'F', patientWeight: 60,
        ph: 7.30, pco2: 27, hco3: 12, na: 135, k: 3.6, cl: 99, lactate: 10.0, albumin: 2.9,
        bun: 16, glucose: 110, nPhosphate: 1.1
      }
    },
    case6: {
      title: 'Case 6: Extreme Hypochloremic Metabolic Alkalosis & AKI (63M Metastatic NET)',
      description: 'Severe persistent vomiting & diarrhea in pancreatic NET causing extreme Metabolic Alkalosis (pH 7.55, HCO3 60, Cl 52), High-AG Uremic Acidosis (cAG 30, Cr 6.1), Hypokalemia (2.4), and massive Chloride Deficit (697 mEq / 4.5L 0.9% NaCl).',
      labs: {
        patientName: 'Case 6 (63M)', patientAge: 63, patientSex: 'M', patientWeight: 72.6,
        ph: 7.55, pco2: 69, hco3: 60, na: 137, k: 2.4, cl: 52, lactate: 1.8, albumin: 2.5,
        bun: 85, glucose: 120, nCreatinine: 6.1
      }
    }
  };

  const GOLDMARK_ITEMS = [
    { letter: 'G', title: 'Glycols (Ethylene & Propylene)', detail: 'Ethylene glycol (antifreeze) & Propylene glycol (solvent in IV lorazepam/phenytoin). Osmolal gap > 10 mOsm/kg H₂O.' },
    { letter: 'O', title: '5-Oxoproline (Pyroglutamic acid)', detail: 'Chronic acetaminophen ingestion with malnutrition, sepsis, or renal impairment. Causes high AG without elevated lactate or ketones.' },
    { letter: 'L', title: 'L-Lactate (Type A, B, D)', detail: 'Type A (hypoxia/ischemia), Type B (toxins: linezolid, metformin, Warburg effect), Type D (short bowel syndrome).' },
    { letter: 'D', title: 'D-Lactate', detail: 'Colonic bacterial fermentation of carbohydrates in short-bowel syndrome. Standard blood lactate assays measure L-lactate and miss D-lactate!' },
    { letter: 'M', title: 'Methanol', detail: 'Toxic alcohol metabolized to formic acid. High osmolal gap + retinal toxicity / optic disc hyperemia.' },
    { letter: 'A', title: 'Aspirin / Salicylates', detail: 'Direct respiratory center stimulation (Resp Alk) + mitochondrial uncoupling (HAGMA). Post-intubation sedation causes dangerous Resp Acidosis.' },
    { letter: 'R', title: 'Renal Failure (Uremia)', detail: 'Accumulation of organic anions (sulfates, phosphates, urate) due to GFR impairment.' },
    { letter: 'K', title: 'Ketoacidosis (DKA, AKA, Starvation)', detail: 'DKA, Alcoholic Ketoacidosis, Starvation. Note: Urine dipstick tests Acetoacetate, NOT Beta-hydroxybutyrate.' }
  ];

  let activeStepIndex = 0;
  let currentAnalysis = null;

  function loadPreset(key){
    const p = PRESETS[key];
    if(!p) return;
    for(const [id, val] of Object.entries(p.labs)){
      const el = document.getElementById(id);
      if(el) el.value = val;
    }
    const evt = new Event('submit', { cancelable: true });
    document.getElementById('f').dispatchEvent(evt);
  }

  function renderGauges(r, data){
    // Use the analysed values, not the raw form entries — for a VBG these differ, and the gauge
    // was drawing a target band from raw HCO₃⁻ against a marker at the raw pCO₂ while the
    // step transcript beside it reasoned over the converted arterial equivalents.
    const pco2 = r.pco2, hco3 = r.hco3;
    
    // 1. Expected pCO2 Gauge — Winter's formula target depends on which side (met acid vs met alk)
    // is primary; it isn't meaningful when the primary disorder is respiratory (compensation there
    // is renal/HCO3-based, not a pCO2 target), so leave it unset in that case.
    let expPCO2Min = null, expPCO2Max = null, expPCO2Mid = null;
    if(hco3 != null && r.primary === 'Metabolic acidosis'){
      expPCO2Mid = ABG.Calculators.metAcidExpectedPCO2(hco3);
    } else if(hco3 != null && r.primary === 'Metabolic alkalosis'){
      expPCO2Mid = ABG.Calculators.metAlkExpectedPCO2(hco3);
    }
    if(expPCO2Mid != null){
      expPCO2Min = Math.max(10, expPCO2Mid - 2);
      expPCO2Max = expPCO2Mid + 2;
    }

    const pco2Pct = Math.min(100, Math.max(0, ((pco2 - 15) / 55) * 100));
    const expMinPct = expPCO2Min != null ? Math.min(100, Math.max(0, ((expPCO2Min - 15) / 55) * 100)) : null;
    const expMaxPct = expPCO2Max != null ? Math.min(100, Math.max(0, ((expPCO2Max - 15) / 55) * 100)) : null;

    // 2. Delta Ratio Gauge — take the engine's ratio so the gauge, the summary card and Step 8
    // can never disagree. Re-deriving it here against a >12 threshold drew a delta marker for
    // gaps the engine classed as borderline and for which it emitted no delta-gap step.
    const deltaRatioVal = (r.delta && r.delta.ratio != null) ? r.delta.ratio : null;

    let deltaPosPct = 50;
    if(deltaRatioVal != null){
      // Scale: 0 to 3.0 — must match the three equal-width (flex:1) zones below, whose
      // boundaries at 1.0 and 2.0 sit at exactly 1/3 and 2/3 of the bar. A mismatched divisor
      // here (previously 2.5) shifts the marker right of its true zone — e.g. a ratio of 0.9,
      // which Step 8 calls "mixed", would land inside the "Pure HAGMA" band instead of "NAGMA".
      deltaPosPct = Math.min(100, Math.max(0, (deltaRatioVal / 3.0) * 100));
    }

    return `
      <div class="visual-gauges-card">
        <div class="gauge-block">
          <div class="gauge-title">
            <span>Respiratory Compensation Gauge (pCO₂)</span>
            <span class="gauge-val">${pco2 != null ? pco2 + ' mmHg' : 'N/A'}</span>
          </div>
          <div class="gauge-bar-track">
            ${expMinPct != null ? `<div class="gauge-target-range" style="left:${expMinPct}%; width:${Math.max(4, expMaxPct - expMinPct)}%;" title="Expected pCO₂ range (${expPCO2Min.toFixed(1)}–${expPCO2Max.toFixed(1)} mmHg)"></div>` : ''}
            <div class="gauge-marker" style="left:${pco2Pct}%;" title="Measured pCO₂ (${pco2} mmHg)"></div>
          </div>
          <div class="gauge-labels">
            <span>15 mmHg</span>
            <span style="color:var(--accent)">${expPCO2Min != null ? `Target Expected: ${expPCO2Min.toFixed(1)}–${expPCO2Max.toFixed(1)}` : 'Winter\'s target (metabolic-primary only)'}</span>
            <span>70 mmHg</span>
          </div>
        </div>

        ${deltaRatioVal != null ? `
        <div class="gauge-block" style="margin-top:14px;">
          <div class="gauge-title">
            <span>ΔAG / ΔHCO₃⁻ Delta Ratio Spectrum</span>
            <span class="gauge-val">${deltaRatioVal != null ? deltaRatioVal.toFixed(2) : 'N/A'}</span>
          </div>
          <div class="gauge-bar-track delta-track">
            <div class="delta-zone nagma" title="< 1.0: NAGMA">NAGMA (&lt;1.0)</div>
            <div class="delta-zone pure" title="1.0–2.0: Pure HAGMA">Pure HAGMA (1.0–2.0)</div>
            <div class="delta-zone metalk" title="> 2.0: Met Alkalosis">Met Alk (&gt;2.0)</div>
            ${deltaRatioVal != null ? `<div class="gauge-marker delta-marker" style="left:${deltaPosPct}%;"></div>` : ''}
          </div>
          <div class="gauge-labels">
            <span>0.0</span>
            <span>1.0</span>
            <span>2.0</span>
            <span>3.0+</span>
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  function renderLacticClassifier(lactate){
    if(lactate == null || lactate <= 2.0) return '';
    // This is a differential reference, not an automated classifier: the form collects no
    // haemodynamic data (MAP, pressor use, ScvO2), so there is no signal here to determine
    // which type actually applies. Previously the Type B node was hardcoded '.active' for
    // every case above 2.0 mmol/L, including obvious Type A pictures (e.g. septic shock) —
    // silently pointing at the wrong mechanism. Do not highlight any node until real
    // haemodynamic/drug-history inputs exist to justify one.
    return `
      <div class="lactic-tree-card">
        <div class="subhead" style="margin-top:0;">Lactic Acidosis Differential (Lactate ${lactate} mmol/L)</div>
        <div class="node-desc" style="margin-bottom:8px;">Elevated lactate alone does not identify the mechanism — work through all three against the clinical picture:</div>
        <div class="tree-nodes">
          <div class="tree-node">
            <div class="node-badge type-a">Type A (Hypoxia / Hypoperfusion)</div>
            <div class="node-desc">Sepsis, cardiogenic shock, mesenteric ischemia, severe anemia. Check MAP, ScvO₂, peripheral perfusion.</div>
          </div>
          <div class="tree-node">
            <div class="node-badge type-b">Type B (Cellular / Mitochondrial Toxin)</div>
            <div class="node-desc"><b>Mitochondrial Complex I/IV Inhibitors:</b> Linezolid, Metformin, NRTIs, Propofol (PRIS), Malignancy (Warburg effect). Occurs despite normal blood pressure & tissue oxygenation!</div>
          </div>
          <div class="tree-node">
            <div class="node-badge type-d">Type D (Short Gut Syndrome)</div>
            <div class="node-desc">Colonic bacterial carbohydrate fermentation. <i>Standard lab assays measure L-lactate and will miss D-lactate!</i></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderGoldmarkMatrix(){
    return `
      <div class="goldmark-card">
        <div class="subhead" style="margin-top:0;">Interactive GOLDMARK Differential Matrix</div>
        <div class="goldmark-grid">
          ${GOLDMARK_ITEMS.map(item => `
            <div class="gm-item" onclick="this.classList.toggle('open')">
              <span class="gm-letter">${item.letter}</span>
              <div class="gm-content">
                <div class="gm-title">${item.title}</div>
                <div class="gm-detail">${item.detail}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderTutorStepper(r, d){
    const steps = r.steps || [];
    return `
      <div class="tutor-stepper-wrap" id="tutorStepperContainer">
        <div class="tutor-header">
          <div class="tutor-title">💡 Interactive Thinking Assistant & Step-by-Step Guide</div>
          <div class="tutor-sub">Walk through the clinical reasoning step-by-step:</div>
        </div>
        <div class="tutor-nav">
          ${steps.map((_, idx) => `
            <button type="button" class="tutor-step-btn ${idx === activeStepIndex ? 'active' : ''}" onclick="ABG.Tutor.setStep(${idx})">
              Step ${idx + 1}
            </button>
          `).join('')}
        </div>
        <div class="tutor-card">
          ${steps[activeStepIndex] ? `
            <div class="tutor-step-title">Step ${activeStepIndex + 1} · ${steps[activeStepIndex].h}</div>
            <div class="tutor-step-body">${steps[activeStepIndex].b}</div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function setStep(idx){
    activeStepIndex = idx;
    if(!currentAnalysis || !currentAnalysis.r || !currentAnalysis.r.steps) return;
    const wrap = document.getElementById('tutorStepperContainer');
    if(!wrap) return;

    const btns = wrap.querySelectorAll('.tutor-step-btn');
    btns.forEach((btn, i) => {
      if(i === idx) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    const card = wrap.querySelector('.tutor-card');
    const step = currentAnalysis.r.steps[idx];
    if(card && step){
      card.innerHTML = `
        <div class="tutor-step-title">Step ${idx + 1} · ${step.h}</div>
        <div class="tutor-step-body">${step.b}</div>
      `;
    }
  }

  function renderPresetPicker(){
    const box = document.getElementById('presetCaseContainer');
    if(!box) return;
    const chev = `<svg class="chev" viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    box.innerHTML = `
      <div class="card">
        <button type="button" class="card-summary" data-collapse="presetCasesCard" aria-expanded="false">
          <span>🧪 Real-World Clinical Preset Cases <em>Load a worked teaching example</em></span>
          ${chev}
        </button>
        <div class="card-body collapsible" id="presetCasesCard">
          <div class="preset-case-list">
            ${Object.entries(PRESETS).map(([key, p]) => `
              <button type="button" class="preset-case-item" onclick="ABG.Tutor.loadPreset('${key}')">
                <span class="preset-case-title">${p.title}</span>
                <span class="preset-case-desc">${p.description}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function attachUI(){
    const main = document.querySelector('main');
    if(!main) return;

    // Add containers for gauges and tutor views
    const outDiv = document.getElementById('out');
    if(outDiv){
      const tutorBox = document.createElement('div');
      tutorBox.id = 'tutorContainer';
      outDiv.parentNode.insertBefore(tutorBox, outDiv.nextSibling);
    }

    renderPresetPicker();
  }

  function updateTutorView(r, d){
    currentAnalysis = { r, d };
    activeStepIndex = 0;
    const box = document.getElementById('tutorContainer');
    if(!box) return;

    let html = renderGauges(r, d);
    html += renderTutorStepper(r, d);

    if(d.lactate != null && d.lactate > 2.0){
      html += renderLacticClassifier(d.lactate);
    }

    // Match the engine's verdict. Showing the GOLDMARK high-AG differential off a >12 cutoff
    // put a high-AG workup on screen while the diagnosis header read "Normal-anion-gap".
    if(r.agState === 'high' || r.agState === 'borderline'){
      html += renderGoldmarkMatrix();
    }

    box.innerHTML = html;
  }

  return {
    init: attachUI,
    loadPreset,
    setStep,
    updateTutorView
  };
})();
