import {recentEvidence,recentMovers,recentCohort,recentMetaSnapshot} from './recentMeta.js';
import {normalizeCoreName} from './traitMeta.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>(x*100).toFixed(1)+'%';
const pp=x=>'+'+(x*100).toFixed(1)+'%p';
function link(url,label) {
  try {const u=new URL(url);if(u.origin!=='https://dak.gg'||!u.pathname.startsWith('/er/characters/'))return '';}
  catch{return '';}
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
}
function scope(c,t) {
  return t('recent.scope',{tier:t(`recent.${c.key}`),patch:c.patch,date:c.updatedAt.slice(0,10)});
}
export function renderRecentEvidence(id,tier,core,t) {
  const e=recentEvidence(id,tier);
  if(!e)return `<p class="recent-meta-note">${esc(t('recent.unavailable'))}</p>`;
  const r=e.row,cr=r.cores.find(c=>c.core===String(core));
  const build=r.builds?.find(b=>b.items?.every(code=>recentMetaSnapshot().itemNames?.[code]));
  return `<details class="recent-meta-evidence" aria-label="${esc(t('recent.title'))}">
    <summary>${esc(t('recent.title'))} · TOP 3 ${pct(e.top3Rate)} · ${r.games.toLocaleString()}</summary><small>${esc(scope(e.cohort,t))}</small>
    <p>${esc(t('recent.rates',{games:r.games.toLocaleString(),win:pct(e.winRate),top3:pct(e.top3Rate)}))}</p>
    ${cr?`<p>${esc(normalizeCoreName(cr.core))} · ${esc(t('recent.rates',{games:cr.games.toLocaleString(),win:pct(cr.wins/cr.games),top3:pct(cr.top3/cr.games)}))}</p>`:''}
    <p class="recent-meta-note">${esc(t(!e.cohort.transfer?'recent.referenceOnly':r.games>=300?'recent.correction':'recent.unavailable'))}</p>
    ${build?`<details><summary>${esc(t('recent.build'))}</summary><p>${build.items.map(code=>esc(recentMetaSnapshot().itemNames[code])).join(' · ')}</p><p>${esc(t('recent.rates',{games:build.games.toLocaleString(),win:pct(build.wins/build.games),top3:pct(build.top3/build.games)}))}</p><p class="recent-meta-note">${esc(t('recent.buildCaution'))}</p></details>`:''}
    ${link(r.url,t('recent.source'))}
  </details>`;
}
export function renderRecentDashboard(tier,resolve,t) {
  const cohort=recentCohort(tier);
  const cards=(kind,scopeTier=tier)=>recentMovers(scopeTier,kind).slice(0,3).map(({variantId,row,movement})=>{
    const c=resolve(variantId);if(!c)return '';
    return `<li><div class="recent-mover-head"><img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy"><div><b>${esc(t(`char.${c.id}`))} · ${esc(t(`weapon.${c.weapon}`))}</b>
      <span>${esc(t(kind==='usage'?'recent.usageDelta':'recent.performanceDelta',{delta:pp(movement.delta)}))}</span></div></div>
      <small>${esc(t('recent.rates',{games:row.games.toLocaleString(),win:pct(row.wins/row.games),top3:pct(row.top3/row.games)}))}</small>
      ${link(row.url,'DAK.GG')}</li>`;
  }).join('')||`<li class="recent-meta-note">${esc(t('recent.noMovers'))}</li>`;
  return `<section class="recent-meta-section"><h3>${esc(t('recent.dashboard'))}</h3>
    <p class="recent-meta-note">${esc(scope(cohort,t))}</p>
    <details><summary>${esc(t('recent.comparisonLabel'))}</summary><p class="recent-meta-note">${esc(t('recent.comparison'))}</p></details>
    ${cohort.freshness?`<div class="recent-meta-columns"><section><h4>${esc(t('recent.usage'))}</h4><ul>${cards('usage')}</ul></section><section><h4>${esc(t('recent.performance'))}</h4><ul>${cards('performance')}</ul></section>${cohort.key!=='mithril_plus'&&recentCohort('mithril_plus').freshness?`<section><h4>${esc(t('recent.upperUsage'))}</h4><p class="recent-meta-note">${esc(scope(recentCohort('mithril_plus'),t))}</p><ul>${cards('usage','mithril_plus')}</ul></section>`:''}</div>`:`<p>${esc(t('recent.unavailable'))}</p>`}
  </section>`;
}
