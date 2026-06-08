/* ============================================================
   淨海漁夫 Ocean Cleanup Fisher
   純 JavaScript + Canvas 2D。世界座標水平捲動，攝影機跟著船。
   ============================================================ */
(() => {
'use strict';

// ---------- 基本設定 ----------
const WORLD_W = 3000;          // 海洋世界總寬度
const DOCK_X  = WORLD_W - 320; // 漁港 / 商店所在位置（留邊距，避免靠岸時被擠到螢幕邊緣）
const DAY_LEN = 150;           // 一天 = 150 秒
const SAVE_KEY = 'oceanFisher.save.v1';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let view = { w: 0, h: 0, dpr: 1 };
let seaY = 0;        // 海平面在螢幕上的基準高度
let running = false;
let lastT = 0;
let time = 6 * 60 * 60 / (24*60*60) * DAY_LEN; // 從早上6點開始(秒)

// ---------- 升級定義 ----------
const DEFS = {
  rod:    { name:'釣竿',           icon:'🎣', cat:'upgrade', lvl:1, min:1, max:6, base:30,  mul:1.7 },
  speed:  { name:'船用引擎',       icon:'⚙️', cat:'upgrade', lvl:1, min:1, max:6, base:25,  mul:1.6 },
  hold:   { name:'魚艙',           icon:'🧺', cat:'upgrade', lvl:1, min:1, max:6, base:35,  mul:1.7 },
  sonar:  { name:'聲納雷達',       icon:'📡', cat:'upgrade', lvl:0, min:0, max:3, base:120, mul:2.0 },
};
const depthFor  = l => 130 + (l - 1) * 70;     // 釣線可達深度(螢幕px)
const holdFor   = l => 8 + (l - 1) * 6;        // 魚艙容量
const speedMul  = l => 1 + (l - 1) * 0.30;     // 船速倍率（每級 +30%）
const descOf = {
  rod:   l => `釣線深度等級 ${l}，能釣到更深、更值錢的魚`,
  speed: l => `船速 +${Math.round((speedMul(l)-1)*100)}%`,
  hold:  l => `魚艙可裝 ${holdFor(l)} 條魚`,
  sonar: l => l>0 ? `魚價 +${l*8}%，並顯示魚群與污染資訊` : '安裝後顯示魚群位置與污染程度，並提升魚價',
};

// ---------- 環保機器（購買後放置定點、自動運作；可收回重放） ----------
const MACHINE = {
  scoop:  { name:'海洋垃圾撈取機', icon:'🗑️', price:80,  range:155, cd:0.7,    cap:5 },
  filter: { name:'塑膠微粒過濾機', icon:'💧', price:120, range:170, rate:0.018, cap:5 },
};
function machineOwned(type){ return state.inv[type] + state.placed.filter(p=>p.type===type).length; }

// ---------- 魚種 ----------
const FISH_TYPES = [
  { key:'sardine', name:'沙丁魚', emoji:'🐟', color:'#9fd3e8', value:8,   dMinF:0.05, dMaxF:0.30, w:5,  night:0, shape:'fish',   size:0.8 },
  { key:'bream',   name:'真鯛',   emoji:'🐠', color:'#ff9a6c', value:22,  dMinF:0.25, dMaxF:0.58, w:4,  night:0, shape:'bream',  size:1.0 },
  { key:'tuna',    name:'鮪魚',   emoji:'🐟', color:'#4a78b5', value:55,  dMinF:0.40, dMaxF:0.68, w:2.4,night:0, shape:'tuna',   size:1.5 },
  { key:'puffer',  name:'河豚',   emoji:'🐡', color:'#f2c14e', value:38,  dMinF:0.30, dMaxF:0.64, w:2,  night:0, shape:'puffer', size:1.0 },
  { key:'squid',   name:'魷魚',   emoji:'🦑', color:'#e7a6c4', value:70,  dMinF:0.40, dMaxF:0.82, w:2,  night:1, shape:'squid',  size:1.0 },
  { key:'shrimp',  name:'甜蝦',   emoji:'🦐', color:'#ff8e7a', value:30,  dMinF:0.80, dMaxF:0.93, w:3,  night:0, shape:'shrimp', size:0.85 },
];
const TRASH_EMOJI = ['🥤','🛍️','🧴','🥫','📦','🩴'];
// 海底可捕獲的螃蟹（需要長釣竿才搆得到）
const CRAB_TYPE = { key:'crab', name:'螃蟹', emoji:'🦀', color:'#e74c3c', value:45 };

// ---------- 遊戲狀態 ----------
let state;
function freshState() {
  return {
    coins: 0,
    up: { rod:1, speed:1, hold:1, sonar:0 },
    inv: { scoop:0, filter:0 },   // 已購買、尚未放置的機器數量
    placed: [],                   // 已放置在海上的機器 {type, worldX, cd}
    boat: { x: 400, vx: 0, dir: 1 },
    hold: [],                 // 魚艙內的魚 {type,value}
    fish: [],
    trash: [],
    zones: [                  // 污染海域 (世界座標) — 4 區
      { x0: 560,  x1: 880,  p: 0.85 },
      { x0: 1150, x1: 1450, p: 0.95 },
      { x0: 1700, x1: 2000, p: 1.0  },
      { x0: 2250, x1: 2550, p: 0.90 },
    ],
    eco: 55,                  // 海洋健康度 0~100 (平滑值)
    line: { active:false, phase:'idle', depth:0, caught:null },
    stats: { caught:0, sold:0, trash:0, cleaned:0, earned:0 },
    questIdx: 0,
    time: time,
    day: 1,
    muted: false,
  };
}

// ---------- 不需存檔的執行期狀態 ----------
let paused = false;
let combo = 0, comboTimer = 0;
let fx = [];          // 特效粒子（水花、收線星光）
let allCleanCelebrated = false;  // 是否已慶祝過全海域淨化

// ---------- 任務 ----------
const QUESTS = [
  { text:'釣到 3 條魚',                 done:s=>s.stats.caught>=3,  reward:30 },
  { text:'把魚開到右邊的漁港賣掉',      done:s=>s.stats.sold>=1,    reward:30 },
  { text:'購買「撈取機」並放到海上撈垃圾',  done:s=>machineOwned('scoop')>0, reward:60 },
  { text:'撈起 5 件海洋垃圾',           done:s=>s.stats.trash>=5,   reward:60 },
  { text:'購買「淨化機」放進深色污染區',    done:s=>machineOwned('filter')>0, reward:100 },
  { text:'淨化一個深色污染海域',        done:s=>s.stats.cleaned>=1, reward:150 },
  { text:'最終目標：淨化全部 4 個污染海域！', done:s=>s.zones.every(z=>z.p<=0), reward:300 },
];

// ============================================================
//  存檔
// ============================================================
function save() {
  try {
    const data = {
      coins: state.coins, up: state.up, eco: state.eco,
      inv: state.inv, placed: state.placed,
      zones: state.zones, stats: state.stats, questIdx: state.questIdx,
      boatX: state.boat.x, time: state.time, day: state.day, muted: state.muted,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state = freshState();
    state.coins = d.coins ?? 0;
    state.up = Object.assign(state.up, d.up || {});
    state.eco = d.eco ?? 55;
    // 機器（含舊存檔遷移：舊版買斷的機器轉成 1 台庫存）
    state.inv = { scoop:0, filter:0 };
    if (d.inv) state.inv = Object.assign(state.inv, d.inv);
    else { if (d.up && d.up.scoop>0) state.inv.scoop=1; if (d.up && d.up.filter>0) state.inv.filter=1; }
    state.placed = Array.isArray(d.placed) ? d.placed : [];
    if (d.zones) state.zones = d.zones;
    // 防呆：舊存檔的污染區座標若超出目前世界範圍，重建一份
    if (state.zones.some(z => z.x1 > DOCK_X - 200)) state.zones = freshState().zones;
    if (d.stats) state.stats = Object.assign(state.stats, d.stats);
    state.questIdx = d.questIdx ?? 0;
    state.boat.x = d.boatX ?? 400;
    state.time = d.time ?? time;
    state.day = d.day ?? 1;
    state.muted = d.muted ?? false;
    // 同步升級定義等級
    for (const k in DEFS) DEFS[k].lvl = state.up[k];
    return true;
  } catch (e) { return false; }
}
function syncDefs() { for (const k in DEFS) DEFS[k].lvl = state.up[k]; }

// ============================================================
//  音效 (Web Audio 合成，無需音檔)
// ============================================================
let audioCtx = null;
function initAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
}
function beep(freq, dur, type, vol, delay) {
  if (!audioCtx || state.muted) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol || 0.18, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function sfx(name) {
  if (state.muted || !audioCtx) return;
  switch (name) {
    case 'cast':  beep(330, 0.12, 'sine', 0.12); break;
    case 'catch': beep(523, 0.10, 'triangle', 0.18); beep(784, 0.12, 'triangle', 0.18, 0.08); break;
    case 'sell':  beep(659, 0.10, 'square', 0.12); beep(880, 0.10, 'square', 0.12, 0.09); beep(1047, 0.14, 'square', 0.12, 0.18); break;
    case 'buy':   beep(440, 0.08, 'sine', 0.16); beep(660, 0.10, 'sine', 0.16, 0.07); break;
    case 'clean': beep(700, 0.16, 'sine', 0.10); beep(1000, 0.18, 'sine', 0.10, 0.1); beep(1320, 0.22, 'sine', 0.10, 0.2); break;
    case 'trash': beep(280, 0.07, 'square', 0.10); break;
    case 'error': beep(150, 0.18, 'sawtooth', 0.12); break;
  }
}

// ============================================================
//  畫布尺寸 (RWD)
// ============================================================
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  view.dpr = dpr;
  canvas.width = Math.floor(view.w * dpr);
  canvas.height = Math.floor(view.h * dpr);
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seaY = view.h * 0.40;
}
window.addEventListener('resize', resize);

// ============================================================
//  海浪 / 海面
// ============================================================
function surfaceY(worldX, t) {
  return seaY
    + Math.sin(worldX * 0.0090 + t * 1.10) * 7
    + Math.sin(worldX * 0.0260 + t * 1.70) * 4
    + Math.sin(worldX * 0.0045 - t * 0.65) * 11;
}
function pollutionAt(worldX) {
  let p = 0;
  for (const z of state.zones) if (worldX >= z.x0 && worldX <= z.x1) p = Math.max(p, z.p);
  return p;
}

// 沙灘與可用水深（魚與釣鉤都不可低於沙灘）
function seabedTop()  { return view.h - 46; }
function waterBottom(){ return seabedTop() - 14; }                 // 魚最深只能到這（沙灘上方）
function columnH()    { return Math.max(60, waterBottom() - seaY); } // 海面到沙灘上緣的可用高度
function rodReach(l)  { return columnH() * Math.min(0.98, 0.30 + (l - 1) * 0.135); } // 釣線可達深度(px)
function fishScreenY(f, t) {
  return Math.min(surfaceY(f.worldX, t) + f.depth + Math.sin(f.ph) * 3, waterBottom());
}

// ============================================================
//  特效粒子
// ============================================================
function addRipple(worldX, y) {
  fx.push({ type:'ripple', x:worldX, y, t:0 });
  if (fx.length > 60) fx.shift();
}
function addSparkle(worldX, y) {
  for (let i=0;i<7;i++) fx.push({ type:'spark', x:worldX, y, vx:(Math.random()-0.5)*70, vy:-40-Math.random()*40, t:0, life:0.6 });
  if (fx.length > 90) fx.splice(0, fx.length-90);
}
function updateFx(dt) {
  for (let i=fx.length-1;i>=0;i--){
    const p=fx[i]; p.t+=dt;
    if (p.type==='ripple'){ if(p.t>0.6) fx.splice(i,1); }
    else { p.x+=p.vx*dt; p.vy+=140*dt; p.y+=p.vy*dt; if(p.t>p.life) fx.splice(i,1); }
  }
}
function drawFx(c) {
  for (const p of fx){
    const x=p.x-c; if(x<-30||x>view.w+30) continue;
    if (p.type==='ripple'){
      const r=4+p.t*46, a=Math.max(0,0.5*(1-p.t/0.6));
      ctx.strokeStyle=`rgba(255,255,255,${a})`; ctx.lineWidth=2;
      ctx.beginPath(); ctx.ellipse(x,p.y,r,r*0.32,0,0,7); ctx.stroke();
    } else {
      const a=Math.max(0,1-p.t/p.life);
      ctx.fillStyle=`rgba(255,255,210,${a})`;
      ctx.beginPath(); ctx.arc(x,p.y,2,0,7); ctx.fill();
    }
  }
}

// ============================================================
//  生成魚 / 垃圾
// ============================================================
function isNight() { const h = (state.time / DAY_LEN) * 24; return h < 5.5 || h > 18.5; }

function spawnFish(forceX) {
  const night = isNight();
  // 依機率挑魚種
  const pool = FISH_TYPES.filter(f => f.night === 0 || night);
  let total = pool.reduce((a,f)=>a+f.w,0), r = Math.random()*total, t = pool[0];
  for (const f of pool) { if ((r -= f.w) <= 0) { t = f; break; } }
  // 找一個非污染的位置
  let x = forceX;
  if (x == null) {
    for (let i=0;i<8;i++){ x = 200 + Math.random()*(DOCK_X-500); if (pollutionAt(x) < 0.3) break; }
  }
  const depth = (t.dMinF + Math.random()*(t.dMaxF - t.dMinF)) * columnH();
  state.fish.push({
    t, worldX:x, depth,
    vx:(Math.random()<0.5?-1:1)*(12+Math.random()*22),
    ph: Math.random()*Math.PI*2,
  });
}
function spawnTrash(forceX) {
  let x = forceX ?? (200 + Math.random()*(DOCK_X-400));
  state.trash.push({
    worldX:x, emoji:TRASH_EMOJI[(Math.random()*TRASH_EMOJI.length)|0],
    ph: Math.random()*Math.PI*2, drift:(Math.random()-0.5)*8,
  });
}

// ============================================================
//  輸入
// ============================================================
const keys = { left:false, right:false };
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code==='ArrowLeft'||e.code==='KeyA') keys.left=true;
  if (e.code==='ArrowRight'||e.code==='KeyD') keys.right=true;
  if (e.code==='Space'){ e.preventDefault(); cast(); }
});
window.addEventListener('keyup', e => {
  if (e.code==='ArrowLeft'||e.code==='KeyA') keys.left=false;
  if (e.code==='ArrowRight'||e.code==='KeyD') keys.right=false;
});

