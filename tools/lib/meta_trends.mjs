const DAY = 86400000;
export const TREND_TIERS = ['iron_gold','platinum_diamond','meteor_mithril','demigod_eternity'];
function tail(z) {
  const t=1/(1+0.2316419*z);
  return Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(0.31938153+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
}
export function createTrendAccumulator({asOf=new Date().toISOString(), days=7, minTeams=1000}={}) {
  const end=Math.floor((Date.parse(asOf)+9*3600000)/DAY)*DAY-9*3600000, start=end-2*days*DAY, middle=end-days*DAY;
  if (!Number.isFinite(end)) throw new Error('Invalid trend cutoff');
  const buckets=Object.fromEntries(TREND_TIERS.map(t=>[t,[{total:0,dates:new Set(),rows:new Map()},{total:0,dates:new Set(),rows:new Map()}]]));
  const seen=new Set();
  let latest=null;
  return {
    add({gameId,teamKey,startedAt,tierBucket,members,placement}) {
      const time=Date.parse(startedAt), bucket=buckets[tierBucket];
      if (!bucket || !gameId || teamKey===undefined || !Number.isFinite(time) || time<start || time>=end ||
          members.length!==3 || new Set(members.map(v=>v.split(':')[0])).size!==3 ||
          !Number.isFinite(placement) || placement<1) return false;
      const key=`${gameId}:${teamKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      latest=Math.max(latest??0,time);
      const period=bucket[time<middle?0:1];
      period.total++; period.dates.add(Math.floor(time/DAY));
      const ids=[...members].sort();
      const groups=[...ids.map(id=>[id]),[ids[0],ids[1]],[ids[0],ids[2]],[ids[1],ids[2]],ids];
      for (const group of groups) {
        const k=group.join('|');
        const row=period.rows.get(k)??{members:group,games:0,top3:0,placement:0};
        row.games++; row.top3+=Number(placement<=3); row.placement+=placement;period.rows.set(k,row);
      }
      return true;
    },
    finish() {
      const byTier={};
      for (const tier of ['all',...TREND_TIERS]) {
        // Fixed weights in both windows prevent a shifting sampled tier mix from looking like a meta rise.
        const sources=(tier==='all'?TREND_TIERS:[tier]).map(t=>buckets[t]).filter(p=>p.every(w=>w.total>=100&&w.dates.size>=Math.min(5,days)));
        const totals=[0,1].map(i=>sources.reduce((n,p)=>n+p[i].total,0));
        const combined=totals[0]+totals[1], candidates=[];
        if (Math.min(...totals)>=minTeams) {
          const keys=new Set(sources.flatMap(p=>[...p[0].rows.keys(),...p[1].rows.keys()]));
          for (const key of keys) {
            let previous=0,recent=0,variance=0,games=0,previousGames=0,top3=0,placement=0,members;
            for (const p of sources) {
              const old=p[0].rows.get(key), row=p[1].rows.get(key), weight=(p[0].total+p[1].total)/combined;
              const a=old?.games??0,b=row?.games??0, pooled=(a+b)/(p[0].total+p[1].total);
              previous+=weight*a/p[0].total;recent+=weight*b/p[1].total;
              variance+=weight*weight*pooled*(1-pooled)*(1/p[0].total+1/p[1].total);
              games+=b;previousGames+=a;top3+=row?.top3??0;placement+=row?.placement??0;members=row?.members??old?.members??members;
            }
            const size=members.length, delta=recent-previous, ratio=(recent+1/totals[1])/(previous+1/totals[0]);
            const z=variance>0?delta/Math.sqrt(variance):0;
            // Keep all tested increases in the correction family; apply practical thresholds afterwards.
            candidates.push({members,games,previousGames,recentShare:recent,previousShare:previous,delta,ratio,
              top3Rate:top3/games,avgPlacement:placement/games,p:delta>0?tail(z):1,z,size});
          }
        }
        candidates.sort((a,b)=>a.p-b.p);
        let cutoff=-1;
        candidates.forEach((r,i)=>{if(r.p<=0.1*(i+1)/candidates.length)cutoff=i;});
        const qualified=candidates.slice(0,cutoff+1).filter(r=>r.games>=({1:60,2:40,3:20}[r.size]) &&
          r.ratio>=1.5&&r.delta>=0.0001&&r.z>=2.58);
        byTier[tier]={previousTeams:totals[0],recentTeams:totals[1],
          rows:[1,2,3].flatMap(size=>qualified.filter(r=>r.size===size).sort((a,b)=>b.z-a.z||b.delta-a.delta)
            .slice(0,10).map(({p,z,size,...r})=>r))};
      }
      return {schemaVersion:1,generatedAt:new Date().toISOString(),days,timeZone:'Asia/Seoul',
        previousStart:new Date(start).toISOString(),recentStart:new Date(middle).toISOString(),end:new Date(end).toISOString(),
        latestMatchAt:latest?new Date(latest).toISOString():null,byTier};
    },
  };
}
