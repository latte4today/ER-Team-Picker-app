import {patchNoteForCharacter, patchNotesForItems} from './preseason.js';
import {currentSeason} from './seasonContext.js';
import {recentEvidence,recentMovers,recentCohort,recentMetaSnapshot,preseasonHasPulse,recentStrengthCorrection} from './recentMeta.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pp=(x,precision=1)=>'+'+(x*100).toFixed(precision)+'%p';

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
  const preseason=currentSeason().phase==='preseason';
  const short=preseason&&preseasonHasPulse(tier);
  const cohort=recentCohort(tier);
  const cards=(kind,scopeTier=tier)=>recentMovers(scopeTier,kind).slice(0,3).map(({variantId,movement})=>{
    const c=resolve(variantId);if(!c)return '';
    return `<li class="meta-mover-row"><img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy">
      <div><b>${esc(t(`char.${c.id}`))}</b><small>${esc(t(`weapon.${c.weapon}`))}</small></div>
      <strong class="meta-mover-delta">${pp(movement.delta,preseason&&kind==='usage'?2:1)}</strong></li>`;
  }).join('')||`<li class="meta-mover-empty">${esc(t('recent.noMovers'))}</li>`;
  const strong=short?Object.entries(cohort.pulse.rows).map(([id,row])=>({id,row,score:recentStrengthCorrection(id,tier,0)}))
    .filter(({row,score})=>row.games>=120&&score>0).sort((a,b)=>b.score-a.score)
    .flatMap(({id,row})=>{const c=resolve(id);return c?[`<li class="meta-mover-row">
      <img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy"><div><b>${esc(t(`char.${c.id}`))}</b><small>${esc(t(`weapon.${c.weapon}`))}</small></div>
      <strong class="meta-mover-delta">TOP 3 ${(row.top3/row.games*100).toFixed(1)}%</strong></li>`]:[];}).slice(0,3).join(''):'';
  return `<section class="recent-meta-section"><div class="meta-section-heading"><h3>${esc(t('recent.dashboard'))}</h3><small>${esc(t(preseason?'recent.preseasonWindow':'recent.window'))}</small></div>
    ${cohort.freshness&&(!preseason||short)?`<div class="recent-meta-columns"><section><h4>${esc(t('recent.usage'))}</h4><ul>${cards('usage')}</ul></section><section><h4>${esc(t('recent.performance'))}</h4><ul>${cards('performance')}</ul></section>${preseason?(strong?`<section><h4>${esc(t('recent.preseasonStrong'))}</h4><ul>${strong}</ul></section>`:''):cohort.key!=='mithril_plus'&&recentCohort('mithril_plus').freshness?`<section><h4>${esc(t('recent.upperUsage'))}</h4><ul>${cards('usage','mithril_plus')}</ul></section>`:''}</div>`:`<p class="recent-meta-note">${esc(t(preseason?'recent.preseasonPending':'recent.unavailable'))}</p>`}
  </section>`;
}