function holdBtn(id, on, off) {
  const el = document.getElementById(id);
  const down = e => { e.preventDefault(); on(); };
  const up   = e => { e.preventDefault(); off(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}
holdBtn('btnLeft', ()=>keys.left=true, ()=>keys.left=false);
holdBtn('btnRight',()=>keys.right=true,()=>keys.right=false);
document.getElementById('btnCast').addEventListener('click', cast);
document.getElementById('btnScoop').addEventListener('click', ()=>toggleMachine('scoop'));
document.getElementById('btnFilter').addEventListener('click', ()=>toggleMachine('filter'));

// 放置 / 收回機器
function toggleMachine(type) {
  if (!running || shopOpen() || paused) return;
  const R = 70;
  const idx = state.placed.findIndex(p => p.type===type && Math.abs(p.worldX-state.boat.x)<R);
  const sx = state.boat.x - cam(), sy = surfaceY(state.boat.x, state.time) - 26;
  if (idx >= 0) {                                   // 附近有自己的機器 → 收回
    state.placed.splice(idx,1); state.inv[type]++;
    toast(sx, sy, '🔧 收回機器', 'eco'); sfx('buy');
  } else if (state.inv[type] > 0) {                 // 放一台
    state.inv[type]--;
    state.placed.push({ type, worldX: state.boat.x, cd: 0 });
    toast(sx, sy, (type==='filter'?'💧 放置淨化機':'🗑️ 放置撈取機'), 'eco'); sfx('buy');
  } else {
    toast(view.w/2, view.h*0.55, '沒有可放置的機器，去漁港商店購買', 'warn'); sfx('error');
  }
  updateMachineBtns(); save();
}

// 點海面任意空白處即可釣魚（移動請用左右鍵）
canvas.addEventListener('pointerdown', e => {
  if (!running || shopOpen() || paused) return;
  e.preventDefault();
  cast();
});

// ============================================================
//  釣魚
// ============================================================
function cast() {
  if (!running || shopOpen()) return;
  if (state.line.active) return;
  if (nearDock()) { openShop(); return; }
  if (state.hold.length >= holdFor(state.up.hold)) {
    toast(view.w/2, view.h*0.55, '魚艙滿了！去漁港賣魚 ▶', 'warn'); sfx('error'); return;
  }
  state.line = { active:true, phase:'down', depth:0, caught:null };
  sfx('cast');
  addRipple(state.boat.x, surfaceY(state.boat.x, state.time));
}

// ============================================================
//  更新
// ============================================================
function update(dt) {
  // 時間 / 日夜 / 天數
  const prevTime = state.time;
  state.time = (state.time + dt) % DAY_LEN;
  if (state.time < prevTime) state.day++;   // 跨過午夜 → 新的一天

  // Combo 連釣計時
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

  // 螃蟹被釣走後的重生計時
  for (const cb of SEABED.crabs) if (cb.hideT > 0) cb.hideT -= dt;

  // 特效
  updateFx(dt);

  // 船移動
  const acc = 850, max = 250 * speedMul(state.up.speed);
  let dir = 0;
  if (keys.left) dir -= 1;
  if (keys.right) dir += 1;
  state.boat.vx += dir * acc * dt;
  state.boat.vx *= Math.pow(0.0008, dt);  // 阻力
  if (dir===0 && Math.abs(state.boat.vx)<4) state.boat.vx=0;
  state.boat.vx = Math.max(-max, Math.min(max, state.boat.vx));
  state.boat.x += state.boat.vx * dt;
  state.boat.x = Math.max(120, Math.min(DOCK_X, state.boat.x));
  if (dir!==0) state.boat.dir = dir;

  // 釣線
  updateLine(dt);

  // 魚群
  const target = Math.round(26 * (0.4 + state.eco/100 * 1.1));
  while (state.fish.length < target) spawnFish();
  for (let i=state.fish.length-1;i>=0;i--){
    const f = state.fish[i];
    f.worldX += f.vx * dt;
    f.ph += dt*3;
    // 往前看一段距離，遇污染區或邊界才轉頭（避免在邊緣原地抖動）
    const ahead = f.worldX + Math.sign(f.vx) * 22;
    if (pollutionAt(ahead) > 0.4 || ahead < 150 || ahead > DOCK_X-150) f.vx = -f.vx;
    if (f.worldX<120||f.worldX>DOCK_X-80){ state.fish.splice(i,1); }
  }
  // 夜晚切換時清掉不合時宜的魚
  if (state.fish.length>target+12) state.fish.splice(0, state.fish.length-target);

  // 垃圾持續從污染海域產生
  const trashTarget = Math.round(state.zones.reduce((a,z)=>a+z.p* (z.x1-z.x0)/500, 0)) + 4;
  if (state.trash.length < trashTarget && Math.random()<0.6) {
    // 偏好生在污染區附近
    const z = state.zones[(Math.random()*state.zones.length)|0];
    spawnTrash(z.x0 + Math.random()*(z.x1-z.x0));
  }
  for (const tr of state.trash){ tr.ph += dt*1.5; tr.worldX += tr.drift*dt; }

  // 已放置的環保機器（自動運作）
  for (const m of state.placed) {
    if (m.type === 'scoop') {
      m.cd = (m.cd || 0) - dt;
      if (m.cd <= 0) {
        const R = MACHINE.scoop.range;
        let idx=-1, best=R;
        for (let i=0;i<state.trash.length;i++){ const d=Math.abs(state.trash[i].worldX-m.worldX); if(d<best){best=d;idx=i;} }
        if (idx>=0){
          const tr=state.trash.splice(idx,1)[0]; m.cd=MACHINE.scoop.cd;
          const gain = 3 + (Math.random()<0.12?20:0);   // 偶爾撈到寶物
          state.coins += gain; state.stats.trash++; state.stats.earned+=gain;
          const sx = tr.worldX - cam();
          toast(sx, surfaceY(tr.worldX,state.time)-20, (gain>10?'💎 寶物 +':'♻️ +')+gain, 'coin');
          sfx(gain>10?'buy':'trash'); checkQuest();
        } else m.cd = 0.5;
      }
    } else { // filter
      const R = MACHINE.filter.range;
      for (const z of state.zones){
        if (z.p<=0) continue;
        if (m.worldX > z.x0-R && m.worldX < z.x1+R){
          const before=z.p;
          z.p = Math.max(0, z.p - MACHINE.filter.rate*dt);
          if (before>0 && z.p===0){
            state.stats.cleaned++;
            toast(view.w/2, view.h*0.45, '✨ 海域淨化完成！魚群回來了', 'eco');
            sfx('clean');
            for (let i=0;i<6;i++) spawnFish(z.x0+Math.random()*(z.x1-z.x0));
            checkQuest(); checkAllClean(); save();
          }
        }
      }
    }
  }

  // 海洋健康度：依污染與垃圾平滑變化
  const avgP = state.zones.length ? state.zones.reduce((a,z)=>a+z.p,0)/state.zones.length : 0;
  const ecoTarget = Math.max(0, Math.min(100, 100 - avgP*55 - Math.min(state.trash.length,30)*1.1));
  state.eco += (ecoTarget - state.eco) * Math.min(1, dt*0.6);

  updateHUD();
}

function updateLine(dt) {
  const L = state.line;
  if (!L.active) return;
  const maxD = rodReach(state.up.rod);
  const spd = 230;
  if (L.phase==='down') {
    L.depth += spd*dt;
    // 嘗試咬鉤
    if (!L.caught) {
      const tipX = state.boat.x, tipY = surfaceY(state.boat.x,state.time)+L.depth;
      const cr = 26 + state.up.rod*3;
      for (let i=0;i<state.fish.length;i++){
        const f=state.fish[i];
        const fy = fishScreenY(f, state.time);
        if (Math.abs(f.worldX-tipX)<cr && Math.abs(fy-tipY)<cr){
          L.caught = state.fish.splice(i,1)[0];
          L.phase='up'; break;
        }
      }
      // 海底螃蟹：鉤子接近海底且停在螃蟹上方才能釣到
      if (!L.caught && tipY > waterBottom()-25) {
        for (const cb of SEABED.crabs) {
          if (cb.hideT > 0) continue;
          const wx = cb.base + Math.sin(state.time*cb.sp + cb.ph) * cb.range;
          if (Math.abs(wx - tipX) < cr+6) {
            cb.hideT = 14;                       // 釣走後 14 秒重生
            L.caught = { t: CRAB_TYPE, worldX: wx };
            L.phase = 'up'; break;
          }
        }
      }
    }
    if (L.depth>=maxD) L.phase='up';
  } else if (L.phase==='up') {
    L.depth -= spd*1.15*dt;
    if (L.depth<=0){
      L.depth=0; L.active=false;
      if (L.caught) deliverFish(L.caught);
      L.phase='idle'; L.caught=null;
    }
  }
}

function deliverFish(f) {
  let value = f.t.value;
  let polluted = pollutionAt(state.boat.x) > 0.3;
  if (polluted){ value = Math.round(value*0.4); bumpEco(-2); }
  // Combo 連釣加成（最高 +50%）
  combo++; comboTimer = 6;
  const cmult = 1 + Math.min(combo-1, 5) * 0.1;
  value = Math.round(value * cmult);
  state.hold.push({ key:f.t.key, value });
  state.stats.caught++;
  const sx = state.boat.x - cam();
  const sy = surfaceY(state.boat.x,state.time)-30;
  addSparkle(state.boat.x, surfaceY(state.boat.x,state.time));
  if (polluted) { toast(sx, sy, '🤢 污染魚 '+f.t.emoji, 'warn'); sfx('trash'); }
  else { toast(sx, sy, '釣到 '+f.t.name+' '+f.t.emoji+(cmult>1?` x${combo}🔥`:''), 'eco'); sfx('catch'); }
  checkQuest(); save();
}

function nearDock(){ return state.boat.x > DOCK_X - 130; }

function sellAll() {
  if (state.hold.length===0){ return 0; }
  const mult = (0.7 + state.eco/100*0.6) * (1 + state.up.sonar*0.08);
  let total=0;
  for (const f of state.hold) total += Math.round(f.value*mult);
  state.coins += total; state.stats.sold += state.hold.length; state.stats.earned+=total;
  const n=state.hold.length; state.hold=[];
  toast(view.w/2, view.h*0.4, `賣出 ${n} 條魚  +${total} 🪙`, 'coin');
  sfx('sell'); bumpEco(0.5); checkQuest(); save(); updateHUD();
  return total;
}

function bumpEco(d){ /* 立即影響但仍會被平滑追回；此處只做提示用途 */ }

// ============================================================
//  任務
// ============================================================
function checkQuest() {
  const q = QUESTS[state.questIdx];
  if (!q || state.questIdx>=QUESTS.length-1) { showQuest(); return; }
  if (q.done(state)) {
    state.coins += q.reward; state.stats.earned+=q.reward;
    toast(view.w/2, view.h*0.5, `✅ 任務完成！+${q.reward} 🪙`, 'coin');
    state.questIdx++;
    save();
  }
  showQuest();
}
function showQuest() {
  const el = document.getElementById('quest-banner');
  const q = QUESTS[state.questIdx];
  if (!q){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `🎯 任務：<b>${q.text}</b>`;
}

// ============================================================
//  繪製
// ============================================================
function cam() {
  let c = state.boat.x - view.w/2;
  return Math.max(0, Math.min(WORLD_W - view.w, c));
}

function dayColors() {
  const h = (state.time/DAY_LEN)*24;
  // 關鍵時段顏色
  const stops = [
    { h:0,  top:'#0a1430', bot:'#16314f' }, // 深夜
    { h:5.5,top:'#1a2a4a', bot:'#3a5d7a' }, // 黎明
    { h:8,  top:'#7ec0ee', bot:'#cdeafe' }, // 早晨
    { h:13, top:'#6db8f0', bot:'#bfe6ff' }, // 正午
    { h:17.5,top:'#f6a85c', bot:'#ffd9a0' },// 黃昏
    { h:19.5,top:'#3a3f6a', bot:'#7a5a8a' },// 暮色
    { h:24, top:'#0a1430', bot:'#16314f' },
  ];
  let a=stops[0], b=stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++){ if (h>=stops[i].h && h<=stops[i+1].h){ a=stops[i]; b=stops[i+1]; break; } }
  const f=(h-a.h)/((b.h-a.h)||1);
  return { top: lerpHex(a.top,b.top,f), bot: lerpHex(a.bot,b.bot,f), h };
}
function lerpHex(c1,c2,t){
  const p=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const a=p(c1),b=p(c2);
  const m=i=>Math.round(a[i]+(b[i]-a[i])*t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

function render() {
  const t = state.time, c = cam(), W = view.w, H = view.h;
  const dc = dayColors();
  const night = isNight();

  // 天空
  const sky = ctx.createLinearGradient(0,0,0,seaY+40);
  sky.addColorStop(0, dc.top); sky.addColorStop(1, dc.bot);
  ctx.fillStyle = sky; ctx.fillRect(0,0,W,seaY+40);

  // 太陽 / 月亮 (沿天空弧線)
  drawCelestial(dc.h, W, H);

  // 遠景雲 (慢速視差)
  drawClouds(c, night);
  // 海鷗 (白天)
  if (!night) drawBirds(c, t);

  // 海水
  drawSea(c, t, night);

  // 海底沙地 + 海草 / 螃蟹 / 貝殼
  drawSeabed(c, t);

  // 污染區 (深色 + 塑膠微粒)
  drawPollution(c, t);

  // 魚群
  drawFish(c, t);

  // 漂浮垃圾
  drawTrash(c, t);

  // 放置在海上的環保機器
  drawPlaced(c, t);

  // 釣線 + 船 + 漁夫
  drawLine(c, t);
  drawBoat(c, t);

  // 水花 / 收線星光
  drawFx(c);

  // 漁港
  drawDock(c, t);

  // 夜晚暗化
  if (night) { ctx.fillStyle='rgba(10,15,40,0.28)'; ctx.fillRect(0,0,W,H); }

  // 導航提示（畫面外的漁港與污染區）
  drawNav(c);
  // Combo 連釣顯示
  drawCombo();

  // 靠岸提示
  document.getElementById('dockHint').classList.toggle('hidden', !nearDock() || !running);
}

function drawCelestial(h, W, H) {
  // 太陽白天、月亮夜晚，沿弧線移動
  const dayPhase = (h-6)/12;           // 6點到18點 0→1
  let x, y, isMoon=false;
  if (h>=6 && h<=18){ x=dayPhase*W; }
  else { const np=((h<6?h+6:h-18))/12; x=np*W; isMoon=true; }
  const px=x; const py=seaY*0.85 - Math.sin(Math.PI*(isMoon?((h<6?h+6:h-18))/12:dayPhase))*seaY*0.55;
  ctx.save();
  if (isMoon){
    ctx.fillStyle='rgba(245,245,220,0.95)';
    ctx.shadowColor='rgba(255,255,220,0.6)'; ctx.shadowBlur=24;
    ctx.beginPath(); ctx.arc(px,py,20,0,7); ctx.fill();
  } else {
    const g=ctx.createRadialGradient(px,py,4,px,py,60);
    g.addColorStop(0,'rgba(255,250,210,1)'); g.addColorStop(0.4,'rgba(255,225,150,0.9)'); g.addColorStop(1,'rgba(255,210,120,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(px,py,60,0,7); ctx.fill();
    ctx.fillStyle='#fff6c8'; ctx.beginPath(); ctx.arc(px,py,26,0,7); ctx.fill();
  }
  ctx.restore();
}

let cloudSeeds = Array.from({length:9},(_,i)=>({x:i*640+120, y:40+(i*53)%120, s:0.6+(i%3)*0.25}));
function drawClouds(c, night) {
  ctx.save();
  ctx.fillStyle = night ? 'rgba(200,210,235,0.18)' : 'rgba(255,255,255,0.85)';
  for (const cl of cloudSeeds) {
    const sx = (cl.x - c*0.25) % (WORLD_W*0.5);
    const x = ((sx%(view.w+260))+(view.w+260))%(view.w+260) - 130;
    puff(x, cl.y, cl.s);
  }
  ctx.restore();
}
function puff(x,y,s){
  ctx.beginPath();
  ctx.ellipse(x,y,46*s,22*s,0,0,7);
  ctx.ellipse(x+38*s,y+6*s,34*s,18*s,0,0,7);
  ctx.ellipse(x-38*s,y+6*s,30*s,16*s,0,0,7);
  ctx.fill();
}

const birdSeeds = [{x:300,y:80,s:1.0},{x:760,y:120,s:0.8},{x:1180,y:70,s:1.1}];
function drawBirds(c, t) {
  ctx.save();
  ctx.strokeStyle='rgba(60,70,90,0.5)'; ctx.lineWidth=2; ctx.lineCap='round';
  for (let i=0;i<birdSeeds.length;i++){
    const b=birdSeeds[i];
    const period=view.w+200;
    const x=((b.x + t*14*(0.6+i*0.2) - c*0.4) % period + period) % period - 100;
    const flap=Math.sin(t*4+i)*4;
    ctx.beginPath();
    ctx.moveTo(x-8*b.s, b.y);
    ctx.quadraticCurveTo(x, b.y-6-flap, x+8*b.s, b.y);  // 左右翅膀
    ctx.stroke();
  }
  ctx.restore();
}

// 畫面外目標的方向提示
function drawNav(c) {
  const y = seaY + 40;
  // 漁港在右方畫面外
  const dockSx = DOCK_X - c;
  if (dockSx > view.w - 8) {
    const dist = Math.max(0, Math.round((DOCK_X - state.boat.x)));
    drawNavChip(view.w - 64, y, '🏪▶', dist + 'm', 'rgba(255,204,68,0.9)', '#3a2700');
  }
  // 污染區在畫面外
  for (const z of state.zones) {
    if (z.p <= 0.05) continue;
    const mid = (z.x0 + z.x1)/2, sx = mid - c;
    if (sx < 0) drawNavChip(40, y + 44, '◀⚠', '', 'rgba(70,90,60,0.9)', '#fff');
    else if (sx > view.w) drawNavChip(view.w - 40, y + 44, '⚠▶', '', 'rgba(70,90,60,0.9)', '#fff');
  }
}
function drawNavChip(x, y, label, sub, bg, fg) {
  ctx.save();
  ctx.font='bold 13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const w = sub ? 58 : 40;
  ctx.fillStyle=bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x-w/2, y-13, w, 26, 13);
  else ctx.rect(x-w/2, y-13, w, 26);
  ctx.fill();
  ctx.fillStyle=fg; ctx.fillText(label, x, sub ? y-4 : y);
  if (sub){ ctx.font='10px sans-serif'; ctx.fillText(sub, x, y+8); }
  ctx.restore();
}

// Combo 連釣顯示
function drawCombo() {
  if (combo < 2 || comboTimer <= 0) return;
  const pct = Math.min(combo-1, 5) * 10;
  ctx.save();
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold 22px sans-serif';
  const alpha = Math.min(1, comboTimer/1.5);
  ctx.fillStyle=`rgba(255,170,40,${alpha})`;
  ctx.fillText(`🔥 連釣 x${combo}  +${pct}%`, view.w/2, seaY*0.45);
  // 計時條
  const bw=120, bx=view.w/2-bw/2, by=seaY*0.45+18;
  ctx.fillStyle=`rgba(255,255,255,${0.2*alpha})`; ctx.fillRect(bx,by,bw,4);
  ctx.fillStyle=`rgba(255,170,40,${alpha})`; ctx.fillRect(bx,by,bw*(comboTimer/6),4);
  ctx.restore();
}
function drawSea(c, t, night) {
  const W=view.w, H=view.h;
  // 海水漸層
  const g=ctx.createLinearGradient(0,seaY,0,H);
  if (night){ g.addColorStop(0,'#13496b'); g.addColorStop(0.5,'#0c2f4d'); g.addColorStop(1,'#06182b'); }
  else { g.addColorStop(0,'#2aa6c8'); g.addColorStop(0.45,'#1c6e98'); g.addColorStop(1,'#0c3a5c'); }
  // 海面波形路徑
  ctx.beginPath();
  ctx.moveTo(0,H);
  ctx.lineTo(0, surfaceY(c,t));
  for (let sx=0;sx<=W;sx+=10){ ctx.lineTo(sx, surfaceY(c+sx,t)); }
  ctx.lineTo(W,H); ctx.closePath();
  ctx.fillStyle=g; ctx.fill();

  // 海面泡沫高光線
  ctx.beginPath();
  for (let sx=0;sx<=W;sx+=10){ const y=surfaceY(c+sx,t); if(sx===0)ctx.moveTo(sx,y); else ctx.lineTo(sx,y); }
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2; ctx.stroke();

  // 水中陽光（柔和的丁達爾光，往深處淡出）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i=0;i<5;i++){
    const period = W + 220;
    const x = ((i*270 + 90 - c*0.18) % period + period) % period - 110;
    const topY = surfaceY(c+x, t);
    const botY = topY + (H - topY) * 0.78;
    const g = ctx.createLinearGradient(x, topY, x, botY);
    const a = night ? 0.022 : 0.05;
    g.addColorStop(0, `rgba(205,242,255,${a})`);
    g.addColorStop(1, 'rgba(205,242,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 12, topY);
    ctx.lineTo(x + 20, topY);
    ctx.lineTo(x + 62, botY);
    ctx.lineTo(x + 6, botY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------- 海底裝飾（固定種子，隨攝影機捲動） ----------
const SEABED = (() => {
  const weeds=[], rocks=[], decos=[], crabs=[];
  for (let x=120; x<WORLD_W-160; x += 58 + (Math.floor(x*7)%46))
    weeds.push({ x, h: 20 + (Math.floor(x*1.7)%26), blades: 2 + (x%3), hue: (x%2)?'#2faa6a':'#48c07a', ph:(x%628)/100 });
  for (let x=320; x<WORLD_W-160; x += 210 + (Math.floor(x*1.1)%140))
    rocks.push({ x, r: 9 + (Math.floor(x*0.3)%9) });
  for (let x=220; x<WORLD_W-160; x += 150 + (Math.floor(x*0.5)%90))
    decos.push({ x, k: x%2 });
  for (let i=0;i<6;i++) crabs.push({ base: 380 + i*420, range: 55 + i*14, sp: 0.45 + i*0.1, ph: i*1.3, hideT: 0 });
  return { weeds, rocks, decos, crabs };
})();

function drawSeabed(c, t) {
  const top = view.h - 46;
  ctx.save();
  // 沙地
  const g = ctx.createLinearGradient(0, top-12, 0, view.h);
  g.addColorStop(0, '#c8a868'); g.addColorStop(1, '#9c7e46');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, view.h); ctx.lineTo(0, top);
  for (let sx=0; sx<=view.w; sx+=14) ctx.lineTo(sx, top + Math.sin((c+sx)*0.02)*5);
  ctx.lineTo(view.w, view.h); ctx.closePath(); ctx.fill();
  // 沙面亮邊
  ctx.strokeStyle='rgba(255,240,200,0.3)'; ctx.lineWidth=2;
  ctx.beginPath();
  for (let sx=0; sx<=view.w; sx+=14){ const yy=top+Math.sin((c+sx)*0.02)*5; if(sx===0)ctx.moveTo(sx,yy); else ctx.lineTo(sx,yy); }
  ctx.stroke();
  // 海草
  for (const w of SEABED.weeds){ const x=w.x-c; if(x<-30||x>view.w+30) continue; drawSeaweed(x, top+4, w, t); }
  // 石頭
  for (const r of SEABED.rocks){ const x=r.x-c; if(x<-30||x>view.w+30) continue;
    ctx.fillStyle='#6f7a82'; ctx.beginPath(); ctx.ellipse(x, top+5, r.r, r.r*0.6, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle='#5c666d'; ctx.beginPath(); ctx.ellipse(x-r.r*0.3, top+5, r.r*0.4, r.r*0.28, 0, Math.PI, 0); ctx.fill(); }
  // 貝殼 / 海星
  for (const d of SEABED.decos){ const x=d.x-c; if(x<-20||x>view.w+20) continue; if(d.k) drawStarfish(x, top); else drawShell(x, top); }
  // 螃蟹（左右走動，被釣走時暫時消失）
  for (const cr of SEABED.crabs){ if(cr.hideT>0) continue; const wx=cr.base + Math.sin(t*cr.sp+cr.ph)*cr.range; const x=wx-c; if(x<-30||x>view.w+30) continue; drawCrab(x, top+2, t, cr); }
  ctx.restore();
}
function drawSeaweed(x, baseY, w, t) {
  ctx.strokeStyle=w.hue; ctx.lineWidth=3; ctx.lineCap='round';
  for (let b=0;b<w.blades;b++){
    const off=(b-(w.blades-1)/2)*4;
    const sway=Math.sin(t*1.2 + w.ph + b)*6;
    ctx.beginPath(); ctx.moveTo(x+off, baseY);
    ctx.quadraticCurveTo(x+off+sway*0.5, baseY-w.h*0.5, x+off+sway, baseY-w.h); ctx.stroke();
  }
}
function drawCrab(x, gy, t, cr) {
  ctx.save(); ctx.translate(x, gy);
  // 腳（擺動）
  ctx.strokeStyle='#b53224'; ctx.lineWidth=1.5; ctx.lineCap='round';
  const lp=Math.sin(t*6+cr.ph)*1.6;
  for (let i=0;i<3;i++){ const lx=4+i*3;
    ctx.beginPath(); ctx.moveTo(-lx,-3); ctx.lineTo(-lx-3, 1+(i%2?lp:-lp)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx,-3); ctx.lineTo(lx+3, 1+(i%2?-lp:lp)); ctx.stroke(); }
  // 螯
  ctx.fillStyle='#e74c3c';
  ctx.beginPath(); ctx.ellipse(-9,-6,3.2,2.4,0.4,0,7); ctx.ellipse(9,-6,3.2,2.4,-0.4,0,7); ctx.fill();
  // 身體
  ctx.beginPath(); ctx.ellipse(0,-5,8,5,0,0,7); ctx.fill();
  // 眼柄 + 眼睛
  ctx.strokeStyle='#e74c3c'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(-2,-9); ctx.lineTo(-2,-12); ctx.moveTo(2,-9); ctx.lineTo(2,-12); ctx.stroke();
  ctx.fillStyle='#1a1a1a'; ctx.beginPath(); ctx.arc(-2,-12.5,1.4,0,7); ctx.arc(2,-12.5,1.4,0,7); ctx.fill();
  ctx.restore();
}
function drawStarfish(x, gy) {
  ctx.save(); ctx.translate(x, gy-3); ctx.fillStyle='#e8884a';
  ctx.beginPath();
  for (let i=0;i<5;i++){ const a=-Math.PI/2+i*2*Math.PI/5, a2=a+Math.PI/5;
    ctx.lineTo(Math.cos(a)*5, Math.sin(a)*5); ctx.lineTo(Math.cos(a2)*2.2, Math.sin(a2)*2.2); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(0,0,1.4,0,7); ctx.fill();
  ctx.restore();
}
function drawShell(x, gy) {
  ctx.save(); ctx.translate(x, gy-2); ctx.fillStyle='#f0c9b0';
  ctx.beginPath(); ctx.arc(0,0,4,Math.PI,0); ctx.fill();
  ctx.strokeStyle='#d9a98a'; ctx.lineWidth=0.8;
  for (let i=1;i<4;i++){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(Math.PI+i*Math.PI/4)*4, Math.sin(Math.PI+i*Math.PI/4)*4); ctx.stroke(); }
  ctx.restore();
}

function drawPollution(c, t) {
  for (const z of state.zones) {
    if (z.p<=0.04) continue;
    const x0=z.x0-c, x1=z.x1-c;
    if (x1<-20||x0>view.w+20) continue;
    ctx.save();
    // 深色污染水
    const g=ctx.createLinearGradient(0,seaY,0,view.h);
    g.addColorStop(0,`rgba(40,55,40,${0.15*z.p})`);
    g.addColorStop(1,`rgba(20,35,25,${0.55*z.p})`);
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(x0, view.h);
    for (let sx=x0;sx<=x1;sx+=10){ ctx.lineTo(sx, surfaceY(c+sx,t)); }
    ctx.lineTo(x1, view.h); ctx.closePath(); ctx.fill();
    // 塑膠微粒
    const n=Math.floor((z.x1-z.x0)/24 * z.p);
    ctx.fillStyle=`rgba(220,225,210,${0.5*z.p})`;
    for (let i=0;i<n;i++){
      const wx=z.x0+((i*53)%(z.x1-z.x0));
      const px=wx-c; if(px<-5||px>view.w+5) continue;
      const py=surfaceY(c+ (wx-c),t)+30+((i*37)%(view.h-seaY-40)) + Math.sin(t*1.3+i)*4;
      ctx.beginPath(); ctx.arc(px,py,1.6+ (i%2),0,7); ctx.fill();
    }
    ctx.restore();
  }
}

function drawFish(c, t) {
  const showInfo = state.up.sonar>0;
  for (const f of state.fish) {
    const x=f.worldX-c; if(x<-40||x>view.w+40) continue;
    const y=fishScreenY(f, t);
    const dir=f.vx<0?-1:1;
    ctx.save(); ctx.translate(x,y); ctx.scale(dir,1);
    drawFishBody(f.t, f.ph);
    ctx.restore();
    if (showInfo){ ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px sans-serif'; ctx.textAlign='center'; ctx.fillText(f.t.value+'🪙', x, y-13); }
  }
}
function fishEye(ex, ey, r) {
  ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(ex,ey,r,0,7); ctx.fill();
  ctx.fillStyle='#06222e'; ctx.beginPath(); ctx.arc(ex+r*0.3,ey,r*0.55,0,7); ctx.fill();
}
// 依魚種畫不同外型（一律朝右，dir 翻轉由外層處理）
function drawFishBody(ty, ph) {
  const s = ty.size || 1;
  const col = ty.color;
  const dark = lerpHex(col, '#0a2733', 0.42);
  const tw = Math.sin(ph) * 2;   // 尾巴擺動
  ctx.lineCap='round';
  switch (ty.shape) {
    case 'bream': { // 真鯛：身體高、背鰭明顯、叉尾
      ctx.fillStyle=dark;
      ctx.beginPath(); ctx.moveTo(-4*s,-6*s); ctx.lineTo(5*s,-5*s); ctx.lineTo(2*s,-12*s); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0,5*s); ctx.lineTo(4*s,5*s); ctx.lineTo(1*s,9*s); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-7*s,0); ctx.lineTo(-15*s,-7*s+tw); ctx.lineTo(-11*s,0); ctx.lineTo(-15*s,7*s+tw); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(0,0,9*s,7*s,0,0,7); ctx.fill();
      fishEye(4*s,-2*s,1.8*s); break;
    }
    case 'tuna': { // 鮪魚：流線魚雷狀、月牙尾、大
      ctx.fillStyle=dark;
      ctx.beginPath(); ctx.moveTo(-7*s,0); ctx.lineTo(-17*s,-8*s+tw); ctx.quadraticCurveTo(-12*s,0,-17*s,8*s+tw); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1*s,-5*s); ctx.lineTo(6*s,-5*s); ctx.lineTo(0,-11*s); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2*s,2*s); ctx.lineTo(9*s,6*s); ctx.lineTo(2*s,5*s); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.moveTo(14*s,0);
      ctx.quadraticCurveTo(5*s,-7*s,-7*s,-4*s);
      ctx.quadraticCurveTo(-11*s,0,-7*s,4*s);
      ctx.quadraticCurveTo(5*s,7*s,14*s,0); ctx.fill();
      fishEye(9*s,-1.5*s,1.7*s); break;
    }
    case 'puffer': { // 河豚：圓球+刺
      ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(-7*s,0); ctx.lineTo(-12*s,-4*s); ctx.lineTo(-12*s,4*s); ctx.closePath(); ctx.fill();
      ctx.fillStyle=dark;
      for(let a=0;a<10;a++){ const ang=a/10*Math.PI*2, c0=Math.cos(ang), s0=Math.sin(ang), px=-s0, py=c0;
        ctx.beginPath();
        ctx.moveTo(c0*7*s+px*2*s, s0*7*s+py*2*s);
        ctx.lineTo(c0*12*s, s0*12*s);
        ctx.lineTo(c0*7*s-px*2*s, s0*7*s-py*2*s); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle=col; ctx.beginPath(); ctx.arc(0,0,8*s,0,7); ctx.fill();
      fishEye(4*s,-2*s,2.1*s); break;
    }
    case 'squid': { // 魷魚：尖外套膜+觸手
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(-12*s,0,4*s,6*s,0,0,7); ctx.fill();
      ctx.strokeStyle=col; ctx.lineWidth=1.6*s;
      for(let i=-2;i<=2;i++){ const yy=i*1.6*s;
        ctx.beginPath(); ctx.moveTo(3*s,yy);
        ctx.quadraticCurveTo(9*s,yy+Math.sin(ph+i)*2, 14*s, yy+i*1.2*s); ctx.stroke(); }
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.moveTo(-15*s,0);
      ctx.quadraticCurveTo(-6*s,-6*s,3*s,-5*s);
      ctx.quadraticCurveTo(8*s,0,3*s,5*s);
      ctx.quadraticCurveTo(-6*s,6*s,-15*s,0); ctx.fill();
      ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(0,-1*s,2.3*s,0,7); ctx.fill();
      ctx.fillStyle='#06222e'; ctx.beginPath(); ctx.arc(0.6*s,-1*s,1.1*s,0,7); ctx.fill(); break;
    }
    case 'shrimp': { // 甜蝦：彎曲身體+尾扇+觸鬚
      ctx.strokeStyle=col; ctx.lineWidth=1*s;
      ctx.beginPath(); ctx.moveTo(7*s,-1*s); ctx.lineTo(16*s,-6*s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7*s,0); ctx.lineTo(16*s,-1*s); ctx.stroke();
      ctx.fillStyle=dark; ctx.beginPath();
      ctx.moveTo(-7*s,1*s); ctx.lineTo(-13*s,-3*s); ctx.lineTo(-11*s,1*s); ctx.lineTo(-13*s,5*s); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col; ctx.save(); ctx.rotate(-0.25);
      ctx.beginPath(); ctx.ellipse(0,0,9*s,4.6*s,0,0,7); ctx.fill(); ctx.restore();
      ctx.strokeStyle=dark; ctx.lineWidth=0.8*s;
      for(let i=0;i<4;i++){ const lx=-3*s+i*3*s; ctx.beginPath(); ctx.moveTo(lx,3*s); ctx.lineTo(lx-1*s,7*s); ctx.stroke(); }
      ctx.fillStyle='#06222e'; ctx.beginPath(); ctx.arc(6*s,-2*s,1.4*s,0,7); ctx.fill(); break;
    }
    default: { // 沙丁魚 / 一般魚：細長
      ctx.fillStyle=dark;
      ctx.beginPath(); ctx.moveTo(-9*s,0); ctx.lineTo(-16*s,-5*s+tw); ctx.lineTo(-16*s,5*s+tw); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0,-4*s); ctx.lineTo(5*s,-4*s); ctx.lineTo(1*s,-8*s); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(0,0,11*s,5*s,0,0,7); ctx.fill();
      fishEye(6*s,-1.5*s,1.6*s);
    }
  }
}

function drawTrash(c, t) {
  ctx.font='20px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for (const tr of state.trash) {
    const x=tr.worldX-c; if(x<-30||x>view.w+30) continue;
    const y=surfaceY(tr.worldX,t)+4+Math.sin(tr.ph)*3;
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(tr.ph*0.5)*0.2);
    ctx.fillText(tr.emoji,0,0); ctx.restore();
  }
  ctx.textBaseline='alphabetic';
}

function drawPlaced(c, t) {
  for (const m of state.placed) {
    const x = m.worldX - c; if (x<-50||x>view.w+50) continue;
    const sy = surfaceY(m.worldX, t);
    if (m.type === 'scoop') {
      // 作用範圍
      ctx.strokeStyle='rgba(120,200,255,0.22)'; ctx.lineWidth=2; ctx.setLineDash([5,5]);
      ctx.beginPath(); ctx.ellipse(x, sy, MACHINE.scoop.range, 14, 0,0,7); ctx.stroke(); ctx.setLineDash([]);
      // 浮台
      ctx.fillStyle='#3e6b8c'; ctx.fillRect(x-13, sy-9, 26, 8);
      ctx.fillStyle='#ffcc44'; ctx.fillRect(x-13, sy-11, 26, 3);
      // 撈網臂
      const sw=Math.sin(t*3+m.worldX)*4;
      ctx.strokeStyle='#9aa3a8'; ctx.lineWidth=2; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(x+9, sy-7); ctx.lineTo(x+16+sw, sy+12); ctx.stroke();
      ctx.fillStyle='rgba(200,220,160,0.6)'; ctx.beginPath(); ctx.arc(x+16+sw, sy+13, 5, 0, Math.PI); ctx.fill();
      ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.fillText('🗑️', x, sy-15);
    } else {
      const inZone = state.zones.some(z=>z.p>0 && m.worldX>z.x0-MACHINE.filter.range && m.worldX<z.x1+MACHINE.filter.range);
      // 下伸管
      ctx.strokeStyle='#7fbfd0'; ctx.lineWidth=3; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(x, sy-2); ctx.lineTo(x, sy+44); ctx.stroke();
      // 浮台
      ctx.fillStyle='#2e8b9e'; ctx.fillRect(x-13, sy-9, 26, 8);
      ctx.fillStyle='#9be0ff'; ctx.fillRect(x-13, sy-11, 26, 3);
      ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.fillText('💧', x, sy-15);
      if (inZone){
        ctx.fillStyle='rgba(220,250,255,0.65)';
        for(let i=0;i<5;i++){ const bx=x+Math.sin(t*2+i)*9; const by=sy+44-((t*42+i*26)%48); ctx.beginPath(); ctx.arc(bx,by,2,0,7); ctx.fill(); }
      } else {
        // 提示：不在污染區內、沒在工作
        ctx.font='9px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText('移到污染區', x, sy+24);
      }
    }
    // 船在附近 → 提示可收回
    if (Math.abs(m.worldX - state.boat.x) < 70) {
      ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.75)';
      ctx.fillText('↑ 靠近可收回', x, sy-26);
    }
  }
}

function drawLine(c, t) {
  const L=state.line; if(!L.active && L.depth<=0) return;
  const bx=state.boat.x-c; const topY=surfaceY(state.boat.x,t)-26;
  const tipY=surfaceY(state.boat.x,t)+L.depth;
  ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(bx+14, topY); ctx.lineTo(bx+14, tipY); ctx.stroke();
  // 鉤 / 釣到的魚
  if (L.caught){ ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.fillText(L.caught.t.emoji, bx+14, tipY+4); }
  else {
    ctx.fillStyle='#ddd'; ctx.beginPath(); ctx.arc(bx+14, tipY, 3, 0, 7); ctx.fill();
    // 附近有魚 → 顯示咬餌提示
    if (L.phase==='down'){
      let bite=false;
      for (const f of state.fish){
        const fy=fishScreenY(f, t);
        if (Math.abs(f.worldX-state.boat.x)<60 && Math.abs(fy-tipY)<55){ bite=true; break; }
      }
      if (!bite && tipY > waterBottom()-30){
        for (const cb of SEABED.crabs){ if(cb.hideT>0) continue;
          const wx=cb.base+Math.sin(t*cb.sp+cb.ph)*cb.range;
          if (Math.abs(wx-state.boat.x)<60){ bite=true; break; } }
      }
      if (bite){ ctx.font='bold 16px sans-serif'; ctx.fillStyle='#ffcc44'; ctx.fillText('❗', bx+14, tipY-12); }
    }
  }
}

function drawBoat(c, t) {
  const x=state.boat.x-c;
  const y=surfaceY(state.boat.x,t);
  const slope=(surfaceY(state.boat.x+14,t)-surfaceY(state.boat.x-14,t))/28;
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(Math.atan(slope));
  const dir=state.boat.dir;
  // 倒影
  ctx.save(); ctx.globalAlpha=0.15; ctx.scale(1,-1); ctx.fillStyle='#3a2a1a';
  ctx.fillRect(-34,2,68,16); ctx.restore();
  // 船身
  ctx.fillStyle='#8a5a32';
  ctx.beginPath();
  ctx.moveTo(-36,-4); ctx.lineTo(36,-4);
  ctx.lineTo(26,18); ctx.lineTo(-26,18); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#a96e3e'; ctx.fillRect(-36,-8,72,5);
  ctx.fillStyle='#6f4626'; ctx.fillRect(-26,-3,52,3);
  // 駕駛艙
  ctx.fillStyle='#d9e6ef'; ctx.fillRect(-8,-24,18,18);
  ctx.fillStyle='#4a7fa5'; ctx.fillRect(-5,-21,12,8);
  // 桅杆與旗
  ctx.strokeStyle='#5a3a20'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-20,-8); ctx.lineTo(-20,-40); ctx.stroke();
  ctx.fillStyle='#19c3a6'; ctx.beginPath(); ctx.moveTo(-20,-40); ctx.lineTo(-4,-35); ctx.lineTo(-20,-30); ctx.fill();
  // 漁夫
  ctx.save(); ctx.translate(14*dir,0); ctx.scale(dir,1);
  ctx.fillStyle='#f4c542'; ctx.beginPath(); ctx.arc(0,-26,4,Math.PI,0); ctx.fill(); // 帽
  ctx.fillStyle='#f4c542'; ctx.fillRect(-5,-25,10,2);
  ctx.fillStyle='#e8b98e'; ctx.beginPath(); ctx.arc(0,-20,4,0,7); ctx.fill();        // 頭
  ctx.fillStyle='#d94f4f'; ctx.fillRect(-4,-16,8,12);                                 // 身
  // 釣竿
  ctx.strokeStyle='#3a2410'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(2,-12); ctx.lineTo(14,-30); ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawDock(c, t) {
  const x=DOCK_X-c;
  if (x>view.w+200) return;
  const y=surfaceY(DOCK_X,t);
  ctx.save();
  // 棧橋柱
  ctx.fillStyle='#6b4a2b';
  for(let i=0;i<4;i++){ ctx.fillRect(x+14+i*48, y, 9, view.h-y); }
  // 平台
  ctx.fillStyle='#8a6038'; ctx.fillRect(x, y-12, 185, 14);
  ctx.fillStyle='#a87a48'; ctx.fillRect(x, y-15, 185, 4);

  // 攤位：紅白條紋遮陽棚 + 木牌
  const aw=92, ax=x+18, ay=y-70;
  for(let i=0;i<6;i++){ ctx.fillStyle=(i%2)?'#ffffff':'#d94f4f'; ctx.fillRect(ax+i*(aw/6), ay, aw/6, 13); }
  // 棚下波浪邊
  ctx.fillStyle='#d94f4f';
  for(let i=0;i<6;i++){ ctx.beginPath(); ctx.arc(ax+(i+0.5)*(aw/6), ay+13, aw/12, 0, Math.PI); ctx.fill(); }
  // 木牌
  ctx.fillStyle='#f3e4c4'; ctx.fillRect(ax+6, ay+18, aw-12, 18);
  ctx.strokeStyle='#b9925a'; ctx.lineWidth=1.5; ctx.strokeRect(ax+6, ay+18, aw-12, 18);
  ctx.fillStyle='#5a3a1a'; ctx.font='bold 12px "Microsoft JhengHei",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('收購魚貨', ax+aw/2, ay+28);
  ctx.textBaseline='alphabetic';

  // 魚販 + 魚箱
  drawVendor(x+118, y-12);
  drawFishCrate(x+152, y-12);
  ctx.restore();
}

// 漁港魚販小人（戴漁夫帽、揮手）
function drawVendor(px, gy) {
  ctx.save();
  ctx.translate(px, gy);
  // 鞋 + 腿
  ctx.fillStyle='#34506a'; ctx.fillRect(-6,-12,4,12); ctx.fillRect(2,-12,4,12);
  ctx.fillStyle='#222'; ctx.fillRect(-7,-3,5,3); ctx.fillRect(1,-3,5,3);
  // 身體（圓潤）
  ctx.fillStyle='#2e9bb0';
  ctx.beginPath(); ctx.moveTo(-8,-30); ctx.quadraticCurveTo(-10,-20,-7,-12);
  ctx.lineTo(7,-12); ctx.quadraticCurveTo(10,-20,8,-30); ctx.closePath(); ctx.fill();
  // 白圍裙 + 口袋
  ctx.fillStyle='#f4f7f3';
  ctx.beginPath(); ctx.moveTo(-5,-26); ctx.lineTo(5,-26); ctx.lineTo(6,-12); ctx.lineTo(-6,-12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#d4ddd0'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(-3,-19); ctx.lineTo(3,-19); ctx.stroke();
  // 手臂（左手揮手、右手垂下）
  ctx.strokeStyle='#eed0b0'; ctx.lineWidth=3.2; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-7,-28); ctx.lineTo(-14,-36); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7,-27); ctx.lineTo(12,-18); ctx.stroke();
  ctx.fillStyle='#eed0b0'; ctx.beginPath(); ctx.arc(-14,-37,2.2,0,7); ctx.fill();
  // 頭 + 耳朵
  ctx.beginPath(); ctx.arc(0,-37,7.5,0,7); ctx.fill();
  ctx.beginPath(); ctx.arc(-7.5,-36,1.5,0,7); ctx.arc(7.5,-36,1.5,0,7); ctx.fill();
  // 漁夫帽
  ctx.fillStyle='#2b6f88';
  ctx.beginPath(); ctx.ellipse(0,-43,9,3,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.arc(0,-44,6,Math.PI,0); ctx.fill(); ctx.fillRect(-6,-44,12,2);
  // 腮紅
  ctx.fillStyle='rgba(255,150,150,0.55)';
  ctx.beginPath(); ctx.arc(-4.5,-35,1.7,0,7); ctx.arc(4.5,-35,1.7,0,7); ctx.fill();
  // 眼睛
  ctx.fillStyle='#3a2410';
  ctx.beginPath(); ctx.arc(-2.6,-37.5,1.1,0,7); ctx.arc(2.6,-37.5,1.1,0,7); ctx.fill();
  // 微笑
  ctx.strokeStyle='#3a2410'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(0,-35.5,2.4,0.15*Math.PI,0.85*Math.PI); ctx.stroke();
  ctx.restore();
}

// 一箱魚
function drawFishCrate(px, gy) {
  ctx.save();
  ctx.translate(px, gy);
  ctx.fillStyle='#9c6b3f'; ctx.fillRect(-13,-15,26,15);
  ctx.fillStyle='#7d5430'; ctx.fillRect(-13,-15,26,3);
  ctx.strokeStyle='#5e3f24'; ctx.lineWidth=1; ctx.strokeRect(-13,-15,26,15);
  // 兩條魚露出箱口
  ctx.fillStyle='#8fc5e2';
  ctx.save(); ctx.translate(-5,-15); ctx.rotate(-0.5);
  ctx.beginPath(); ctx.ellipse(0,0,8,3.5,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(12,-4); ctx.lineTo(12,4); ctx.fill(); ctx.restore();
  ctx.fillStyle='#ff9a6c';
  ctx.save(); ctx.translate(6,-16); ctx.rotate(-0.85);
  ctx.beginPath(); ctx.ellipse(0,0,7,3,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(5,0); ctx.lineTo(10,-3); ctx.lineTo(10,3); ctx.fill(); ctx.restore();
  ctx.restore();
}

// ============================================================
//  HUD / 商店 UI
// ============================================================
function updateHUD() {
  document.getElementById('coins').textContent = Math.floor(state.coins);
  document.getElementById('hold').textContent = state.hold.length;
  document.getElementById('holdMax').textContent = holdFor(state.up.hold);
  // 魚艙滿了變紅
  document.getElementById('stat-hold').classList.toggle('full', state.hold.length >= holdFor(state.up.hold));
  const eco=Math.round(state.eco);
  document.getElementById('ecoFill').style.width = eco+'%';
  document.getElementById('ecoVal').textContent = eco+'%';
  document.getElementById('ecoIcon').textContent = eco>=66 ? '💚' : eco>=33 ? '💛' : '💔';
  // 時鐘
  const h=(state.time/DAY_LEN)*24; const hh=Math.floor(h), mm=Math.floor((h-hh)*60);
  document.getElementById('clock').textContent = String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
  document.getElementById('clockIcon').textContent = isNight()?'🌙':'☀️';
  // 釣魚鈕：靠岸時變成「賣魚」
  document.getElementById('btnCast').textContent = nearDock() ? '💰 賣魚 / 商店' : '🎣 釣魚';
  updateMachineBtns();   // 每幀更新（讓「靠近可收回」即時反映）
}
function updateMachineBtns() {
  const bs=document.getElementById('btnScoop'), bf=document.getElementById('btnFilter');
  const near = type => state.placed.some(p=>p.type===type && Math.abs(p.worldX-state.boat.x)<70);
  bs.textContent = near('scoop') ? '🗑️ 收回撈取機' : `🗑️ 放撈取機 (${state.inv.scoop})`;
  bf.textContent = near('filter') ? '💧 收回淨化機' : `💧 放淨化機 (${state.inv.filter})`;
  bs.disabled = !(state.inv.scoop>0 || near('scoop'));
  bf.disabled = !(state.inv.filter>0 || near('filter'));
}

let toastCount=0;
function toast(x,y,text,cls){
  const el=document.createElement('div');
  el.className='toast '+(cls||'');
  el.textContent=text;
  el.style.left=Math.max(8,Math.min(view.w-8,x))+'px';
  el.style.top=y+'px';
  el.style.transform='translateX(-50%)';
  document.getElementById('toast-layer').appendChild(el);
  setTimeout(()=>el.remove(),1100);
}

// 商店
const shopOverlay=document.getElementById('shop-overlay');
function shopOpen(){ return !shopOverlay.classList.contains('hidden'); }
function openShop(){
  if (!nearDock()) return;
  if (state.hold.length) sellAll();          // 有魚才賣，空手進商店不跳提示
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.tab==='upgrade'));
  renderShop('upgrade');
  shopOverlay.classList.remove('hidden');
}
function closeShop(){ shopOverlay.classList.add('hidden'); }
document.getElementById('shopClose').addEventListener('click', closeShop);
document.getElementById('dockHint').addEventListener('click', openShop);
document.querySelectorAll('.tab').forEach(tb=>tb.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  tb.classList.add('active'); renderShop(tb.dataset.tab);
}));

