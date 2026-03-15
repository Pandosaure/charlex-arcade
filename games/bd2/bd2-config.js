"use strict";
// ════════════════════════════════════════════════════
// BD2 PHASE 1 — Continuous path, face-to-face tablet
// ════════════════════════════════════════════════════

// Design: 1280×720 virtual canvas. Grid = 20cols × 18rows × 40px.
// P2 castle top (row 0), P1 castle bottom (row 17).
// Units spawn at own castle, walk to opponent castle.
// Towers only fire at enemy units in own territory.
const VW=1280,VH=720,T=40,GC=20,GR=18;
const GOX=(VW-GC*T)/2; // grid x offset to center
const P1R=9; // P1 rows 9-17, P2 rows 0-8

// ── CONFIG ──
const HP=750,SGOLD=100,PASV=2,WBON=20,WINT=30,LUT=15;

// ── XP ──
const XPT=[0,100,260,480,760,1110,1530,2030,2610,3270,4010,4840];
const xpNeed=l=>(l-1<XPT.length?XPT[l-1]:XPT[XPT.length-1]+(l-XPT.length)*90);

// ── TOWERS (Phase 2: +Magic Tower, +Lv4 Rare gate) ──
const TW={
  archer:{n:'Archer',ic:'🏹',dt:'p',d:30,r:1.2,rn:5.5,c:60,cl:0x55cc88,air:1,sl:0,ao:0,
    lv:{2:{cm:.6,dm:1.5,rm:1.15},3:{cm:1,dm:1.47,rm:1.15,gate:1,sth:1},
        4:{cm:1.6,dm:1.36,rm:1.2,gate:1,multi:2}}}, // Lv2=×1.5, Lv3=×2.2, Lv4=×3.0
  cannon:{n:'Cannon',ic:'💣',dt:'p',d:90,r:.4,rn:4,c:90,cl:0xee8833,air:0,sl:0,ao:1.2,
    lv:{2:{cm:.6,dm:1.5,rm:1.1,am:1.3},3:{cm:1,dm:1.47,rm:1.1,st:1.5,gate:1},
        4:{cm:1.6,dm:1.36,rm:1.15,gate:1,cluster:1}}}, // Lv2=×1.5, Lv3=×2.2, Lv4=×3.0
  frost:{n:'Frost',ic:'❄️',dt:'m',d:45,r:.7,rn:4.5,c:100,cl:0x55aaff,air:0,sl:.3,ao:1,
    lv:{2:{cm:.6,dm:1.5,rm:1.1,sa:.25},3:{cm:1,dm:1.47,rm:1.1,frz:1,gate:1},
        4:{cm:1.6,dm:1.36,rm:1.15,gate:1,deepfrz:1}}}, // Lv2=×1.5, Lv3=×2.2, Lv4=×3.0
  magic:{n:'Magic',ic:'✨',dt:'m',d:40,r:.8,rn:3.5,c:95,cl:0xcc66ff,air:1,sl:0,ao:0,chain:2,detect:1,
    lv:{2:{cm:.6,dm:1.5,rm:1.1,chain:1},3:{cm:1,dm:1.47,rm:1.1,chain:1,gate:1,mega:1},
        4:{cm:1.6,dm:1.36,rm:1.15,gate:1,storm:1}}}, // Lv2=×1.5, Lv3=×2.2, Lv4=×3.0
};
const TK=Object.keys(TW);

