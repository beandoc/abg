document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const TAB_TITLES = { analyze:'Analyze', chart:'Davenport Chart', trend:'Trend Tracker', nephro:'Nephrology Suite', reference:'Clinical Guidelines' };

  const pages = Array.from(document.querySelectorAll('.tab-page'));
  const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  const content = document.querySelector('.app-content');
  const title = document.getElementById('pageTitle');

  const sidebarDrawer = document.getElementById('sidebarDrawer');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  const sidebarNavBtns = Array.from(document.querySelectorAll('.sidebar-nav-btn'));

  function openSidebar(){
    if(sidebarDrawer) sidebarDrawer.classList.add('open');
    if(sidebarBackdrop) sidebarBackdrop.classList.add('open');
  }

  function closeSidebar(){
    if(sidebarDrawer) sidebarDrawer.classList.remove('open');
    if(sidebarBackdrop) sidebarBackdrop.classList.remove('open');
  }

  if(sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', openSidebar);
  if(sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if(sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  function activate(tab, cardId){
    pages.forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    sidebarNavBtns.forEach(b => b.classList.toggle('active', b.dataset.nav === tab && (!cardId || b.dataset.card === cardId)));

    if(title) title.textContent = TAB_TITLES[tab] || tab;
    if(content) content.scrollTop = 0;

    if(cardId){
      const cardBody = document.getElementById(cardId);
      if(cardBody){
        cardBody.classList.add('open');
        const summaryBtn = document.querySelector(`[data-collapse="${cardId}"]`);
        if(summaryBtn){
          summaryBtn.setAttribute('aria-expanded', 'true');
          summaryBtn.classList.add('open');
        }
        setTimeout(() => {
          cardBody.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }

    if(tab === 'chart' && window.ABG && ABG.Davenport && ABG.Davenport.draw){
      window.dispatchEvent(new Event('resize'));
    }

    closeSidebar();
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.tab)));
  sidebarNavBtns.forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.nav, btn.dataset.card)));

  document.querySelectorAll('[data-collapse]').forEach(btn => {
    const body = document.getElementById(btn.dataset.collapse);
    if(!body) return;
    btn.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.classList.toggle('open', open);
    });
  });
});
