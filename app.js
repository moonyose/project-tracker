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
async function load(){
  try{server=await (await fetch('data.json?'+Date.now())).json()}catch(e){server={categories:[]};msg('Could not load data.json')}
  let local=null;try{local=JSON.parse(localStorage.getItem(KEY))}catch{}
  S=merge(server,local);S.deleted=S.deleted||[];if(S.title)$('#title').textContent=S.title;render()}
function find(tid){for(const c of S.categories)for(const p of c.projects){const t=p.tasks.find(x=>x.id===tid);if(t)return{c,p,t}}}
function proj(pid){for(const c of S.categories){const p=c.projects.find(x=>x.id===pid);if(p)return{c,p}}}
function listen(cb,btn){
  if(!SR){msg('Voice input isn’t supported in this browser — try Chrome or Safari.');return}
  const r=new SR();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;
  btn&&btn.classList.add('on');msg('Listening…');
  r.onresult=e=>cb(e.results[0][0].transcript.trim());
  r.onerror=e=>msg('Voice error: '+e.error);r.onend=()=>{btn&&btn.classList.remove('on')};r.start()}
const mic=()=>`<button type="button" class="ic mic" title="Dictate" ${SR?'':'disabled title="Voice not supported"'}>🎤</button>`;
const onlyDone=()=>$('#onlyDone').checked,showDone=()=>$('#showDone').checked;
function taskHTML(t){
  if(onlyDone()&&!t.done||!showDone()&&t.done&&!onlyDone())return'';
  return`<li class="${t.done?'done':''}" data-t="${t.id}"><div class="row"><input type="checkbox" ${t.done?'checked':''} data-a="toggle">
  <span class="txt">${esc(t.text)}${t.due?`<span class="due">📅 ${esc(t.due)}</span>`:''}</span>
  <button class="ic" data-a="edit" title="Edit">✏️</button><button class="ic" data-a="del" title="Delete">🗑</button></div>
  ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}</li>`}
function cardHTML(p){
  const n=p.tasks.length,d=p.tasks.filter(t=>t.done).length,pc=n?Math.round(d/n*100):0;
  return`<div class="card" data-p="${p.id}"><div class="ph"><h3>${esc(p.name)}</h3>
  <span><button class="ic" data-a="rename" title="Rename">✏️</button><button class="ic" data-a="delp" title="Delete project">🗑</button></span></div>
  <div class="status" data-a="status" title="Click to edit status">${esc(p.status)}</div>
  <div class="bar"><i style="width:${pc}%"></i></div><div class="pct">${d}/${n} done · ${pc}%</div>
  <ul>${p.tasks.map(taskHTML).join('')}</ul><button class="add" data-a="add">＋ Add task</button></div>`}
function render(){
  const pin=S.categories.filter(c=>c.pinned),rest=S.categories.filter(c=>!c.pinned);
  const sec=c=>`<h2>${esc(c.name)}</h2><div class="grid">${c.projects.map(cardHTML).join('')||'<p class="pct">No projects</p>'}</div>`;
  $('#pinned').innerHTML=pin.map(sec).join('');$('#cats').innerHTML=rest.map(sec).join('')}
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
    if(a==='toggle'){t.done=b.checked;save()}
    if(a==='edit')editor(li,taskFields(t),v=>{if(v.text.trim())t.text=v.text.trim();t.notes=v.notes;t.due=v.due||null});
    if(a==='del'&&confirm('Delete this task?')){p.tasks=p.tasks.filter(x=>x!==t);S.deleted.push(t.id);save()}
    return}
  if(card){const{c,p}=proj(card.dataset.p);
    if(a==='add')editor(card,taskFields(),v=>{if(v.text.trim())p.tasks.push({id:uid(),text:v.text.trim(),done:false,notes:v.notes,due:v.due||null})});
    if(a==='status')editor(card,[{k:'status',v:p.status,ph:'Status'}],v=>p.status=v.status);
    if(a==='rename')editor(card,[{k:'name',v:p.name,ph:'Project name'}],v=>{if(v.name.trim())p.name=v.name.trim()});
    if(a==='delp'&&confirm(`Delete project “${p.name}”?`)){c.projects=c.projects.filter(x=>x!==p);S.deleted.push(p.id);save()}}});
$('#showDone').onchange=$('#onlyDone').onchange=render;
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
$('#import').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(!Array.isArray(d.categories))throw 0;S=d;S.deleted=S.deleted||[];save();msg('Imported')}catch{msg('Invalid JSON file')}e.target.value=''};
$('#reset').onclick=()=>{if(confirm('Discard all your local edits and reload the latest data from the server?')){localStorage.removeItem(KEY);load().then(()=>msg('Reset to server data'))}};
load();
