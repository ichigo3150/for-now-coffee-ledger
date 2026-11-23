import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const PEOPLE=['岩間','小林','谷'];
const CATS={sale:['現金','キャッシュレス'],cost:['出店料','豆・材料','カップ・消耗品','備品・機材','交通費','宿泊費','食事','その他']};
const st={kind:'sale',cat:'現金',person:null,tab:'in'};
let entries=[],readOnly=false,editId=null,loadTimer=null,unsub=null;

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
let fs;
try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){fs=getFirestore(app)}
const col=collection(fs,'entries');

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>(n<0?'−':'')+'¥'+Math.abs(Math.round(n)).toLocaleString('ja-JP');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtDate=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?Number(m[2])+'/'+Number(m[3]):''};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

function setStatus(t,warn){const s=$('#status');s.textContent=t;s.className='status'+(warn&&t?' warn':'')}
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className='msg '+(ok?'ok':'ng')}

function drawKind(){
  for(const b of document.querySelectorAll('#kind button'))b.setAttribute('aria-pressed',String(b.dataset.k===st.kind));
  if(!CATS[st.kind].includes(st.cat))st.cat=CATS[st.kind][0];
  $('#cats').innerHTML=CATS[st.kind].map(c=>`<button type="button" data-c="${esc(c)}" aria-pressed="${c===st.cat}">${esc(c)}</button>`).join('');
  $('#whoLabel').textContent=st.kind==='sale'?'受け取った人（お金を持っている人）':'払った人（立て替えた人）';
}
function drawPeople(){$('#people').innerHTML=PEOPLE.map(p=>`<button type="button" data-p="${esc(p)}" aria-pressed="${p===st.person}">${esc(p)}</button>`).join('')}

function filtered(){const f=$('#fEvent').value;return f?entries.filter(e=>e.event===f):entries}
function totals(list){let s=0,c=0;for(const e of list){if(e.kind==='sale')s+=e.amount||0;else c+=e.amount||0}return{s,c,p:s-c}}
function eventNames(){const seen=new Set();for(const e of [...entries].sort((a,b)=>(b.date||'').localeCompare(a.date||''))){if(e.event)seen.add(e.event)}return[...seen]}

