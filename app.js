// Project Tracker. data.json in the GitHub repo is the single source of truth.
// Every change in the UI becomes a small "op" that is queued in localStorage, applied on screen at once,
// and committed to data.json through the GitHub contents API (GET sha, PUT, retry on conflict).
// On load the fresh data.json is fetched and any still-unsynced ops are re-applied per task:
// an op only wins if it is newer than that task's updatedAt on the server.
const REPO='moonyose/project-tracker',BRANCH='main',FILE='data.json',API=`https://api.github.com/repos/${REPO}/contents/`;
const K={q:'pt-pending-v2',cache:'pt-server-v2',tok:'pt-gh-token',mig:'pt-migrated-v2',old:'pt-state-v1',bak:'pt-state-v1-backup'};
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let base=null,S=null,view='active',openArch=new Set(),needRender=false,lastFetch=0;
const $=s=>document.querySelector(s);
const uid=()=>'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const msg=t=>{$('#msg').textContent=t;clearTimeout(msg.t);msg.t=setTimeout(()=>$('#msg').textContent='',5000)};
const now=()=>new Date().toISOString();
const ts=x=>{const n=Date.parse(x||'');return isNaN(n)?0:n};
const clone=x=>structuredClone(x);
const token=()=>localStorage.getItem(K.tok)||'';
const lsJSON=k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}};
let Q=lsJSON(K.q)||[];
const saveQ=()=>localStorage.setItem(K.q,JSON.stringify(Q));

// ---------- data helpers ----------
function findIn(doc,tid){for(const c of doc.categories||[])for(const p of c.projects||[]){const t=(p.tasks||[]).find(x=>x.id===tid);if(t)return{c,p,t}}}
function projIn(doc,pid){for(const c of doc.categories||[]){const p=(c.projects||[]).find(x=>x.id===pid);if(p)return{c,p}}}
function setFields(o,set){for(const[k,v]of Object.entries(set)){if(v==null)delete o[k];else o[k]=clone(v)}}
// Apply one op to a document. Returns false when it no longer applies (target gone, or server copy is newer).
function applyOp(doc,op){
  switch(op.k){
    case'task':{const f=findIn(doc,op.id);if(!f||ts(f.t.updatedAt)>ts(op.at))return false;setFields(f.t,op.set);f.t.updatedAt=op.at;return true}
    case'sub':{const f=findIn(doc,op.tid),s=f?.t.subtasks?.find(x=>x.id===op.id);if(!s||ts(s.updatedAt)>ts(op.at))return false;setFields(s,op.set);s.updatedAt=op.at;return true}
    case'add':{if(findIn(doc,op.task.id))return false;const f=projIn(doc,op.pid);if(!f)return false;(f.p.tasks=f.p.tasks||[]).push({...clone(op.task),updatedAt:op.at});return true}
    case'purge':{const f=findIn(doc,op.id);if(!f||ts(f.t.updatedAt)>ts(op.at))return false;f.p.tasks=f.p.tasks.filter(x=>x.id!==op.id);return true}
    case'proj':{const f=projIn(doc,op.id);if(!f||ts(f.p.updatedAt)>ts(op.at))return false;setFields(f.p,op.set);f.p.updatedAt=op.at;return true}
    case'addProj':{if(projIn(doc,op.project.id))return false;let c=doc.categories.find(x=>x.id===op.cid);
      if(!c){if(!op.cat)return false;c={...clone(op.cat),projects:[]};doc.categories.push(c)}
      c.projects.push({...clone(op.project),updatedAt:op.at});return true}
    case'purgeProj':{for(const c of doc.categories){const i=c.projects.findIndex(x=>x.id===op.id);if(i>=0){c.projects.splice(i,1);return true}}return false}
  }return false}
function derive(){S=clone(base);for(const op of Q)applyOp(S,op)}
// For every UI change: queue it, show it, sync it.
function mutate(op){op.at=now();Q.push(op);saveQ();applyOp(S,op);render();scheduleSync(600)}
// Same layout as the Python writers (json.dump indent=2, ASCII-escaped) so commits diff cleanly.
const serialize=d=>JSON.stringify(d,null,2).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+'\n';

