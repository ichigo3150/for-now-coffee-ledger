import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ===== 設定 =====
const PEOPLE=['岩間','小林','谷'];   // 屋号情報にメンバーが未登録のときに使う人
// メンバーの色（屋号情報で1人ずつ選ぶ。同時に操作しているときのポインタの色にも使う）
const MCOL=[{c:'#028760',n:'緑'},{c:'#2b6cb0',n:'青'},{c:'#dd6b20',n:'オレンジ'},{c:'#805ad5',n:'紫'},{c:'#d53f8c',n:'ピンク'}];
const CATS={sale:['現金','キャッシュレス'],cost:['出店料','豆','食材','消耗品','備品','交通費','宿泊費','その他']};
const TYPE={event:'イベント',shop:'店舗'};
// 経費の科目は屋号情報ページで管理（未設定なら上の CATS.cost を使う）
const A40=c=>c+'66';   // メンバーの色は不透明度40%で表示する
const people=()=>(D.shop.members&&D.shop.members.length)?D.shop.members:PEOPLE;
const colorOf=name=>{const i=D.shop.mcolors?.[name];return MCOL[(i??Math.max(0,people().indexOf(name)))%MCOL.length].c};
const memberOfEmail=email=>email?people().find(n=>(D.shop.memails?.[n]||'').toLowerCase()===email.toLowerCase())||null:null;
const costCats=()=>(D.shop.costCats&&D.shop.costCats.length)?D.shop.costCats:CATS.cost;
const IK={
  stock:{t:'在庫',qtyL:'在庫数',namePh:'例：コーヒー豆（ブラジル）',unitPh:'例：袋、kg、個'},
  gear:{t:'備品',qtyL:'数',namePh:'例：テント、ドリッパー',unitPh:'例：台、個'}
};

// ===== データ（Firestoreの中身をここに写して使う） =====
const D={projects:[],entries:[],items:[],packs:[],shop:{},presence:[]};
const loaded=new Set();
let user=null,unsubs=[],loadTimer=null,R={name:'home'},V=null;
const ui={kind:'cost',cat:'',person:null,mtab:'in',editId:null,ptype:'event',shopEdit:false,bBean:null,bDest:null,iBean:null};

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
let fs;
try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){fs=getFirestore(app)}
const C={projects:collection(fs,'projects'),entries:collection(fs,'entries'),items:collection(fs,'items'),packs:collection(fs,'packs')};
const shopRef=doc(fs,'shop','info');
const PRESC=collection(fs,'presence');   // いま開いている人のポインタの位置（1人1件）

// ===== 小さな道具 =====
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>(n<0?'−':'')+'¥'+Math.abs(Math.round(n)).toLocaleString('ja-JP');
const num=s=>{const v=Number(String(s??'').replace(/[０-９．]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[,，\s]/g,''));return Number.isFinite(v)?v:0};
const qf=n=>(Number(n)||0).toLocaleString('ja-JP',{maximumFractionDigits:2});
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const md=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?Number(m[2])+'/'+Number(m[3]):''};
// イベントの日付（数日にわたるときは「〜」でつなぐ）
const dateRange=p=>p.date?ymd(p.date)+(p.endDate&&p.endDate>p.date?' 〜 '+(p.endDate.slice(0,4)===p.date.slice(0,4)?ymd(p.endDate).replace(/^\d+年/,''):ymd(p.endDate)):''):'';
// 時間の入力をそろえる（「8」「830」「8.30」「８：３０」→「8:00」「8:30」）。読めなければ null
function normTime(s){
  s=String(s??'').normalize('NFKC').trim().replace(/[時．.]/g,':').replace(/分$/,'');
  if(!s)return '';
  let m=/^(\d{1,2})(?::(\d{1,2}))?$/.exec(s)||/^(\d{1,2})(\d{2})$/.exec(s);
  if(!m)return null;
  const h=+m[1],mi=+(m[2]||0);
  if(h>29||mi>59)return null;
  return h+':'+String(mi).padStart(2,'0');
}
const ymd=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?`${m[1]}年${Number(m[2])}月${Number(m[3])}日`:''};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const stamp=()=>({updatedAt:Date.now(),by:auth.currentUser?.email||''});
const safeUrl=u=>{u=String(u||'').trim();if(!u)return'';if(!/^https?:\/\//i.test(u))u='https://'+u;return u};

const proj=id=>D.projects.find(p=>p.id===id);
const itemOf=id=>D.items.find(i=>i.id===id);
// 在庫・備品の名前は、同じ文字列なら同じ物として扱う（全角／半角・前後や連続の空白・大文字小文字の違いは同じとみなす）
const nkey=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const itemByName=(name,exceptId)=>D.items.find(i=>i.id!==exceptId&&nkey(i.name)===nkey(name));
// コーヒー豆だけは kg で数える（品目に bean:true を持たせる）。名前に「豆」があれば最初から kg を選んでおく（豆乳などは除く）
const guessBean=name=>/豆/.test(nkey(name))&&!/豆乳|豆腐|大豆|小豆/.test(nkey(name));
const unitOf=it=>it?.kind==='gear'?'':it?.bean?'kg':(it?.unit||'');   // 備品は単位なし
// プロジェクトで経費として買った数（品目ごと）
const boughtOf=(pid,itemId)=>entriesOf(pid).filter(e=>e.itemId===itemId).reduce((a,e)=>a+(e.qty||0),0);
const entriesOf=pid=>D.entries.filter(e=>e.projectId===pid);
const packsOf=pid=>D.packs.filter(p=>p.projectId===pid);
function totals(list){let s=0,c=0;for(const e of list){if(e.kind==='sale')s+=e.amount||0;else c+=e.amount||0}return{s,c,p:s-c}}
const sortedProjects=()=>[...D.projects].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0));

function setStatus(t,warn){const s=$('#status');s.textContent=t;s.className='status'+(warn&&t?' warn':'')}
// 知らせは画面下のお知らせと、ボタンのすぐ下（.fmsg）の両方に出す（下のお知らせが見えない画面でも気づけるように）
function toast(t,ng){if(!t)return;for(const f of $$('#view .fmsg')){f.textContent=t;f.className='fmsg'+(ng?' ng':' ok')}const m=$('#toast');m.textContent=t;m.className='toast show'+(ng?' ng':'');clearTimeout(toast.t);toast.t=setTimeout(()=>m.classList.remove('show'),2600)}
function writeErr(err){
  if(err&&err.code==='permission-denied')toast('保存する権限がありません。Firestoreのルールが新しい版になっているか確認してください。',true);
  else toast('保存できませんでした。もう一度お試しください。',true);
}
// 2回押しで実行（うっかり削除を防ぐ）
function sure(btn,fn,label='本当に削除'){
  if(btn.dataset.sure!=='1'){const t=btn.textContent;btn.dataset.sure='1';btn.textContent=label;setTimeout(()=>{if(btn.isConnected){btn.dataset.sure='';btn.textContent=t}},3000);return}
  btn.disabled=true;fn();
}
// 入力中の欄があるときは描き直さない（打っている文字が消えないように）
function fill(el,html){
  if(!el)return;
  const a=document.activeElement;
  if(a&&el.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){el.dataset.stale='1';return}
  el.dataset.stale='';el.innerHTML=html;
}
document.addEventListener('focusout',()=>setTimeout(()=>{if(document.querySelector('[data-stale="1"]'))V?.refresh?.()},0));

const empty=t=>`<li class="empty">${esc(t)}</li>`;
function projCards(list){
  return list.map(p=>{const t=totals(entriesOf(p.id));return `<li data-lp data-id="${esc(p.id)}"><a href="#p/${esc(p.id)}">
    <span class="badge ${p.type==='shop'?'shop':''}">${TYPE[p.type]||''}</span>
    <b class="nm">${esc(p.name)}</b>
    <span class="meta">${p.type==='event'?(dateRange(p)||'日付未定'):(p.place?esc(p.place):'')}</span>
    <span class="money ${t.p<0?'c':'s'}">${yen(t.p)}</span></a></li>`}).join('');
}

// ===== ページ =====

// メイン画面（何を表示するかは後で決める。いまは空）
// メイン画面：店舗・イベントをすべて合わせた収支
function vHome(){return{title:'',html:`
<div class="phead">
  <div class="note" style="margin:0">すべての店舗・イベントの合計</div>
  <div class="big"><b id="tProfit"></b><span>利益</span></div>
  <div class="sub" id="tVisW"><span><i>来客数</i><b id="tVis"></b></span></div>
</div>
<div class="scroll"><table><thead><tr><th></th><th>件数</th><th>売上</th><th>経費</th><th>利益</th></tr></thead><tbody id="tType"></tbody></table></div>
<h2>プロジェクト別</h2>
<ul class="plist" id="tList"></ul>`,
refresh(){
  const ids=new Set(D.projects.map(p=>p.id)),all=D.entries.filter(e=>ids.has(e.projectId)),t=totals(all);
  $('#tProfit').textContent=yen(t.p);$('#tProfit').className=t.p<0?'c':'';
  const vis=D.projects.reduce((a,p)=>a+(p.visitors||0),0);$('#tVisW').hidden=!vis;$('#tVis').textContent=vis.toLocaleString('ja-JP')+'人';
  $('#tType').innerHTML=['event','shop'].map(k=>{const ps=D.projects.filter(p=>p.type===k),pi=new Set(ps.map(p=>p.id)),x=totals(all.filter(e=>pi.has(e.projectId)));
    return `<tr><td><b>${TYPE[k]}</b></td><td>${ps.length}件</td><td>${yen(x.s)}</td><td>${yen(x.c)}</td><td class="${x.p<0?'c':'s'}"><b>${yen(x.p)}</b></td></tr>`}).join('');
  $('#tList').innerHTML=projCards(sortedProjects())||empty('まだプロジェクトがありません。左のメニューの「＋ プロジェクト作成」から始めましょう。');
},
onLpDelete(li){deleteProject(li.dataset.id)}}}

