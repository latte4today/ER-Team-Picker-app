import {recentEvidence,recentMovers,recentCohort,recentMetaSnapshot} from './recentMeta.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pp=x=>'+'+(x*100).toFixed(1)+'%p';

// Raw cohort statistics support scoring; the product shows an actionable build.
export function renderRecentEvidence(id,tier,_core,t) {
  const e=recentEvidence(id,tier);
  if(!e)return '';
  const names=recentMetaSnapshot().itemNames;
  const build=e.row.builds?.find(b=>b.items?.every(code=>names?.[code]));
  if(!build)return '';
  return `<details class="recommended-build"><summary>${esc(t('recent.recommendedBuild'))}</summary>
    <ul class="build-items">${build.items.map(code=>`<li>${esc(names[code])}</li>`).join('')}</ul>
    <small>${esc(t('recent.buildNote'))}</small>
  </details>`;
}

export function renderRecentDashboard(tier,resolve,t) {
  const cohort=recentCohort(tier);
  const cards=(kind,scopeTier=tier)=>recentMovers(scopeTier,kind).slice(0,3).map(({variantId,movement})=>{
    const c=resolve(variantId);if(!c)return '';
    return `<li class="meta-mover-row"><img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy">
      <div><b>${esc(t(`char.${c.id}`))}</b><small>${esc(t(`weapon.${c.weapon}`))}</small></div>
      <strong class="meta-mover-delta">${pp(movement.delta)}</strong></li>`;
  }).join('')||`<li class="meta-mover-empty">${esc(t('recent.noMovers'))}</li>`;
  return `<section class="recent-meta-section"><div class="meta-section-heading"><h3>${esc(t('recent.dashboard'))}</h3><small>${esc(t('recent.window'))}</small></div>
    ${cohort.freshness?`<div class="recent-meta-columns"><section><h4>${esc(t('recent.usage'))}</h4><ul>${cards('usage')}</ul></section><section><h4>${esc(t('recent.performance'))}</h4><ul>${cards('performance')}</ul></section>${cohort.key!=='mithril_plus'&&recentCohort('mithril_plus').freshness?`<section><h4>${esc(t('recent.upperUsage'))}</h4><ul>${cards('usage','mithril_plus')}</ul></section>`:''}</div>`:`<p class="recent-meta-note">${esc(t('recent.unavailable'))}</p>`}
  </section>`;
}
