const KEY='pt-state-v1',SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let server=null,S=null;const $=s=>document.querySelector(s);
const uid=()=>'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const msg=t=>{$('#msg').textContent=t;clearTimeout(msg.t);msg.t=setTimeout(()=>$('#msg').textContent='',4000)};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(S));render()};
// Merge: user's saved state wins; new server categories/projects/tasks (not deleted locally) get layered in.
function merge(base,local){
  if(!local)return structuredClone(base);
  const del=new Set(local.deleted||[]),out=structuredClone(local);
  for(const c of base.categories){if(del.has(c.id))continue;let lc=out.categories.find(x=>x.id===c.id);
    if(!lc){out.categories.push(structuredClone(c));continue}
    for(const p of c.projects){if(del.has(p.id))continue;let lp=lc.projects.find(x=>x.id===p.id);
      if(!lp){lc.projects.push(structuredClone(p));continue}
      for(const t of p.tasks)if(!del.has(t.id)&&!lp.tasks.some(x=>x.id===t.id))lp.tasks.push(structuredClone(t))}}
  return out}
// Old versions hard-deleted tasks (IDs kept in S.deleted). Bring any server task/project that was deleted
// back as an archived (done) item, unless it was purged from the Archive on purpose.
function recover(base,S){
  const del=new Set(S.deleted||[]),purged=new Set(S.purged||[]),now=new Date().toISOString(),got=[];
  const arch=(t,p)=>{const n=structuredClone(t);if(!n.done){n.done=true;n.wasOpen=true}n.completedAt=n.completedAt||now;n.recovered=now;got.push(n.text+' ('+p.name+')');return n};
  for(const c of base.categories){let lc=S.categories.find(x=>x.id===c.id);
    if(!lc){if(!del.has(c.id))continue;lc={...structuredClone(c),projects:[]};S.categories.push(lc)}
    for(const p of c.projects){if(purged.has(p.id))continue;let lp=lc.projects.find(x=>x.id===p.id);
      if(!lp){if(!del.has(p.id))continue;lp={...structuredClone(p),tasks:[]};lc.projects.push(lp)}
      for(const t of p.tasks)if(del.has(t.id)||del.has(p.id)){if(!purged.has(t.id)&&!lp.tasks.some(x=>x.id===t.id))lp.tasks.push(arch(t,p))}}}
  S.deleted=[];return got}
// When data.json bumps `rev`, drop localStorage overrides for tasks the server has reopened
// (done:false). Otherwise an archived-in-browser copy keeps hiding the reopened task.
function applyServerReopens(base,S){
  const srvRev=+(base.rev||0),locRev=+(S.rev||0);
  if(srvRev<=locRev){S.rev=Math.max(srvRev,locRev);return 0}
  const st={};for(const c of base.categories||[])for(const p of c.projects||[])for(const t of p.tasks||[])st[t.id]=t;
  let n=0;
  for(const c of S.categories)for(const p of c.projects)for(const t of p.tasks){const b=st[t.id];if(!b)continue;
    // Server marked done in a newer rev (doneRev): done state wins over the browser copy
    if(b.done){if(+(b.doneRev||0)>locRev&&!t.done){t.done=true;t.completedAt=b.completedAt;n++}else if(+(b.doneRev||0)>locRev)t.completedAt=b.completedAt;
      if(+(b.doneRev||0)>locRev&&b.transcript!=null)t.transcript=b.transcript;continue}
    // Server open state wins: reopen + take server text/notes/attachments
    if(t.done||t.text!==b.text||(b.notes!=null&&t.notes!==b.notes)||(b.transcript!=null&&t.transcript!==b.transcript))n++;
    t.done=false;delete t.completedAt;delete t.wasOpen;delete t.archivedBy;delete t.recovered;
    t.text=b.text;if(b.notes!=null)t.notes=b.notes;if(b.due!==undefined)t.due=b.due;
    if(b.attachments)t.attachments=structuredClone(b.attachments);
    if(b.transcript!=null)t.transcript=b.transcript}
  S.rev=srvRev;return n}
async function load(){
  try{server=await (await fetch('data.json?'+Date.now())).json()}catch(e){server={categories:[]};msg('Could not load data.json')}
  let local=null;try{local=JSON.parse(localStorage.getItem(KEY))}catch{}
  S=merge(server,local);S.deleted=S.deleted||[];S.purged=S.purged||[];
  const got=recover(server,S);
  const reopened=applyServerReopens(server,S);
  // backfill completedAt from server data for done tasks
  const st={};for(const c of server.categories)for(const p of c.projects)for(const t of p.tasks)st[t.id]=t;
  for(const c of S.categories)for(const p of c.projects)for(const t of p.tasks){const b=st[t.id];
    if(t.done&&!t.completedAt)t.completedAt=b?.completedAt||new Date().toISOString();
    if(b?.attachments&&!t.attachments)t.attachments=b.attachments;
    // transcript isn't editable in the UI, so the server copy always wins (reaches cached browsers too)
    if(b?.transcript!=null)t.transcript=b.transcript;
    if(b?.agent)t.agent=b.agent;else delete t.agent}
  if(local||got.length||reopened)localStorage.setItem(KEY,JSON.stringify(S));
  if(got.length)setTimeout(()=>msg(`Recovered ${got.length} deleted task(s) into the Archive`),50);
  else if(reopened)setTimeout(()=>msg(`Synced ${reopened} task change(s) from server`),50);
  if(S.title)$('#title').textContent=S.title;render()}
