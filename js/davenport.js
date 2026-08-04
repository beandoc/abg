window.ABG = window.ABG || {};

ABG.Davenport = (function(){
  'use strict';

  const hhPH   = (pco2, hco3) => 6.1 + Math.log10(hco3 / (0.03 * pco2));
  const hhHCO3 = (ph, pco2)   => 0.03 * pco2 * Math.pow(10, ph - 6.1);
  const hhPCO2 = (ph, hco3)   => hco3 / (0.03 * Math.pow(10, ph - 6.1));

  const XDOM = [7.00, 7.80];
  const YDOM = [0, 60];
  const BUFFER_SLOPE = -34.5; // whole-blood non-bicarbonate buffer line (Hb 15 g/dL)

  let svg, gRegions, gIsobars, gBuffer, gTrend, gPatient, gAxes, overlay, tooltip, legendEl;
  let x, y, zoomBehavior;
  let width = 0, height = 0;
  const margin = {top: 28, right: 54, bottom: 42, left: 52};
  let regionDefs = null, normalBox = null, isobarList = [];
  let regionPolys = [];
  let dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  let lastPatient = null, lastSeries = [];
  let containerEl = null;

  // Layer Visibility Controls
  const layers = {
    patient: true,
    isobars: true,
    normal: true,
    buffer: true,
    bands: true
  };

  function palette(){
    return dark
      ? { bg:'#0F172A', bg2:'#090D16', grid:'rgba(255,255,255,.08)', axis:'#94A3B8', text:'#F8FAFC',
          normalFill:'rgba(16, 185, 129, .15)', normalLine:'#10B981', normalGlow:'rgba(16,185,129,.4)',
          isobar:'rgba(148, 163, 184, .35)', isobarLbl:'#CBD5E1', buffer:'rgba(217, 119, 6, .7)',
          trendLine:'#F59E0B', patient:'#10B981', patientPulse:'#34D399', patientRing:'#0F172A',
          shadow:'rgba(0,0,0,.6)', cardBorder:'rgba(255,255,255,.1)' }
      : { bg:'#FFFFFF', bg2:'#F8FAFC', grid:'#E2E8F0', axis:'#64748B', text:'#0F172A',
          normalFill:'rgba(16, 185, 129, .12)', normalLine:'#059669', normalGlow:'rgba(5,150,105,.3)',
          isobar:'rgba(100, 116, 139, .35)', isobarLbl:'#475569', buffer:'rgba(180, 83, 9, .75)',
          trendLine:'#D97706', patient:'#059669', patientPulse:'#10B981', patientRing:'#FFFFFF',
          shadow:'rgba(15,23,42,.12)', cardBorder:'rgba(15,23,42,.08)' };
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

  function isRegionActive(region, patient){
    if(!patient || !patient.integrated) return false;
    const dx = patient.integrated.toLowerCase();
    const rId = region.id.toLowerCase();
    const rLbl = region.label.toLowerCase();

    if(dx.includes('resp') && dx.includes('acid') && (rId.includes('resp_acid') || rLbl.includes('respiratory acidosis'))) return true;
    if(dx.includes('resp') && dx.includes('alk') && (rId.includes('resp_alk') || rLbl.includes('respiratory alkalosis'))) return true;
    if(dx.includes('met') && dx.includes('acid') && (rId.includes('met_acid') || rLbl.includes('metabolic acidosis'))) return true;
    if(dx.includes('met') && dx.includes('alk') && (rId.includes('met_alk') || rLbl.includes('metabolic alkalosis'))) return true;
    return pointInPolygon([patient.ph, patient.hco3], region.poly);
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
          <div class="dv-filter-pills">
            <button type="button" class="dv-pill active" data-layer="patient">● Patient</button>
            <button type="button" class="dv-pill active" data-layer="bands">Zones</button>
            <button type="button" class="dv-pill active" data-layer="normal">Normal</button>
            <button type="button" class="dv-pill active" data-layer="isobars">pCO₂ Isobars</button>
            <button type="button" class="dv-pill active" data-layer="buffer">Buffer Line</button>
          </div>
          <div class="dv-toolbar-right">
            <div class="dv-toolbar-group">
              <button type="button" class="dv-btn" data-act="zoomIn" title="Zoom in">＋</button>
              <button type="button" class="dv-btn" data-act="zoomOut" title="Zoom out">－</button>
              <button type="button" class="dv-btn" data-act="reset" title="Reset view">⤾ Reset</button>
            </div>
            <div class="dv-toolbar-group">
              <button type="button" class="dv-btn" data-act="dark" title="Toggle theme">🌓 Theme</button>
              <button type="button" class="dv-btn" data-act="svg" title="Export SVG">⭳ SVG</button>
            </div>
          </div>
        </div>
        <div class="dv-wrap"><svg></svg><div class="dv-tooltip" style="display:none;"></div></div>
        <div class="dv-legend"></div>
      </div>`;

    if(!document.getElementById('dv-style')){
      const style = document.createElement('style');
      style.id = 'dv-style';
      style.textContent = `
        .dv-card { background: var(--paper, #fff); border: 1px solid var(--line, #e2e8f0); border-radius: 16px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
        .dv-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .dv-filter-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .dv-pill { padding: 4px 10px; font-size: 0.72rem; font-weight: 700; border-radius: 20px; border: 1px solid var(--line, #cbd5e1); background: #f8fafc; color: #64748b; cursor: pointer; transition: all 0.15s ease; }
        .dv-pill.active { background: #059669; color: #ffffff; border-color: #059669; box-shadow: 0 2px 6px rgba(5,150,105,0.25); }
        .dv-toolbar-right { display: flex; gap: 6px; align-items: center; }
        .dv-toolbar-group { display: flex; gap: 2px; background: rgba(100,116,139,0.08); padding: 3px; border-radius: 10px; }
        .dv-btn { padding: 4px 9px; font-size: 0.72rem; font-weight: 700; border: none; border-radius: 8px; background: transparent; color: var(--muted, #64748b); cursor: pointer; transition: background 0.15s, color 0.15s; }
        .dv-btn:hover { background: var(--paper, #fff); color: #059669; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .dv-wrap { position: relative; width: 100%; height: 430px; }
        .dv-wrap svg { width: 100%; height: 100%; border-radius: 12px; display: block; }
        .dv-tooltip { position: absolute; pointer-events: none; background: rgba(15, 23, 42, 0.94); color: #fff; font-size: 0.76rem; line-height: 1.4; padding: 8px 12px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); transform: translate(-50%, -125%); white-space: nowrap; z-index: 10; backdrop-filter: blur(4px); }
        .dv-legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line, #e2e8f0); }
        .dv-legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.76rem; color: var(--muted, #64748b); font-weight: 600; }
        .dv-legend-swatch { width: 14px; height: 14px; border-radius: 4px; flex: none; }
        .dv-legend-line { width: 16px; height: 0; border-top-width: 2px; border-top-style: solid; flex: none; }
        .dv-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(5,150,105,0.2); }
        
        @keyframes dv-pulse {
          0% { r: 7px; opacity: 1; stroke-width: 2.5px; }
          50% { r: 16px; opacity: 0.35; stroke-width: 1.5px; }
          100% { r: 7px; opacity: 1; stroke-width: 2.5px; }
        }
        .dv-pulse-ring { animation: dv-pulse 2s infinite ease-in-out; transform-origin: center; pointer-events: none; }
      `;
      document.head.appendChild(style);
    }

    svg = d3.select(containerEl).select('svg');
    tooltip = d3.select(containerEl).select('.dv-tooltip');
    legendEl = containerEl.querySelector('.dv-legend');

    containerEl.querySelectorAll('.dv-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const layerKey = pill.dataset.layer;
        layers[layerKey] = !layers[layerKey];
        pill.classList.toggle('active', layers[layerKey]);
        if(regionDefs){ renderStatic(); redraw(x,y); }
      });
    });

    containerEl.querySelectorAll('.dv-toolbar button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if(act==='dark'){ dark = !dark; renderStatic(); redraw(x,y); }
        else if(act==='svg'){ ABG.Export.downloadSVG(svg.node(), 'davenport-diagram.svg'); }
        else if(act==='reset'){ svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity); }
        else if(act==='zoomIn'){ svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.4); }
        else if(act==='zoomOut'){ svg.transition().duration(200).call(zoomBehavior.scaleBy, 1/1.4); }
      });
    });

    window.addEventListener('resize', () => { if(regionDefs){ renderStatic(); redraw(x,y); } });

    return loadRegions().then(() => { renderStatic(); });
  }

  function renderStatic(){
    const rect = containerEl.querySelector('.dv-wrap').getBoundingClientRect();
    width = Math.max(320, rect.width) - margin.left - margin.right;
    height = 430 - margin.top - margin.bottom;
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

    const activeGlow = defs.append('filter').attr('id','dv-active-glow').attr('x','-30%').attr('y','-30%').attr('width','160%').attr('height','160%');
    activeGlow.append('feDropShadow').attr('dx',0).attr('dy',0).attr('stdDeviation',4).attr('flood-color','#059669').attr('flood-opacity',0.4);

    const shadow = defs.append('filter').attr('id','dv-shadow').attr('x','-60%').attr('y','-60%').attr('width','220%').attr('height','220%');
    shadow.append('feDropShadow').attr('dx',0).attr('dy',2).attr('stdDeviation',3).attr('flood-color', pal.shadow).attr('flood-opacity',0.3);

    const clip = defs.append('clipPath').attr('id','dv-clip');
    clip.append('rect').attr('width', width).attr('height', height).attr('rx', 8);

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    root.append('rect').attr('class','dv-bg').attr('width', width).attr('height', height).attr('rx', 8)
      .attr('fill', 'url(#dv-bg-grad)').attr('stroke', pal.cardBorder);

    gAxes = root.append('g');
    const clipped = root.append('g').attr('clip-path', 'url(#dv-clip)');

    overlay = clipped.append('rect').attr('width', width).attr('height', height)
      .attr('fill', 'transparent').style('cursor','crosshair');
    overlay.on('mousemove', onHover).on('mouseleave', () => tooltip.style('display','none'));

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
      .on('zoom', (ev) => redraw(ev.transform.rescaleX(x), ev.transform.rescaleY(y)));
    svg.call(zoomBehavior);

    buildLegend(pal);
    redraw(x, y);
  }

  function haloText(sel, pal){
    sel.attr('paint-order','stroke').attr('stroke', pal.bg).attr('stroke-width', 4)
       .attr('stroke-linejoin','round').style('pointer-events','none');
  }

  function redraw(zx, zy){
    const pal = palette();

    const xAxis = d3.axisBottom(zx).ticks(9).tickFormat(d3.format('.2f'));
    const yAxis = d3.axisLeft(zy).ticks(8);
    gAxes.selectAll('*').remove();
    const gx = gAxes.append('g').attr('transform', `translate(0,${height})`).call(xAxis);
    const gy = gAxes.append('g').call(yAxis);
    [gx,gy].forEach(g => {
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

    // ---- Layer 1: Compensation Bands ----
    if(layers.bands){
      gRegions.selectAll('path.region').data(regionPolys, d=>d.id).join('path')
        .attr('class','region')
        .attr('d', d => lineSmooth(d.poly))
        .attr('fill', d => {
          const active = isRegionActive(d, lastPatient);
          return active ? d.color : d.color;
        })
        .attr('fill-opacity', d => isRegionActive(d, lastPatient) ? 0.32 : 0.07)
        .attr('stroke', d => isRegionActive(d, lastPatient) ? d.line : d.line)
        .attr('stroke-opacity', d => isRegionActive(d, lastPatient) ? 1.0 : 0.35)
        .attr('stroke-width', d => isRegionActive(d, lastPatient) ? 2.5 : 1.0)
        .style('filter', d => isRegionActive(d, lastPatient) ? 'url(#dv-active-glow)' : 'none')
        .style('cursor','pointer')
        .style('transition','all .2s ease')
        .on('mouseenter', function(ev,d){
          d3.select(this).attr('fill-opacity', 0.4).attr('stroke-width', 2.5);
          tooltip.style('display','block').html(`<b>${d.label}</b>`);
        })
        .on('mousemove', function(ev){
          const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap'));
          tooltip.style('left',mx+'px').style('top',my+'px');
        })
        .on('mouseleave', function(ev,d){
          const active = isRegionActive(d, lastPatient);
          d3.select(this)
            .attr('fill-opacity', active ? 0.32 : 0.07)
            .attr('stroke-width', active ? 2.5 : 1.0);
          tooltip.style('display','none');
        });
    } else {
      gRegions.selectAll('path.region').remove();
    }

    // ---- Layer 2: Normal Box ----
    if(layers.normal && normalBox){
      const nb = [[normalBox.phMin,normalBox.hco3Min],[normalBox.phMax,normalBox.hco3Min],
                  [normalBox.phMax,normalBox.hco3Max],[normalBox.phMin,normalBox.hco3Max]];
      const isNormalActive = lastPatient && lastPatient.ph>=normalBox.phMin && lastPatient.ph<=normalBox.phMax && lastPatient.hco3>=normalBox.hco3Min && lastPatient.hco3<=normalBox.hco3Max;

      gRegions.selectAll('path.normal').data([nb]).join('path')
        .attr('class','normal').attr('d', d=>lineGen(d)+'Z')
        .attr('fill', isNormalActive ? pal.normalGlow : pal.normalFill)
        .attr('stroke', pal.normalLine)
        .attr('stroke-width', isNormalActive ? 2.5 : 1.6)
        .attr('rx', 4);

      gRegions.selectAll('text.normal-lbl').data([1]).join('text').attr('class','normal-lbl')
        .attr('x', zx((normalBox.phMin+normalBox.phMax)/2))
        .attr('y', zy((normalBox.hco3Min+normalBox.hco3Max)/2)+4)
        .attr('text-anchor','middle').attr('font-size',11).attr('font-weight',800).attr('fill', pal.normalLine)
        .text('NORMAL RANGE').call(haloText, pal);
    } else {
      gRegions.selectAll('path.normal, text.normal-lbl').remove();
    }

    // ---- Layer 3: pCO2 Isobars ----
    if(layers.isobars){
      const isobarPaths = isobarList.map(p => {
        const pts=[];
        for(let ph=XDOM[0]; ph<=XDOM[1]; ph+=0.01){
          const hco3 = hhHCO3(ph,p);
          if(hco3>=YDOM[0] && hco3<=YDOM[1]) pts.push([ph,hco3]);
        }
        return {p, pts};
      });
      gIsobars.selectAll('path.isobar').data(isobarPaths, d=>d.p).join('path')
        .attr('class','isobar').attr('d', d=>lineGen(d.pts))
        .attr('fill','none').attr('stroke', pal.isobar).attr('stroke-width',1.2).attr('stroke-dasharray','2,4')
        .attr('stroke-linecap','round');
      gIsobars.selectAll('text.isobar-lbl').data(isobarPaths, d=>d.p).join('text')
        .attr('class','isobar-lbl')
        .attr('x', d => d.pts.length ? zx(d.pts[d.pts.length-1][0]) : -100)
        .attr('y', d => d.pts.length ? zy(d.pts[d.pts.length-1][1])-6 : -100)
        .attr('font-size', 9.5).attr('font-weight', 700).attr('fill', pal.isobarLbl)
        .text(d => `${d.p}`).call(haloText, pal);
    } else {
      gIsobars.selectAll('path.isobar, text.isobar-lbl').remove();
    }

    // ---- Layer 4: Buffer Line ----
    if(layers.buffer){
      const anchor = lastPatient ? [lastPatient.ph, lastPatient.hco3] : [7.40, 24];
      const bufferPts=[];
      for(let ph=XDOM[0]; ph<=XDOM[1]; ph+=0.02){
        const hco3 = anchor[1] + BUFFER_SLOPE*(ph-anchor[0]);
        if(hco3>=YDOM[0] && hco3<=YDOM[1]) bufferPts.push([ph,hco3]);
      }
      gBuffer.selectAll('path.buffer').data([bufferPts]).join('path')
        .attr('class','buffer').attr('d', d=>lineGen(d))
        .attr('fill','none').attr('stroke', pal.buffer).attr('stroke-width',2.0).attr('stroke-linecap','round')
        .on('mouseenter', () => tooltip.style('display','block').html('Whole-blood Buffer Line <small>(Hb ~15 g/dL)</small>'))
        .on('mousemove', function(ev){ const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px'); })
        .on('mouseleave', () => tooltip.style('display','none'));
      gBuffer.selectAll('text.buffer-lbl').data(bufferPts.length ? [bufferPts[0]] : []).join('text')
        .attr('class','buffer-lbl')
        .attr('x', d => zx(d[0])+6).attr('y', d => zy(d[1])-5)
        .attr('font-size', 10).attr('font-weight', 700).attr('font-style','italic').attr('fill', pal.buffer)
        .text('Buffer Line').call(haloText, pal);
    } else {
      gBuffer.selectAll('path.buffer, text.buffer-lbl').remove();
    }

    // ---- Layer 5: Serial Trend Trajectory ----
    if(lastSeries.length > 1){
      gTrend.selectAll('path.trendline').data([lastSeries]).join('path')
        .attr('class','trendline').attr('d', d=>lineGen(d.map(s=>[s.ph,s.hco3])))
        .attr('fill','none').attr('stroke', pal.trendLine).attr('stroke-width', 2.2).attr('stroke-dasharray','6,4')
        .attr('stroke-linecap','round');
    } else {
      gTrend.selectAll('path.trendline').remove();
    }
    gTrend.selectAll('circle.trendpt').data(lastSeries).join('circle')
      .attr('class','trendpt').attr('r', 5)
      .attr('cx', d => zx(d.ph)).attr('cy', d => zy(d.hco3))
      .attr('fill', pal.trendLine).attr('stroke', pal.bg).attr('stroke-width', 1.75)
      .style('filter','url(#dv-shadow)')
      .on('mouseenter', function(ev,d){
        ev.stopPropagation(); d3.select(this).attr('r', 7);
        tooltip.style('display','block')
          .html(`<b>${d.t ? new Date(d.t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br>${d.dx||''}`);
      })
      .on('mousemove', function(ev){
        ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px');
      })
      .on('mouseleave', function(ev){
        ev.stopPropagation(); d3.select(this).attr('r', 5); tooltip.style('display','none');
      });

    // ---- Layer 6: Active Patient Point (Neon Pulsing Node) ----
    if(layers.patient && lastPatient){
      gPatient.selectAll('circle.patient-pulse').data([lastPatient]).join('circle')
        .attr('class','patient-pulse dv-pulse-ring')
        .attr('cx', d => zx(d.ph)).attr('cy', d => zy(d.hco3))
        .attr('fill', 'none').attr('stroke', pal.patientPulse).attr('stroke-width', 2.5);

      gPatient.selectAll('circle.patientpt').data([lastPatient]).join('circle')
        .attr('class','patientpt').attr('r', 7.5)
        .attr('cx', d => zx(d.ph)).attr('cy', d => zy(d.hco3))
        .attr('fill', pal.patient).attr('stroke', pal.patientRing).attr('stroke-width', 2.5)
        .style('filter','url(#dv-shadow)')
        .on('mouseenter', function(ev,d){
          ev.stopPropagation(); tooltip.style('display','block')
            .html(`<b>Current Active Gas</b><br>pH ${d.ph.toFixed(2)} · HCO₃⁻ ${d.hco3.toFixed(1)} · pCO₂ ${d.pco2.toFixed(0)}<br><b>${d.integrated||''}</b>`);
        })
        .on('mousemove', function(ev){
          ev.stopPropagation(); const [mx,my]=d3.pointer(ev, containerEl.querySelector('.dv-wrap')); tooltip.style('left',mx+'px').style('top',my+'px');
        })
        .on('mouseleave', function(ev){
          ev.stopPropagation(); tooltip.style('display','none');
        });

      gPatient.selectAll('text.patient-lbl').data([lastPatient]).join('text')
        .attr('class','patient-lbl')
        .attr('x', d => zx(d.ph)).attr('y', d => zy(d.hco3)-14)
        .attr('text-anchor','middle').attr('font-size', 11).attr('font-weight', 800).attr('fill', pal.patient)
        .text(`● Current (pH ${lastPatient.ph.toFixed(2)}, HCO₃⁻ ${lastPatient.hco3.toFixed(1)})`)
        .call(haloText, pal);
    } else {
      gPatient.selectAll('*').remove();
    }
  }

  function buildLegend(pal){
    if(!legendEl) return;
    const items = [
      { type:'dot', color:pal.patient, label:'Active Patient Gas (Pulsing Node)' },
      { type:'swatch', fill:pal.normalFill, line:pal.normalLine, label:'Normal Box (7.35–7.45)' },
      { type:'swatch', fill:'rgba(16, 185, 129, .25)', line:'#10B981', label:'Active Diagnosis Band (Focused)' },
      { type:'dash', color:pal.isobar, label:'pCO₂ Isobars' },
      { type:'line', color:pal.buffer, label:'Whole-blood Buffer Line' },
      { type:'dashline', color:pal.trendLine, label:'Serial Trajectory' }
    ];
    legendEl.textContent = '';
    items.forEach(it => {
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
    if(!regionDefs){ loadRegions().then(() => { renderStatic(); }); return; }
    redraw(x, y);
  }

  return { init, draw };
})();