// ---------- GitHub API ----------
const b64d=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));
const b64bytes=b=>{let o='';for(let i=0;i<b.length;i+=0x8000)o+=String.fromCharCode(...b.subarray(i,i+0x8000));return btoa(o)};
const b64e=s=>b64bytes(new TextEncoder().encode(s));
const hdr=(tok=token())=>({Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(tok?{Authorization:'Bearer '+tok}:{})});
class GhErr extends Error{constructor(m,status){super(m);this.status=status}}
async function ghGet(path=FILE,tok=token()){
  let r;try{r=await fetch(`${API}${path}?ref=${BRANCH}&t=${Date.now()}`,{cache:'no-store',headers:hdr(tok)})}catch(e){throw new GhErr('offline',0)}
  if(!r.ok)throw new GhErr(r.status===401?'token rejected':r.status===403||r.status===404?'no access to '+REPO+' (check token permissions)':'GitHub error '+r.status,r.status);
  const j=await r.json();let text;
  if(j.content&&j.encoding==='base64')text=b64d(j.content);
  else{const rr=await fetch(`${API}${path}?ref=${BRANCH}&t=${Date.now()}`,{cache:'no-store',headers:{...hdr(tok),Accept:'application/vnd.github.raw+json'}});text=await rr.text()}
  return{doc:JSON.parse(text),sha:j.sha}}
async function ghPut(path,b64,sha,message){
  try{return await fetch(API+path,{method:'PUT',cache:'no-store',headers:{...hdr(),'Content-Type':'application/json'},body:JSON.stringify({message,content:b64,branch:BRANCH,...(sha?{sha}:{})})})}
  catch(e){throw new GhErr('offline',0)}}

// ---------- sync ----------
let syncing=false,again=false,timer=null,lastErr=null;
function scheduleSync(d=800){clearTimeout(timer);timer=setTimeout(sync,d)}
function setSync(state,detail){
  const el=$('#sync');if(!el)return;const n=Q.length,pend=n?` (${n} unsynced change${n>1?'s':''})`:'';
  const M={saved:'✅ Saved to GitHub',saving:'⏳ Saving…',local:'⚠ Not connected — changes are local only'+pend,
    offline:'📴 Offline — '+n+' change(s) queued, will retry',error:'❌ Sync error: '+(detail||'')+(n?' — '+n+' change(s) queued, will retry':'')};
  el.textContent=M[state];el.className='sync '+state;el.dataset.state=state;el.title=state==='local'||state==='error'?'Click to connect GitHub':''}
function opLabel(o){return{task:o.set&&'done'in o.set?(o.set.done?'done ':'reopen ')+o.id:'edit '+o.id,sub:(o.set?.done?'done ':'reopen ')+o.id,add:'add '+o.task?.id,
  purge:'delete '+o.id,proj:'edit project '+o.id,addProj:'add project '+o.project?.id,purgeProj:'delete project '+o.id}[o.k]||o.k}
const commitMsg=ops=>{const l=[...new Set(ops.map(opLabel))];return'Tracker (web): '+l.slice(0,6).join(', ')+(l.length>6?` +${l.length-6} more`:'')};
// Small files picked from the device are uploaded to attachments/ instead of being stored inside data.json.
async function uploadInline(){
  for(const op of Q){const list=op.set?.attachments||op.task?.attachments;if(!list)continue;
    for(const a of list){if(!String(a.url).startsWith('data:'))continue;
      const path='attachments/'+Date.now().toString(36)+'-'+String(a.name||'file').replace(/[^\w.\-]+/g,'_').slice(-80);
      const r=await ghPut(path,a.url.split(',')[1],null,'Tracker (web): attach '+a.name);
      if(!r.ok)throw new GhErr('attachment upload failed ('+r.status+')',r.status);
      a.url=path;saveQ()}}}
