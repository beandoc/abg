window.ABG = window.ABG || {};

ABG.Davenport = (function(){
  'use strict';

  const hhPH   = (pco2, hco3) => 6.1 + Math.log10(hco3 / (0.03 * pco2));
  const hhHCO3 = (ph, pco2)   => 0.03 * pco2 * Math.pow(10, ph - 6.1);
  const hhPCO2 = (ph, hco3)   => hco3 / (0.03 * Math.pow(10, ph - 6.1));

  const XDOM = [7.00, 7.80];
  const YDOM = [0, 60];
  const BUFFER_SLOPE = -34.5; // approx whole-blood non-bicarbonate buffer line, Hb 15 g/dL assumed

  let svg, gRegions, gIsobars, gBuffer, gTrend, gPatient, gAxes, overlay, tooltip;
  let x, y, zoomBehavior;
  let width = 0, height = 0;
  const margin = {top: 28, right: 54, bottom: 42, left: 52};
  let regionDefs = null, normalBox = null, isobarList = [];
  let regionPolys = [];
  let dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  let lastPatient = null, lastSeries = [];
  let containerEl = null;

  function palette(){
    return dark
      ? { bg:'#0f1a22', grid:'rgba(220,230,235,.18)', axis:'#c7d3da', text:'#e7edf0',
          normalFill:'rgba(80,180,140,.18)', normalLine:'rgba(120,210,170,.65)',
          isobar:'rgba(200,215,225,.35)', buffer:'rgba(230,190,90,.75)',
          trendLine:'rgba(230,190,90,.85)', patient:'#ef6a7a' }
      : { bg:'#ffffff', grid:'#e3ebef', axis:'#5b6b78', text:'#16232e',
          normalFill:'rgba(47,107,79,.10)', normalLine:'rgba(47,107,79,.55)',
          isobar:'rgba(120,135,145,.5)', buffer:'rgba(138,90,0,.7)',
          trendLine:'rgba(138,90,0,.8)', patient:'#b23a48' };
  }

  function pointInPolygon(pt, poly){
    let inside = false;
    for(let i=0, j=poly.length-1; i<poly.length; j=i++){
      const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
      const intersect = ((yi>pt[1]) !== (yj>pt[1])) &&
        (pt[0] < (xj-xi) * (pt[1]-yi) / (yj-yi) + xi);
      if(intersect) inside = !inside;
    }
    return inside;
  }

  function buildRegionPoly(region){
    const N = 48;
    const [d0,d1] = region.domain;
    const upper = [], lower = [];
    if(region.axis === 'hco3'){
      for(let i=0;i<=N;i++){
        const hco3 = d0 + (d1-d0)*i/N;
        const mid = region.slope*hco3 + region.intercept;
        const pcoA = Math.max(1, mid - region.tolerance);
        const pcoB = mid + region.tolerance;
        upper.push([hhPH(pcoA, hco3), hco3]);
        lower.push([hhPH(pcoB, hco3), hco3]);
      }
    } else {
      for(let i=0;i<=N;i++){
        const pco2 = d0 + (d1-d0)*i/N;
        const mid = region.slope*pco2 + region.intercept;
        const hcoA = mid + region.tolerance;
        const hcoB = Math.max(1, mid - region.tolerance);
        upper.push([hhPH(pco2, hcoA), hcoA]);
        lower.push([hhPH(pco2, hcoB), hcoB]);
      }
    }
    return upper.concat(lower.reverse());
  }

  function classify(ph, hco3, pco2){
    if(normalBox && ph>=normalBox.phMin && ph<=normalBox.phMax && hco3>=normalBox.hco3Min && hco3<=normalBox.hco3Max){
      return 'Normal';
    }
    for(const r of regionPolys){
      if(pointInPolygon([ph,hco3], r.poly)) return r.label;
    }
    return 'Outside charted compensation bands';
  }

  async function loadRegions(){
    if(regionDefs) return;
    const res = await fetch('assets/davenportRegions.json');
    const json = await res.json();
    regionDefs = json.regions;
    normalBox = json.normalBox;
    isobarList = json.isobars;
    regionPolys = regionDefs.map(r => ({ id:r.id, label:r.label, color:r.color, line:r.line, poly: buildRegionPoly(r) }));
  }

  function init(containerSelector){
    containerEl = document.querySelector(containerSelector);
    containerEl.innerHTML = `
      <div class="dv-toolbar">
        <button type="button" class="exp" data-act="zoomIn" title="Zoom in">＋</button>
        <button type="button" class="exp" data-act="zoomOut" title="Zoom out">－</button>
        <button type="button" class="exp" data-act="reset" title="Reset view">⤾</button>
        <button type="button" class="exp" data-act="dark" title="Toggle dark mode">🌓</button>
        <button type="button" class="exp" data-act="svg" title="Export SVG">⭳ SVG</button>
      </div>
      <div class="dv-wrap"><svg></svg><div class="dv-tooltip" style="display:none;"></div></div>`;
    if(!document.getElementById('dv-style')){
      const style = document.createElement('style');
      style.id = 'dv-style';
      style.textContent = `
        .dv-toolbar{display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;}
        .dv-toolbar button{padding:5px 10px; font-size:.82rem;}
        .dv-wrap{position:relative; width:100%; height:400px;}
        .dv-wrap svg{width:100%; height:100%; border-radius:6px;}
        .dv-tooltip{position:absolute; pointer-events:none; background:rgba(20,30,38,.92); color:#fff;
          font-size:.78rem; padding:6px 9px; border-radius:5px; transform:translate(-50%,-115%); white-space:nowrap; z-index:5;}
      `;
      document.head.appendChild(style);
    }

    svg = d3.select(containerEl).select('svg');
    tooltip = d3.select(containerEl).select('.dv-tooltip');

    containerEl.querySelectorAll('.dv-toolbar button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const act = btn.dataset.act;
        if(act==='dark'){ dark = !dark; renderStatic(); redraw(x,y); }
        else if(act==='svg'){ ABG.Export.downloadSVG(svg.node(), 'davenport-diagram.svg'); }
        else if(act==='reset'){ svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity); }
        else if(act==='zoomIn'){ svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.4); }
        else if(act==='zoomOut'){ svg.transition().duration(200).call(zoomBehavior.scaleBy, 1/1.4); }
      });
    });

    window.addEventListener('resize', ()=>{ if(regionDefs){ renderStatic(); redraw(x,y); } });

    return loadRegions().then(()=>{ renderStatic(); });
  }

  function renderStatic(){
    const rect = containerEl.querySelector('.dv-wrap').getBoundingClientRect();
    width = Math.max(320, rect.width) - margin.left - margin.right;
    height = 400 - margin.top - margin.bottom;
    const pal = palette();

    svg.attr('viewBox', `0 0 ${width+margin.left+margin.right} ${height+margin.top+margin.bottom}`)
       .style('background', pal.bg)
       .style('font-family', 'inherit');
    svg.selectAll('*').remove();

    x = d3.scaleLinear().domain(XDOM).range([0, width]);
    y = d3.scaleLinear().domain(YDOM).range([height, 0]);

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    root.append('rect').attr('class','dv-bg').attr('width', width).attr('height', height)
      .attr('fill', pal.bg).attr('stroke', pal.grid);

    gAxes = root.append('g');

    // Overlay sits BELOW the interactive shapes (regions/markers) in paint order,
    // so those get hover priority; the overlay only catches hover over blank chart area.
    overlay = root.append('rect').attr('width', width).attr('height', height)
      .attr('fill', 'transparent').style('cursor','crosshair');
    overlay.on('mousemove', onHover).on('mouseleave', ()=> tooltip.style('display','none'));

    gRegions = root.append('g').attr('class','dv-regions');
    gIsobars = root.append('g').attr('class','dv-isobars');
    gBuffer  = root.append('g').attr('class','dv-buffer');
    gTrend   = root.append('g').attr('class','dv-trend');
    gPatient = root.append('g').attr('class','dv-patient');

    root.append('text').attr('x', width/2).attr('y', height+38).attr('text-anchor','middle')
      .attr('fill', pal.axis).attr('font-size',13).attr('font-weight',700).text('Arterial blood pH');
    root.append('text').attr('transform',`translate(${-38},${height/2}) rotate(-90)`).attr('text-anchor','middle')
      .attr('fill', pal.axis).attr('font-size',13).attr('font-weight',700).text('Plasma HCO₃⁻ (mEq/L)');

    zoomBehavior = d3.zoom().scaleExtent([1, 8])
      .translateExtent([[0,0],[width,height]])
      .extent([[0,0],[width,height]])
      .on('zoom', (ev)=> redraw(ev.transform.rescaleX(x), ev.transform.rescaleY(y)));
    svg.call(zoomBehavior);

    redraw(x, y);
  }

  function redraw(zx, zy){
    const pal = palette();

    const xAxis = d3.axisBottom(zx).ticks(9).tickFormat(d3.format('.2f'));
    const yAxis = d3.axisLeft(zy).ticks(8);
    gAxes.selectAll('*').remove();
    const gx = gAxes.append('g').attr('transform', `translate(0,${height})`).call(xAxis);
    const gy = gAxes.append('g').call(yAxis);
    [gx,gy].forEach(g=>{
      g.selectAll('text').attr('fill', pal.axis).attr('font-size', 11);
      g.selectAll('line').attr('stroke', pal.grid);
      g.select('.domain').attr('stroke', pal.grid);
    });
    gAxes.append('g').selectAll('grid-x').data(zx.ticks(9)).enter().append('line')
      .attr('x1', d=>zx(d)).attr('x2', d=>zx(d)).attr('y1',0).attr('y2',height)
      .attr('stroke', pal.grid).attr('stroke-width', 0.6);
    gAxes.append('g').selectAll('grid-y').data(zy.ticks(8)).enter().append('line')
      .attr('y1', d=>zy(d)).attr('y2', d=>zy(d)).attr('x1',0).attr('x2',width)
      .attr('stroke', pal.grid).attr('stroke-width', 0.6);

    const lineGen = d3.line().x(p=>zx(p[0])).y(p=>zy(p[1]));

    gRegions.selectAll('path.region').data(regionPolys, d=>d.id).join('path')
      .attr('class','region')
      .attr('d', d => lineGen(d.poly) + 'Z')
      .attr('fill', d=>d.color).attr('stroke', d=>d.line).attr('stroke-width', 1.1)
      .style('cursor','default')
      .on('mouseenter', function(ev,d){ tooltip.style('display','block').html(`<b>${d.label}</b>`); })
      .on('mousemove', function(ev){ const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(){ tooltip.style('display','none'); });

    if(normalBox){
      const nb = [[normalBox.phMin,normalBox.hco3Min],[normalBox.phMax,normalBox.hco3Min],
                  [normalBox.phMax,normalBox.hco3Max],[normalBox.phMin,normalBox.hco3Max]];
      gRegions.selectAll('path.normal').data([nb]).join('path')
        .attr('class','normal').attr('d', d=>lineGen(d)+'Z')
        .attr('fill', pal.normalFill).attr('stroke', pal.normalLine).attr('stroke-width', 1.4);
      gRegions.selectAll('text.normal-lbl').data([1]).join('text').attr('class','normal-lbl')
        .attr('x', zx((normalBox.phMin+normalBox.phMax)/2)).attr('y', zy((normalBox.hco3Min+normalBox.hco3Max)/2)+4)
        .attr('text-anchor','middle').attr('font-size',10).attr('font-weight',700).attr('fill', pal.normalLine).text('Normal');
    }

    const isobarPaths = isobarList.map(p=>{
      const pts=[];
      for(let ph=XDOM[0]; ph<=XDOM[1]; ph+=0.01){
        const hco3 = hhHCO3(ph,p);
        if(hco3>=YDOM[0] && hco3<=YDOM[1]) pts.push([ph,hco3]);
      }
      return {p, pts};
    });
    gIsobars.selectAll('path.isobar').data(isobarPaths, d=>d.p).join('path')
      .attr('class','isobar').attr('d', d=>lineGen(d.pts))
      .attr('fill','none').attr('stroke', pal.isobar).attr('stroke-width',1).attr('stroke-dasharray','4,4');
    gIsobars.selectAll('text.isobar-lbl').data(isobarPaths, d=>d.p).join('text')
      .attr('class','isobar-lbl')
      .attr('x', d=> d.pts.length ? zx(d.pts[d.pts.length-1][0]) : -100)
      .attr('y', d=> d.pts.length ? zy(d.pts[d.pts.length-1][1])-4 : -100)
      .attr('font-size',9).attr('fill', pal.isobar).text(d=>d.p);

    const anchor = lastPatient ? [lastPatient.ph, lastPatient.hco3] : [7.40, 24];
    const bufferPts=[];
    for(let ph=XDOM[0]; ph<=XDOM[1]; ph+=0.02){
      const hco3 = anchor[1] + BUFFER_SLOPE*(ph-anchor[0]);
      if(hco3>=YDOM[0] && hco3<=YDOM[1]) bufferPts.push([ph,hco3]);
    }
    gBuffer.selectAll('path.buffer').data([bufferPts]).join('path')
      .attr('class','buffer').attr('d', d=>lineGen(d))
      .attr('fill','none').attr('stroke', pal.buffer).attr('stroke-width',1.6)
      .on('mouseenter', ()=> tooltip.style('display','block').html('Blood buffer line <small>(approx., Hb 15 g/dL assumed)</small>'))
      .on('mousemove', function(ev){ const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', ()=> tooltip.style('display','none'));

    if(lastSeries.length>1){
      gTrend.selectAll('path.trendline').data([lastSeries]).join('path')
        .attr('class','trendline').attr('d', d=>lineGen(d.map(s=>[s.ph,s.hco3])))
        .attr('fill','none').attr('stroke', pal.trendLine).attr('stroke-width',1.6).attr('stroke-dasharray','3,3');
    } else {
      gTrend.selectAll('path.trendline').remove();
    }
    gTrend.selectAll('circle.trendpt').data(lastSeries).join('circle')
      .attr('class','trendpt').attr('r',5)
      .attr('cx', d=>zx(d.ph)).attr('cy', d=>zy(d.hco3))
      .attr('fill', pal.trendLine).attr('stroke', pal.bg).attr('stroke-width',1.5)
      .on('mouseenter', function(ev,d){ ev.stopPropagation(); tooltip.style('display','block')
          .html(`<b>${d.t ? d.t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br>${d.dx||''}`); })
      .on('mousemove', function(ev){ ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(ev){ ev.stopPropagation(); tooltip.style('display','none'); });

    gPatient.selectAll('circle.patientpt').data(lastPatient ? [lastPatient] : []).join('circle')
      .attr('class','patientpt').attr('r',7.5)
      .attr('cx', d=>zx(d.ph)).attr('cy', d=>zy(d.hco3))
      .attr('fill', pal.patient).attr('stroke', pal.bg).attr('stroke-width',2)
      .on('mouseenter', function(ev,d){ ev.stopPropagation(); tooltip.style('display','block')
          .html(`<b>Current</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br>${d.integrated||''}`); })
      .on('mousemove', function(ev){ ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(ev){ ev.stopPropagation(); tooltip.style('display','none'); });
  }

  function onHover(ev){
    const [mx,my] = d3.pointer(ev);
    const ph = x.invert(mx), hco3 = y.invert(my);
    if(ph<XDOM[0]||ph>XDOM[1]||hco3<YDOM[0]||hco3>YDOM[1]){ tooltip.style('display','none'); return; }
    const pco2 = hhPCO2(ph, hco3);
    const label = classify(ph, hco3, pco2);
    const [tx,ty] = d3.pointer(ev, containerEl.querySelector('.dv-wrap'));
    tooltip.style('display','block').style('left', tx+'px').style('top', ty+'px')
      .html(`pH ${ph.toFixed(2)} · HCO₃⁻ ${hco3.toFixed(0)} · pCO₂ ${pco2.toFixed(0)}<br><b>${label}</b>`);
  }

  function draw(patientPoint, series){
    lastPatient = patientPoint;
    lastSeries = series || [];
    if(!regionDefs){ loadRegions().then(()=>{ renderStatic(); }); return; }
    redraw(x, y);
  }

  return { init, draw };
})();