// 左上の ☰ で開くメニュー
function setMenu(open){
  if(document.body.classList.contains('side'))return; // 左に常に出しているときは開け閉めしない
  document.body.classList.toggle('menu-open',open);
  const d=$('#drawer');d.setAttribute('aria-hidden',String(!open));d.inert=!open;
  $('#menuBtn').setAttribute('aria-expanded',String(open));
  if(open)$('#menuClose').focus();
}
function drawMenu(){
  $('#cP').textContent=D.projects.length+'件';
  const st=D.items.filter(i=>i.kind==='stock'),out=st.filter(i=>(i.qty||0)<=0).length;
  $('#cS').textContent=st.length+'品目'+(out?`・在庫切れ ${out}`:'');
  $('#cG').textContent=D.items.filter(i=>i.kind==='gear').length+'点';
  $('#cShop').textContent=D.shop.name||'未登録';
  const here='#'+(location.hash.replace(/^#\/?/,'').split('/')[0]);
  for(const a of $$('#drawer .di'))a.toggleAttribute('aria-current',a.getAttribute('href')===here);
}
$('#menuBtn').addEventListener('click',()=>setMenu(true));
$('#menuClose').addEventListener('click',()=>setMenu(false));
// 左上の「Ledger」でトップへ（埋め込み表示でも確実に戻れるよう、自分で切り替える）
$('.logo').addEventListener('click',e=>{e.preventDefault();if(pageKey()!=='#')location.hash='#/';else show()});
$('#scrim').addEventListener('click',()=>setMenu(false));
$('#drawer').addEventListener('click',e=>{if(e.target.closest('a'))setMenu(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('menu-open')){setMenu(false);$('#menuBtn').focus()}});

// プロジェクト作成
function setPType(t){
  ui.ptype=t;
  for(const b of $$('#ptype button'))b.setAttribute('aria-pressed',String(b.dataset.v===t));
  $('#pnameL').textContent=t==='event'?'イベント名':'店舗名';
  $('#pname').placeholder=t==='event'?'例：東京コーヒーフェス 2026':'例：〇〇マルシェ 常設ブース';
  $('#pdateW').hidden=t!=='event';
}
function vNew(){return{title:'プロジェクト作成',html:`
<form class="card" data-f="newp" autocomplete="off">
  <div class="l">種類</div>
  <div class="seg" id="ptype"><button type="button" data-v="event" aria-pressed="true">イベント</button><button type="button" data-v="shop" aria-pressed="false">店舗</button></div>
  <label class="l" for="pname" id="pnameL">イベント名</label>
  <input id="pname" maxlength="100">
  <div id="pdateW" class="row2"><div><label class="l" for="pdate">開始日</label><input id="pdate" type="date"></div><div><label class="l" for="pend">終了日（1日だけなら同じ日）</label><input id="pend" type="date"></div></div>
  <button class="go" type="submit">作成する</button>
</form>`,
init(){$('#pdate').value=today();$('#pend').value=today();setPType(ui.ptype)},
onClick(e){const b=e.target.closest('#ptype button');if(b)setPType(b.dataset.v)},
onChange(e){
  // 開始日を動かしたら、終了日がそれより前にならないようにする
  if(e.target.id==='pdate'){const s=$('#pdate').value,en=$('#pend');if(s&&(!en.value||en.value<s))en.value=s}
  if(e.target.id==='pend'){const s=$('#pdate').value;if(s&&e.target.value&&e.target.value<s){e.target.value=s;toast('終了日は開始日より後にしてください',true)}}
},
onSubmit(e){
  e.preventDefault();
  const name=$('#pname').value.trim();
  if(!name){toast('名前を入れてください',true);$('#pname').focus();return}
  const ref=doc(C.projects),t=ui.ptype;
  const d0=t==='event'?($('#pdate').value||''):'',d1=t==='event'?($('#pend').value||''):'';
  setDoc(ref,{type:t,name,date:d0,endDate:d1&&d1>d0?d1:'',createdAt:Date.now(),...stamp()}).catch(writeErr);
  toast('作成しました：'+name);
  location.replace('#p/'+ref.id);
}}}

// プロジェクト一覧
function vList(){return{title:'プロジェクト一覧',html:`
<div class="bar"><span class="note" id="cnt" style="margin:0"></span><a class="ghost" href="#new">＋ 作成</a></div>
<ul class="plist" id="plist"></ul>`,
refresh(){
  $('#cnt').textContent=D.projects.length+'件';
  $('#plist').innerHTML=projCards(sortedProjects())||empty('まだプロジェクトがありません。「＋ 作成」から始めましょう。');
},
onLpDelete(li){deleteProject(li.dataset.id)}}}

// 在庫の「数え方」（個数 / kg）の表示
function drawIBean(){
  const seg=$('#iBean');if(!seg)return;
  const bean=ui.iBean??guessBean($('#iname').value);
  for(const b of seg.querySelectorAll('button'))b.setAttribute('aria-pressed',String((b.dataset.b==='1')===bean));
  const u=$('#iunit');u.disabled=bean;if(bean)u.value='kg';else if(u.value==='kg')u.value='';
  $('#iqty').placeholder=bean?'0.0':'0';
}
function clearItemForm(){$('#iname').value='';$('#iqty').value='';const u=$('#iunit');if(u)u.value='';ui.iBean=null;drawIBean();$('#iname').focus()}
// 在庫・備品（台帳）
function vItems(kind){const k=IK[kind];return{title:k.t,html:`
<form class="card" data-f="item" autocomplete="off">
  <label class="l" for="iname">名前</label><input id="iname" maxlength="60" placeholder="${k.namePh}">
  ${kind==='stock'?`<div class="l">数え方</div><div class="seg small" id="iBean"><button type="button" data-b="0">個数</button><button type="button" data-b="1">kg（コーヒー豆）</button></div>`:''}
  ${kind==='stock'?`<div class="row2">
    <div><label class="l" for="iqty">${k.qtyL}</label><input id="iqty" inputmode="decimal" placeholder="0"></div>
    <div><label class="l" for="iunit">単位</label><input id="iunit" maxlength="10" placeholder="${k.unitPh}"></div>
  </div>`:`<label class="l" for="iqty">${k.qtyL}</label><input id="iqty" inputmode="decimal" placeholder="0">`}
  <button class="go" type="submit">${k.t}に追加</button>
  <p class="fmsg" role="status"></p>
</form>
<p class="note">${kind==='stock'?'イベントの持ち物リストで「使った数」を入れると、ここの在庫数が自動で減ります。':'イベントの持ち物リストに入れて、積み込みのチェックに使えます。'}名前と数はその場で書き換えられます。消すときは行を長押しします。</p>
<ul class="items" id="ilist"></ul>`,
init(){ui.iBean=null;drawIBean()},
refresh(){
  const list=D.items.filter(i=>i.kind===kind).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja'));
  fill($('#ilist'),list.length?list.map(i=>`<li data-lp data-id="${esc(i.id)}" class="${kind==='stock'&&(i.qty||0)<=0?'out':''}">
    <span class="nm" data-act="rename" title="タップで名前を直す・長押しで削除">${esc(i.name)}</span>
    <span class="qty"><button type="button" class="step" data-step="${i.bean?-0.1:-1}" aria-label="${i.bean?'0.1kg':'1つ'}減らす">−</button><input data-fld="qty" inputmode="decimal" value="${esc(qf(i.qty).replace(/,/g,''))}" aria-label="${k.qtyL}"><button type="button" class="step" data-step="${i.bean?0.1:1}" aria-label="${i.bean?'0.1kg':'1つ'}増やす">＋</button><span class="unit">${esc(unitOf(i))}</span></span></li>`).join(''):empty('まだ登録がありません'));
},
onSubmit(e){
  e.preventDefault();
  const name=$('#iname').value.trim();
  if(!name){toast('名前を入れてください',true);$('#iname').focus();return}
  const bean=kind==='stock'&&(ui.iBean??guessBean(name));
  const q=num($('#iqty').value),unit=kind==='gear'?'':bean?'kg':$('#iunit').value.trim(),same=itemByName(name);
  if(same){
    // 同じ名前がもうある → 新しく作らず、その品目にまとめる
    if(same.kind!==kind){toast(`「${same.name}」は${IK[same.kind].t}に登録されています`,true);return}
    if(q||(unit&&!same.unit))updateDoc(doc(C.items,same.id),{...(q?{qty:increment(q)}:{}),...(unit&&!same.unit?{unit}:{}),...stamp()}).catch(writeErr);
    clearItemForm();
    toast(q?`「${same.name}」はもうあるので、数を${qf(q)}${unitOf(same)||unit}足しました`:`「${same.name}」はもう登録されています`);
    return;
  }
  setDoc(doc(C.items),{kind,name,qty:q,unit,...(bean?{bean:true}:{}),createdAt:Date.now(),...stamp()}).catch(writeErr);
  clearItemForm();
  toast('追加しました：'+name);
},
onInput(e){if(e.target.id==='iname')drawIBean()},
onClick(e){
  const ib=e.target.closest('#iBean button');if(ib){ui.iBean=ib.dataset.b==='1';drawIBean();return}
  const li=e.target.closest('li[data-id]');if(!li)return;const id=li.dataset.id;
  const rn=e.target.closest('[data-act="rename"]');
  if(rn){const inp=document.createElement('input');inp.className='nm';inp.dataset.fld='name';inp.maxLength=60;inp.value=itemOf(id)?.name||'';inp.setAttribute('aria-label','名前');rn.replaceWith(inp);inp.focus();inp.select();return}
  const s=e.target.closest('[data-step]');
  if(s){updateDoc(doc(C.items,id),{qty:increment(Number(s.dataset.step)),...stamp()}).catch(writeErr);return}
},
onLpDelete(li){const it=itemOf(li.dataset.id);if(!it)return;deleteDoc(doc(C.items,it.id)).catch(writeErr);toast('削除しました：'+it.name)},
onChange(e){
  const li=e.target.closest('li[data-id]'),f=e.target.dataset.fld;if(!li||!f)return;
  const v=f==='qty'?num(e.target.value):e.target.value.trim();
  if(f==='name'&&!v){e.target.value=itemOf(li.dataset.id)?.name||'';return}
  if(f==='name'){const same=itemByName(v,li.dataset.id);if(same){toast(`「${same.name}」はもう${IK[same.kind].t}にあります`,true);e.target.value=itemOf(li.dataset.id)?.name||'';return}}
  updateDoc(doc(C.items,li.dataset.id),{[f]:v,...stamp()}).catch(writeErr);
}}}

// 屋号情報
function shopForm(){
  const s=D.shop,links=(s.links&&s.links.length?s.links:[{label:'',url:''}]);
  return `<form class="card" data-f="shop" autocomplete="off">
    <label class="l" for="sName">屋号</label><input id="sName" maxlength="60" value="${esc(s.name)}" placeholder="例：FOR NOW COFFEE">
    <div class="l">メンバー（色は、同時に操作しているときのポインタの色になります）</div>
    <div id="sMem">${people().map((n,i)=>memberRow(n,D.shop.mcolors?.[n]??i%MCOL.length,D.shop.memails?.[n]||'')).join('')}</div>
    <button type="button" class="ghost" data-act="addMem">＋ メンバーを追加</button>
    <p class="note">メールには、そのメンバーがログインに使うGoogleアカウントを入れます。消すときは左の丸を長押し（名前を空にして保存しても消えます）。</p>
    <div class="l">関係のあるURL</div>
    <div id="sLinks">${links.map(linkRow).join('')}</div>
    <button type="button" class="ghost" data-act="addLink">＋ URLを追加</button>
    <p class="note">消すときは左の印を長押し（URLを空にして保存しても消えます）。</p>
    <label class="l" for="sCats">経費の科目（1行に1つ。経費の入力ページに、この順で並びます）</label><textarea id="sCats" rows="6">${esc(costCats().join('\n'))}</textarea>
    <label class="l" for="sMemo">メモ</label><textarea id="sMemo" rows="3" placeholder="例：営業許可の番号、連絡先など">${esc(s.memo)}</textarea>
    <button class="go" type="submit">保存する</button>
    <div style="text-align:center;margin-top:10px"><button type="button" class="ghost" data-act="cancel">やめる</button></div>
  </form>`;
}
const linkRow=l=>`<div class="lrow" data-lp><span class="grip" aria-hidden="true">≡</span><input class="lb" maxlength="30" placeholder="名前（例：Instagram）" value="${esc(l.label)}"><input class="lu" inputmode="url" placeholder="https://" value="${esc(l.url)}"></div>`;
const memberRow=(name,col,email)=>`<div class="mrow" data-lp data-col="${col}"><span class="mdot" style="background:${A40(MCOL[col].c)}" aria-hidden="true"></span><input class="mn" maxlength="20" placeholder="名前" value="${esc(name)}" aria-label="名前"><input class="me" type="email" inputmode="email" maxlength="100" placeholder="Googleアカウントのメール" value="${esc(email)}" aria-label="メール"><span class="sw" role="group" aria-label="色">${MCOL.map((c,i)=>`<button type="button" class="swb" data-col="${i}" style="--c:${A40(c.c)}" aria-label="${c.n}" aria-pressed="${i===col}"></button>`).join('')}</span></div>`;
function shopShow(){
  const s=D.shop;
  if(!s.name&&!(s.links||[]).length&&!(s.members||[]).length&&!(s.costCats||[]).length)return `<div class="card" style="text-align:center"><p class="note" style="margin:0 0 12px">屋号情報はまだ登録されていません</p><button type="button" class="go" data-act="edit" style="margin-top:0">登録する</button></div>`;
  return `<div class="card shopc">
    <p class="shopname">${esc(s.name||'（屋号未設定）')}</p>
    <div class="l">メンバー</div><ul class="mlist">${people().map(n=>`<li><span class="mdot" style="background:${A40(colorOf(n))}"></span><b>${esc(n)}</b><span class="meta">${esc(D.shop.memails?.[n]||'')}</span></li>`).join('')}</ul>
    ${(s.links||[]).length?`<div class="l">関係のあるURL</div><ul class="links">${s.links.map(l=>`<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label||l.url)}</a><span class="meta">${esc(l.url)}</span></li>`).join('')}</ul>`:''}
    <div class="l">経費の科目</div><div class="chips ro">${costCats().map(c=>`<span>${esc(c)}</span>`).join('')}</div>
    ${s.memo?`<div class="l">メモ</div><p class="memo">${esc(s.memo)}</p>`:''}
    <button type="button" class="ghost" data-act="edit" style="margin-top:16px">編集</button>
  </div>`;
}
function vShop(){ui.shopEdit=false;return{title:'屋号情報',html:`<div id="shopBox"></div>`,
refresh(){if(!ui.shopEdit)$('#shopBox').innerHTML=shopShow()},
onLpDelete(el){el.remove()},
onClick(e){
  const sw=e.target.closest('.swb');
  if(sw){const r=sw.closest('.mrow');r.dataset.col=sw.dataset.col;for(const b of r.querySelectorAll('.swb'))b.setAttribute('aria-pressed',String(b===sw));r.querySelector('.mdot').style.background=A40(MCOL[+sw.dataset.col].c);return}
  const a=e.target.closest('[data-act]');if(!a)return;
  if(a.dataset.act==='edit'){ui.shopEdit=true;$('#shopBox').innerHTML=shopForm();$('#sName').focus()}
  if(a.dataset.act==='cancel'){ui.shopEdit=false;this.refresh()}
  if(a.dataset.act==='addLink'){$('#sLinks').insertAdjacentHTML('beforeend',linkRow({}));$('#sLinks .lrow:last-child .lb').focus()}
  if(a.dataset.act==='addMem'){const used=$$('#sMem .mrow').map(r=>+r.dataset.col),c=MCOL.findIndex((x,i)=>!used.includes(i));$('#sMem').insertAdjacentHTML('beforeend',memberRow('',c<0?0:c,''));$('#sMem .mrow:last-child .mn').focus()}
},
onSubmit(e){
  e.preventDefault();
  const links=$$('#sLinks .lrow').map(r=>({label:r.querySelector('.lb').value.trim(),url:r.querySelector('.lu').value.trim()})).filter(l=>l.url);
  const cats=[...new Set($('#sCats').value.split('\n').map(s=>s.trim().slice(0,30)).filter(Boolean))].slice(0,40);
  const members=[],mcolors={},memails={};
  for(const r of $$('#sMem .mrow')){const n=r.querySelector('.mn').value.trim();if(!n||members.includes(n))continue;members.push(n);mcolors[n]=+r.dataset.col||0;const m=r.querySelector('.me').value.trim();if(m)memails[n]=m}
  const body={name:$('#sName').value.trim(),members,mcolors,memails,links,costCats:cats,memo:$('#sMemo').value.trim(),...stamp()};
  setDoc(shopRef,body).catch(writeErr);
  D.shop=body;ui.shopEdit=false;this.refresh();toast('保存しました');
}}}

// ----- プロジェクトの中 -----
const pBack=()=>['#p/'+R.id,proj(R.id)?.name||'プロジェクト'];

function vHub(){const id=R.id;return{title:proj(id).name,back:['#list','一覧'],html:`
<div class="phead">
  <div><span class="badge" id="hType"></span> <span class="note" id="hDate"></span></div>
  <div class="big"><b id="hProfit"></b><span>利益</span></div>
  <div class="sub"><span><i>売上</i><b id="hSale"></b></span><span><i>経費</i><b id="hCost"></b></span></div>
</div>
<nav class="menu">
  <a class="mi" href="#p/${esc(id)}/money"><b>経費 / トランザクション / 集計</b><span id="mM"></span></a>
  <a class="mi" href="#p/${esc(id)}/pack"><b>在庫 / 備品（持ち物リスト）</b><span id="mK"></span></a>
  <a class="mi" href="#p/${esc(id)}/detail"><b id="mDt"></b><span id="mD"></span></a>
  <a class="mi" href="#p/${esc(id)}/pay"><b>精算</b><span id="mP"></span></a>
</nav>`,
refresh(){
  const p=proj(id);if(!p)return;
  $('#title').textContent=p.name;
  const b=$('#hType');b.textContent=TYPE[p.type]||'';b.className='badge'+(p.type==='shop'?' shop':'');
  $('#hDate').textContent=p.type==='event'?(dateRange(p)||'日付未定'):'';
  const es=entriesOf(id),t=totals(es);
  $('#hProfit').textContent=yen(t.p);$('#hSale').textContent=yen(t.s);$('#hCost').textContent=yen(t.c);
  $('#mDt').textContent=(p.type==='event'?'イベント':'店舗')+'詳細';
  $('#mD').textContent=[p.place,p.fee?'出店料 '+yen(p.fee):''].filter(Boolean).join('・')||'場所・出店料・URLなど';
  const ps=packList(id).filter(x=>!x.off);$('#mK').textContent=ps.length?`${ps.length}点・積んだ ${ps.filter(x=>x.checked).length}`:'';
  $('#mM').textContent=es.length+'件の記録';
  const mv=moves(payRows(es));$('#mP').textContent=es.length?(mv.length?mv.length+'件の受け渡し':'精算の必要なし'):'記録がまだありません';
}}}

// イベント（店舗）詳細
function vDetail(){const id=R.id,p=proj(id),ev=p.type==='event';return{title:(ev?'イベント':'店舗')+'詳細',back:pBack(),html:`
<form class="card" data-f="detail" data-noenter autocomplete="off">
  <label class="l" for="dName">${ev?'イベント名':'店舗名'}</label><input id="dName" maxlength="100">
  ${ev?`<div class="row2"><div><label class="l" for="dDate">開始日</label><input id="dDate" type="date"></div><div><label class="l" for="dEnd">終了日（1日だけなら同じ日）</label><input id="dEnd" type="date"></div></div>`:''}
  <label class="l" for="dPlace">場所</label><input id="dPlace" maxlength="100" placeholder="例：〇〇公園 芝生広場">
  <div class="l">時間（一覧から選ぶか、数字で入力。例：830 → 8:30）</div>
  <div class="tgrid">
    <label for="dIn">搬入</label><span class="tmw"><input class="tm" id="dIn" inputmode="numeric" maxlength="5" placeholder="8:00" data-def="8:00"></span><span></span><span></span>
    <label for="dOpen">営業</label><span class="tmw"><input class="tm" id="dOpen" inputmode="numeric" maxlength="5" placeholder="10:00" data-def="10:00"></span><span class="tsep">〜</span><span class="tmw"><input class="tm" id="dClose" inputmode="numeric" maxlength="5" placeholder="16:00" data-def="16:00" aria-label="営業の終わり"></span>
  </div>
  <label class="l" for="dFee">出店料</label><div class="amt"><span>¥</span><input id="dFee" inputmode="numeric" placeholder="0"></div>
  <div class="l">メニュー（品目と値段）</div>
  <div id="dMenu">${((p.menu||[]).length?p.menu:[{}]).map(menuRow).join('')}</div>
  <button type="button" class="ghost" data-act="addMenu">＋ メニューを追加</button>
  <p class="note">売上数は「トランザクション」のページで入れると、値段×売上数で売上になります。消すときは左の印を長押し（そのメニューの売上数も消えます）。</p>
  <label class="l" for="dUrl">URL</label><input id="dUrl" inputmode="url" placeholder="https://">
  <label class="l" for="dMemo">メモ</label><textarea id="dMemo" rows="4" placeholder="例：電源なし、駐車場は裏手"></textarea>
  <button class="go" type="submit">保存する</button>
</form>
<p id="dLink" class="note"></p>
<div class="danger"><button type="button" class="ghost" data-act="delP">このプロジェクトを削除</button><p class="note">記録・持ち物リストもまとめて消えます（在庫の数は戻りません）。</p></div>`,
init(){
  $('#dName').value=p.name||'';
  if(ev){$('#dDate').value=p.date||'';$('#dEnd').value=p.endDate||''}
  $('#dPlace').value=p.place||'';
  // 以前の「時間」の文から読み取れるものは読み取っておく
  const lt=p.time||'',mIn=/搬入\s*(\d{1,2}:\d{2})/.exec(lt),mOp=/(\d{1,2}:\d{2})\s*[〜~～ー\-－]\s*(\d{1,2}:\d{2})/.exec(lt.replace(/搬入\s*\d{1,2}:\d{2}/,''));
  $('#dIn').value=p.loadIn??(mIn?mIn[1]:'');$('#dOpen').value=p.open??(mOp?mOp[1]:'');$('#dClose').value=p.close??(mOp?mOp[2]:'');
  $('#dFee').value=p.fee?Number(p.fee).toLocaleString('ja-JP'):'';$('#dUrl').value=p.url||'';$('#dMemo').value=p.memo||'';
},
refresh(){const q=proj(id);if(q&&q.url)$('#dLink').innerHTML=`<a href="${esc(safeUrl(q.url))}" target="_blank" rel="noopener">${esc(q.url)} を開く</a>`;else $('#dLink').textContent=''},
onInput(e){if(e.target.id==='dFee'||e.target.classList.contains('mnp')){const d=e.target.value.replace(/[^\d]/g,'');e.target.value=d?Number(d).toLocaleString('ja-JP'):''}},
onSubmit(e){
  e.preventDefault();
  const name=$('#dName').value.trim();if(!name){toast('名前を入れてください',true);return}
  const tm={};
  for(const [k,el] of [['loadIn','#dIn'],['open','#dOpen'],['close','#dClose']]){const v=normTime($(el).value);if(v===null){toast('時間は 8:00 のように入れてください',true);$(el).focus();return}tm[k]=v}
  if($('#dDate')&&$('#dEnd').value&&$('#dDate').value&&$('#dEnd').value<$('#dDate').value){toast('終了日は開始日より後にしてください',true);return}
  const time=[tm.loadIn&&'搬入 '+tm.loadIn,(tm.open||tm.close)&&'営業 '+(tm.open||'')+'〜'+(tm.close||'')].filter(Boolean).join('／');
  const body={name,place:$('#dPlace').value.trim(),...tm,time,fee:num($('#dFee').value),url:$('#dUrl').value.trim(),memo:$('#dMemo').value.trim(),...stamp()};
  if(ev){body.date=$('#dDate').value||'';body.endDate=$('#dEnd').value||''}
  body.menu=$$('#dMenu .mnrow').map(r=>({id:r.dataset.mid,name:r.querySelector('.mnn').value.trim(),price:num(r.querySelector('.mnp').value)})).filter(m=>m.name);
  // メニューの売上（値段×売上数）を、値段や名前の変更に合わせて直す。消したメニューの売上は消す
  const b=writeBatch(fs);
  b.update(doc(C.projects,id),body);
  for(const e of entriesOf(id).filter(x=>x.menuId)){
    const m=body.menu.find(x=>x.id===e.menuId);
    if(!m)b.delete(doc(C.entries,e.id));
    else if(m.price>0&&(m.price!==e.unitPrice||m.name!==e.category))b.update(doc(C.entries,e.id),{category:m.name,unitPrice:m.price,amount:m.price*(e.count||0),...stamp()});
  }
  b.commit().catch(writeErr);
  toast('保存しました');location.hash='#p/'+id;
},
onLpDelete(el){el.remove()},
onChange(e){
  if(e.target.classList.contains('tm')){const v=normTime(e.target.value);if(v===null)toast('時間は 8:00 のように入れてください',true);else e.target.value=v}
},
onClick(e){
  if(e.target.closest('[data-act="addMenu"]')){$('#dMenu').insertAdjacentHTML('beforeend',menuRow({}));$('#dMenu .mnrow:last-child .mnn').focus();return}
  const a=e.target.closest('[data-act="delP"]');if(!a)return;
  sure(a,()=>{deleteProject(id);location.replace('#list')},'本当に削除（元に戻せません）');
}}}

// メニュー1行（イベント詳細）
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const menuRow=m=>`<div class="mnrow" data-lp data-mid="${esc(m.id||newId())}"><span class="grip" aria-hidden="true">≡</span><input class="mnn" maxlength="40" placeholder="品目（例：ドリップコーヒー）" value="${esc(m.name)}" aria-label="品目"><div class="amt"><span>¥</span><input class="mnp" inputmode="numeric" placeholder="0" value="${m.price?Number(m.price).toLocaleString('ja-JP'):''}" aria-label="値段"></div></div>`;
// メニューの売上（1メニュー＝1件の売上記録。id は「プロジェクトID_m_メニューID」）
const menuEntry=(pid,mid)=>D.entries.find(e=>e.id===pid+'_m_'+mid);
const holderOf=p=>(p?.salesHolder&&people().includes(p.salesHolder))?p.salesHolder:(memberOfEmail(user?.email)||people()[0]);
function setVisitors(pid,n){n=Math.max(0,Math.round(n));updateDoc(doc(C.projects,pid),{visitors:n,...stamp()}).catch(writeErr)}
function setMenuCount(pid,mid,n){
  const p=proj(pid),m=(p?.menu||[]).find(x=>x.id===mid);if(!m)return;
  n=Math.max(0,Math.round(n));
  const ref=doc(C.entries,pid+'_m_'+mid),old=menuEntry(pid,mid);
  if(!n){if(old)deleteDoc(ref).catch(writeErr);return}
  if(!(m.price>0)){toast('イベント詳細で「'+m.name+'」の値段を入れてください',true);return}
  setDoc(ref,{projectId:pid,kind:'sale',category:m.name,amount:m.price*n,person:holderOf(p),menuId:mid,count:n,unitPrice:m.price,date:old?.date||p.date||today(),memo:'',createdAt:old?.createdAt||Date.now(),...stamp()}).catch(writeErr);
}
// プロジェクトを記録・持ち物リストごと消す（在庫の数は戻さない）
function deleteProject(id){
  const p=proj(id);if(!p)return;
  const b=writeBatch(fs);
  b.delete(doc(C.projects,id));
  for(const x of entriesOf(id))b.delete(doc(C.entries,x.id));
  for(const x of packsOf(id))b.delete(doc(C.packs,x.id));
  b.commit().catch(writeErr);
  toast('削除しました：'+p.name);
}
// 在庫・備品（持ち物リスト）
function packRow(pk){
  const it=itemOf(pk.itemId),st=pk.kind==='stock',u=esc(unitOf(it));
  const bought=boughtOf(pk.projectId,pk.itemId),left=(pk.take||0)+bought-(pk.used||0);
  return `<li data-lp data-id="${esc(pk.id)}" class="${pk.checked?'done':''}">
    <label class="chk"><input type="checkbox" data-fld="checked"${pk.checked?' checked':''}><span class="nm">${esc(it?it.name:(pk.name||'（削除された品目）'))}</span></label>
    ${it?`<span class="stk">${st?'在庫':'登録'} ${qf(it.qty)}${u}</span>`:'<span></span>'}
    <span class="meta">持っていく<span class="tq"><button type="button" class="step" data-tstep="-1" aria-label="1つ減らす">−</button><input data-fld="take" inputmode="decimal" value="${esc(qf(pk.take||0).replace(/,/g,''))}" aria-label="持っていく数"><button type="button" class="step" data-tstep="1" aria-label="1つ増やす">＋</button></span>${u}${st?`<i>・</i>使った<input data-fld="used" inputmode="decimal" value="${esc(+(pk.used||0))}" aria-label="使った数">${u}`:''}${bought?`<i>・</i>買った <b>${qf(bought)}</b>${u}`:''}${st&&(bought||pk.used)?`<i>・</i>残り <b>${qf(left)}</b>${u}`:''}</span>
  </li>`;
}
// 持ち物リスト：在庫・備品の全品目を出す。まだ記録のない品目は仮の行（_v）で、数を入れたときに保存する
function packList(pid){
  const ps=packsOf(pid),by=new Map(ps.map(x=>[x.itemId,x]));
  // 備品は全部出す。在庫はリストに入れた物だけ（経費で買った物は自動で入る）
  const rows=D.items.filter(it=>it.kind==='gear').map(it=>by.get(it.id)||{id:pid+'_'+it.id,projectId:pid,itemId:it.id,kind:it.kind,name:it.name,take:0,used:0,checked:false,_v:true});
  for(const x of ps)if(x.kind==='stock'&&itemOf(x.itemId))rows.push(x);
  for(const x of ps)if(!itemOf(x.itemId)&&(x.used||x.take))rows.push(x);   // 品目を消したあとも、記録のある行は残す
  return rows;
}
const packBase=pk=>({projectId:pk.projectId,itemId:pk.itemId,kind:pk.kind,name:itemOf(pk.itemId)?.name||pk.name||'',take:pk.take||0,used:pk.used||0,checked:!!pk.checked,off:!!pk.off,createdAt:pk.createdAt||Date.now()});
function vPack(){const id=R.id;
const getPk=pid=>D.packs.find(x=>x.id===pid)||packList(id).find(x=>x.id===pid);
// 仮の行なら丸ごと作る、あれば一部だけ書きかえる
const putPk=(b,pk,patch)=>pk._v?b.set(doc(C.packs,pk.id),{...packBase(pk),...patch,...stamp()}):b.update(doc(C.packs,pk.id),{...patch,...stamp()});
// 持っていく数：在庫・備品に登録されている数より多くはできない（在庫は、このイベントで使った分も含めた数まで）
const takeMax=pk=>{const it=itemOf(pk.itemId);return it?Math.max(0,(it.qty||0)+(pk.kind==='stock'?(pk.used||0):0)):Infinity};
const setTake=(pk,v)=>{
  v=Math.max(0,v);const mx=takeMax(pk);
  if(v>mx){v=mx;toast(`${itemOf(pk.itemId)?.name||''}は${qf(mx)}${unitOf(itemOf(pk.itemId))}までです`,true)}
  const b=writeBatch(fs);putPk(b,pk,{take:+v.toFixed(3)});b.commit().catch(writeErr);
  const inp=$$('#view .pk li').find(x=>x.dataset.id===pk.id)?.querySelector('[data-fld="take"]');if(inp)inp.value=qf(v).replace(/,/g,'');
};
return{title:'在庫・備品',back:pBack(),html:`
<div class="bar"><b id="prog"></b></div>
<p class="note" style="margin-top:0">積んだらチェック。最後に「使った数」を入れると、残った分だけ在庫に残ります。在庫は上の欄から選んで追加、備品は全部出ています。使わない物は行を長押しして外せます。</p>
<h2>在庫</h2>
<div class="pkadd"><select id="pkSel" aria-label="在庫から選ぶ"></select><button type="button" class="ghost" data-act="addStock">追加</button></div>
<ul class="pk" id="pkStock"></ul>
<h2>備品</h2><ul class="pk" id="pkGear"></ul>
<div class="note" id="pkOff"></div>`,
refresh(){
  const all=packList(id),on=all.filter(x=>!x.off),off=all.filter(x=>x.off&&itemOf(x.itemId));
  $('#prog').textContent=on.length?`積んだ ${on.filter(x=>x.checked).length} / ${on.length}`:'';
  const by=k=>on.filter(x=>x.kind===k).sort((a,b)=>(itemOf(a.itemId)?.name||a.name||'').localeCompare(itemOf(b.itemId)?.name||b.name||'','ja'));
  const s=by('stock'),g=by('gear');
  fill($('#pkStock'),s.length?s.map(packRow).join(''):empty('在庫から選んで追加してください'));
  {const sel=$('#pkSel'),cur=sel.value,inP=new Set(s.map(x=>x.itemId));
   const opts=D.items.filter(i=>i.kind==='stock'&&!inP.has(i.id)).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja'));
   if(document.activeElement!==sel){sel.innerHTML=opts.length?opts.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}（在庫 ${qf(i.qty)}${esc(unitOf(i))}）</option>`).join(''):'<option value="">追加できる在庫がありません</option>';if(cur&&opts.some(i=>i.id===cur))sel.value=cur}
   $('[data-act="addStock"]').disabled=!opts.length}
  fill($('#pkGear'),g.length?g.map(packRow).join(''):empty('備品の登録がありません（左のメニューの「備品」で登録）'));
  $('#pkOff').innerHTML=off.filter(x=>x.kind==='gear').length?`外した品目（タップで戻す）：${off.filter(x=>x.kind==='gear').map(x=>`<button type="button" class="ghost sm" data-on="${esc(x.id)}">${esc(itemOf(x.itemId).name)}</button>`).join('')}`:'';
},
onClick(e){
  const b=e.target.closest('[data-on]');
  if(b){updateDoc(doc(C.packs,b.dataset.on),{off:false,...stamp()}).catch(writeErr);return}
  if(e.target.closest('[data-act="addStock"]')){
    const it=itemOf($('#pkSel').value);if(!it)return;
    const pid=id+'_'+it.id,old=D.packs.find(x=>x.id===pid);
    (old?updateDoc(doc(C.packs,pid),{off:false,...stamp()}):setDoc(doc(C.packs,pid),{projectId:id,itemId:it.id,kind:'stock',name:it.name,take:0,used:0,checked:false,off:false,createdAt:Date.now(),...stamp()})).catch(writeErr);
    toast('追加しました：'+it.name);return;
  }
  const t=e.target.closest('[data-tstep]');
  if(t){const pk=getPk(t.closest('li').dataset.id);if(pk)setTake(pk,(pk.take||0)+Number(t.dataset.tstep));return}
},
onLpDelete(li){
  // このプロジェクトのリストから外す（品目そのものは在庫・備品に残る）。使った分は在庫に戻す
  const pk=getPk(li.dataset.id);if(!pk)return;
  const b=writeBatch(fs);
  if(pk.kind==='stock')b.delete(doc(C.packs,pk.id));   // 在庫はリストから消す（また選べば戻せる）
  else b.set(doc(C.packs,pk.id),{...packBase(pk),take:0,used:0,checked:false,off:true,...stamp()});   // 備品は「外した品目」に回す
  if(pk.kind==='stock'&&pk.used&&itemOf(pk.itemId))b.update(doc(C.items,pk.itemId),{qty:increment(pk.used),...stamp()});
  b.commit().catch(writeErr);
  toast(pk.kind==='stock'&&pk.used?'外しました（使った分を在庫に戻しました）':'このイベントのリストから外しました');
},
onChange(e){
  const li=e.target.closest('li[data-id]'),f=e.target.dataset.fld;if(!li||!f)return;
  const pk=getPk(li.dataset.id);if(!pk)return;
  const b=writeBatch(fs);
  if(f==='checked'){putPk(b,pk,{checked:e.target.checked});b.commit().catch(writeErr);return}
  const v=Math.max(0,num(e.target.value));
  if(f==='take'){setTake(pk,v);return}
  if(f==='used'){
    const delta=v-(pk.used||0),it=itemOf(pk.itemId);if(!delta)return;
    putPk(b,pk,{used:v});
    if(it)b.update(doc(C.items,it.id),{qty:increment(-delta),...stamp()});
    b.commit().catch(writeErr);
    if(it)toast(`在庫を${qf(Math.abs(delta))}${unitOf(it)}${delta>0?'減らしました':'戻しました'}`);
  }
}}}

// 経費・トランザクション・集計
function drawKind(){
  ui.kind='cost';   // 入力は経費だけ
  let cats=costCats();
  if(ui.editId&&ui.cat&&!cats.includes(ui.cat))cats=[...cats,ui.cat];   // 科目を消したあとでも、前の記録は元の科目のまま直せる
  if(!cats.includes(ui.cat))ui.cat=cats[0]||'その他';
  $('#cats').innerHTML=cats.map(c=>`<button type="button" data-c="${esc(c)}" aria-pressed="${c===ui.cat}">${esc(c)}</button>`).join('');
  drawBuy();
}
// 経費の品目欄：同じ名前があればその品目に、なければ選んだ方（在庫／備品）に足す
// 在庫・備品にない名前は、「在庫」「備品」を押したときだけ新しく作る（押さなければ経費の記録だけ）
const buyDest=it=>it?it.kind:ui.bDest;
function drawBuy(){
  const box=$('#buyBox');if(!box)return;
  const name=$('#bItem').value.trim(),it=name?itemByName(name):null;
  const dest=buyDest(it),bean=it?!!it.bean:(dest==='stock'&&(ui.bBean??guessBean(name)));
  $('#bDest').hidden=!name;
  $('#bDestL').textContent=it?`${IK[it.kind].t}に同じ名前があるので、数量を足します`:(dest?`${IK[dest].t}に新しく追加します（もう一度押すと取り消し）`:'在庫・備品にない品目です。追加するなら押してください（押さなければ経費の記録だけ）');
  for(const b of $$('#bKind button')){b.setAttribute('aria-pressed',String(b.dataset.d===dest));b.disabled=!!it}
  $('#bHow').hidden=!name||!!it||!dest;$('#bBeanW').hidden=dest!=='stock';
  for(const b of $$('#bBean button'))b.setAttribute('aria-pressed',String((b.dataset.b==='1')===bean));
  $('#bUnitIn').hidden=bean||dest==='gear';
  $('#bUnit').textContent=it?unitOf(it):dest?(bean?'kg':$('#bUnitIn').value.trim()):'';
  $('#bQty').placeholder=bean?'0.0':'0';
}
function drawPeople(){$('#people').innerHTML=people().map(p=>`<button type="button" data-p="${esc(p)}" style="--pc:${A40(colorOf(p))}" aria-pressed="${p===ui.person}">${esc(p)}</button>`).join('')}
function mTab(t){ui.mtab=t;for(const b of $$('#mtab button'))b.setAttribute('aria-selected',String(b.dataset.t===t));for(const s of ['in','log','sum'])$('#m-'+s).hidden=s!==t}
function resetEntry(){ui.editId=null;ui.bBean=null;ui.bDest=null;$('#bItem').value='';$('#bQty').value='';$('#bUnitIn').value='';drawBuy();$('#amount').value='';$('#memo').value='';$('#save').textContent='記録する';$('#cancelWrap').hidden=true}
function vMoney(){const id=R.id;ui.editId=null;return{title:'経費・トランザクション・集計',back:pBack(),html:`
<div class="tabs" id="mtab" role="tablist"><button type="button" role="tab" data-t="in">経費</button><button type="button" role="tab" data-t="log">トランザクション</button><button type="button" role="tab" data-t="sum">集計</button></div>
<section id="m-in" hidden>
  <form class="card" data-f="entry" autocomplete="off">
    <div class="l" style="margin-top:0">科目</div><div class="chips" id="cats"></div>
    <div id="buyBox">
      <div class="row2">
        <div><label class="l" for="bItem">品目</label><input id="bItem" list="bList" maxlength="60" placeholder="例：コーヒー豆、紙カップ"><datalist id="bList"></datalist></div>
        <div><label class="l" for="bQty">数量</label><div class="qin"><input id="bQty" inputmode="decimal" placeholder="0"><span id="bUnit"></span></div></div>
      </div>
      <div id="bDest" hidden>
        <div class="l sm" id="bDestL">反映先</div>
        <div class="seg small" id="bKind"><button type="button" data-d="stock">在庫</button><button type="button" data-d="gear">備品</button></div>
      </div>
      <div id="bHow" hidden>
        <div id="bBeanW"><div class="l sm">数え方</div>
        <div class="seg small" id="bBean"><button type="button" data-b="0">個数</button><button type="button" data-b="1">kg（コーヒー豆）</button></div></div>
        <input id="bUnitIn" maxlength="10" placeholder="単位（例：個、袋、本）" style="margin-top:8px">
      </div>
    </div>
    <label class="l" for="amount">金額</label>
    <div class="amt"><span>¥</span><input id="amount" inputmode="numeric" placeholder="0"></div>
    <div class="chips" id="people" style="margin-top:16px" aria-label="払った人"></div>
    <label class="l" for="date">日付</label><input id="date" type="date">
    <label class="l" for="memo">メモ</label><input id="memo" placeholder="例：ドリップ 20杯分">
    <button class="go" id="save" type="submit">記録する</button>
    <p class="fmsg" role="status"></p>
    <div style="text-align:center;margin-top:10px" id="cancelWrap" hidden><button type="button" class="ghost" data-act="cancel">編集をやめる</button></div>
  </form>
  <h2>記録した経費 <span class="note" id="cCount" style="font-weight:400"></span></h2>
  <ul class="list" id="clist"></ul>
</section>
<section id="m-log" hidden>
  <div class="card vis">
    <label for="visitors"><b>来客数</b></label>
    <span class="qty"><button type="button" class="step" data-vstep="-1" aria-label="1人減らす">−</button><input id="visitors" inputmode="numeric" placeholder="0"><button type="button" class="step" data-vstep="1" aria-label="1人増やす">＋</button><span class="unit">人</span></span>
  </div>
  <div class="card ms">
    <div class="bar" style="margin:0 0 6px"><b>売上</b><b class="s" id="msTotal"></b></div>
    <div id="msRows"></div>
    <div id="msHold"><div class="l sm">売上を持っている人</div><div class="chips" id="holder"></div></div>
  </div>
  <h2>記録</h2>
  <div class="bar"><span id="logCount" class="note" style="margin:0"></span><button type="button" class="ghost" data-act="csv">CSVをコピー</button></div>
  <ul class="list" id="list"></ul>
</section>
<section id="m-sum" hidden>
  <div class="sumbox"><div><i>売上</i><b class="s" id="sS"></b></div><div><i>経費</i><b class="c" id="sC"></b></div><div><i>利益</i><b id="sP"></b></div></div>
  <h2>売上の内訳</h2><div id="saleRows"></div>
  <h2>経費の内訳</h2><div id="catRows"></div>
</section>`,
init(){
  const p=proj(id);$('#date').value=(p.type==='event'&&p.date)?p.date:today();
  drawKind();drawPeople();mTab(ui.mtab);
},
refresh(){
  drawKind();   // 屋号情報で科目が変わったら並べ直す
  const list=entriesOf(id),sorted=[...list].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0));
  const pending=list.filter(e=>e._pending).length;
  $('#logCount').textContent=sorted.length+'件'+(pending?`（未送信 ${pending}件）`:'');
  // メニューの売上数
  const p=proj(id),menu=p?.menu||[];
  {const v=$('#visitors');if(document.activeElement!==v)v.value=p?.visitors?String(p.visitors):''}
  fill($('#msRows'),menu.length?menu.map(m=>{const e=menuEntry(id,m.id),n=e?.count||0;return `<div class="msr" data-mid="${esc(m.id)}">
    <span class="nm">${esc(m.name)}<span class="meta">${m.price?yen(m.price):'値段未設定'}</span></span>
    <span class="qty"><button type="button" class="step" data-mstep="-1" aria-label="1つ減らす">−</button><input data-fld="cnt" inputmode="numeric" value="${n}" aria-label="${esc(m.name)}の売上数"><button type="button" class="step" data-mstep="1" aria-label="1つ増やす">＋</button></span>
    <b class="sub">${yen((m.price||0)*n)}</b></div>`}).join(''):'<p class="note" style="margin:0">イベント詳細でメニュー（品目と値段）を登録すると、ここで売上数を入れられます。</p>');
  $('#msTotal').textContent=menu.length?yen(list.filter(e=>e.menuId).reduce((a,e)=>a+(e.amount||0),0)):'';
  $('#msHold').hidden=!menu.length;
  const h=holderOf(p);
  $('#holder').innerHTML=people().map(n=>`<button type="button" data-h="${esc(n)}" style="--pc:${A40(colorOf(n))}" data-p aria-pressed="${n===h}">${esc(n)}</button>`).join('');
  $('#list').innerHTML=sorted.length?sorted.map(entryRow).join(''):empty('まだ記録がありません。「経費」から最初の1件を記録しましょう。');
  // 経費タブの下：記録した順に下へ足していく
  const costs=list.filter(e=>e.kind==='cost').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  $('#cCount').textContent=costs.length?`${costs.length}件・${yen(costs.reduce((a,e)=>a+(e.amount||0),0))}`:'';
  $('#clist').innerHTML=costs.length?costs.map(entryRow).join(''):empty('まだ経費の記録がありません');
  $('#bList').innerHTML=[...D.items].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja')).map(i=>`<option value="${esc(i.name)}">${i.kind==='gear'?'備品':'在庫'} ${qf(i.qty)}${esc(unitOf(i))}</option>`).join('');
  const t=totals(list);
  $('#sS').textContent=yen(t.s);$('#sC').textContent=yen(t.c);$('#sP').textContent=yen(t.p);
  const bars=(kind,cls)=>{const r=[...new Set([...(kind==='cost'?costCats():CATS.sale),...list.filter(e=>e.kind===kind).map(e=>e.category)])].map(c=>({c,v:list.filter(e=>e.kind===kind&&e.category===c).reduce((a,e)=>a+(e.amount||0),0)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);const mx=Math.max(1,...r.map(x=>x.v));
    return r.length?r.map(x=>`<div class="cat"><span>${esc(x.c)}</span><span class="track"><span class="fill ${cls}" style="width:${(x.v/mx*100).toFixed(1)}%"></span></span><b>${yen(x.v)}</b></div>`).join(''):`<p class="empty">${kind==='sale'?'売上':'経費'}の記録がありません</p>`};
  $('#saleRows').innerHTML=bars('sale','s');$('#catRows').innerHTML=bars('cost','c');
},
onClick(e){
  let b;
  if(b=e.target.closest('#mtab button')){mTab(b.dataset.t);return}
  if(b=e.target.closest('#cats button')){ui.cat=b.dataset.c;drawKind();return}
  if(b=e.target.closest('#bBean button')){ui.bBean=b.dataset.b==='1';drawBuy();return}
  if(b=e.target.closest('#bKind button')){if(!b.disabled){ui.bDest=ui.bDest===b.dataset.d?null:b.dataset.d;drawBuy()}return}
  if(b=e.target.closest('[data-vstep]')){setVisitors(id,(proj(id)?.visitors||0)+Number(b.dataset.vstep));return}
  if(b=e.target.closest('[data-mstep]')){const r=b.closest('.msr'),cur=menuEntry(id,r.dataset.mid)?.count||0;setMenuCount(id,r.dataset.mid,cur+Number(b.dataset.mstep));return}
  if(b=e.target.closest('#holder button')){
    // 売上を持っている人を変える（メニューの売上すべてに反映）
    const n=b.dataset.h,bt=writeBatch(fs);
    bt.update(doc(C.projects,id),{salesHolder:n,...stamp()});
    for(const x of entriesOf(id).filter(x=>x.menuId))bt.update(doc(C.entries,x.id),{person:n,...stamp()});
    bt.commit().catch(writeErr);return;
  }
  if(b=e.target.closest('#people button')){ui.person=b.dataset.p;ls.set('cfl-person',ui.person);drawPeople();return}
  if(e.target.closest('[data-act="cancel"]')){resetEntry();return}
  if(b=e.target.closest('[data-act="csv"]')){copyCsv(b,entriesOf(id));return}
  const li=e.target.closest('li[data-id]');if(!li)return;const it=D.entries.find(x=>x.id===li.dataset.id);if(!it)return;
  if(e.target.closest('[data-edit]')&&it.kind==='cost'){
    ui.editId=it.id;ui.cat=it.category;ui.person=it.person;drawKind();drawPeople();
    $('#bItem').value=it.itemId?(itemOf(it.itemId)?.name||it.itemName||''):(it.itemName||'');$('#bQty').value=it.qty?String(it.qty):'';ui.bBean=null;ui.bDest=null;drawBuy();
    $('#amount').value=Number(it.amount||0).toLocaleString('ja-JP');$('#date').value=it.date||today();$('#memo').value=it.memo||'';
    $('#save').textContent='この内容で更新';$('#cancelWrap').hidden=false;mTab('in');$('#mtab').scrollIntoView({block:'start'});
  }
},
onLpDelete(li){
  const it=D.entries.find(x=>x.id===li.dataset.id);if(!it)return;
  // 品目の数量を在庫・備品に足した記録なら、その分も引き戻す
  const b=writeBatch(fs);b.delete(doc(C.entries,it.id));
  if(it.itemId&&it.qty&&itemOf(it.itemId))b.update(doc(C.items,it.itemId),{qty:increment(-it.qty),...stamp()});
  b.commit().catch(writeErr);
  if(ui.editId===it.id)resetEntry();
  toast(it.itemId&&it.qty?'削除しました（'+IK[itemOf(it.itemId)?.kind||'stock'].t+'から'+qf(it.qty)+unitOf(itemOf(it.itemId))+'引きました）':'削除しました');
},
onChange(e){
  if(e.target.id==='visitors'){setVisitors(id,num(e.target.value));return}
  if(e.target.dataset.fld==='cnt'){const r=e.target.closest('.msr');setMenuCount(id,r.dataset.mid,num(e.target.value))}
},
onInput(e){
  if(e.target.id==='bItem'||e.target.id==='bUnitIn'){drawBuy();return}if(e.target.id==='amount'){const d=e.target.value.replace(/[^\d]/g,'');e.target.value=d?Number(d).toLocaleString('ja-JP'):''}},
onSubmit(e){
  e.preventDefault();
  const amount=num($('#amount').value);
  if(!amount||amount<0){toast('金額を入れてください',true);$('#amount').focus();return}
  if(!ui.person){toast('だれのお金かを選んでください',true);return}
  // 品目：在庫・備品にある名前か、「在庫」「備品」を押したときは数量を反映。それ以外は経費の記録に品目名を残すだけ
  let buy=null,note=null;
  {
    const name=$('#bItem').value.trim(),q=num($('#bQty').value);
    if(!name&&$('#bQty').value.trim()){toast('品目を入れてください',true);$('#bItem').focus();return}
    if(name&&(itemByName(name)||ui.bDest)){
      if(!(q>0)){toast('数量を入れてください',true);$('#bQty').focus();return}
      buy={name,q};
    }else if(name)note={name,q};
  }
  const old=ui.editId?D.entries.find(x=>x.id===ui.editId):null;
  const body={projectId:id,date:$('#date').value||today(),kind:ui.kind,category:ui.cat,amount,person:ui.person,memo:$('#memo').value.trim(),createdAt:old?.createdAt||Date.now(),...stamp()};
  const b=writeBatch(fs),now=Date.now();
  let it=null;
  if(buy){
    it=itemByName(buy.name);
    if(!it){
      // 同じ名前の品目がなければ、押した方（在庫／備品）に新しく作る
      const kind=buyDest(null),bean=kind==='stock'&&(ui.bBean??guessBean(buy.name)),ref=doc(C.items);
      it={id:ref.id,kind,name:buy.name,bean,unit:kind==='gear'?'':bean?'kg':$('#bUnitIn').value.trim(),qty:0,_new:true};
      b.set(ref,{kind:it.kind,name:it.name,unit:it.unit,...(bean?{bean:true}:{}),qty:0,createdAt:now,...stamp()});
    }
    Object.assign(body,{itemId:it.id,itemName:it.name,qty:buy.q,unit:unitOf(it)});
  }
  if(note)Object.assign(body,{itemName:note.name,...(note.q>0?{qty:note.q}:{})});
  // 在庫の数を動かす（前の記録の分を戻して、新しい分を足す）
  const dl={};
  if(old?.itemId&&old.qty&&itemOf(old.itemId))dl[old.itemId]=(dl[old.itemId]||0)-old.qty;
  if(buy)dl[it.id]=(dl[it.id]||0)+buy.q;
  for(const [k,v] of Object.entries(dl))if(v)b.update(doc(C.items,k),{qty:increment(v),...stamp()});
  // このプロジェクトの持ち物リストに入っていなければ入れる（あとで「使った数」を入れるため）
  if(buy&&!D.packs.some(p=>p.id===id+'_'+it.id))b.set(doc(C.packs,id+'_'+it.id),{projectId:id,itemId:it.id,kind:it.kind,name:it.name,take:0,used:0,checked:false,createdAt:now,...stamp()});
  // 電波がなくても端末に先に保存され、つながったら自動で送られる
  b.set(old?doc(C.entries,old.id):doc(C.entries),body);
  b.commit().catch(writeErr);
  const was=!!old;resetEntry();
  toast((was?'更新しました：':'記録しました：')+body.category+' '+yen(amount)+(buy?(was?`・${it.name}の${IK[it.kind].t}も直しました`:`・${it.name} ${qf(buy.q)}${unitOf(it)}を${IK[it.kind].t}に足しました`):(was&&old?.itemId?'・在庫も直しました':''))+(navigator.onLine?'':'（電波が戻ったら送信します）'));
}}}
// 記録1件の行（トランザクション・経費タブで共通）
function entryRow(e){
  const nm=e.itemId?(itemOf(e.itemId)?.name||e.itemName||''):(e.itemName||''),u=e.itemId?(unitOf(itemOf(e.itemId))||e.unit||''):'';
  return `<li data-lp data-id="${esc(e.id)}">
    <span class="what">${esc(e.category)}<span class="meta" style="font-weight:400"> ・ ${esc(e.person)}</span></span>
    <span class="money ${e.kind==='sale'?'s':'c'}">${e.kind==='sale'?'+':'−'}${yen(e.amount).replace('−','')}</span>
    <span class="meta">${md(e.date)}${e.menuId?`　・${yen(e.unitPrice||0)} × ${e.count||0}`:''}${nm?`　・${esc(nm)}${e.qty?' '+qf(e.qty)+esc(u):''}${e.itemId?`（${IK[itemOf(e.itemId)?.kind||'stock'].t}）`:''}`:''}${e._pending?'　・未送信':''}</span>
    <span class="ops">${e.kind==='cost'?'<button type="button" class="ghost" data-edit>編集</button>':''}</span>
    ${e.memo?`<span class="memo">${esc(e.memo)}</span>`:''}</li>`;
}
async function copyCsv(btn,list){
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"',p=proj(R.id);
  const rows=[['日付','プロジェクト','種類','科目','金額','人','品目','数量','単位','メモ']].concat([...list].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(x=>[x.date,p?.name,x.kind==='sale'?'売上':'経費',x.category,x.amount,x.person,x.itemName||'',x.qty??'',x.itemId?(unitOf(itemOf(x.itemId))||x.unit||''):'',x.memo]));
  try{await navigator.clipboard.writeText(rows.map(r=>r.map(q).join(',')).join('\n'));btn.textContent='コピーしました'}catch(err){btn.textContent='コピーできませんでした'}
  setTimeout(()=>{btn.textContent='CSVをコピー'},2000);
}

// 精算
function payRows(list){
  const P=people(),t=totals(list),share=t.p/P.length;
  return P.map(p=>{const mine=list.filter(e=>e.person===p);const paid=mine.filter(e=>e.kind==='cost').reduce((a,e)=>a+(e.amount||0),0);const held=mine.filter(e=>e.kind==='sale').reduce((a,e)=>a+(e.amount||0),0);return{p,paid,held,bal:share-(held-paid)}});
}
function moves(rows){
  const pos=rows.map(r=>({p:r.p,v:Math.round(r.bal)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  const neg=rows.map(r=>({p:r.p,v:Math.round(r.bal)})).filter(x=>x.v<0).sort((a,b)=>a.v-b.v);
  const out=[];let i=0,j=0;
  while(i<pos.length&&j<neg.length){const m=Math.min(pos[i].v,-neg[j].v);if(m>0)out.push([neg[j].p,pos[i].p,m]);pos[i].v-=m;neg[j].v+=m;if(pos[i].v<=0)i++;if(neg[j].v>=0)j++}
  return out;
}
function vPay(){const id=R.id;return{title:'精算',back:pBack(),html:`
<h2>だれがだれに渡すか</h2><ul class="pay" id="moves"></ul>
<h2>${people().length}人の内訳</h2>
<div class="scroll"><table><thead><tr><th>メンバー</th><th>立て替えた経費</th><th>手元の売上</th><th>精算額</th></tr></thead><tbody id="payRows"></tbody></table></div>
<p class="note">このプロジェクトの利益を${people().length}人で同じ額に分ける計算です。精算額がプラスの人は受け取り、マイナスの人は渡します。</p>`,
refresh(){
  const list=entriesOf(id),rows=payRows(list),mv=moves(rows);
  $('#payRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.p)}</td><td>${yen(r.paid)}</td><td>${yen(r.held)}</td><td class="${r.bal>=0?'s':'c'}"><b>${r.bal>=0?'+':''}${yen(r.bal)}</b></td></tr>`).join('');
  $('#moves').innerHTML=list.length?(mv.length?mv.map(m=>`<li>${esc(m[0])} → ${esc(m[1])}<b>${yen(m[2])}</b></li>`).join(''):'<li>精算の必要はありません</li>'):'<li>記録がまだありません</li>';
}}}

// ログイン
function vLogin(){return{title:'Ledger',html:`
<div class="card" style="text-align:center">
  <p style="margin:0 0 6px;font-weight:700;font-size:18px">ログインしてください</p>
  <p class="note" style="margin:0">登録されたGoogleアカウントだけが使えます。</p>
  <button class="go" data-act="login" type="button">Googleでログイン</button>
  <p class="note c" id="loginNote"></p>
</div>`,
async onClick(e){
  if(!e.target.closest('[data-act="login"]'))return;
  $('#loginNote').textContent='';
  try{await signInWithPopup(auth,new GoogleAuthProvider().setCustomParameters({prompt:'select_account'}))}
  catch(err){if(err.code!=='auth/popup-closed-by-user'&&err.code!=='auth/cancelled-popup-request')$('#loginNote').textContent='ログインできませんでした（'+err.code+'）。ポップアップがブロックされていないか確認してください。'}
}}}

// ===== ページの切り替え =====
const VIEWS={home:vHome,new:vNew,list:vList,stock:()=>vItems('stock'),gear:()=>vItems('gear'),shop:vShop,hub:vHub,detail:vDetail,pack:vPack,money:vMoney,pay:vPay};
function parse(){
  const p=location.hash.replace(/^#\/?/,'').split('/');
  if(p[0]==='p'&&p[1])return{name:VIEWS[p[2]]&&!['home','new','list','stock','gear','shop'].includes(p[2])?p[2]:'hub',id:p[1]};
  return{name:VIEWS[p[0]]&&p[0]!=='hub'?p[0]:'home'};
}
function show(){
  R=parse();let v;
  if(!user)v=vLogin();
  else if(R.id&&!proj(R.id)){
    v=loaded.has('projects')
      ?{title:'見つかりません',back:['#list','一覧'],html:'<p class="empty">このプロジェクトは見つかりませんでした（削除されたかもしれません）。</p>'}
      :{title:'読み込み中',back:['#list','一覧'],html:'<p class="empty">読み込んでいます…</p>',waiting:true};
  }
  else v=VIEWS[R.name]();
  V=v;
  // ログイン中はメニューを左に常に表示（☰ は使わない）
  document.body.classList.toggle('side',!!user);document.body.classList.toggle('home',R.name==='home'&&!R.id);$('#menuBtn').hidden=true;
  {const d=$('#drawer');d.inert=!user;d.setAttribute('aria-hidden',String(!user))}
  if(user)drawMenu();
  $('#title').textContent=v.title;document.title=v.title&&v.title!=='Ledger'?v.title+'｜Ledger':'Ledger';
  const b=$('#back');b.hidden=!v.back;if(v.back){b.href=v.back[0];b.textContent='‹ '+v.back[1]}
  $('#view').innerHTML=v.html;
  v.init?.();v.refresh?.();
  window.scrollTo({top:0});
  presSend({x:null,y:null,focus:null});presDraw();
}
window.addEventListener('hashchange',show);

// ===== いっしょに開いている人のポインタ（Googleスプレッドシートのように、メンバーの色で表示） =====
// 自分のポインタの位置・入力中の欄を presence/{自分のID} に書き、同じページを開いている他の人の分を描く。
// 位置は本文の幅に対する割合と、本文の上からの距離で送る（画面の大きさが違ってもだいたい同じ場所になる）
const pageKey=()=>{const h=location.hash;return(!h||h==='#'||h==='#/')?'#':h};   // トップは「#」「#/」どちらでも同じページ
const PRES={last:0,timer:null,data:{x:null,y:null,focus:null}};
function presSend(patch){
  if(!user||!user.uid)return;
  Object.assign(PRES.data,patch);
  clearTimeout(PRES.timer);
  PRES.timer=setTimeout(()=>{
    PRES.last=Date.now();
    const me=memberOfEmail(user.email);
    setDoc(doc(PRESC,user.uid),{email:user.email||'',name:me||(user.email||'').split('@')[0],color:me?colorOf(me):'#566a62',page:pageKey(),...PRES.data,t:Date.now()}).catch(()=>{});
  },Math.max(0,250-(Date.now()-PRES.last)));   // 送るのは 0.25 秒に1回まで
}
function focusKey(el){
  if(!el||!el.matches||!el.matches('input,textarea,select'))return null;
  if(el.id)return '#'+el.id;
  const row=el.closest('[data-id],[data-mid]');if(!row)return null;
  const rk=row.dataset.id?`[data-id="${row.dataset.id}"]`:`[data-mid="${row.dataset.mid}"]`;
  return rk+' '+(el.dataset.fld?`[data-fld="${el.dataset.fld}"]`:'.'+el.classList[0]);
}
document.addEventListener('pointermove',e=>{
  if(!user)return;
  const r=$('main .wrap').getBoundingClientRect(),x=(e.clientX-r.left)/r.width;
  presSend(x<0||x>1?{x:null,y:null}:{x:+x.toFixed(4),y:Math.round(e.clientY-r.top)});
},{passive:true});
document.addEventListener('mouseout',e=>{if(!e.relatedTarget)presSend({x:null,y:null})});
$('#view').addEventListener('focusin',e=>presSend({focus:focusKey(e.target)}));
$('#view').addEventListener('focusout',()=>presSend({focus:null}));
document.addEventListener('visibilitychange',()=>{if(document.hidden)presSend({x:null,y:null,focus:null})});
window.addEventListener('pagehide',()=>{if(user?.uid)deleteDoc(doc(PRESC,user.uid)).catch(()=>{})});
function presDraw(){
  const layer=$('#pres');if(!layer)return;
  const now=Date.now(),here=pageKey(),r=$('main .wrap').getBoundingClientRect();
  const others=user?D.presence.filter(p=>p.id!==user.uid&&now-(p.t||0)<60000&&(p.page||'#')===here):[];
  let html='';
  for(const p of others){
    const c=A40(/^#[0-9a-f]{6}$/i.test(p.color||'')?p.color:'#566a62'),nm=esc(p.name||'');
    if(p.focus){let el=null;try{el=$('#view').querySelector(p.focus)}catch(err){}
      if(el){const b=el.getBoundingClientRect();if(b.width)html+=`<div class="pf" style="left:${b.left-r.left-3}px;top:${b.top-r.top-3}px;width:${b.width+6}px;height:${b.height+6}px;--c:${c}"><span>${nm}</span></div>`}}
    if(p.x!=null&&p.y!=null)html+=`<div class="pc" data-u="${esc(p.id)}" style="left:${(p.x*r.width).toFixed(1)}px;top:${p.y}px;--c:${c}"><svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M1.5 1.5l14 9-6.5 1.4-3.6 7.6z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>${nm}</span></div>`;
  }
  // 動きがなめらかになるよう、同じ人のポインタは作り直さず位置だけ変える
  const keep={};for(const el of layer.querySelectorAll('.pc'))keep[el.dataset.u]=el;
  const tmp=document.createElement('div');tmp.innerHTML=html;
  for(const el of tmp.querySelectorAll('.pc')){const o=keep[el.dataset.u];if(o){o.style.cssText=el.style.cssText;o.innerHTML=el.innerHTML;el.replaceWith(o)}}
  layer.replaceChildren(...tmp.childNodes);
}
setInterval(presDraw,5000);
window.addEventListener('resize',presDraw);

// ===== スワイプで前のページへ =====
// Macのトラックパッド：2本指で右へスワイプ／スマホ：画面の左端から右へスワイプ
// 戻り先は「‹ 戻る」と同じ。メニューから開くページ（一覧・在庫など）はメイン画面へ戻る。
(()=>{
  const ind=document.createElement('div');ind.className='swipe';ind.textContent='‹';ind.setAttribute('aria-hidden','true');document.body.appendChild(ind);
  const TH=120;let acc=0,timer=null,lock=false,unlock=null;
  const target=()=>!user?null:(V?.back?.[0]||(R.name!=='home'&&!R.id?'#/':null));
  const showP=p=>{p=Math.max(0,Math.min(1,p));ind.style.opacity=p;ind.style.transform=`translateX(${p*60-60}px)`;ind.classList.toggle('go',p>=1)};
  const reset=()=>{acc=0;showP(0)};
  const go=()=>{const t=target();reset();if(t)location.hash=t};
  const scrollableX=el=>{for(;el&&el!==document.body;el=el.parentElement){const o=getComputedStyle(el).overflowX;if((o==='auto'||o==='scroll')&&el.scrollWidth>el.clientWidth)return true}return false};
  window.addEventListener('wheel',e=>{
    if(lock){clearTimeout(unlock);unlock=setTimeout(()=>{lock=false},350);if(Math.abs(e.deltaX)>Math.abs(e.deltaY))e.preventDefault();return}
    if(e.ctrlKey||!target()||Math.abs(e.deltaX)<=Math.abs(e.deltaY)||scrollableX(e.target))return;
    e.preventDefault();
    acc=Math.max(0,acc-e.deltaX);showP(acc/TH);
    clearTimeout(timer);
    if(acc>=TH){lock=true;unlock=setTimeout(()=>{lock=false},350);go();return}
    timer=setTimeout(reset,200);
  },{passive:false});
  let sx=null,sy=0;
  window.addEventListener('touchstart',e=>{const t=e.touches[0];sx=(t.clientX<28&&target())?t.clientX:null;sy=t.clientY},{passive:true});
  window.addEventListener('touchmove',e=>{if(sx==null)return;const t=e.touches[0],dx=t.clientX-sx;if(Math.abs(t.clientY-sy)>Math.max(dx,30)){sx=null;reset();return}showP(dx/100)},{passive:true});
  window.addEventListener('touchend',e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(dx>=100)go();else reset()});
})();
// 送信ボタン（type=submit）と入力欄での Enter は、ブラウザの「フォーム送信」に頼らず自分で処理する
// （フォーム送信が止められている画面＝埋め込み表示などでも、ボタンが効くように）
function submitForm(form){if(form&&V&&V.onSubmit)V.onSubmit({target:form,currentTarget:form,preventDefault(){}})}
// ===== 時間の選択（一覧をスクロールして選ぶ／数字で入力もできる） =====
const TIMES=[];for(let h=0;h<24;h++)for(const m of ['00','15','30','45'])TIMES.push(h+':'+m);
const tmMin=s=>{const [a,b]=s.split(':');return +a*60+ +b};
function tmClose(){for(const x of $$('.tmpop'))x.remove()}
function tmMark(el,pop){
  const cur=normTime(el.value),v=cur||el.dataset.def||'9:00';let best=null,bd=1e9;
  for(const b of pop.children){b.setAttribute('aria-selected',String(b.dataset.tm===cur));const d=Math.abs(tmMin(b.dataset.tm)-tmMin(v));if(d<bd){bd=d;best=b}}
  if(best)pop.scrollTop=best.offsetTop-pop.clientHeight/2+best.offsetHeight/2;
}
$('#view').addEventListener('focusin',e=>{
  const el=e.target;if(!el.classList?.contains('tm')||el.parentElement.querySelector('.tmpop'))return;
  tmClose();
  const pop=document.createElement('div');pop.className='tmpop';pop.setAttribute('role','listbox');
  pop.innerHTML=TIMES.map(t=>`<button type="button" role="option" tabindex="-1" data-tm="${t}">${t}</button>`).join('');
  el.parentElement.appendChild(pop);tmMark(el,pop);
});
$('#view').addEventListener('input',e=>{if(e.target.classList?.contains('tm')){const pop=e.target.parentElement.querySelector('.tmpop');if(pop&&normTime(e.target.value))tmMark(e.target,pop)}});
$('#view').addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.target.closest('.tmpop'))e.preventDefault()});   // マウスのときは入力欄から外れないように
$('#view').addEventListener('click',e=>{
  const b=e.target.closest('.tmpop button');if(!b)return;
  const el=b.closest('.tmw').querySelector('.tm');el.value=b.dataset.tm;el.dispatchEvent(new Event('change',{bubbles:true}));tmClose();el.blur();
},true);
$('#view').addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.closest?.('.tmw'))tmClose()},150));
$('#view').addEventListener('keydown',e=>{if(e.key==='Escape')tmClose()});