// ── UNITS (Phase 2: +Ghost, +Titan, +6 unlockable elites) ──
const UN={
  // Base 5
  runner: {hp:60,sp:2,cd:12,bt:2,xp:4,air:0,pr:0,mr:0,cl:0xff5555,sz:6,base:1},
  brute:  {hp:200,sp:.9,cd:30,bt:5,xp:10,air:0,pr:.4,mr:0,cl:0xcc7744,sz:9,base:1},
  flyer:  {hp:110,sp:2.3,cd:20,bt:6,xp:7,air:1,pr:0,mr:0,cl:0x88ddff,sz:7,base:1},
  ghost:  {hp:140,sp:1.5,cd:25,bt:8,xp:12,air:0,pr:0,mr:0,cl:0xcc99cc,sz:6,stealth:1,base:1},
  titan:  {hp:1000,sp:.5,cd:100,bt:30,xp:60,air:0,pr:.2,mr:.2,cl:0xff4444,sz:14,base:1},
  // Common unlockables
  crawler:     {hp:180,sp:.4,cd:20,bt:4,xp:8,air:0,pr:.7,mr:0,cl:0xaa8844,sz:8},
  screamer:    {hp:50,sp:1.8,cd:8,bt:3,xp:5,air:0,pr:0,mr:0,cl:0x88bbff,sz:5,scream:1},
  shieldrunner:{hp:90,sp:2,cd:15,bt:3,xp:6,air:0,pr:0,mr:0,cl:0x66aa66,sz:6,shield:2},
  // Rare unlockables
  revenant:    {hp:220,sp:1.0,cd:30,bt:5,xp:10,air:0,pr:0,mr:0,cl:0x669944,sz:8,revive:1},
  troll:       {hp:350,sp:.7,cd:35,bt:7,xp:14,air:0,pr:0,mr:0,cl:0x558844,sz:11,regen:20},
  gargoyle:    {hp:180,sp:1.4,cd:22,bt:6,xp:11,air:0,pr:0,mr:0,cl:0x777777,sz:8,flyswitch:1},
};

// ── BOSSES (v3 final — ongoing only, no entry, no tower damage) ──
const BOSSES={
  warlord:{nm:'The Warlord',ic:'🗡️',hp:2800,cd:150,sp:.6,pr:.15,mr:.15,cl:0xff4422,sz:18,
    desc:'Walking aura buffs nearby wave units.',mechanic:'aura',
    exUnit:'healer'},
  serpent:{nm:'Serpent Queen',ic:'🐍',hp:2400,cd:140,sp:.7,pr:0,mr:0,cl:0x44cc44,sz:16,
    desc:'Spawns 2 Runners every 5s. Dodge chance.',mechanic:'spawn',
    exUnit:'broodling'},
  troll:{nm:'Frost Troll',ic:'🧊',hp:2600,cd:150,sp:.55,pr:0,mr:.5,cl:0x55aaff,sz:20,
    desc:'Regen 25 HP/s. Absorbs frost for speed.',mechanic:'frostfeed',
    exUnit:'icetroll'},
  dragon:{nm:'Elder Dragon',ic:'🐲',hp:2200,cd:160,sp:.65,pr:0,mr:0,cl:0xff8800,sz:18,
    desc:'Weakest base. Fire damages enemy units. Gains flight.',mechanic:'firebreath',
    exUnit:'wyvern'},
  wraith:{nm:'Shadow Wraith',ic:'👻',hp:2800,cd:140,sp:.6,pr:0,mr:0,cl:0xaa44ff,sz:18,
    desc:'Phases out 2s/visible 4s. Revives dead allies.',mechanic:'phase',
    exUnit:'lesserwraith'},
};
// Boss-exclusive units (only available if that boss is chosen)
const BOSS_UNITS={
  healer:     {hp:120,sp:1.2,cd:15,bt:4,xp:8,air:0,pr:0,mr:0,cl:0xffcc44,sz:7,heal:10},
  broodling:  {hp:40,sp:2.2,cd:8,bt:2,xp:3,air:0,pr:0,mr:0,cl:0x66cc44,sz:5,breed:1},
  icetroll:   {hp:280,sp:.6,cd:25,bt:5,xp:12,air:0,pr:0,mr:.3,cl:0x66aadd,sz:9,regen:12},
  wyvern:     {hp:150,sp:1.8,cd:22,bt:6,xp:11,air:1,pr:0,mr:0,cl:0xff6622,sz:8},
  lesserwraith:{hp:100,sp:1.5,cd:18,bt:5,xp:9,air:0,pr:0,mr:0,cl:0x8844cc,sz:6,stealth:1},
};