function find(tid){for(const c of S.categories)for(const p of c.projects){const t=p.tasks.find(x=>x.id===tid);if(t)return{c,p,t}}}
function proj(pid){for(const c of S.categories){const p=c.projects.find(x=>x.id===pid);if(p)return{c,p}}}
function listen(cb,btn){
  if(!SR){msg('Voice input isn’t supported in this browser — try Chrome or Safari.');return}
  const r=new SR();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;
  btn&&btn.classList.add('on');msg('Listening…');
  r.onresult=e=>cb(e.results[0][0].transcript.trim());
  r.onerror=e=>msg('Voice error: '+e.error);r.onend=()=>{btn&&btn.classList.remove('on')};r.start()}
const mic=()=>`<button type="button" class="ic mic" title="Dictate" ${SR?'':'disabled title="Voice not supported"'}>🎤</button>`;
let view='active';
const fmt=d=>d?new Date(d).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'date unknown';
const attHTML=t=>(t.attachments||[]).length?`<div class="atts">${t.attachments.map((x,i)=>`<span class="chip"><a href="${esc(x.url)}" target="_blank" rel="noopener" ${x.url.startsWith('data:')?`download="${esc(x.name)}"`:''}>📎 ${esc(x.name)}</a><button class="ic" data-a="unatt" data-i="${i}" title="Remove attachment">✕</button></span>`).join('')}</div>`:'';
// Optional full verbatim transcript, collapsed under the task behind a "More" toggle.
const trHTML=t=>t.transcript?`<details class="tr"><summary>More</summary><div class="trx">${esc(t.transcript)}</div></details>`:'';
function taskHTML(t){
  if(t.done)return'';
  return`<li class="${t.done?'done':''}" data-t="${t.id}"><div class="row"><input type="checkbox" ${t.done?'checked':''} data-a="toggle">
  <span class="txt">${esc(t.text)}${t.due?`<span class="due">📅 ${esc(t.due)}</span>`:''}</span>
  <button class="ic" data-a="att" title="Attach file or link">📎</button><button class="ic" data-a="edit" title="Edit">✏️</button><button class="ic" data-a="del" title="Archive (delete)">🗑</button></div>
  ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}${trHTML(t)}${attHTML(t)}${agentHTML(t.agent)}</li>`}
// What the scheduled Claude run did with this task (written to data.json by agent/apply_results.py).
const AG={pr_opened:['🤖','PR ready to review','ok'],needs_austin:['🙋','Needs you','warn'],blocked:['⛔','Blocked','bad'],
  failed:['⚠️','Claude couldn’t finish','bad'],retry:['⏳','Claude will retry next run','mut'],done_no_change:['🤖','Checked — nothing to change','mut']};
