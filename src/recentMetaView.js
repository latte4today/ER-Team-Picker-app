import {patchNoteForCharacter, patchNotesForItems} from './preseason.js';
import {currentSeason} from './seasonContext.js';
import {recentEvidence,recentMovers,recentCohort,recentMetaSnapshot,preseasonHasPulse,recentStrengthCorrection,META_RANK_LIMIT,PRESEASON_META_POLICY,validBuildIcon} from './recentMeta.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pp=(x,precision=1)=>'+'+(x*100).toFixed(precision)+'%p';

const BUILD_STAT_SCALES = {
  amp: 90, attack: 35, defense: 22, health: 250, attackSpeed: 27,
  cooldown: 10, crit: 23, move: 0.25, movePercent: 5, lifesteal: 10, healing: 10,
};
const PERCENT_STATS = new Set(["attackSpeed", "crit", "movePercent", "lifesteal", "healing"]);

function buildStats(items, details) {
  const total = {};
  for (const code of items) {
    for (const [stat, value] of Object.entries(details?.[code]?.stats ?? {})) {
      if (Number.isFinite(value)) total[stat] = (total[stat] ?? 0) + value;
    }
  }
  return total;
}

function buildStatText(items, reference, details, t) {
  if (!items.every((code) => details?.[code]) || (reference && !reference.every((code) => details?.[code]))) return "";
  const total = buildStats(items, details);
  const baseline = reference ? buildStats(reference, details) : {};
  const changes = Object.entries(BUILD_STAT_SCALES).map(([stat, scale]) => {
    const value = Number(((total[stat] ?? 0) - (baseline[stat] ?? 0)).toFixed(2));
    return { stat, value, size: Math.abs(value) / scale };
  }).filter(({ value }) => value !== 0).sort((a, b) => b.size - a.size);
  const positive = changes.filter(({ value }) => value > 0);
  const downside = reference && changes.find(({ value }) => value < 0);
  const visible = downside ? [...positive.slice(0, 1), downside] : changes.slice(0, 2);
  return visible.map(({ stat, value }) => `${t(`recent.itemStat.${stat === "movePercent" ? "move" : stat}`)} ${value > 0 ? "+" : ""}${value}${PERCENT_STATS.has(stat) ? "%" : ""}`).join(" · ");
}