// ── WAVES (Phase 2: extended to 13+, boss waves at 3 & 8) ──
const WV=[
  [{t:'runner',n:3}],                                                    // W1
  [{t:'runner',n:5},{t:'brute',n:1}],                                   // W2
  [{t:'runner',n:4},{t:'brute',n:2}],                                   // W3 ⚡BOSS
  [{t:'runner',n:4},{t:'brute',n:2},{t:'flyer',n:1}],                   // W4
  [{t:'runner',n:5},{t:'brute',n:2},{t:'flyer',n:1}],                   // W5
  [{t:'runner',n:3},{t:'brute',n:2},{t:'flyer',n:2}],                   // W6
  [{t:'runner',n:4},{t:'brute',n:3},{t:'flyer',n:2}],                   // W7
  [{t:'runner',n:5},{t:'brute',n:3},{t:'flyer',n:2}],                   // W8 ⚡BOSS
  [{t:'runner',n:4},{t:'brute',n:3},{t:'flyer',n:2},{t:'ghost',n:1}],   // W9
  [{t:'runner',n:4},{t:'brute',n:2},{t:'flyer',n:2},{t:'ghost',n:2}],   // W10
  [{t:'runner',n:5},{t:'brute',n:3},{t:'flyer',n:2},{t:'ghost',n:2}],   // W11
  [{t:'runner',n:3},{t:'brute',n:4},{t:'flyer',n:3},{t:'ghost',n:2}],   // W12
  [{t:'runner',n:5},{t:'brute',n:4},{t:'flyer',n:3},{t:'ghost',n:3}],   // W13 ⚡BOSS
];
const BOSS_WAVES=new Set([3,8,13,18,23]); // boss every 5 waves starting at 3
// No wave cap — waves continue infinitely