function render(){
  const names=eventNames(),f=$('#fEvent'),cur=f.value;
  f.innerHTML='<option value="">すべてのイベント</option>'+names.map(n=>`<option${n===cur?' selected':''}>${esc(n)}</option>`).join('');
  if(cur&&!names.includes(cur))f.value='';
  $('#events').innerHTML=names.map(n=>`<option value="${esc(n)}">`).join('');
  const list=filtered(),t=totals(list);
  $('#hProfit').textContent=yen(t.p);$('#hSale').textContent=yen(t.s);$('#hCost').textContent=yen(t.c);
  const sorted=[...list].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0));
  const pending=entries.filter(e=>e._pending).length;
  $('#logCount').textContent=sorted.length+'件'+(pending?`（未送信 ${pending}件）`:'');
  $('#list').innerHTML=sorted.length?sorted.map(e=>`<li data-id="${esc(e.id)}">
    <span class="what">${esc(e.category)}<span class="meta" style="font-weight:400"> ・ ${esc(e.person)}</span></span>
    <span class="money ${e.kind==='sale'?'s':'c'}">${e.kind==='sale'?'+':'−'}${yen(e.amount).replace('−','')}</span>
    <span class="meta">${fmtDate(e.date)}　${esc(e.event)}${e._pending?'　・未送信':''}</span>
    ${readOnly?'':`<span class="ops"><button type="button" class="ghost" data-edit>編集</button><button type="button" class="ghost" data-del>削除</button></span>`}
    ${e.memo?`<span class="memo">${esc(e.memo)}</span>`:''}</li>`).join(''):'<li class="empty" style="display:block">まだ記録がありません。「入力」から最初の1件を記録しましょう。</li>';
  const ev=names.map(n=>({n,...totals(entries.filter(e=>e.event===n))})),all=totals(entries);
  $('#evRows').innerHTML=ev.length?ev.map(r=>`<tr><td>${esc(r.n)}</td><td class="s">${yen(r.s)}</td><td class="c">${yen(r.c)}</td><td><b>${yen(r.p)}</b></td></tr>`).join('')+`<tr><td><b>合計</b></td><td class="s"><b>${yen(all.s)}</b></td><td class="c"><b>${yen(all.c)}</b></td><td><b>${yen(all.p)}</b></td></tr>`:'<tr><td colspan="4" class="empty">記録がまだありません</td></tr>';
  const byCat=CATS.cost.map(c=>({c,v:list.filter(e=>e.kind==='cost'&&e.category===c).reduce((a,e)=>a+(e.amount||0),0)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  const mx=Math.max(1,...byCat.map(x=>x.v));
  $('#catRows').innerHTML=byCat.length?byCat.map(x=>`<div class="cat"><span>${esc(x.c)}</span><span class="track"><span class="fill" style="display:block;width:${(x.v/mx*100).toFixed(1)}%"></span></span><b>${yen(x.v)}</b></div>`).join(''):'<p class="empty">経費の記録がありません</p>';
  const share=t.p/PEOPLE.length,rows=PEOPLE.map(p=>{const mine=list.filter(e=>e.person===p);const paid=mine.filter(e=>e.kind==='cost').reduce((a,e)=>a+(e.amount||0),0);const held=mine.filter(e=>e.kind==='sale').reduce((a,e)=>a+(e.amount||0),0);return{p,paid,held,bal:share-(held-paid)}});
  $('#payRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.p)}</td><td>${yen(r.paid)}</td><td>${yen(r.held)}</td><td class="${r.bal>=0?'s':'c'}"><b>${r.bal>=0?'+':''}${yen(r.bal)}</b></td></tr>`).join('');
  const mv=moves(rows);
  $('#moves').innerHTML=list.length?(mv.length?mv.map(m=>`<li>${esc(m[0])} → ${esc(m[1])}<b>${yen(m[2])}</b></li>`).join(''):'<li>精算の必要はありません</li>'):'<li>記録がまだありません</li>';
}
function moves(rows){
  const pos=rows.map(r=>({p:r.p,v:Math.round(r.bal)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  const neg=rows.map(r=>({p:r.p,v:Math.round(r.bal)})).filter(x=>x.v<0).sort((a,b)=>a.v-b.v);
  const out=[];let i=0,j=0;
  while(i<pos.length&&j<neg.length){const m=Math.min(pos[i].v,-neg[j].v);if(m>0)out.push([neg[j].p,pos[i].p,m]);pos[i].v-=m;neg[j].v+=m;if(pos[i].v<=0)i++;if(neg[j].v>=0)j++}
  return out;
}

function resetForm(){editId=null;$('#amount').value='';$('#memo').value='';$('#save').textContent='記録する';$('#cancelWrap').hidden=true}
function switchTab(t){st.tab=t;for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-selected',String(b.dataset.t===t));for(const s of ['in','log','sum','pay'])$('#t-'+s).hidden=s!==t;window.scrollTo({top:0})}
function showApp(on){$('#login').hidden=on;$('nav').hidden=!on;for(const s of ['in','log','sum','pay'])$('#t-'+s).hidden=!on||s!==st.tab;$('#account').hidden=!on}

$('#kind').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.kind=b.dataset.k;drawKind()});
$('#cats').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.cat=b.dataset.c;drawKind()});
$('#people').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.person=b.dataset.p;ls.set('cfl-person',st.person);drawPeople()});
document.querySelector('nav').addEventListener('click',e=>{const b=e.target.closest('button');if(b)switchTab(b.dataset.t)});
$('#fEvent').addEventListener('change',render);
$('#amount').addEventListener('input',e=>{const d=e.target.value.replace(/[^\d]/g,'');e.target.value=d?Number(d).toLocaleString('ja-JP'):''});
$('#cancel').addEventListener('click',()=>{resetForm();msg('')});

function writeError(err){
  if(err&&err.code==='permission-denied')msg('このアカウントには記録する権限がありません。登録されたGoogleアカウントでログインしてください。');
  else msg('保存できませんでした。通信状況を確認して、もう一度お試しください。');
}

$('#form').addEventListener('submit',e=>{
  e.preventDefault();
  if(readOnly){msg('このアカウントでは記録できません');return}
  const amount=Number($('#amount').value.replace(/[^\d]/g,''));
  const event=$('#event').value.trim();
  if(!amount){msg('金額を入れてください');$('#amount').focus();return}
  if(!st.person){msg('だれのお金かを選んでください');return}
  if(!event){msg('イベント名を入れてください');$('#event').focus();return}
  const old=editId?entries.find(x=>x.id===editId):null;
  const body={date:$('#date').value||today(),event,kind:st.kind,category:st.cat,amount,person:st.person,memo:$('#memo').value.trim(),createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),by:auth.currentUser?.email||''};
  const ref=editId?doc(col,editId):doc(col);
  // 電波がなくても端末に先に保存され、つながったら自動で送られる
  setDoc(ref,body).catch(writeError);
  ls.set('cfl-event',event);
  const was=!!editId;resetForm();
  msg((was?'更新しました：':'記録しました：')+body.category+' '+yen(amount)+(navigator.onLine?'':'（電波が戻ったら自動で送信します）'),true);
  if(was)switchTab('log');
});