function costOf(def){ return Math.round(def.base * Math.pow(def.mul, def.lvl - def.min)); }

function renderShop(tab){
  document.getElementById('shopCoins').textContent=Math.floor(state.coins);
  const body=document.getElementById('shopBody');
  if (tab==='info'){ body.innerHTML=renderInfo(); return; }
  if (tab==='machine'){
    body.innerHTML=renderMachines();
    body.querySelectorAll('[data-buymachine]').forEach(b=>b.addEventListener('click',()=>buyMachine(b.dataset.buymachine)));
    return;
  }
  let html='';
  for (const k in DEFS){
    const d=DEFS[k]; if (d.cat!==tab) continue;
    const owned = d.lvl>d.min || (d.min>0 && d.lvl>=d.min) ? true : d.lvl>d.min;
    const maxed = d.lvl>=d.max;
    const cost = costOf(d);
    const can = !maxed && state.coins>=cost;
    // 等級點（單次購買的機器不顯示等級格）
    let pips='';
    if (!d.once) { const shown=d.max-d.min; for(let i=0;i<shown;i++) pips+=`<span class="pip ${i<(d.lvl-d.min)?'on':''}"></span>`; }
    let lvlLabel;
    if (d.once) lvlLabel = d.lvl>0 ? '✓ 已安裝' : '未擁有';
    else lvlLabel = (d.min===0 && d.lvl===0) ? '未擁有' : `Lv ${d.lvl}${maxed?' (滿級)':''}`;
    let btn;
    if (maxed) btn=`<button class="buy-btn maxed" disabled>${d.once?'已安裝':'滿級'}</button>`;
    else btn=`<button class="buy-btn" data-buy="${k}" ${can?'':'disabled'}>${d.lvl===0?'購買':'升級'}<span class="price">🪙 ${cost}</span></button>`;
    html+=`<div class="item">
      <div class="item-icon">${d.icon}</div>
      <div class="item-main">
        <div class="item-title">${d.name} <span class="item-lvl">${lvlLabel}</span></div>
        <div class="item-desc">${descOf[k](d.lvl)}</div>
        <div class="pips">${pips}</div>
      </div>${btn}
    </div>`;
  }
  body.innerHTML=html;
  body.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>buy(b.dataset.buy,tab)));
}
function renderMachines(){
  const desc = {
    scoop: '放到海面上 → 自動撈起附近漂浮垃圾(可賣錢、改善海洋健康)',
    filter:'放進深色污染區 → 自動淨化塑膠微粒，魚群才會回來',
  };
  let html=`<div class="info-text" style="margin-bottom:10px">買來後回到海上，用畫面下方按鈕<b>放置</b>機器；可放多台同時運作，靠近自己的機器再按一次可<b>收回</b>移到別區。</div>`;
  for (const k of ['scoop','filter']){
    const m=MACHINE[k]; const owned=machineOwned(k); const maxed=owned>=m.cap; const can=!maxed && state.coins>=m.price;
    const btn = maxed ? `<button class="buy-btn maxed" disabled>已達上限</button>`
      : `<button class="buy-btn" data-buymachine="${k}" ${can?'':'disabled'}>購買<span class="price">🪙 ${m.price}</span></button>`;
    html+=`<div class="item">
      <div class="item-icon">${m.icon}</div>
      <div class="item-main">
        <div class="item-title">${m.name} <span class="item-lvl">擁有 ${owned} 台${maxed?'（上限）':` / ${m.cap}`}</span></div>
        <div class="item-desc">${desc[k]}</div>
      </div>${btn}
    </div>`;
  }
  return html;
}
function buyMachine(type){
  const m=MACHINE[type];
  if (machineOwned(type) >= m.cap || state.coins < m.price){ sfx('error'); return; }
  state.coins -= m.price; state.inv[type]++;
  sfx('buy'); updateMachineBtns(); updateHUD(); checkQuest(); save();
  toast(view.w/2, view.h*0.5, `${m.icon} 已購買，回海上放置！`, 'eco');
  renderShop('machine');
}
function checkAllClean(){
  if (allCleanCelebrated) return;
  if (state.zones.every(z=>z.p<=0)){
    allCleanCelebrated = true;
    const bonus = 200;
    state.coins += bonus; state.stats.earned += bonus;
    toast(view.w/2, view.h*0.4, `🎉 全海域淨化完成！獎勵 +${bonus}🪙`, 'coin');
    sfx('sell');
  }
}
function renderInfo(){
  let rows=FISH_TYPES.map(f=>`<div class="fish-row"><span class="fdot" style="background:${f.color}"></span>${f.emoji} ${f.name} ${f.night?'🌙':''}<span class="fval">${f.value}🪙</span></div>`).join('');
  rows+=`<div class="fish-row"><span class="fdot" style="background:${CRAB_TYPE.color}"></span>${CRAB_TYPE.emoji} ${CRAB_TYPE.name}（海底，需長釣竿）<span class="fval">${CRAB_TYPE.value}🪙</span></div>`;
  return `<div class="info-text">
    <h3>🐟 魚種圖鑑</h3>${rows}
    <h3>🌊 玩法重點</h3>
    越深的海域有越值錢的魚，升級<b>釣竿</b>才釣得到。<br/>
    深色海域代表<b>塑膠微粒污染</b>，那裡沒有魚，且在污染區釣到的是「污染魚」只值 4 成價。<br/>
    🎯 <b>目標：淨化全部 4 個污染海域！</b> 在商店買<b>淨化機</b>,回海上把它<b>放進</b>污染區就會自動淨化;買<b>撈取機</b>放在海面自動撈垃圾。可放多台、也能收回換位置。<br/>
    <b>海洋健康度</b>越高，魚越多、賣價越好。🌙 夜晚會出現魷魚等夜行性高價魚種。
  </div>`;
}
function buy(key){
  const d=DEFS[key]; const cost=costOf(d);
  if (d.lvl>=d.max || state.coins<cost) { sfx('error'); return; }
  state.coins-=cost; d.lvl++; state.up[key]=d.lvl;
  sfx('buy'); updateMachineBtns(); updateHUD();
  toast(view.w/2, view.h*0.5, `${d.icon} ${d.name} ${d.lvl===d.min+1&&d.min===0?'已安裝':'Lv'+d.lvl}`, 'eco');
  checkQuest(); save();
  renderShop(d.cat);
}

