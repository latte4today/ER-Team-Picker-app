import {patchNoteForCharacter, patchNotesForItems, changedCharacters, S13_PATCH} from './preseason.js';
import {currentSeason} from './seasonContext.js';
import {recentEvidence,recentMovers,recentCohort,recentMetaSnapshot} from './recentMeta.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pp=x=>'+'+(x*100).toFixed(1)+'%p';

// Raw cohort statistics support scoring; the product shows an actionable build.
export function renderRecentEvidence(id,tier,_core,t) {
  const e=recentEvidence(id,tier);
  const note=patchNoteForCharacter(id.split(':')[0],t);
  const patchNote=note?`<p class="detail-section-note">${esc(note)}</p>`:'';
  const names=recentMetaSnapshot().itemNames;
  const build=e?.row.builds?.find(b=>b.items?.every(code=>names?.[code]));
  if(!build)return patchNote;
  const items=build.items.map(code=>names[code]);
  const effects=patchNotesForItems(items,t);
  return patchNote+`<details class="recommended-build"><summary>${esc(t('recent.recommendedBuild'))}</summary>
    <ul class="build-items">${items.map(name=>`<li>${esc(name)}</li>`).join('')}</ul>
    <small>${esc(t(e.cohort.key==='unrank'?'season.normalBuild':'recent.buildNote'))}</small>
    ${effects.length?`<ul class="patch-build-effects">${effects.map(effect=>`<li>${esc(effect)}</li>`).join('')}</ul>`:''}
  </details>`;
}

export function renderRecentDashboard(tier,resolve,t) {
  const active=currentSeason();
  if(active.phase==='preseason'){
    if(active.patch!==S13_PATCH)return '';
    return `<section class="recent-meta-section preseason-patch-notes"><div class="meta-section-heading"><h3>${esc(t('patch13.title'))}</h3></div>
      <div class="recent-meta-columns">
        <section><h4>${esc(t('patch13.characters'))}</h4><ul>${changedCharacters.filter(resolve).map(id=>`<li><strong>${esc(t('char.'+id))}</strong><small>${esc(patchNoteForCharacter(id,t))}</small></li>`).join('')}</ul></section>
        <section><h4>${esc(t('patch13.combat'))}</h4><p>${esc(t('patch13.onHit'))}</p><p>${esc(t('patch13.item.guard'))}</p><p>${esc(t('patch13.item.noAntiHeal'))}</p></section>
        <section><h4>${esc(t('patch13.routes'))}</h4><p>${esc(t('patch13.routeReset'))}</p><p>${esc(t('patch13.economy'))}</p></section>
      </div></section>`;
  }
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