// ===== 長押しで削除 =====
// data-lp の付いた行を 0.5 秒ほど押し続けると「削除／やめる」が出る（入力欄やボタンの上からは始めない）
let lp=null,lpAt=0;
function lpClear(){for(const x of $$('#view .lpbar'))x.remove();for(const x of $$('#view .lp-on,#view .lp-press'))x.classList.remove('lp-on','lp-press')}
function lpCancel(){if(lp){clearTimeout(lp.t);lp.el.classList.remove('lp-press');lp=null}}
$('#view').addEventListener('pointerdown',e=>{
  if(e.button>0)return;
  let el=e.target.closest('[data-lp]');
  if(!el||e.target.closest('input,select,textarea,button,.lpbar'))return;
  lpCancel();
  el.classList.add('lp-press');
  lp={el,x:e.clientX,y:e.clientY,t:setTimeout(()=>{
    lp=null;lpAt=Date.now();lpClear();
    // 押している間に一覧が描き直されていたら、同じ行を探し直す
    if(!el.isConnected&&el.dataset.id)el=$$('#view [data-lp]').find(x=>x.dataset.id===el.dataset.id)||el;
    if(!el.isConnected)return;
    el.classList.add('lp-on');
    el.insertAdjacentHTML('beforeend','<span class="lpbar"><button type="button" class="lpdel" data-lpdel>削除</button><button type="button" class="ghost" data-lpno>やめる</button></span>');
    try{navigator.vibrate?.(15)}catch(err){}
  },550)};
});
$('#view').addEventListener('pointermove',e=>{if(lp&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10)lpCancel()});
for(const t of ['pointerup','pointercancel'])$('#view').addEventListener(t,lpCancel);
$('#view').addEventListener('contextmenu',e=>{if(e.target.closest('[data-lp]'))e.preventDefault()});
// 長押しを離した直後のクリック（リンクを開くなど）は無視する
document.addEventListener('click',e=>{if(Date.now()-lpAt<600&&!e.target.closest('.lpbar')){e.preventDefault();e.stopPropagation()}},true);
$('#view').addEventListener('click',e=>{
  const lb=e.target.closest('[data-lpdel],[data-lpno]');
  if(lb){e.preventDefault();const el=lb.closest('[data-lp]');const del=lb.hasAttribute('data-lpdel');lpClear();if(del&&el&&V?.onLpDelete)V.onLpDelete(el);return}
  if($('#view .lpbar'))lpClear();
  const sb=e.target.closest('button[type="submit"],button:not([type])');
  if(sb&&sb.form){e.preventDefault();submitForm(sb.form);return}
  if(V&&V.onClick)V.onClick(e);
});
$('#view').addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing||e.keyCode===229)return;   // 日本語変換の確定の Enter は除く
  const el=e.target;
  if(el.tagName!=='INPUT'||!el.form||/^(checkbox|radio|button|submit)$/.test(el.type))return;
  e.preventDefault();
  if(el.form.hasAttribute('data-noenter')){el.blur();return}   // Enter は入力の確定だけ（保存はボタンで）
  submitForm(el.form);
});
$('#view').addEventListener('submit',e=>e.preventDefault());
for(const t of ['change','input']){
  const k='on'+t[0].toUpperCase()+t.slice(1);
  $('#view').addEventListener(t,e=>{if(V&&V[k])V[k](e)});
}
function changed(name){
  loaded.add(name);
  if(user)drawMenu();
  if(!V)return;
  if(V.waiting){if(name==='projects')show();return}
  if(R.id&&!proj(R.id)&&loaded.has('projects')){show();return}
  V.refresh?.();
  presDraw();
}

