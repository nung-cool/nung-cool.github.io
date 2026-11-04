import { FIREBASE_CONFIG } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, query, orderBy, onSnapshot, updateDoc, addDoc, deleteDoc, getDoc, setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const won = n => Number(n || 0).toLocaleString('ko-KR');
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let goals = [], ready = false, sel = store.get('hn-sel');
let fs = null, room = null;

function showErr(msg) { $('status').hidden = false; $('status').textContent = msg; }
const SAVE_ERR = '저장이 안 됐어요. 인터넷 연결을 확인하고 다시 해 주세요.';

/* ---------- views ---------- */
function setView(v) {
  for (const s of ['map', 'goals', 'add']) $('v-' + s).hidden = s !== v;
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'map') requestAnimationFrame(placePair);
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function current() { return goals.find(g => g.id === sel) || goals[0] || null; }
function counts(g) { const s = g?.steps || []; return { total: s.length, done: s.filter(x => x.done).length }; }
function dday(due) {
  if (!due) return '';
  const d = Math.ceil((new Date(due + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
  return d > 0 ? 'D-' + d : d === 0 ? 'D-DAY' : 'D+' + (-d);
}

function renderMap() {
  const g = current();
  $('tabs').innerHTML = goals.map(x => `<button type="button" class="tab ${x === g ? 'on' : ''}" data-sel="${x.id}">${esc(x.title)}</button>`).join('');
  if (!g) { $('m-title').textContent = '희넝이네 완주 지도'; $('m-amount').textContent = ''; $('m-dday').textContent = ''; $('next').hidden = true; $('dots').innerHTML = ''; $('cheer').hidden = true; placePair(); return; }
  const { total, done } = counts(g);
  const pct = total ? Math.round(done / total * 100) : 0;
  $('m-title').textContent = g.title;
  $('m-amount').innerHTML = g.target ? `<b>${won(g.saved)}</b> / ${won(g.target)}만원 · ${pct}%` : `<b>${done}</b> / ${total}칸 · ${pct}%`;
  $('m-dday').textContent = dday(g.due);
  const road = $('road'), L = road.getTotalLength();
  let html = '';
  for (let i = 0; i <= total; i++) {
    const p = road.getPointAtLength(total ? L * i / total : 0);
    const on = i <= done;
    html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${on ? 6 : 5}" fill="${on ? 'var(--ok)' : 'var(--card)'}" stroke="var(--fg)" stroke-width="2"/>`;
  }
  $('dots').innerHTML = html;
  const idx = (g.steps || []).findIndex(s => !s.done);
  $('next').hidden = idx < 0 || !ready;
  if (idx >= 0) { $('n-text').textContent = g.steps[idx].t; $('n-btn').dataset.g = g.id; $('n-btn').dataset.i = idx; }
  $('cheer').hidden = !(total && done === total);
  placePair();
}

function placePair() {
  const g = current(); const { total, done } = counts(g);
  const road = $('road'), L = road.getTotalLength();
  const p0 = road.getPointAtLength(total ? L * done / total : 0);
  const r = $('map').getBoundingClientRect(); if (!r.width) return;
  const s = r.width / 356, x = p0.x * s, y = p0.y * s;
  $('pair').style.left = x + 'px'; $('pair').style.top = y + 'px';
  const b = $('bub');
  b.hidden = !g || !total;
  b.textContent = `${done}칸 / ${total}칸`;
  b.style.left = Math.min(x + 48, r.width - 90) + 'px'; b.style.top = (y - 46) + 'px';
}

function renderCards() {
  const box = $('cards');
  if (!goals.length) { box.innerHTML = '<p class="notice">아직 목표가 없어요. 추가 탭에서 첫 목표를 넣어 보세요.</p>'; return; }
  const dis = ready ? '' : 'disabled';
  box.innerHTML = goals.map(g => {
    const { total, done } = counts(g); const pct = total ? Math.round(done / total * 100) : 0;
    return `<article class="goal ${total && done === total ? 'done' : ''}">
      <div class="gt"><b>${esc(g.title)}</b>${g.due ? `<span>~ ${esc(g.due.slice(0, 7).replace('-', '.'))}</span>` : ''}</div>
      <div class="bar" aria-label="${pct}% 완료"><i style="width:${pct}%"></i></div>
      ${g.target ? `<div class="money"><span>모은 돈</span><input type="number" inputmode="numeric" id="m-${g.id}" min="0" step="10" value="${Number(g.saved || 0)}" ${dis} aria-label="모은 돈 (만원)"><span>/ ${won(g.target)}만원</span><button class="btn ghost" type="button" data-save="${g.id}" ${dis}>저장</button></div>` : ''}
      <ul class="steps">${(g.steps || []).map((s, i) => `<li class="${s.done ? 'is-done' : ''}"><label><input type="checkbox" id="s-${g.id}-${i}" data-g="${g.id}" data-i="${i}" ${s.done ? 'checked' : ''} ${dis}><span>${esc(s.t)}</span></label></li>`).join('')}</ul>
      <div class="foot"><span>${done}/${total}칸</span><button class="del" type="button" data-del="${g.id}" ${dis}>삭제</button></div>
    </article>`;
  }).join('');
}
function render() { renderMap(); renderCards(); }

/* ---------- writes ---------- */
const goalRef = id => doc(fs, 'rooms', room, 'goals', id);

async function setStep(id, i, val) {
  const g = goals.find(x => x.id === id); if (!g || !ready) return;
  const steps = g.steps.map((s, j) => j === i ? { ...s, done: val } : s);
  g.steps = steps; render();
  try { await updateDoc(goalRef(id), { steps }); } catch (e) { showErr(SAVE_ERR); }
}

document.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.g && el.type === 'checkbox') setStep(el.dataset.g, +el.dataset.i, el.checked); });
document.addEventListener('click', async e => {
  const t = e.target.closest && e.target.closest('button'); if (!t) return;
  if (t.dataset.sel) { sel = t.dataset.sel; store.set('hn-sel', sel); renderMap(); return; }
  if (t.id === 'n-btn') { setStep(t.dataset.g, +t.dataset.i, true); return; }
  if (t.id === 'k-go') { const v = $('k-in').value.trim(); if (v) { store.set('hn-room', v); location.reload(); } return; }
  if (!ready) return;
  if (t.dataset.save) {
    const v = Math.max(0, Number($('m-' + t.dataset.save).value) || 0);
    const g = goals.find(x => x.id === t.dataset.save); if (g) g.saved = v; render();
    try { await updateDoc(goalRef(t.dataset.save), { saved: v }); } catch (err) { showErr(SAVE_ERR); }
    return;
  }
  if (t.dataset.del) {
    if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { t.classList.remove('armed'); t.textContent = '삭제'; }, 3000); return; }
    try { await deleteDoc(goalRef(t.dataset.del)); } catch (err) { showErr(SAVE_ERR); }
  }
});