async function sync(){
  if(!token()){setSync('local');return}
  if(!Q.length){if(!lastErr)setSync('saved');return}
  if(syncing){again=true;return}
  syncing=true;setSync('saving');let retryIn=0;
  try{
    await uploadInline();
    for(let i=0;;i++){
      if(i>=6)throw new GhErr('kept conflicting with other commits',409);
      const n=Q.length,ops=Q.slice(0,n),{doc,sha}=await ghGet();
      const out=clone(doc);for(const o of ops)applyOp(out,o);
      out.updated=new Date().toLocaleDateString('en-CA');
      const r=await ghPut(FILE,b64e(serialize(out)),sha,commitMsg(ops));
      if(r.ok){base=out;localStorage.setItem(K.cache,JSON.stringify(base));Q=Q.slice(n);saveQ();lastErr=null;refresh();break}
      if(r.status===409||r.status===422){await new Promise(z=>setTimeout(z,300*(i+1)));continue} // sha moved on: re-fetch, re-apply, retry
      throw new GhErr(r.status===401?'token rejected — reconnect GitHub':r.status===403||r.status===404?'token cannot write to '+REPO:'GitHub error '+r.status,r.status)}
    setSync(Q.length?'saving':'saved');
  }catch(e){lastErr=e;
    if(e.status===0){setSync('offline');retryIn=15000}else{setSync('error',e.message);retryIn=e.status===401?0:30000}
  }finally{syncing=false;
    if(again||(!lastErr&&Q.length)){again=false;scheduleSync(300)}else if(retryIn)scheduleSync(retryIn)}}
window.addEventListener('online',()=>scheduleSync(200));

// ---------- load ----------
// Pages can lag a minute behind a commit; if we had to read it, keep the newer copy of each task we already know.
function keepNewer(fresh,old){if(!old)return fresh;
  for(const c of old.categories||[])for(const p of c.projects||[]){const fp=projIn(fresh,p.id)?.p;if(!fp)continue;
    if(ts(p.updatedAt)>ts(fp.updatedAt)){fp.name=p.name;fp.status=p.status;fp.updatedAt=p.updatedAt}
    for(const t of p.tasks||[]){const f=findIn(fresh,t.id);if(!f)continue;
      if(ts(t.updatedAt)>ts(f.t.updatedAt)){const keep={agent:f.t.agent,transcript:f.t.transcript,owner:f.t.owner??t.owner};Object.keys(f.t).forEach(k=>delete f.t[k]);Object.assign(f.t,clone(t),keep);if(!keep.agent)delete f.t.agent;if(keep.transcript==null)delete f.t.transcript;if(keep.owner==null)delete f.t.owner}
      for(const s of t.subtasks||[]){const fs=f.t.subtasks?.find(x=>x.id===s.id);if(fs&&ts(s.updatedAt)>ts(fs.updatedAt))Object.assign(fs,clone(s))}}}
  return fresh}
async function fetchServer(){
  try{const{doc}=await ghGet();return{doc,src:'api'}}catch(e){if(token()&&e.status&&e.status!==0)lastErr=e}
  if(token()){try{const{doc}=await ghGet(FILE,'');return{doc,src:'api'}}catch{}} // public repo: read without the token
  try{const r=await fetch('data.json?t='+Date.now(),{cache:'no-store'});if(r.ok)return{doc:await r.json(),src:'pages'}}catch{}
  return{doc:null,src:'none'}}
async function load(){
  lastErr=null;const cached=lsJSON(K.cache),{doc,src}=await fetchServer();lastFetch=Date.now();
  if(!doc&&!cached)msg('Could not load data.json');
  base=doc?(src==='api'?doc:keepNewer(doc,cached)):(cached||{categories:[]});
  if(doc)localStorage.setItem(K.cache,JSON.stringify(base));
  if(doc&&!localStorage.getItem(K.mig))migrate();
  Q=lsJSON(K.q)||Q;derive();
  if(S.title)$('#title').textContent=S.title;render();
  if(lastErr)setSync('error',lastErr.message);else if(!token())setSync('local');else if(!Q.length)setSync('saved');
  if(Q.length)scheduleSync(100)}
