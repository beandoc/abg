window.ABG = window.ABG || {};

ABG.Patient = (function(){
  'use strict';

  let current = { name: '', id: '', bed: '', age: null, sex: '' };

  function set(fields){ current = Object.assign({}, current, fields); }
  function get(){ return Object.assign({}, current); }

  function summaryLabel(){
    const parts = [];
    if(current.name) parts.push(current.name);
    if(current.id) parts.push(`MRN ${current.id}`);
    if(current.bed) parts.push(`Bed ${current.bed}`);
    if(current.age!=null) parts.push(`${current.age}y`);
    if(current.sex) parts.push(current.sex);
    return parts.length ? parts.join(' · ') : 'Unidentified patient';
  }

  return { get, set, summaryLabel };
})();
