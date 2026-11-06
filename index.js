/** Integer-second half-open intervals over nonnegative ledger close times. */
const MAX = (1n << 63n) - 1n;
function integer(v) {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('Unsafe integer');
  if (!/^(0|[1-9][0-9]*)$/.test(String(v))) throw new Error('Expected unsigned integer');
  const n = BigInt(v); if (n > MAX) throw new Error('Timestamp exceeds int64'); return n;
}
function merge(xs) {
  const out = [];
  for (const [a,b] of xs.filter(([a,b]) => b === null || a < b).sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0)) {
    const p = out.at(-1);
    if (p && (p[1] === null || a <= p[1])) p[1] = p[1] === null || b === null ? null : p[1]>b?p[1]:b;
    else out.push([a,b]);
  } return out;
}
function intersect(a,b) {
  return merge(a.flatMap(([s,e])=>b.map(([t,u])=>[s>t?s:t,e===null?u:u===null?e:e<u?e:u])));
}
function complement(xs) {
  let start=0n; const out=[];
  for(const [a,b] of merge(xs)) {if(start<a)out.push([start,a]);if(b===null)return out;start=b;}
  out.push([start,null]);return out;
}
/** Input keys follow Horizon claim predicate JSON. Unknown relative origin throws. */
export function intervals(predicate, {createdAt} = {}) {
  let count=0;
  function visit(p,depth=0) {
    if (++count>1000 || depth>4) throw new Error('Predicate complexity exceeds Stellar limits');
    if (!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).length!==1) throw new Error('Expected exactly one predicate operator');
    const [key]=Object.keys(p), v=p[key];
    if(key==='unconditional' && v===true)return [[0n,null]];
    if(key==='abs_before') {
      const t= typeof v==='string' && /T/.test(v) ? (()=>{const ms=Date.parse(v);if(!Number.isFinite(ms)||ms%1000!==0)throw new Error('Expected whole-second timestamp');return integer(ms/1000);})() : integer(v);
      return t===0n?[]:[[0n,t]];
    }
    if(key==='rel_before') {
      if(createdAt===undefined)throw new Error('Relative predicate requires creation ledger close time');
      const t=integer(createdAt)+integer(v); if(t>MAX)throw new Error('Relative timestamp overflow');return t===0n?[]:[[0n,t]];
    }
    if(key==='not')return complement(visit(v,depth+1));
    if(key==='and'||key==='or') {
      if(!Array.isArray(v)||v.length!==2)throw new Error('Binary predicate requires two children');
      const a=visit(v[0],depth+1),b=visit(v[1],depth+1);return key==='and'?intersect(a,b):merge([...a,...b]);
    }
    throw new Error('Unsupported predicate operator');
  }
  return visit(predicate).map(([start,end])=>({start:start.toString(),end:end===null?null:end.toString()}));
}
export function eligible(predicate,at,options) {
  const t=integer(at);return intervals(predicate,options).some(({start,end})=>t>=BigInt(start)&&(end===null||t<BigInt(end)));
}
export function analyzeClaimants(claimants,options={}) {
  if(!Array.isArray(claimants)||claimants.length<1||claimants.length>10)throw new Error('Expected 1–10 claimants');
  const windows=claimants.map(c=>({destination:c.destination,windows:intervals(c.predicate,options)}));
  const all=windows.flatMap(c=>c.windows.map(w=>[BigInt(w.start),w.end===null?null:BigInt(w.end)]));
  return {claimants:windows,unclaimable:complement(all).map(([a,b])=>({start:String(a),end:b===null?null:String(b)}))};
}