// One-time: browsers that ran the old localStorage-only version may hold checkoffs/tasks the server never got.
// Push those instead of discarding them. The old copy is kept under pt-state-v1-backup.
function migrate(){
  const raw=localStorage.getItem(K.old);localStorage.setItem(K.mig,now());if(!raw)return;
  let old;try{old=JSON.parse(raw)}catch{return}
  if(!Array.isArray(old?.categories))return;
  localStorage.setItem(K.bak,raw);
  const ops=diffOps(old,base,'migrate');Q.push(...ops);saveQ();localStorage.removeItem(K.old);
  if(ops.length)setTimeout(()=>msg(`Recovered ${ops.length} change(s) saved only in this browser${token()?' — saving to GitHub':' — connect GitHub to save them'}`),60)}
// Ops that turn server doc B into local doc L. 'migrate' is conservative (old browser copies of text/notes are
// usually just stale): it carries over checkoffs, new tasks/projects and added attachments. 'import' carries everything.
function diffOps(L,B,mode){
  const ops=[],at=now(),imp=mode==='import',trust=imp||(+L.rev||0)>=(+B.rev||0),purged=new Set(L.purged||[]);
  for(const c of L.categories||[])for(const p of c.projects||[]){
    const bp=projIn(B,p.id)?.p;
    if(!bp){if(!purged.has(p.id)&&(imp||String(p.id).startsWith('u')||!(p.tasks||[]).every(t=>findIn(B,t.id))))
        ops.push({k:'addProj',cid:c.id,cat:B.categories.some(x=>x.id===c.id)?null:{id:c.id,name:c.name,...(c.pinned?{pinned:true}:{})},project:{...clone(p),tasks:(p.tasks||[]).filter(t=>!findIn(B,t.id))},at});
      continue}
    if(imp){const set={};for(const k of['name','status'])if((p[k]??null)!==(bp[k]??null))set[k]=p[k]??null;if(Object.keys(set).length)ops.push({k:'proj',id:p.id,set,at})}
    for(const t of p.tasks||[]){const b=findIn(B,t.id)?.t;
      if(!b){if(imp||String(t.id).startsWith('u'))ops.push({k:'add',pid:p.id,task:clone(t),at});continue}
      const set={};let when=at;
      if(t.done&&!b.done&&(trust||(t.text===b.text&&(t.notes??'')===(b.notes??'')))){
        set.done=true;set.completedAt=t.completedAt||at;for(const k of['archivedBy','wasOpen','recovered'])if(t[k])set[k]=t[k];
        if(!imp&&ts(t.completedAt))when=new Date(ts(t.completedAt)).toISOString()}
      if(imp){if(!t.done&&b.done){set.done=false;set.completedAt=null;set.wasOpen=null;set.archivedBy=null}
        for(const k of['text','notes','due'])if((t[k]??null)!==(b[k]??null))set[k]=t[k]??null;
        if(JSON.stringify(t.attachments||[])!==JSON.stringify(b.attachments||[]))set.attachments=t.attachments||null}
      else{const extra=(t.attachments||[]).filter(a=>!(b.attachments||[]).some(x=>x.url===a.url));if(extra.length)set.attachments=[...(b.attachments||[]),...extra]}
      if(imp)for(const s of t.subtasks||[]){const bs=b.subtasks?.find(x=>x.id===s.id);if(bs&&!!s.done!==!!bs.done)ops.push({k:'sub',tid:t.id,id:s.id,set:{done:!!s.done,completedAt:s.done?(s.completedAt||at):null},at})}
      if(Object.keys(set).length)ops.push({k:'task',id:t.id,set,at:when})}}
  return ops}
// Re-render after background syncs, but never wipe a form that is being typed in.
function refresh(){const before=JSON.stringify(S);derive();if(JSON.stringify(S)===before)return;if(document.querySelector('.edit'))needRender=true;else render()}
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||Date.now()-lastFetch<60000||syncing)return;
  const{doc,src}=await fetchServer();lastFetch=Date.now();if(!doc)return;base=src==='api'?doc:keepNewer(doc,base);localStorage.setItem(K.cache,JSON.stringify(base));refresh()});