// ── CARD POOL (Phase 2: expanded with Magic gates, Lv4 gates, augments, unit unlocks) ──
const CARDS=[
  // Common tower gates (Lv3)
  {r:0,ty:'gate',tw:'archer',lv:3,nm:'Archer Lv3',ds:'Ghost detect, +20% dmg',cost:55},
  {r:0,ty:'gate',tw:'cannon',lv:3,nm:'Cannon Lv3',ds:'Stun 1.5s, +20% dmg',cost:55},
  {r:0,ty:'gate',tw:'frost', lv:3,nm:'Frost Lv3',ds:'Freeze burst, +20% dmg',cost:60},
  {r:0,ty:'gate',tw:'magic', lv:3,nm:'Magic Lv3',ds:'Chain 4, mega-bolt',cost:60},
  // Common wave cards
  {r:0,ty:'tide',nm:'Runner Tide',ds:'+4 wave power',cost:0,wp:4},
  {r:0,ty:'surge',nm:'Runner Surge',ds:'+10 wave power',cost:45,wp:10},
  {r:0,ty:'tide',nm:'Brute Tide',ds:'+4 WP (Brutes)',cost:0,wp:4},
  // Common unit unlocks
  {r:0,ty:'unlock',unit:'crawler',nm:'Crawler Cohort',ds:'Unlock Crawler (70% phys resist)',cost:55},
  {r:0,ty:'unlock',unit:'screamer',nm:'Screamer Swarm',ds:'Unlock Screamer (disables tower on death)',cost:45},
  {r:0,ty:'unlock',unit:'shieldrunner',nm:'Shield Bearers',ds:'Unlock Shield Runner',cost:50},
  // Common augments
  {r:0,ty:'aug',aug:'quickReflexes',nm:'Quick Reflexes',ds:'+15% fire rate (all towers)',cost:0},
  {r:0,ty:'aug',aug:'spotterEye',nm:"Spotter's Eye",ds:'+15% range (all towers)',cost:0},
  {r:0,ty:'aug',aug:'taintedBlow',nm:'Tainted Blow',ds:'6 DPS poison 3s',cost:0},
  // Common buff & economy
  {r:0,ty:'buff',nm:'Swifter Feet',ds:'Runners +25% speed',cost:0,buff:{type:'runner',sp:1.25}},
  {r:0,ty:'buff',nm:'Thicker Hide',ds:'Runners +30 HP',cost:0,buff:{type:'runner',hp:30}},
  {r:0,ty:'eco',sub:'inc',nm:"Merchant's Route",ds:'+1g/s income',cost:80},
  {r:0,ty:'fort',nm:'Fortify',ds:'+60 castle HP',cost:0,heal:60},
  // Rare unit unlocks
  {r:1,ty:'unlock',unit:'revenant',nm:'Raise the Revenant',ds:'Unlock Revenant (revives once)',cost:130},
  {r:1,ty:'unlock',unit:'troll',nm:'Troll Blood',ds:'Unlock Troll (regen 20hp/s)',cost:120},
  {r:1,ty:'unlock',unit:'gargoyle',nm:'Gargoyle Wings',ds:'Unlock Gargoyle (air/ground switch)',cost:140},
  // Rare wave & augments
  {r:1,ty:'tide',nm:'Dark Tide',ds:'+12 wave power',cost:0,wp:12},
  {r:1,ty:'surge',nm:'Iron Storm',ds:'+26 wave power',cost:100,wp:26},
  {r:1,ty:'aug',aug:'keenEdge',nm:'Keen Edge',ds:'Phys towers: 8% crit, 2× dmg',cost:0},
  {r:1,ty:'aug',aug:'bouncingShot',nm:'Bouncing Shot',ds:'Archer/Magic: bounce 1 target 80% dmg',cost:0},
  {r:1,ty:'aug',aug:'concussive',nm:'Concussive Strike',ds:'5% stun 1s',cost:0},
  {r:1,ty:'aug',aug:'venomCoat',nm:'Venom Coat',ds:'18 DPS poison 4s',cost:0},
  {r:1,ty:'eco',sub:'bty',nm:'War Spoils',ds:'Bounty ×1.25 (cap ×2)',cost:90},
  {r:1,ty:'eco',sub:'wb',nm:'Tithe Collector',ds:'Wave bonus +25g',cost:110},
  {r:1,ty:'fort',nm:'Fortify II',ds:'+120 castle HP',cost:80,heal:120},
  {r:1,ty:'buff',nm:'Berserker Rage',ds:'Brutes +60% HP, +25% speed',cost:0,buff:{type:'brute',hp:1.6,sp:1.25}},
  // Rare: new mechanics
  {r:1,ty:'immunity',nm:'Iron Scales',ds:'Your Brutes ignore Lv1 towers',cost:70,unit:'brute',minTwLv:2},
  {r:1,ty:'goldcut',nm:'Plunder Tax',ds:'Enemy gets -25% kill gold',cost:0,cut:0.25},
  // Epic tower gates — these are powerful
  {r:2,ty:'gate',tw:'archer',lv:4,nm:'Ranger Citadel',ds:'Archer Lv4: multi-shot, +15% range',cost:120},
  {r:2,ty:'gate',tw:'cannon',lv:4,nm:'Siege Works',ds:'Cannon Lv4: cluster bombs',cost:120},
  {r:2,ty:'gate',tw:'frost', lv:4,nm:'Permafrost Spire',ds:'Frost Lv4: deep freeze +30% dmg',cost:130},
  {r:2,ty:'gate',tw:'magic', lv:4,nm:'Arcane Nexus',ds:'Magic Lv4: storm field',cost:130},
  // Epic augments
  {r:2,ty:'aug',aug:'executioner',nm:'Executioner',ds:'Towers deal 2× to units below 30% HP',cost:0},
  {r:2,ty:'aug',aug:'arcaneInfusion',nm:'Arcane Infusion',ds:'+25% dmg all towers, +10% range',cost:0},
  {r:2,ty:'aug',aug:'frostNova',nm:'Frost Nova',ds:'Frozen units explode for 40 AoE dmg',cost:0},
  // Epic wave & buffs
  {r:2,ty:'surge',nm:'Hellish Tide',ds:'+40 wave power',cost:80,wp:40},
  {r:2,ty:'buff',nm:'Titan Blood',ds:'All units +40% HP',cost:0,buff:{type:'all',hp:1.4}},
  {r:2,ty:'immunity',nm:'Phantom Veil',ds:'Your Runners ignore Lv1-2 towers',cost:90,unit:'runner',minTwLv:3},
  {r:2,ty:'goldcut',nm:'Cursed Coffers',ds:'Enemy gets -40% kill gold',cost:0,cut:0.40},
  {r:2,ty:'fort',nm:'Fortress III',ds:'+200 castle HP',cost:60,heal:200},
];