$('#list').addEventListener('click',e=>{
  const li=e.target.closest('li[data-id]');if(!li)return;const id=li.dataset.id;const it=entries.find(x=>x.id===id);if(!it)return;
  if(e.target.closest('[data-edit]')){
    editId=id;st.kind=it.kind;st.cat=it.category;st.person=it.person;drawKind();drawPeople();
    $('#amount').value=Number(it.amount||0).toLocaleString('ja-JP');$('#event').value=it.event||'';$('#date').value=it.date||today();$('#memo').value=it.memo||'';
    $('#save').textContent='この内容で更新';$('#cancelWrap').hidden=false;msg('');switchTab('in');
  }
  const d=e.target.closest('[data-del]');
  if(d){
    if(d.dataset.sure!=='1'){d.dataset.sure='1';d.textContent='本当に削除';setTimeout(()=>{if(d.isConnected){d.dataset.sure='';d.textContent='削除'}},3000);return}
    d.disabled=true;
    deleteDoc(doc(col,id)).catch(()=>{d.disabled=false;d.textContent='削除できませんでした'});
  }
});

$('#copyCsv').addEventListener('click',async e=>{
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const rows=[['日付','イベント','種類','科目','金額','人','メモ']].concat([...filtered()].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(x=>[x.date,x.event,x.kind==='sale'?'売上':'経費',x.category,x.amount,x.person,x.memo]));
  try{await navigator.clipboard.writeText(rows.map(r=>r.map(q).join(',')).join('\n'));e.target.textContent='コピーしました'}catch(err){e.target.textContent='コピーできませんでした'}
  setTimeout(()=>{e.target.textContent='CSVをコピー'},2000);
});

$('#loginBtn').addEventListener('click',async()=>{
  $('#loginNote').textContent='';
  try{await signInWithPopup(auth,new GoogleAuthProvider().setCustomParameters({prompt:'select_account'}))}
  catch(err){if(err.code!=='auth/popup-closed-by-user'&&err.code!=='auth/cancelled-popup-request')$('#loginNote').textContent='ログインできませんでした（'+err.code+'）。ポップアップがブロックされていないか確認してください。'}
});
$('#logout').addEventListener('click',()=>signOut(auth));

onAuthStateChanged(auth,user=>{
  if(unsub){unsub();unsub=null}
  clearTimeout(loadTimer);
  if(!user){entries=[];readOnly=false;showApp(false);setStatus('');render();return}
  showApp(true);
  $('#who').textContent=user.email+' でログイン中';
  setStatus('記録を読み込んでいます…');
  loadTimer=setTimeout(()=>setStatus('サーバーにつながりません。電波が戻ると自動で同期します。',true),10000);
  unsub=onSnapshot(col,{includeMetadataChanges:true},snap=>{
    entries=snap.docs.map(d=>({id:d.id,...d.data(),_pending:d.metadata.hasPendingWrites}));
    if(!snap.metadata.fromCache){clearTimeout(loadTimer);setStatus('')}
    readOnly=false;$('#save').disabled=false;
    render();
  },err=>{
    clearTimeout(loadTimer);
    if(err.code==='permission-denied'){readOnly=true;$('#save').disabled=true;setStatus(user.email+' はこのアプリを使えません。登録されたGoogleアカウントでログインし直してください。',true)}
    else setStatus('記録を読み込めませんでした（'+err.code+'）。ページを開き直してください。',true);
    render();
  });
});

st.person=PEOPLE.includes(ls.get('cfl-person'))?ls.get('cfl-person'):null;
$('#date').value=today();$('#event').value=ls.get('cfl-event')||'';
drawKind();drawPeople();render();

// ホーム画面に追加したときにアプリとして動かすための仕組み（オフライン対応）
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{})}