// ============================================================
//  暫停選單 / 音效開關 / 統計
// ============================================================
const pauseOverlay = document.getElementById('pause-overlay');
function togglePause(p) {
  paused = p;
  pauseOverlay.classList.toggle('hidden', !p);
  if (p) { renderStats(); save(); }
}
function updateSoundUI() {
  document.getElementById('btnSound').textContent = state.muted ? '🔇' : '🔊';
  document.getElementById('btnSound2').textContent = state.muted ? '🔇 音效：關' : '🔊 音效：開';
}
function toggleMute() {
  state.muted = !state.muted;
  if (!state.muted) { initAudio(); sfx('buy'); }
  updateSoundUI(); save();
}
function renderStats() {
  const s = state.stats;
  document.getElementById('statsBox').innerHTML = `
    <div class="stats-grid">
      <div class="s-row"><span>📅 天數</span><b>第 ${state.day} 天</b></div>
      <div class="s-row"><span>🪙 金幣</span><b>${Math.floor(state.coins)}</b></div>
      <div class="s-row"><span>💰 總收入</span><b>${s.earned}</b></div>
      <div class="s-row"><span>🐟 釣魚數</span><b>${s.caught}</b></div>
      <div class="s-row"><span>📦 賣出數</span><b>${s.sold}</b></div>
      <div class="s-row"><span>♻️ 撈垃圾</span><b>${s.trash}</b></div>
      <div class="s-row"><span>✨ 淨化海域</span><b>${s.cleaned}</b></div>
      <div class="s-row"><span>🌊 海洋健康</span><b>${Math.round(state.eco)}%</b></div>
    </div>`;
}
document.getElementById('btnPause').addEventListener('click', ()=>togglePause(true));
document.getElementById('pauseClose').addEventListener('click', ()=>togglePause(false));
document.getElementById('btnResume').addEventListener('click', ()=>togglePause(false));
document.getElementById('btnSound').addEventListener('click', toggleMute);
document.getElementById('btnSound2').addEventListener('click', toggleMute);
document.getElementById('btnReset2').addEventListener('click', ()=>{
  if (window.confirm('確定要清除所有進度，重新開始嗎？')) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});