// ── AUGMENT DEFINITIONS (auto-applied to qualifying towers) ──
const AUGS={
  quickReflexes:{stat:'rt',val:1.15,minLv:2,nm:'Quick Reflexes'},
  spotterEye:{stat:'rn',val:1.15,minLv:2,nm:"Spotter's Eye"},
  taintedBlow:{stat:'poison',val:{dps:6,dur:3},minLv:2,nm:'Tainted Blow'},
  keenEdge:{stat:'crit',val:{ch:.08,mult:2},minLv:3,dt:'p',nm:'Keen Edge'},
  bouncingShot:{stat:'bounce',val:1,minLv:3,tw:['archer','magic'],nm:'Bouncing Shot'},
  concussive:{stat:'stun',val:{ch:.05,dur:1},minLv:3,nm:'Concussive Strike'},
  venomCoat:{stat:'poison',val:{dps:18,dur:4},minLv:3,nm:'Venom Coat'},
  executioner:{stat:'exec',val:2,minLv:2,nm:'Executioner'},
  arcaneInfusion:{stat:'dmgAll',val:1.25,rng:1.10,minLv:2,nm:'Arcane Infusion'},
  frostNova:{stat:'frostNova',val:40,minLv:3,tw:['frost'],nm:'Frost Nova'},
};

// ── PATH ──
const RAW=[
  [10,0],[10,1],[11,1],[12,1],[13,1],[14,1],[15,1],[16,1],
  [16,2],[16,3],
  [15,3],[14,3],[13,3],[12,3],[11,3],[10,3],[9,3],[8,3],[7,3],[6,3],[5,3],[4,3],[3,3],
  [3,4],[3,5],
  [4,5],[5,5],[6,5],[7,5],[8,5],[9,5],[10,5],[11,5],[12,5],[13,5],[14,5],[15,5],[16,5],
  [16,6],[16,7],
  [15,7],[14,7],[13,7],[12,7],[11,7],[10,7],[9,7],
  [9,8],[9,9],
  [10,9],[11,9],[12,9],[13,9],[14,9],[15,9],[16,9],
  [16,10],[16,11],
  [15,11],[14,11],[13,11],[12,11],[11,11],[10,11],[9,11],[8,11],[7,11],[6,11],[5,11],[4,11],[3,11],
  [3,12],[3,13],
  [4,13],[5,13],[6,13],[7,13],[8,13],[9,13],[10,13],[11,13],[12,13],[13,13],[14,13],[15,13],
  [15,14],[15,15],[14,15],[13,15],[12,15],[11,15],[10,15],
  [10,16],[10,17],
];
const PATH_DN=RAW.map(([x,y])=>({px:GOX+(x+.5)*T,py:(y+.5)*T}));
const PATH_UP=[...PATH_DN].reverse();
const FLY_DN=[];for(let i=0;i<18;i++)FLY_DN.push({px:GOX+10.5*T,py:(i+.5)*T});
const FLY_UP=[...FLY_DN].reverse();

function pLen(p){let d=0;for(let i=1;i<p.length;i++){const dx=p[i].px-p[i-1].px,dy=p[i].py-p[i-1].py;d+=Math.sqrt(dx*dx+dy*dy);}return d;}
function pAt(p,dist){
  let d=0;for(let i=1;i<p.length;i++){
    const dx=p[i].px-p[i-1].px,dy=p[i].py-p[i-1].py,s=Math.sqrt(dx*dx+dy*dy);
    if(d+s>=dist){const t=(dist-d)/s;return{x:p[i-1].px+dx*t,y:p[i-1].py+dy*t,end:false};}
    d+=s;}
  return{x:p[p.length-1].px,y:p[p.length-1].py,end:true};
}

// Tower slots
const PSET=new Set(RAW.map(([x,y])=>`${x},${y}`));
const SLOTS=[];
for(const[x,y]of RAW)for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
  const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
  if(nx>=0&&nx<GC&&ny>=0&&ny<GR&&!PSET.has(k)&&!SLOTS.find(s=>s.x===nx&&s.y===ny))SLOTS.push({x:nx,y:ny});
}
const S0=SLOTS.filter(s=>s.y>=P1R),S1=SLOTS.filter(s=>s.y<P1R);
