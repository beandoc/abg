window.ABG = window.ABG || {};

ABG.Export = (function(){
  'use strict';

  function downloadBlob(content, filename, mime){
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTrendCSV(log){
    if(!log.length) return;
    const header = ['#','Time','pH','pCO2','HCO3','AG','Lactate','Interpretation'];
    const rows = log.map((g,i)=>[
      i+1,
      g.t.toLocaleString(),
      g.ph.toFixed(2),
      g.pco2.toFixed(1),
      g.hco3.toFixed(1),
      g.ag!=null ? g.ag.toFixed(1) : '',
      g.lactate!=null ? g.lactate.toFixed(1) : '',
      `"${(g.dx||'').replace(/"/g,'""')}"`
    ]);
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\n');
    const stamp = log[log.length-1].t.toISOString().slice(0,19).replace(/[:T]/g,'-');
    downloadBlob(csv, `abg-trend-${stamp}.csv`, 'text/csv');
  }

  function downloadSVG(svgEl, filename){
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgEl);
    if(!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)){
      source = source.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    downloadBlob(source, filename, 'image/svg+xml');
  }

  function printReport(){
    window.print();
  }

  return { downloadBlob, downloadTrendCSV, downloadSVG, printReport };
})();