// ===== ログインとデータの同期 =====
$('#logout').addEventListener('click',()=>signOut(auth));

onAuthStateChanged(auth,u=>{
  for(const f of unsubs)f();unsubs=[];
  clearTimeout(loadTimer);loaded.clear();
  user=u;
  if(!u){Object.assign(D,{projects:[],entries:[],items:[],packs:[],shop:{},presence:[]});$('#account').hidden=true;setStatus('');show();return}
  $('#account').hidden=false;$('#who').textContent=u.email+' でログイン中';
  setStatus('読み込んでいます…');
  loadTimer=setTimeout(()=>setStatus('サーバーにつながりません。電波が戻ると自動で同期します。',true),10000);
  const fail=err=>{
    clearTimeout(loadTimer);
    if(err.code==='permission-denied')setStatus(u.email+' では読み込めませんでした。登録されたアカウントか、Firestoreのルールが新しい版になっているかを確認してください。',true);
    else setStatus('読み込めませんでした（'+err.code+'）。ページを開き直してください。',true);
  };
  for(const k of Object.keys(C)){
    unsubs.push(onSnapshot(C[k],{includeMetadataChanges:true},snap=>{
      D[k]=snap.docs.map(d=>({id:d.id,...d.data(),_pending:d.metadata.hasPendingWrites}));
      if(!snap.metadata.fromCache&&k==='projects'){clearTimeout(loadTimer);setStatus('')}
      changed(k);
    },fail));
  }
  unsubs.push(onSnapshot(shopRef,snap=>{D.shop=snap.exists()?snap.data():{};changed('shop')},fail));
  // ポインタ（読めなくてもアプリは使えるので、エラーは出さない）
  unsubs.push(onSnapshot(PRESC,snap=>{D.presence=snap.docs.map(d=>({id:d.id,...d.data()}));presDraw()},()=>{}));
  show();
});

ui.person=ls.get('cfl-person')||null;

// ホーム画面に追加したときにアプリとして動かすための仕組み（オフライン対応）
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{})}