$('add').addEventListener('submit', async e => {
  e.preventDefault(); if (!ready) return;
  const title = $('g-title').value.trim(); if (!title) return;
  const steps = $('g-steps').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 40).map(t => ({ t, done: false }));
  if (!steps.length) steps.push({ t: title, done: false });
  const target = Number($('g-target').value) || 0;
  $('g-submit').disabled = true;
  try {
    const ref = await addDoc(collection(fs, 'rooms', room, 'goals'), { title, due: $('g-due').value || '', target, saved: 0, steps, created: Date.now() });
    sel = ref.id; store.set('hn-sel', sel);
    $('add').reset(); setView('map');
  } catch (err) { showErr('목표 추가가 안 됐어요. 인터넷 연결을 확인하고 다시 해 주세요.'); }
  $('g-submit').disabled = false;
});

window.addEventListener('resize', placePair);

/* ---------- first goals, written once per room ---------- */
const months = ['26년 11월', '26년 12월', '27년 1월', '27년 2월', '27년 3월', '27년 4월', '27년 5월', '27년 6월', '27년 7월', '27년 8월', '27년 9월', '27년 10월'];
const SEED = {
  'save-30m': { title: '1년 3천만원 모으기', due: '2027-10-31', target: 3000, saved: 0, created: 1, steps: months.map(m => ({ t: m + ' 250만원 저축', done: false })) },
  'move-3y': { title: '3년 안에 집 갈아타기', due: '2029-11-04', target: 0, saved: 0, created: 2, steps: ['갈아탈 동네·평수·예산 같이 정하기', '지금 집 시세랑 대출 잔액 확인하기', '은행에서 대출 한도 상담받기', '관심 단지 임장 다니기', '매수 자금 계획 확정하기', '지금 집 내놓고 매도 계약하기', '새 집 매수 계약하기', '이사 완료!'].map(t => ({ t, done: false })) }
};
async function seedOnce() {
  const meta = doc(fs, 'rooms', room, 'meta', 'info');
  const m = await getDoc(meta);
  if (m.exists()) return;
  const b = writeBatch(fs);
  for (const [id, data] of Object.entries(SEED)) b.set(goalRef(id), data);
  b.set(meta, { seeded: true, at: Date.now() });
  await b.commit();
}

/* ---------- boot ---------- */
render();
(async () => {
  const url = new URL(location.href);
  room = url.searchParams.get('k') || store.get('hn-room');
  if (room) store.set('hn-room', room);
  if (!room) { $('status').hidden = true; $('keybox').hidden = false; return; }
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) { showErr('아직 저장소 연결 전이에요. 곧 열려요!'); return; }
  const app = initializeApp(FIREBASE_CONFIG);
  fs = getFirestore(app);
  const auth = getAuth(app);
  const timer = setTimeout(() => showErr('목표를 아직 못 불러왔어요. 인터넷 연결을 확인해 주세요.'), 10000);
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try { await seedOnce(); } catch (e) { /* not allowed or offline: the listener below reports it */ }
    onSnapshot(query(collection(fs, 'rooms', room, 'goals'), orderBy('created')), snap => {
      clearTimeout(timer); ready = true;
      goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (goals.length) $('status').hidden = true;
      else showErr('아직 목표가 없어요. 추가 탭에서 첫 목표를 넣으면 둘이 걷기 시작해요.');
      render();
    }, err => { clearTimeout(timer); showErr('목표를 불러오지 못했어요. 받은 링크로 다시 들어와 주세요.'); });
  });
  signInAnonymously(auth).catch(() => { clearTimeout(timer); showErr('접속이 안 됐어요. 잠시 뒤 다시 열어 주세요.'); });
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