// ---------- UI ----------
function listen(cb,btn){
  if(!SR){msg('Voice input isn’t supported in this browser — try Chrome or Safari.');return}
  const r=new SR();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;
  btn&&btn.classList.add('on');msg('Listening…');
  r.onresult=e=>cb(e.results[0][0].transcript.trim());
  r.onerror=e=>msg('Voice error: '+e.error);r.onend=()=>{btn&&btn.classList.remove('on')};r.start()}
const mic=()=>`<button type="button" class="ic mic" title="Dictate" ${SR?'':'disabled title="Voice not supported"'}>🎤</button>`;
const fmt=d=>d?new Date(d).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'date unknown';
const attHTML=t=>(t.attachments||[]).length?`<div class="atts">${t.attachments.map((x,i)=>`<span class="chip"><a href="${esc(x.url)}" target="_blank" rel="noopener" ${String(x.url).startsWith('data:')?`download="${esc(x.name)}"`:''}>📎 ${esc(x.name)}</a><button class="ic" data-a="unatt" data-i="${i}" title="Remove attachment">✕</button></span>`).join('')}</div>`:'';
// Optional full verbatim transcript, collapsed under the task behind a "More" toggle.
const trHTML=t=>t.transcript?`<details class="tr"><summary>More</summary><div class="trx">${esc(t.transcript)}</div></details>`:'';
// owner:"austin" (on a task or a whole card) = human-only; AI agents must not work on it.
const ownHTML=o=>o==='austin'?'<span class="due own" title="Austin handles this; AI agents skip it">👤 Austin only</span>':'';
// Checkable sub-steps of a task (e.g. t35). Each one is saved to data.json like a task.
const subHTML=t=>(t.subtasks||[]).length?`<ul class="subs">${t.subtasks.map(s=>`<li class="${s.done?'done':''}" data-s="${esc(s.id)}"><label class="row"><input type="checkbox" ${s.done?'checked':''} data-a="sub"><span class="txt">${esc(s.text)}</span></label></li>`).join('')}</ul>`:'';
function taskHTML(t){
  if(t.done)return'';
  const ns=(t.subtasks||[]).length,ds=(t.subtasks||[]).filter(s=>s.done).length;
  return`<li data-t="${t.id}"><div class="row"><input type="checkbox" data-a="toggle">
  <span class="txt">${esc(t.text)}${ownHTML(t.owner)}${t.due?`<span class="due">📅 ${esc(t.due)}</span>`:''}${ns?`<span class="due sc">${ds}/${ns} steps</span>`:''}</span>
  <button class="ic" data-a="att" title="Attach file or link">📎</button><button class="ic" data-a="edit" title="Edit">✏️</button><button class="ic" data-a="del" title="Archive (delete)">🗑</button></div>
  ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}${subHTML(t)}${trHTML(t)}${attHTML(t)}${agentHTML(t.agent)}</li>`}
// What the scheduled Claude run did with this task (written to data.json by agent/apply_results.py).
const AG={pr_opened:['🤖','PR ready to review','ok'],needs_austin:['🙋','Needs you','warn'],blocked:['⛔','Blocked','bad'],
  failed:['⚠️','Claude couldn’t finish','bad'],retry:['⏳','Claude will retry next run','mut'],done_no_change:['🤖','Checked — nothing to change','mut']};
