window.ABG = window.ABG || {};

ABG.PatientVault = (function(){
  'use strict';

  const STORAGE_KEY = 'abg_nephro_patient_cases';

  function getAllCases(){
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch(e) {
      console.error('Failed to load patient cases', e);
      return [];
    }
  }

  function saveAllCases(cases){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    } catch(e) {
      console.error('Failed to save patient cases', e);
    }
  }

  function saveCurrentCase(patientInfo, trendLogs, currentForm){
    const cases = getAllCases();
    const caseId = patientInfo.id || patientInfo.name ? `case_${(patientInfo.id || patientInfo.name).toLowerCase().replace(/[^a-z0-9]/g, '_')}` : `case_${Date.now()}`;

    const existingIdx = cases.findIndex(c => c.id === caseId);
    const caseRecord = {
      id: caseId,
      patient: patientInfo,
      logs: trendLogs.map(l => ({ ...l, t: l.t instanceof Date ? l.t.toISOString() : l.t })),
      form: currentForm,
      updatedAt: new Date().toISOString()
    };

    if(existingIdx >= 0){
      cases[existingIdx] = caseRecord;
    } else {
      cases.unshift(caseRecord);
    }

    saveAllCases(cases);
    return caseRecord;
  }

  function loadCase(caseId){
    const cases = getAllCases();
    const found = cases.find(c => c.id === caseId);
    if(!found) return null;

    return {
      ...found,
      logs: found.logs.map(l => ({ ...l, t: new Date(l.t) }))
    };
  }

  function deleteCase(caseId){
    let cases = getAllCases();
    cases = cases.filter(c => c.id !== caseId);
    saveAllCases(cases);
  }

  function renderVaultModal(container, onSelectCase, onDeleteCase){
    const cases = getAllCases();
    if(!cases.length){
      container.innerHTML = `<div class="vault-empty"><p class="placeholder">No saved patient records found. Fill patient details and tap “Save Record”.</p></div>`;
      return;
    }

    const items = cases.map(c => {
      const p = c.patient || {};
      const name = p.name || 'Unidentified Patient';
      const mrn = p.id ? `MRN ${p.id}` : '';
      const bed = p.bed ? `Bed ${p.bed}` : '';
      const meta = [mrn, bed, `${c.logs.length} logged ABGs`].filter(Boolean).join(' · ');
      const dateStr = new Date(c.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      return `
        <div class="vault-item" data-case-id="${c.id}">
          <div class="vault-item-info">
            <div class="vault-item-title">${name}</div>
            <div class="vault-item-meta">${meta}</div>
            <div class="vault-item-date">Last updated: ${dateStr}</div>
          </div>
          <div class="vault-item-actions">
            <button type="button" class="btn btn-secondary btn-sm load-case-btn" data-id="${c.id}">Load</button>
            <button type="button" class="btn btn-ghost btn-sm del-case-btn" data-id="${c.id}">✕</button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="vault-list">${items}</div>`;

    container.querySelectorAll('.load-case-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if(onSelectCase) onSelectCase(id);
      });
    });

    container.querySelectorAll('.del-case-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        deleteCase(id);
        renderVaultModal(container, onSelectCase, onDeleteCase);
        if(onDeleteCase) onDeleteCase(id);
      });
    });
  }

  return {
    getAllCases,
    saveCurrentCase,
    loadCase,
    deleteCase,
    renderVaultModal
  };
})();