const safeUrl=u=>/^https:\/\/github\.com\//.test(u||'')?u:'';
function agentHTML(a){if(!a||!AG[a.status])return'';const[i,l,k]=AG[a.status],u=safeUrl(a.pr_url);
  return`<div class="agent ${k}"><b>${i} ${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`:l}</b>${a.summary?`<span>${esc(a.summary)}</span>`:''}${a.next_step?`<span class="nx">Next: ${esc(a.next_step)}</span>`:''}</div>`}
const allDone=p=>p.tasks.length>0&&p.tasks.every(t=>t.done);
let openArch=new Set();
function archHTML(){
  const groups=[];for(const c of S.categories)for(const p of c.projects){const ts=p.tasks.filter(t=>t.done);if(ts.length)groups.push({c,p,ts,last:ts.reduce((m,t)=>(t.completedAt||'')>m?t.completedAt:m,'')})}
  if(!groups.length)return'<p class="pct">Nothing archived yet.</p>';
  groups.sort((a,b)=>b.last.localeCompare(a.last));
  return groups.map(({c,p,ts})=>{ts.sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||''));const full=allDone(p);
  return`<div class="card" data-p="${p.id}"><div class="ph"><h3>${esc(p.name)}</h3><span class="pct">${esc(c.name)}${full?' · 📦 card archived':''}</span></div>
  ${full?`<button class="add" data-a="viewcard">${openArch.has(p.id)?'Hide archived card':'🗂 View archived card'}</button>${openArch.has(p.id)?`<div class="archcard">${cardHTML(p,true)}</div>`:''}`:''}
  <ul>${ts.map(t=>`<li class="done" data-t="${t.id}"><div class="row"><input type="checkbox" checked data-a="toggle" title="Un-archive (mark not done)">
  <span class="txt">${esc(t.text)}${t.wasOpen?'<span class="due" title="Was not done when deleted">⚠ was open</span>':''}<div class="meta">✅ ${fmt(t.completedAt)}${t.recovered?' · ♻ recovered':''}</div></span>
  <button class="ic" data-a="unarch" title="Un-archive">↩</button><button class="ic" data-a="att" title="Attach file or link">📎</button><button class="ic" data-a="purge" title="Delete permanently">🗑</button></div>
  ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}${trHTML(t)}${attHTML(t)}</li>`).join('')}</ul></div>`}).join('')}
function cardHTML(p,ro){
  const n=p.tasks.length,d=p.tasks.filter(t=>t.done).length,pc=n?Math.round(d/n*100):0;
  return`<div class="card" data-p="${p.id}"><div class="ph"><h3>${esc(p.name)}</h3>
  ${ro?'':`<span><button class="ic" data-a="rename" title="Rename">✏️</button><button class="ic" data-a="delp" title="Delete project">🗑</button></span>`}</div>
  <div class="status" ${ro?'':'data-a="status" title="Click to edit status"'}>${esc(p.status)}</div>
  <div class="bar"><i style="width:${pc}%"></i></div><div class="pct">${d}/${n} done · ${pc}%</div>
  ${ro?`<ul>${p.tasks.map(t=>`<li class="done"><span class="txt">✅ ${esc(t.text)}</span>${trHTML(t)}</li>`).join('')}</ul>`:`<ul>${p.tasks.map(taskHTML).join('')}</ul><button class="add" data-a="add">＋ Add task</button>`}</div>`}
function render(){
  const pin=S.categories.filter(c=>c.pinned),rest=S.categories.filter(c=>!c.pinned);
  const sec=c=>`<h2>${esc(c.name)}</h2><div class="grid">${c.projects.filter(p=>!allDone(p)).map(p=>cardHTML(p)).join('')||'<p class="pct">No active projects</p>'}</div>`;
  const na=S.categories.reduce((a,c)=>a+c.projects.reduce((b,p)=>b+p.tasks.filter(t=>t.done).length,0),0);
  $('#tabArchive').textContent=`🗄 Archive (${na})`;$('#tabActive').classList.toggle('on',view==='active');$('#tabArchive').classList.toggle('on',view==='archive');
  if(view==='archive'){$('#pinned').innerHTML='';$('#cats').innerHTML='<h2>🗄 Archive / History</h2>'+archHTML();return}
  $('#pinned').innerHTML=pin.map(sec).join('');$('#cats').innerHTML=rest.map(sec).join('')}
function attach(t){
  const url=prompt('Paste a link (e.g. attachments/file.pdf or https://…), or leave blank to pick a file from this device:');if(url==null)return;
  if(url.trim()){const name=prompt('Name for this attachment:',decodeURIComponent(url.split('/').pop()))||url;(t.attachments=t.attachments||[]).push({name,url:url.trim()});save();return}
  const f=document.createElement('input');f.type='file';f.onchange=()=>{const file=f.files[0];if(!file)return;
    if(file.size>1.5e6){msg('File too big for in-browser storage (max 1.5 MB). Add it to the repo’s attachments/ folder and link it.');return}
    const rd=new FileReader();rd.onload=()=>{(t.attachments=t.attachments||[]).push({name:file.name,url:rd.result});
      try{save();msg('Attached (stored in this browser only — Export to keep a copy)')}catch{t.attachments.pop();msg('Browser storage full — link the file instead')}};rd.readAsDataURL(file)};f.click()}
function editor(host,vals,onSave){
  host.querySelector('.edit')?.remove();
  const f=document.createElement('form');f.className='edit';
  f.innerHTML=vals.map(v=>`<div class="fld">${v.area?`<textarea name="${v.k}" rows="2" placeholder="${v.ph}">${esc(v.v)}</textarea>`:`<input name="${v.k}" type="${v.type||'text'}" placeholder="${v.ph}" value="${esc(v.v)}">`}${v.type?'':mic()}</div>`).join('')+
  `<div class="fld"><button>Save</button><button type="button" data-x>Cancel</button></div>`;
  f.querySelectorAll('.mic').forEach(b=>b.onclick=()=>{const i=b.previousElementSibling;listen(t=>{i.value=(i.value?i.value+' ':'')+t;msg('Heard: '+t)},b)});
  f.querySelector('[data-x]').onclick=()=>f.remove();
  f.onsubmit=e=>{e.preventDefault();onSave(Object.fromEntries(new FormData(f)));save()};
  host.appendChild(f);f.querySelector('input,textarea').focus()}
const taskFields=t=>[{k:'text',v:t?.text||'',ph:'Task'},{k:'notes',v:t?.notes||'',ph:'Notes',area:1},{k:'due',v:t?.due||'',ph:'Due',type:'date'}];
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a;
  const li=b.closest('[data-t]'),card=b.closest('[data-p]');
  if(li){const{p,t}=find(li.dataset.t);
    if(a==='toggle'){t.done=b.checked;if(t.done)t.completedAt=new Date().toISOString();else{delete t.completedAt;delete t.wasOpen}save();if(t.done)msg('Moved to Archive')}
    if(a==='unarch'){t.done=false;delete t.completedAt;delete t.wasOpen;save();msg('Restored to '+p.name)}
    if(a==='att')attach(t);
    if(a==='unatt'&&confirm('Remove this attachment?')){t.attachments.splice(+b.dataset.i,1);save()}
    if(a==='purge'&&confirm('Permanently delete this task? This cannot be undone.')){p.tasks=p.tasks.filter(x=>x!==t);S.purged.push(t.id);save()}
    if(a==='edit')editor(li,taskFields(t),v=>{if(v.text.trim())t.text=v.text.trim();t.notes=v.notes;t.due=v.due||null});
    if(a==='del'){t.done=true;t.completedAt=new Date().toISOString();t.archivedBy='delete';save();msg('Archived — find it in the Archive tab')}
    return}
  if(card){const{c,p}=proj(card.dataset.p);
    if(a==='viewcard'){openArch.has(p.id)?openArch.delete(p.id):openArch.add(p.id);render();return}
    if(a==='add')editor(card,taskFields(),v=>{if(v.text.trim())p.tasks.push({id:uid(),text:v.text.trim(),done:false,notes:v.notes,due:v.due||null})});
    if(a==='status')editor(card,[{k:'status',v:p.status,ph:'Status'}],v=>p.status=v.status);
    if(a==='rename')editor(card,[{k:'name',v:p.name,ph:'Project name'}],v=>{if(v.name.trim())p.name=v.name.trim()});
    if(a==='delp'&&confirm(`Delete project “${p.name}” and all its tasks permanently? (Tip: archive tasks instead.)`)){c.projects=c.projects.filter(x=>x!==p);S.purged.push(p.id,...p.tasks.map(t=>t.id));save()}}});
$('#tabActive').onclick=()=>{view='active';render()};$('#tabArchive').onclick=()=>{view='archive';render()};
$('#addProject').onclick=()=>{
  const names=S.categories.map((c,i)=>`${i+1}. ${c.name}`).join('\n');
  const ci=prompt('Category number (or type a new category name):\n'+names,'1');if(ci==null)return;
  let c=S.categories[+ci-1];if(!c){c={id:uid(),name:ci,projects:[]};S.categories.push(c)}
  const name=prompt('Project name:');if(!name)return;const status=prompt('Status (optional):')||'';
  c.projects.push({id:uid(),name,status,tasks:[]});save()};
$('#voiceAdd').onclick=e=>listen(text=>{
  const all=S.categories.flatMap(c=>c.projects);const low=text.toLowerCase();
  // "add X to <project>" routes to a project whose name is mentioned; otherwise ask.
  let p=all.find(p=>low.includes(p.name.toLowerCase().split(/[ (]/)[0]));
  if(!p){const list=all.map((p,i)=>`${i+1}. ${p.name}`).join('\n');const i=prompt(`Heard: “${text}”\nAdd to which project?\n${list}`,'1');if(i==null)return;p=all[+i-1];if(!p)return}
  const t=text.replace(/^add\s+/i,'').replace(new RegExp('\\s+(to|for)\\s+'+p.name.split(/[ (]/)[0]+'.*$','i'),'');
  p.tasks.push({id:uid(),text:t.charAt(0).toUpperCase()+t.slice(1),done:false,notes:'',due:null});save();msg(`Added to ${p.name}: ${t}`)},e.currentTarget);
if(!SR){$('#voiceAdd').title='Voice input not supported in this browser';$('#voiceAdd').style.opacity=.5}
$('#export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}));a.download=`project-tracker-${new Date().toISOString().slice(0,10)}.json`;a.click()};
$('#import').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(!Array.isArray(d.categories))throw 0;S=d;S.deleted=S.deleted||[];S.purged=S.purged||[];save();msg('Imported')}catch{msg('Invalid JSON file')}e.target.value=''};
$('#reset').onclick=()=>{if(confirm('Discard all your local edits and reload the latest data from the server?')){localStorage.removeItem(KEY);load().then(()=>msg('Reset to server data'))}};
load();