const safeUrl=u=>/^https:\/\/github\.com\//.test(u||'')?u:'';
function agentHTML(a){if(!a||!AG[a.status])return'';const[i,l,k]=AG[a.status],u=safeUrl(a.pr_url);
  return`<div class="agent ${k}"><b>${i} ${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`:l}</b>${a.summary?`<span>${esc(a.summary)}</span>`:''}${a.next_step?`<span class="nx">Next: ${esc(a.next_step)}</span>`:''}</div>`}
const allDone=p=>p.tasks.length>0&&p.tasks.every(t=>t.done);
function archHTML(){
  const groups=[];for(const c of S.categories)for(const p of c.projects){const ts=p.tasks.filter(t=>t.done);if(ts.length)groups.push({c,p,ts,last:ts.reduce((m,t)=>(t.completedAt||'')>m?t.completedAt:m,'')})}
  if(!groups.length)return'<p class="pct">Nothing archived yet.</p>';
  groups.sort((a,b)=>b.last.localeCompare(a.last));
  return groups.map(({c,p,ts})=>{ts.sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||''));const full=allDone(p);
  return`<div class="card" data-p="${p.id}"><div class="ph"><h3>${esc(p.name)}</h3><span class="pct">${esc(c.name)}${full?' · 📦 card archived':''}</span></div>
  ${full?`<button class="add" data-a="viewcard">${openArch.has(p.id)?'Hide archived card':'🗂 View archived card'}</button>${openArch.has(p.id)?`<div class="archcard">${cardHTML(p,true)}</div>`:''}`:''}
  <ul>${ts.map(t=>`<li class="done" data-t="${t.id}"><div class="row"><input type="checkbox" checked data-a="toggle" title="Un-archive (mark not done)">
  <span class="txt">${esc(t.text)}${ownHTML(t.owner)}${t.wasOpen?'<span class="due" title="Was not done when deleted">⚠ was open</span>':''}<div class="meta">✅ ${fmt(t.completedAt)}${t.recovered?' · ♻ recovered':''}</div></span>
  <button class="ic" data-a="unarch" title="Un-archive">↩</button><button class="ic" data-a="att" title="Attach file or link">📎</button><button class="ic" data-a="purge" title="Delete permanently">🗑</button></div>
  ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}${trHTML(t)}${attHTML(t)}</li>`).join('')}</ul></div>`}).join('')}
function cardHTML(p,ro){
  const n=p.tasks.length,d=p.tasks.filter(t=>t.done).length,pc=n?Math.round(d/n*100):0;
  return`<div class="card" data-p="${p.id}"><div class="ph"><h3>${esc(p.name)}${ownHTML(p.owner)}</h3>
  ${ro?'':`<span><button class="ic" data-a="rename" title="Rename">✏️</button><button class="ic" data-a="delp" title="Delete project">🗑</button></span>`}</div>
  <div class="status" ${ro?'':'data-a="status" title="Click to edit status"'}>${esc(p.status)}</div>
  <div class="bar"><i style="width:${pc}%"></i></div><div class="pct">${d}/${n} done · ${pc}%</div>
  ${ro?`<ul>${p.tasks.map(t=>`<li class="done"><span class="txt">✅ ${esc(t.text)}${ownHTML(t.owner)}</span>${trHTML(t)}</li>`).join('')}</ul>`:`<ul>${p.tasks.map(taskHTML).join('')}</ul><button class="add" data-a="add">＋ Add task</button>`}</div>`}
function render(){
  needRender=false;
  const pin=S.categories.filter(c=>c.pinned),rest=S.categories.filter(c=>!c.pinned);
  const sec=c=>`<h2>${esc(c.name)}</h2><div class="grid">${c.projects.filter(p=>!allDone(p)).map(p=>cardHTML(p)).join('')||'<p class="pct">No active projects</p>'}</div>`;
  const na=S.categories.reduce((a,c)=>a+c.projects.reduce((b,p)=>b+p.tasks.filter(t=>t.done).length,0),0);
  $('#tabArchive').textContent=`🗄 Archive (${na})`;$('#tabActive').classList.toggle('on',view==='active');$('#tabArchive').classList.toggle('on',view==='archive');
  if(view==='archive'){$('#pinned').innerHTML='';$('#cats').innerHTML='<h2>🗄 Archive / History</h2>'+archHTML();return}
  $('#pinned').innerHTML=pin.map(sec).join('');$('#cats').innerHTML=rest.map(sec).join('')}
const setTask=(t,set)=>mutate({k:'task',id:t.id,set});
function attach(t){
  const url=prompt('Paste a link (e.g. attachments/file.pdf or https://…), or leave blank to pick a file from this device:');if(url==null)return;
  const add=a=>setTask(t,{attachments:[...(t.attachments||[]),a]});
  if(url.trim()){const name=prompt('Name for this attachment:',decodeURIComponent(url.split('/').pop()))||url;add({name,url:url.trim()});return}
  const f=document.createElement('input');f.type='file';f.onchange=()=>{const file=f.files[0];if(!file)return;
    if(file.size>1.5e6){msg('File too big (max 1.5 MB here). Add it to the repo’s attachments/ folder and link it.');return}
    const rd=new FileReader();rd.onload=()=>{try{add({name:file.name,url:rd.result});msg(token()?'Attached — uploading to attachments/':'Attached in this browser — connect GitHub to upload it')}catch{msg('Browser storage full — link the file instead')}};rd.readAsDataURL(file)};f.click()}
function editor(host,vals,onSave){
  host.querySelector('.edit')?.remove();
  const f=document.createElement('form');f.className='edit';
  f.innerHTML=vals.map(v=>`<div class="fld">${v.area?`<textarea name="${v.k}" rows="2" placeholder="${v.ph}">${esc(v.v)}</textarea>`:`<input name="${v.k}" type="${v.type||'text'}" placeholder="${v.ph}" value="${esc(v.v)}">`}${v.type?'':mic()}</div>`).join('')+
  `<div class="fld"><button>Save</button><button type="button" data-x>Cancel</button></div>`;
  f.querySelectorAll('.mic').forEach(b=>b.onclick=()=>{const i=b.previousElementSibling;listen(t=>{i.value=(i.value?i.value+' ':'')+t;msg('Heard: '+t)},b)});
  f.querySelector('[data-x]').onclick=()=>{f.remove();if(needRender)render()};
  f.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));f.remove();onSave(v);render()};
  host.appendChild(f);f.querySelector('input,textarea').focus()}
const taskFields=t=>[{k:'text',v:t?.text||'',ph:'Task'},{k:'notes',v:t?.notes||'',ph:'Notes',area:1},{k:'due',v:t?.due||'',ph:'Due',type:'date'}];
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a;
  const li=b.closest('[data-t]'),card=b.closest('[data-p]');
  if(li){const f=findIn(S,li.dataset.t);if(!f)return;const{p,t}=f;
    if(a==='toggle'){if(b.checked){setTask(t,{done:true,completedAt:now()});msg('Moved to Archive')}else setTask(t,{done:false,completedAt:null,wasOpen:null,archivedBy:null})}
    if(a==='sub'){const s=b.closest('[data-s]');mutate({k:'sub',tid:t.id,id:s.dataset.s,set:{done:b.checked,completedAt:b.checked?now():null}})}
    if(a==='unarch'){setTask(t,{done:false,completedAt:null,wasOpen:null,archivedBy:null});msg('Restored to '+p.name)}
    if(a==='att')attach(t);
    if(a==='unatt'&&confirm('Remove this attachment?')){const l=[...t.attachments];l.splice(+b.dataset.i,1);setTask(t,{attachments:l.length?l:null})}
    if(a==='purge'&&confirm('Permanently delete this task? This cannot be undone.'))mutate({k:'purge',id:t.id});
    if(a==='edit')editor(li,taskFields(t),v=>{const set={notes:v.notes||null,due:v.due||null};if(v.text.trim())set.text=v.text.trim();setTask(t,set)});
    if(a==='del'){setTask(t,{done:true,completedAt:now(),archivedBy:'delete'});msg('Archived — find it in the Archive tab')}
    return}
  if(card){const{c,p}=projIn(S,card.dataset.p)||{};if(!p)return;
    if(a==='viewcard'){openArch.has(p.id)?openArch.delete(p.id):openArch.add(p.id);render();return}
    if(a==='add')editor(card,taskFields(),v=>{if(v.text.trim())mutate({k:'add',pid:p.id,task:{id:uid(),text:v.text.trim(),done:false,notes:v.notes||'',due:v.due||null,createdAt:now()}})});
    if(a==='status')editor(card,[{k:'status',v:p.status,ph:'Status'}],v=>mutate({k:'proj',id:p.id,set:{status:v.status}}));
    if(a==='rename')editor(card,[{k:'name',v:p.name,ph:'Project name'}],v=>{if(v.name.trim())mutate({k:'proj',id:p.id,set:{name:v.name.trim()}})});
    if(a==='delp'&&confirm(`Delete project “${p.name}” and all its tasks permanently? (Tip: archive tasks instead.)`))mutate({k:'purgeProj',id:p.id})}});
$('#tabActive').onclick=()=>{view='active';render()};$('#tabArchive').onclick=()=>{view='archive';render()};
$('#addProject').onclick=()=>{
  const names=S.categories.map((c,i)=>`${i+1}. ${c.name}`).join('\n');
  const ci=prompt('Category number (or type a new category name):\n'+names,'1');if(ci==null)return;
  const c=S.categories[+ci-1],cat=c?null:{id:uid(),name:ci};
  const name=prompt('Project name:');if(!name)return;const status=prompt('Status (optional):')||'';
  mutate({k:'addProj',cid:c?c.id:cat.id,cat,project:{id:uid(),name,status,tasks:[]}})};
$('#voiceAdd').onclick=e=>listen(text=>{
  const all=S.categories.flatMap(c=>c.projects);const low=text.toLowerCase();
  // "add X to <project>" routes to a project whose name is mentioned; otherwise ask.
  let p=all.find(p=>low.includes(p.name.toLowerCase().split(/[ (]/)[0]));
  if(!p){const list=all.map((p,i)=>`${i+1}. ${p.name}`).join('\n');const i=prompt(`Heard: “${text}”\nAdd to which project?\n${list}`,'1');if(i==null)return;p=all[+i-1];if(!p)return}
  const t=text.replace(/^add\s+/i,'').replace(new RegExp('\\s+(to|for)\\s+'+p.name.split(/[ (]/)[0]+'.*$','i'),'');
  mutate({k:'add',pid:p.id,task:{id:uid(),text:t.charAt(0).toUpperCase()+t.slice(1),done:false,notes:'',due:null,createdAt:now()}});msg(`Added to ${p.name}: ${t}`)},e.currentTarget);
if(!SR){$('#voiceAdd').title='Voice input not supported in this browser';$('#voiceAdd').style.opacity=.5}
$('#export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([serialize(S)],{type:'application/json'}));a.download=`project-tracker-${new Date().toISOString().slice(0,10)}.json`;a.click()};
$('#import').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(!Array.isArray(d.categories))throw 0;
  const ops=diffOps(d,S,'import');for(const o of ops){o.at=now();Q.push(o)}saveQ();derive();render();scheduleSync(100);msg(`Imported ${ops.length} change(s)`)}catch{msg('Invalid JSON file')}e.target.value=''};
$('#reset').onclick=()=>{if(!Q.length){load().then(()=>msg('Reloaded from GitHub'));return}
  if(confirm(`Discard ${Q.length} change(s) not yet saved to GitHub and reload data.json?`)){Q=[];saveQ();lastErr=null;load().then(()=>msg('Reset to server data'))}};
// GitHub connection panel. The token lives only in this browser's localStorage.
const panel=$('#ghPanel'),showPanel=()=>{panel.classList.remove('hidden');$('#ghTok').value='';$('#ghState').textContent=token()?'Connected: a token is saved in this browser.':'Not connected.'};
$('#ghBtn').onclick=()=>panel.classList.contains('hidden')?showPanel():panel.classList.add('hidden');
$('#sync').onclick=()=>{const st=$('#sync').dataset.state;if(st==='local'||st==='error')showPanel();else if(Q.length)scheduleSync(0)};
$('#ghClose').onclick=()=>panel.classList.add('hidden');
$('#ghSave').onclick=async()=>{const t=$('#ghTok').value.trim();if(!t){$('#ghState').textContent='Paste a token first.';return}
  $('#ghState').textContent='Testing…';
  try{await ghGet(FILE,t);localStorage.setItem(K.tok,t);$('#ghTok').value='';lastErr=null;$('#ghState').textContent='✅ Connected. Reading works; your next change will be saved to GitHub.';
    await load();scheduleSync(0)}
  catch(e){$('#ghState').textContent='❌ '+(e.status===0?'Could not reach GitHub':e.message)+' — token not saved.'}};
$('#ghOff').onclick=()=>{localStorage.removeItem(K.tok);lastErr=null;setSync('local');$('#ghState').textContent='Disconnected. Changes stay in this browser until you reconnect.'};
load();