// P 或 Esc 鍵暫停 / 繼續
window.addEventListener('keydown', e => {
  if (!running || e.repeat) return;
  if (e.code==='KeyP' || e.code==='Escape') {
    if (shopOpen()) { closeShop(); return; }
    togglePause(!paused);
  }
});

// ============================================================
//  主迴圈
// ============================================================
function loop(now){
  if (!running){ return; }
  const dt=Math.min(0.05,(now-lastT)/1000)||0; lastT=now;
  if (!shopOpen() && !paused) update(dt);   // 商店或暫停選單開啟時凍結模擬
  render();
  requestAnimationFrame(loop);
}

// ============================================================
//  啟動
// ============================================================
function startGame(){
  resize();
  if (!state) state=freshState();
  syncDefs();
  // 初始魚與垃圾
  for(let i=0;i<24;i++) spawnFish();
  for(let i=0;i<10;i++) spawnTrash();
  updateMachineBtns(); updateHUD(); showQuest(); updateSoundUI();
  initAudio();   // 開始遊戲是使用者手勢，可安全建立音訊
  paused = false;
  allCleanCelebrated = state.zones.every(z=>z.p<=0);   // 已全淨化的存檔不重複慶祝
  document.getElementById('start-overlay').classList.add('hidden');
  running=true; lastT=performance.now();
  requestAnimationFrame(loop);
}

document.getElementById('btnStart').addEventListener('click', ()=>{
  load(); // 若有存檔則沿用
  startGame();
});
document.getElementById('btnReset').addEventListener('click', ()=>{
  localStorage.removeItem(SAVE_KEY); state=freshState(); syncDefs();
  toast(view.w/2, view.h*0.5, '已清除存檔', 'warn');
});

// 自動暫停（切到背景）
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) save(); });
window.addEventListener('beforeunload', save);
// 防止手機長按 / 右鍵跳出選單影響操作
window.addEventListener('contextmenu', e => { if (running) e.preventDefault(); });

// 初次載入
resize();
// 若已有存檔，開始畫面按鈕仍會載入；先畫一張靜態海面
state=freshState();
render();

})();