function renderBuild(build, index, common, details, names, t) {
  const other = index > 0;
  const moreTop3 = other && build.games >= 40 && build.top3 / build.games > common.top3 / common.games + 0.025;
  const label = t(!other ? "recent.buildCommon" : moreTop3 ? "recent.buildTop3" : "recent.buildAlternative");
  const reference = other ? common.items : null;
  const changes = other ? build.items.filter((code) => !common.items.includes(code)) : build.items;
  const statText = buildStatText(build.items, reference, details, t);
  const skills = [...new Set(changes.flatMap((code) => details?.[code]?.effects ?? []))].slice(0, 3);
  const patchEffects = patchNotesForItems(build.items.map((code) => names[code]), t);
  return `<section class="item-build-option">
    <div class="item-build-heading"><strong>${esc(label)}</strong>${build.games < 40 ? `<small>${esc(t("recent.buildSmallSample"))}</small>` : ""}</div>
    <ul class="build-items">${build.items.map((code) => {
      const icon = details?.[code]?.icon;
      return `<li${other && changes.includes(code) ? ' class="build-item-changed"' : ""}>
        ${validBuildIcon(icon, code) ? `<img src="${esc(icon)}" alt="" width="38" height="38" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ""}
        <span>${esc(names[code])}</span></li>`;
    }).join("")}</ul>
    ${other && changes.length ? `<p class="build-comparison">${esc(t("recent.buildSwaps", { items: changes.map((code) => names[code]).join(" · ") }))}</p>` : ""}
    ${statText ? `<p class="build-comparison">${esc(t(other ? "recent.buildDelta" : "recent.buildStats", { stats: statText }))}</p>` : ""}
    ${skills.length ? `<p class="build-comparison">${esc(t("recent.buildSkills", { effects: skills.join(" · ") }))}</p>` : ""}
    ${patchEffects.length ? `<ul class="patch-build-effects">${patchEffects.map((effect) => `<li>${esc(effect)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

export function renderRecentEvidence(id,tier,_core,t) {
  const e=recentEvidence(id,tier);
  const note=patchNoteForCharacter(id.split(':')[0],t);
  const patchNote=note?`<p class="detail-section-note">${esc(note)}</p>`:'';
  const { itemNames: names, itemDetails: details } = recentMetaSnapshot();
  const seen = new Set();
  const builds = (e?.row.builds ?? []).filter(({ items }) => {
    const key = [...items].sort((a, b) => a - b).join("+");
    if (seen.has(key) || !items.every((code) => names?.[code])) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.games - a.games);
  const missingBuildMessage = e || recentCohort(tier).freshness ? "recent.buildSampleMissing" : "recent.buildPatchPending";
  return patchNote+`<details class="recommended-build"><summary>${esc(t('recent.recommendedBuild'))}</summary>
    ${builds.length ? `<small>${esc(t(e.cohort.key === "unrank" ? "season.normalBuild" : "recent.buildNote"))}</small>
    <div class="item-build-list">${builds.map((build, index) => renderBuild(build, index, builds[0], details, names, t)).join("")}</div>
    <small>${esc(t("recent.buildFinishedNote"))}</small>` : `<small>${esc(t(missingBuildMessage))}</small>`}
  </details>`;
}

export function renderRecentDashboard(tier,resolve,t) {
  const preseason=currentSeason().phase==='preseason';
  const short=preseason&&preseasonHasPulse(tier);
  const cohort=recentCohort(tier);
  const cards=(kind,scopeTier=tier)=>recentMovers(scopeTier,kind).map(({variantId,movement},i)=>{
    const c=resolve(variantId);if(!c)return '';
    return `<li class="meta-mover-row"><span class="meta-rank">${i+1}</span><img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy">
      <div><b>${esc(t(`char.${c.id}`))}</b><small>${esc(t(`weapon.${c.weapon}`))}</small></div>
      <strong class="meta-mover-delta">${pp(movement.delta,preseason&&kind==='usage'?2:1)}</strong></li>`;
  }).join('')||`<li class="meta-mover-empty">${esc(t('recent.noMovers'))}</li>`;
  const strong=short?Object.entries(cohort.pulse.rows).map(([id,row])=>({id,row,score:recentStrengthCorrection(id,tier,0)}))
    .filter(({row,score})=>row.games>=PRESEASON_META_POLICY.minGames&&score>0).sort((a,b)=>b.score-a.score)
    .filter(({id})=>resolve(id)).slice(0,META_RANK_LIMIT)
    .map(({id,row},i)=>{const c=resolve(id);return `<li class="meta-mover-row"><span class="meta-rank">${i+1}</span>
      <img src="${esc(c.image)}" alt="" width="32" height="32" loading="lazy"><div><b>${esc(t(`char.${c.id}`))}</b><small>${esc(t(`weapon.${c.weapon}`))}</small></div>
      <strong class="meta-mover-delta">TOP 3 ${(row.top3/row.games*100).toFixed(1)}%</strong></li>`;}).join(''):'';
  return `<section class="recent-meta-section"><div class="meta-section-heading"><h3>${esc(t('recent.dashboard'))}</h3><small>${esc(t(preseason?'recent.preseasonWindow':'recent.window'))}</small></div>
    ${cohort.freshness&&(!preseason||short)?`<div class="recent-meta-columns"><section><h4>${esc(t('recent.usage'))}</h4><ul tabindex="0">${cards('usage')}</ul></section><section><h4>${esc(t('recent.performance'))}</h4><ul tabindex="0">${cards('performance')}</ul></section>${preseason?(strong?`<section><h4>${esc(t('recent.preseasonStrong'))}</h4><ul tabindex="0">${strong}</ul></section>`:''):cohort.key!=='mithril_plus'&&recentCohort('mithril_plus').freshness?`<section><h4>${esc(t('recent.upperUsage'))}</h4><ul tabindex="0">${cards('usage','mithril_plus')}</ul></section>`:''}</div>`:`<p class="recent-meta-note">${esc(t(preseason?'recent.preseasonPending':'recent.unavailable'))}</p>`}
  </section>`;
}
