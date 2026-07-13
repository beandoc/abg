window.ABG = window.ABG || {};

ABG.Davenport = (function(){
  'use strict';

  const hhPH   = (pco2, hco3) => 6.1 + Math.log10(hco3 / (0.03 * pco2));
  const hhHCO3 = (ph, pco2)   => 0.03 * pco2 * Math.pow(10, ph - 6.1);
  const hhPCO2 = (ph, hco3)   => hco3 / (0.03 * Math.pow(10, ph - 6.1));

  const XDOM = [7.00, 7.80];
  const YDOM = [0, 60];
  const BUFFER_SLOPE = -34.5; // approx whole-blood non-bicarbonate buffer line, Hb 15 g/dL assumed

  let svg, gRegions, gIsobars, gBuffer, gTrend, gPatient, gAxes, overlay, tooltip, legendEl;
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
      ? { bg:'#0f1a22', bg2:'#0c161d', grid:'rgba(220,230,235,.14)', axis:'#a9bac3', text:'#e7edf0',
          normalFill:'rgba(90,195,150,.20)', normalLine:'rgba(130,220,180,.75)',
          isobar:'rgba(205,218,227,.42)', isobarLbl:'rgba(215,226,233,.8)', buffer:'rgba(238,196,96,.85)',
          trendLine:'rgba(238,196,96,.9)', patient:'#f0808f', patientRing:'#0f1a22',
          shadow:'rgba(0,0,0,.55)', cardBorder:'rgba(220,230,235,.12)' }
      : { bg:'#ffffff', bg2:'#fbfdfe', grid:'#e9eff2', axis:'#4c5c68', text:'#16232e',
          normalFill:'rgba(47,107,79,.12)', normalLine:'rgba(47,107,79,.6)',
          isobar:'rgba(120,135,145,.45)', isobarLbl:'rgba(91,107,120,.9)', buffer:'rgba(150,100,0,.75)',
          trendLine:'rgba(150,100,0,.85)', patient:'#b23a48', patientRing:'#ffffff',
          shadow:'rgba(22,35,46,.18)', cardBorder:'rgba(22,35,46,.08)' };
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
      <div class="dv-card">
        <div class="dv-toolbar">
          <div class="dv-toolbar-group">
            <button type="button" class="dv-btn" data-act="zoomIn" title="Zoom in" aria-label="Zoom in">＋</button>
            <button type="button" class="dv-btn" data-act="zoomOut" title="Zoom out" aria-label="Zoom out">－</button>
            <button type="button" class="dv-btn" data-act="reset" title="Reset view" aria-label="Reset view">⤾</button>
          </div>
          <div class="dv-toolbar-group">
            <button type="button" class="dv-btn" data-act="dark" title="Toggle dark mode" aria-label="Toggle dark mode">🌓</button>
            <button type="button" class="dv-btn" data-act="svg" title="Export SVG" aria-label="Export SVG">⭳ SVG</button>
          </div>
        </div>
        <div class="dv-wrap"><svg></svg><div class="dv-tooltip" style="display:none;"></div></div>
        <div class="dv-legend"></div>
      </div>`;
    if(!document.getElementById('dv-style')){
      const style = document.createElement('style');
      style.id = 'dv-style';
      style.textContent = `
        .dv-card{background:var(--paper,#fff); border:1px solid var(--line,#dbe3e8); border-radius:12px;
          padding:14px 14px 12px; box-shadow:0 1px 2px rgba(20,40,60,.04), 0 8px 24px rgba(20,40,60,.06);}
        .dv-toolbar{display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;}
        .dv-toolbar-group{display:flex; gap:3px; background:rgba(120,140,150,.08); padding:3px; border-radius:8px;}
        .dv-btn{padding:5px 10px; font-size:.8rem; border:none; border-radius:6px; background:transparent;
          color:var(--muted,#5b6b78); cursor:pointer; transition:background .15s,color .15s; line-height:1.3;}
        .dv-btn:hover{background:var(--paper,#fff); color:var(--accent-dk,#084d66); box-shadow:0 1px 3px rgba(20,40,60,.12);}
        .dv-btn:active{transform:translateY(1px);}
        .dv-wrap{position:relative; width:100%; height:420px;}
        .dv-wrap svg{width:100%; height:100%; border-radius:8px; display:block;}
        .dv-tooltip{position:absolute; pointer-events:none; background:rgba(15,23,30,.94); color:#fff;
          font-size:.78rem; line-height:1.4; padding:7px 10px; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,.25);
          transform:translate(-50%,-118%); white-space:nowrap; z-index:5;}
        .dv-legend{display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:12px; padding-top:11px;
          border-top:1px solid var(--line,#e3ebef);}
        .dv-legend-item{display:flex; align-items:center; gap:6px; font-size:.76rem; color:var(--muted,#5b6b78);}
        .dv-legend-swatch{width:13px; height:13px; border-radius:3px; flex:none; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);}
        .dv-legend-line{width:16px; height:0; border-top-width:2px; border-top-style:solid; flex:none;}
        .dv-legend-dot{width:9px; height:9px; border-radius:50%; flex:none; box-shadow:0 0 0 1.5px rgba(0,0,0,.1);}
      `;
      document.head.appendChild(style);
    }

    svg = d3.select(containerEl).select('svg');
    tooltip = d3.select(containerEl).select('.dv-tooltip');
    legendEl = containerEl.querySelector('.dv-legend');

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
    height = 420 - margin.top - margin.bottom;
    const pal = palette();

    svg.attr('viewBox', `0 0 ${width+margin.left+margin.right} ${height+margin.top+margin.bottom}`)
       .style('background', pal.bg)
       .style('font-family', 'inherit');
    svg.selectAll('*').remove();

    x = d3.scaleLinear().domain(XDOM).range([0, width]);
    y = d3.scaleLinear().domain(YDOM).range([height, 0]);

    const defs = svg.append('defs');
    const bgGrad = defs.append('linearGradient').attr('id','dv-bg-grad').attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    bgGrad.append('stop').attr('offset','0%').attr('stop-color', pal.bg2);
    bgGrad.append('stop').attr('offset','100%').attr('stop-color', pal.bg);
    const shadow = defs.append('filter').attr('id','dv-shadow').attr('x','-60%').attr('y','-60%').attr('width','220%').attr('height','220%');
    shadow.append('feDropShadow').attr('dx',0).attr('dy',1).attr('stdDeviation',1.6).attr('flood-color', pal.shadow).attr('flood-opacity',1);
    const lineShadow = defs.append('filter').attr('id','dv-line-shadow').attr('x','-20%').attr('y','-20%').attr('width','140%').attr('height','140%');
    lineShadow.append('feDropShadow').attr('dx',0).attr('dy',0.75).attr('stdDeviation',0.9).attr('flood-color', pal.shadow).attr('flood-opacity',.7);
    const clip = defs.append('clipPath').attr('id','dv-clip');
    clip.append('rect').attr('width', width).attr('height', height).attr('rx', 9);

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    root.append('rect').attr('class','dv-bg').attr('width', width).attr('height', height).attr('rx', 9)
      .attr('fill', 'url(#dv-bg-grad)').attr('stroke', pal.cardBorder);

    // Axes/gridlines stay UNCLIPPED so tick labels (which sit just outside the plot
    // rect) aren't cropped; only the data layers below are clipped to the rounded rect.
    gAxes = root.append('g');

    const clipped = root.append('g').attr('clip-path', 'url(#dv-clip)');

    // Overlay sits BELOW the interactive shapes (regions/markers) in paint order,
    // so those get hover priority; the overlay only catches hover over blank chart area.
    overlay = clipped.append('rect').attr('width', width).attr('height', height)
      .attr('fill', 'transparent').style('cursor','crosshair');
    overlay.on('mousemove', onHover).on('mouseleave', ()=> tooltip.style('display','none'));

    gRegions = clipped.append('g').attr('class','dv-regions');
    gIsobars = clipped.append('g').attr('class','dv-isobars');
    gBuffer  = clipped.append('g').attr('class','dv-buffer');
    gTrend   = clipped.append('g').attr('class','dv-trend');
    gPatient = clipped.append('g').attr('class','dv-patient');

    root.append('text').attr('x', width/2).attr('y', height+38).attr('text-anchor','middle')
      .attr('fill', pal.axis).attr('font-size',12.5).attr('font-weight',700)
      .style('letter-spacing','.02em').text('Arterial blood pH');
    root.append('text').attr('transform',`translate(${-38},${height/2}) rotate(-90)`).attr('text-anchor','middle')
      .attr('fill', pal.axis).attr('font-size',12.5).attr('font-weight',700)
      .style('letter-spacing','.02em').text('Plasma HCO₃⁻ (mEq/L)');

    zoomBehavior = d3.zoom().scaleExtent([1, 8])
      .translateExtent([[0,0],[width,height]])
      .extent([[0,0],[width,height]])
      .on('zoom', (ev)=> redraw(ev.transform.rescaleX(x), ev.transform.rescaleY(y)));
    svg.call(zoomBehavior);

    buildLegend(pal);
    redraw(x, y);
  }

  function haloText(sel, pal){
    sel.attr('paint-order','stroke').attr('stroke', pal.bg).attr('stroke-width', 3)
       .attr('stroke-linejoin','round').style('pointer-events','none');
  }

  function redraw(zx, zy){
    const pal = palette();

    const xAxis = d3.axisBottom(zx).ticks(9).tickFormat(d3.format('.2f'));
    const yAxis = d3.axisLeft(zy).ticks(8);
    gAxes.selectAll('*').remove();
    const gx = gAxes.append('g').attr('transform', `translate(0,${height})`).call(xAxis);
    const gy = gAxes.append('g').call(yAxis);
    [gx,gy].forEach(g=>{
      g.selectAll('text').attr('fill', pal.axis).attr('font-size', 11).style('font-variant-numeric','tabular-nums');
      g.selectAll('line').attr('stroke', pal.grid);
      g.select('.domain').attr('stroke', pal.grid);
    });
    gAxes.append('g').selectAll('grid-x').data(zx.ticks(9)).enter().append('line')
      .attr('x1', d=>zx(d)).attr('x2', d=>zx(d)).attr('y1',0).attr('y2',height)
      .attr('stroke', pal.grid).attr('stroke-width', 1);
    gAxes.append('g').selectAll('grid-y').data(zy.ticks(8)).enter().append('line')
      .attr('y1', d=>zy(d)).attr('y2', d=>zy(d)).attr('x1',0).attr('x2',width)
      .attr('stroke', pal.grid).attr('stroke-width', 1);

    const lineGen = d3.line().x(p=>zx(p[0])).y(p=>zy(p[1]));
    const lineSmooth = d3.line().x(p=>zx(p[0])).y(p=>zy(p[1])).curve(d3.curveCatmullRomClosed.alpha(0.5));

    gRegions.selectAll('path.region').data(regionPolys, d=>d.id).join('path')
      .attr('class','region')
      .attr('d', d => lineSmooth(d.poly))
      .attr('fill', d=>d.color).attr('stroke', d=>d.line).attr('stroke-width', 1.2)
      .style('cursor','default').style('transition','filter .15s, stroke-width .15s')
      .on('mouseenter', function(ev,d){
        d3.select(this).attr('stroke-width', 2).style('filter','brightness(1.06)');
        tooltip.style('display','block').html(`<b>${d.label}</b>`);
      })
      .on('mousemove', function(ev){ const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(){ d3.select(this).attr('stroke-width', 1.2).style('filter',null); tooltip.style('display','none'); });

    if(normalBox){
      const nb = [[normalBox.phMin,normalBox.hco3Min],[normalBox.phMax,normalBox.hco3Min],
                  [normalBox.phMax,normalBox.hco3Max],[normalBox.phMin,normalBox.hco3Max]];
      gRegions.selectAll('path.normal').data([nb]).join('path')
        .attr('class','normal').attr('d', d=>lineGen(d)+'Z')
        .attr('fill', pal.normalFill).attr('stroke', pal.normalLine).attr('stroke-width', 1.6)
        .attr('rx', 3);
      gRegions.selectAll('text.normal-lbl').data([1]).join('text').attr('class','normal-lbl')
        .attr('x', zx((normalBox.phMin+normalBox.phMax)/2)).attr('y', zy((normalBox.hco3Min+normalBox.hco3Max)/2)+4)
        .attr('text-anchor','middle').attr('font-size',10.5).attr('font-weight',700).attr('fill', pal.normalLine)
        .text('Normal').call(haloText, pal);
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
      .attr('fill','none').attr('stroke', pal.isobar).attr('stroke-width',1.1).attr('stroke-dasharray','1,4')
      .attr('stroke-linecap','round');
    gIsobars.selectAll('text.isobar-lbl').data(isobarPaths, d=>d.p).join('text')
      .attr('class','isobar-lbl')
      .attr('x', d=> d.pts.length ? zx(d.pts[d.pts.length-1][0]) : -100)
      .attr('y', d=> d.pts.length ? zy(d.pts[d.pts.length-1][1])-5 : -100)
      .attr('font-size',9.5).attr('font-weight',600).attr('fill', pal.isobarLbl)
      .text(d=>`${d.p}`).call(haloText, pal);
    gIsobars.selectAll('text.isobar-title').data(isobarPaths.length ? [1] : []).join('text')
      .attr('class','isobar-title')
      .attr('x', width-4).attr('y', 12).attr('text-anchor','end')
      .attr('font-size',9).attr('font-style','italic').attr('fill', pal.isobarLbl)
      .text('pCO₂ isobars (mmHg)').call(haloText, pal);

    const anchor = lastPatient ? [lastPatient.ph, lastPatient.hco3] : [7.40, 24];
    const bufferPts=[];
    for(let ph=XDOM[0]; ph<=XDOM[1]; ph+=0.02){
      const hco3 = anchor[1] + BUFFER_SLOPE*(ph-anchor[0]);
      if(hco3>=YDOM[0] && hco3<=YDOM[1]) bufferPts.push([ph,hco3]);
    }
    gBuffer.selectAll('path.buffer').data([bufferPts]).join('path')
      .attr('class','buffer').attr('d', d=>lineGen(d))
      .attr('fill','none').attr('stroke', pal.buffer).attr('stroke-width',1.8).attr('stroke-linecap','round')
      .on('mouseenter', ()=> tooltip.style('display','block').html('Blood buffer line <small>(approx., Hb 15 g/dL assumed)</small>'))
      .on('mousemove', function(ev){ const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', ()=> tooltip.style('display','none'));
    gBuffer.selectAll('text.buffer-lbl').data(bufferPts.length ? [bufferPts[0]] : []).join('text')
      .attr('class','buffer-lbl')
      .attr('x', d=>zx(d[0])+6).attr('y', d=>zy(d[1])-4)
      .attr('font-size',9.5).attr('font-style','italic').attr('fill', pal.buffer)
      .text('Buffer line').call(haloText, pal);

    if(lastSeries.length>1){
      gTrend.selectAll('path.trendline').data([lastSeries]).join('path')
        .attr('class','trendline').attr('d', d=>lineGen(d.map(s=>[s.ph,s.hco3])))
        .attr('fill','none').attr('stroke', pal.trendLine).attr('stroke-width',1.8).attr('stroke-dasharray','5,3')
        .attr('stroke-linecap','round');
    } else {
      gTrend.selectAll('path.trendline').remove();
    }
    gTrend.selectAll('circle.trendpt').data(lastSeries).join('circle')
      .attr('class','trendpt').attr('r',5)
      .attr('cx', d=>zx(d.ph)).attr('cy', d=>zy(d.hco3))
      .attr('fill', pal.trendLine).attr('stroke', pal.bg).attr('stroke-width',1.75)
      .style('filter','url(#dv-line-shadow)')
      .on('mouseenter', function(ev,d){ ev.stopPropagation(); d3.select(this).attr('r',6.5); tooltip.style('display','block')
          .html(`<b>${d.t ? d.t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br>${d.dx||''}`); })
      .on('mousemove', function(ev){ ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(ev){ ev.stopPropagation(); d3.select(this).attr('r',5); tooltip.style('display','none'); });

    gPatient.selectAll('text.patient-lbl').data(lastPatient ? [lastPatient] : []).join('text')
      .attr('class','patient-lbl')
      .attr('x', d=>zx(d.ph)).attr('y', d=>zy(d.hco3)-13)
      .attr('text-anchor','middle').attr('font-size',10.5).attr('font-weight',700).attr('fill', pal.patient)
      .text('Current').call(haloText, pal);
    gPatient.selectAll('circle.patientpt').data(lastPatient ? [lastPatient] : []).join('circle')
      .attr('class','patientpt').attr('r',7.5)
      .attr('cx', d=>zx(d.ph)).attr('cy', d=>zy(d.hco3))
      .attr('fill', pal.patient).attr('stroke', pal.patientRing).attr('stroke-width',2.25)
      .style('filter','url(#dv-shadow)')
      .on('mouseenter', function(ev,d){ ev.stopPropagation(); d3.select(this).attr('r',9); tooltip.style('display','block')
          .html(`<b>Current</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br>${d.integrated||''}`); })
      .on('mousemove', function(ev){ ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
      .on('mouseleave', function(ev){ ev.stopPropagation(); tooltip.style('display','none'); });
  }

  function buildLegend(pal){
    if(!legendEl) return;
    const acidFill = 'rgba(178,58,72,0.14)', acidLine = 'rgba(178,58,72,0.55)';
    const alkFill  = 'rgba(47,107,79,0.14)',  alkLine  = 'rgba(47,107,79,0.55)';
    const items = [
      { type:'swatch', fill:acidFill, line:acidLine, label:'Acidosis bands' },
      { type:'swatch', fill:alkFill,  line:alkLine,  label:'Alkalosis bands' },
      { type:'swatch', fill:pal.normalFill, line:pal.normalLine, label:'Normal' },
      { type:'dash',  color:pal.isobar,   label:'pCO₂ isobars' },
      { type:'line',  color:pal.buffer,   label:'Buffer line' },
      { type:'dot',   color:pal.patient,  label:'Current gas' },
      { type:'dashline', color:pal.trendLine, label:'Serial trend' }
    ];
    legendEl.textContent = '';
    items.forEach(it=>{
      const wrap = document.createElement('span');
      wrap.className = 'dv-legend-item';
      const key = document.createElement('span');
      if(it.type==='swatch'){ key.className='dv-legend-swatch'; key.style.background=it.fill; key.style.boxShadow=`inset 0 0 0 1.5px ${it.line}`; }
      else if(it.type==='dot'){ key.className='dv-legend-dot'; key.style.background=it.color; }
      else if(it.type==='dash'){ key.className='dv-legend-line'; key.style.borderTopColor=it.color; key.style.borderTopStyle='dotted'; }
      else if(it.type==='dashline'){ key.className='dv-legend-line'; key.style.borderTopColor=it.color; key.style.borderTopStyle='dashed'; }
      else { key.className='dv-legend-line'; key.style.borderTopColor=it.color; }
      const txt = document.createElement('span');
      txt.textContent = it.label;
      wrap.appendChild(key); wrap.appendChild(txt);
      legendEl.appendChild(wrap);
    });
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
