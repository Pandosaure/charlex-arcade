"use strict";
// ═══════════ SPRITE TEXTURE MAPS ═══════════
const TW_TEX={archer:{},cannon:{},frost:{},magic:{}};
const UN_TEX={};
const BOSS_TEX={};

// Helper: slice a sprite sheet into an array of PIXI.Textures
function sliceSheet(baseTex, info){
  const fw = baseTex.width / info.cols;
  const fh = baseTex.height / info.rows;
  const frames = [];
  for(let i = 0; i < info.frames; i++){
    frames.push(new PIXI.Texture(baseTex, new PIXI.Rectangle(i * fw, 0, fw, fh)));
  }
  return frames;
}

// Strip checkerboard/grey backgrounds from sprite textures at load time
function cleanTexture(baseTex){
  try{
    const src=baseTex.resource?.source||baseTex.baseTexture?.resource?.source;
    if(!src)return baseTex;
    const w=baseTex.width,h=baseTex.height;
    if(!w||!h)return baseTex;
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const ctx=cv.getContext('2d');ctx.drawImage(src,0,0);
    const img=ctx.getImageData(0,0,w,h);const d=img.data;
    // Sample corners to detect background color
    const corners=[[0,0],[w-1,0],[0,h-1],[w-1,h-1]];
    let sr=0,sg=0,sb=0,cnt=0;
    for(const[cx,cy]of corners){const i=(cy*w+cx)*4;
      if(d[i+3]>200){sr+=d[i];sg+=d[i+1];sb+=d[i+2];cnt++;}}
    if(cnt===0)return baseTex;
    sr=Math.round(sr/cnt);sg=Math.round(sg/cnt);sb=Math.round(sb/cnt);
    // Detect if background looks like checkerboard (grey-ish, not transparent)
    const isGrey=Math.abs(sr-sg)<30&&Math.abs(sg-sb)<30;
    if(!isGrey)return baseTex; // Not a checkerboard, leave alone
    const tol=35;
    for(let i=0;i<d.length;i+=4){
      const dr=Math.abs(d[i]-sr),dg=Math.abs(d[i+1]-sg),db=Math.abs(d[i+2]-sb);
      if(dr<tol&&dg<tol&&db<tol)d[i+3]=0;
    }
    ctx.putImageData(img,0,0);
    return PIXI.Texture.from(cv);
  }catch(e){return baseTex;}
}

// Slice sheet then clean each frame's background
function sliceAndClean(baseTex, info){
  const cleaned=cleanTexture(baseTex);
  const fw=cleaned.width/info.cols;
  const fh=cleaned.height/info.rows;
  const frames=[];
  for(let i=0;i<info.frames;i++){
    frames.push(new PIXI.Texture(cleaned, new PIXI.Rectangle(i*fw,0,fw,fh)));
  }
  return frames;
}

async function loadAllSprites(){
  const resp = await fetch('manifest.json');
  const manifest = await resp.json();

  // Load tower sprites
  for(const [type, levels] of Object.entries(manifest.towers || {})){
    TW_TEX[type] = TW_TEX[type] || {};
    for(const [lv, info] of Object.entries(levels)){
      const tex = await PIXI.Assets.load(info.file);
      TW_TEX[type][lv] = sliceAndClean(tex, info);
    }
  }

  // Load unit sprites — handle both single-sheet and walk/action variants
  for(const [type, info] of Object.entries(manifest.units || {})){
    if(info.file){
      // Simple single sheet
      const tex = await PIXI.Assets.load(info.file);
      UN_TEX[type] = sliceAndClean(tex, info);
    } else {
      // Has walk/action sub-sheets
      UN_TEX[type] = {};
      for(const [action, sheet] of Object.entries(info)){
        const tex = await PIXI.Assets.load(sheet.file);
        UN_TEX[type][action] = sliceAndClean(tex, sheet);
      }
    }
  }

  // Load boss sprites — actions have evolution levels, plus portrait
  for(const [boss, data] of Object.entries(manifest.bosses || {})){
    BOSS_TEX[boss] = {walk:[], action:[], portrait:null};
    if(data.actions){
      for(const [action, levels] of Object.entries(data.actions)){
        // levels is {1:{file,frames,cols,rows}, 2:{...}, 3:{...}}
        // For now, load level 1 as default walk/action frames
        const lv1 = levels["1"];
        if(lv1){
          const tex = await PIXI.Assets.load(lv1.file);
          BOSS_TEX[boss][action] = sliceAndClean(tex, lv1);
        }
        // Store all evolution levels for future use
        BOSS_TEX[boss][action+'Levels'] = {};
        for(const [lv, info] of Object.entries(levels)){
          const tex = await PIXI.Assets.load(info.file);
          BOSS_TEX[boss][action+'Levels'][lv] = sliceAndClean(tex, info);
        }
      }
    }
    if(data.portrait){
      BOSS_TEX[boss].portrait = await PIXI.Assets.load(data.portrait);
    }
  }
}

// ═══════════ GAME STATE ═══════════
function mkPlayer(){
  return {g:SGOLD,hp:HP,xp:0,lv:1,inc:PASV,bm:1,wb:WBON,wp:0,
    gates:{archer:2,cannon:2,frost:2,magic:2},
    tw:[],merch:0,tithe:0,luOn:0,luT:0,luC:[],_cg:null,
    boss:null,bossKills:0,augs:[],unlocked:{},
    immunity:{},goldCut:0,
    intT:0,lastSpend:0, // interest timer
    buffs:{} // unit buffs from cards
  };
}
const pl=[mkPlayer(),mkPlayer()];
const units=[[],[]],projs=[],fx=[];
let wave=0,wt=15,time=0,over=false,radial=[null,null],radialT=[0,0],gameStarted=false;
let app,bgL,slotL,twL,unitL,projL,fxL,uiL;

// ═══════════ INIT ═══════════
function init(){
  app=new PIXI.Application({
    view:document.getElementById('c'),
    width:VW,height:VH,
    backgroundColor:0x1a2820,
    antialias:false,
    resolution:1,       // resolution:1 prevents WebGL crash on mobile
    autoDensity:false,
  });

  // Contain-mode: maintain aspect ratio, force landscape dimensions, center
  function resize(){
    const cv=app.view;
    // Use the larger dimension as width (landscape logic)
    const sw=Math.max(innerWidth,innerHeight);
    const sh=Math.min(innerWidth,innerHeight);
    const sc=Math.min(sw/VW,sh/VH);
    const cw=VW*sc, ch=VH*sc;
    cv.style.width=cw+'px';
    cv.style.height=ch+'px';
    cv.style.left=((sw-cw)/2)+'px';
    cv.style.top=((sh-ch)/2)+'px';
  }
  addEventListener('resize',resize);resize();

  bgL=app.stage.addChild(new PIXI.Container());
  slotL=app.stage.addChild(new PIXI.Container());
  twL=app.stage.addChild(new PIXI.Container());
  unitL=app.stage.addChild(new PIXI.Container());
  projL=app.stage.addChild(new PIXI.Container());
  fxL=app.stage.addChild(new PIXI.Container());
  uiL=app.stage.addChild(new PIXI.Container());

  drawBG();
  drawSlots();

  app.stage.eventMode='static';
  app.stage.hitArea=new PIXI.Rectangle(0,0,VW,VH);
  app.stage.on('pointerdown',e=>{
    const gy=e.global?e.global.y:(e.data?.global?.y||VH/2);
    killRadial(gy>=P1R*T?0:1);
  });
  document.addEventListener('pointerdown',e=>{
    if(e.target===app.view)return;
    const p=(e.clientY>=innerHeight/2)?0:1;
    killRadial(p);
  });

  // Show boss selection screen before starting the game
  // Don't show boss select yet - wait for START button
  document.getElementById('startBtn').onclick=function(){
    document.getElementById('titleScreen').style.display='none';
    showBossSelect();
  };
}

// ═══════════ BOSS SELECTION ═══════════
function showBossSelect(){
  const sel=document.getElementById('bossSelect');
  sel.classList.remove('hidden');
  const bossKeys=Object.keys(BOSSES);
  // Mechanic summaries for each boss
  const mechInfo={
    warlord:{mech:'🛡️ Aura buffs nearby units (+20% speed, -15% dmg). Frightens enemies.',unit:'⚕️ Battle Healer — heals adjacent allies'},
    serpent:{mech:'🥚 Spawns 2 Runners every 5s. Dodge chance.',unit:'🐍 Broodling — splits on death'},
    troll:{mech:'❄️ Regen 25 HP/s. IMMUNE to slow. Absorbs frost → +speed!',unit:'🧊 Ice Troll — mini troll with regen'},
    dragon:{mech:'🔥 Fire breath damages enemy units every 6s. Gains FLIGHT at Epic!',unit:'🐉 Wyvern — air unit (unlocks late)'},
    wraith:{mech:'👁️ Phases out 2s/4s cycle. Revives dead allies while phased.',unit:'👻 Lesser Wraith — stealth unit'},
  };

  for(let p=0;p<2;p++){
    const grid=document.getElementById('bgP'+p);
    grid.innerHTML='';
    bossKeys.forEach(k=>{
      const b=BOSSES[k];
      const info=mechInfo[k]||{mech:'',unit:''};
      const bTex=BOSS_TEX[k];
      const card=document.createElement('div');
      card.className='bs-card';
      // Portrait — use loaded texture's source image if available
      let portraitHTML='<div class="bi">'+b.ic+'</div>';
      if(bTex&&bTex.portrait){
        const src=bTex.portrait.resource?.src || bTex.portrait.baseTexture?.resource?.src || '';
        if(src){
          portraitHTML=`<div class="bi"><img src="${src}" style="width:52px;height:52px;border-radius:50%;border:2px solid #c8a84b;image-rendering:pixelated;display:block;margin:0 auto"></div>`;
        }
      }
      card.innerHTML=portraitHTML+
        `<div class="bn">${b.nm}</div>`+
        `<div class="bst">${b.hp} HP · ${b.cd} dmg · ⚡${b.sp}</div>`+
        `<div class="bd">${info.mech}</div>`+
        `<div class="bu">${info.unit}</div>`;
      card.onclick=()=>selectBoss(p,k);
      card.setAttribute('data-boss',k);
      grid.appendChild(card);
    });
  }
}

function selectBoss(p,key){
  // If already locked, ignore
  if(pl[p].boss)return;

  // Highlight selected card, deselect others
  const grid=document.getElementById('bgP'+p);
  grid.querySelectorAll('.bs-card').forEach(c=>{
    c.classList.toggle('selected',c.getAttribute('data-boss')===key);
  });

  // Set boss
  pl[p].boss=key;
  const status=document.getElementById('bsS'+p);
  status.textContent=`✓ ${BOSSES[key].nm} LOCKED IN`;
  status.classList.add('ready');

  // Lock cards for this player
  grid.querySelectorAll('.bs-card').forEach(c=>{
    if(c.getAttribute('data-boss')!==key)c.classList.add('locked');
    c.onclick=null; // disable further clicks
  });

  // Check if both players have chosen
  if(pl[0].boss&&pl[1].boss){
    setTimeout(startGame,800);
  }
}

function startGame(){
  // Show the game canvas
  app.view.style.visibility='visible';
  app.view.style.pointerEvents='auto';
  // Hide boss selection
  document.getElementById('bossSelect').classList.add('hidden');

  // Add boss portraits to HUD
  for(let p=0;p<2;p++){
    const s=pl[p],h=s._h;if(!h)continue;
    const bTex=BOSS_TEX[s.boss];
    if(bTex&&bTex.portrait){
      const portrait=new PIXI.Sprite(bTex.portrait);
      portrait.width=22;portrait.height=22;portrait.anchor.set(.5);
      // Position: left side of HUD bar
      portrait.x=p===0?GOX-16:GOX+GC*T+16;
      portrait.y=p===0?VH-14:14;
      if(p===1)portrait.rotation=Math.PI;
      // Circle mask effect via rounded graphics behind
      const ring=new PIXI.Graphics();
      ring.lineStyle(2,0xc8a84b,.9);ring.drawCircle(portrait.x,portrait.y,13);
      ring.beginFill(0x0a0e14,.8);ring.drawCircle(portrait.x,portrait.y,12);ring.endFill();
      uiL.addChild(ring,portrait);
      h.bossPortrait=portrait;
    }
  }

  // Start game loop
  app.ticker.add(loop);
  toast(`⚔ ${BOSSES[pl[0].boss].nm} vs ${BOSSES[pl[1].boss].nm} ⚔`,2500);
  setTimeout(()=>toast('Tap a slot to build towers!'),3000);
}

// ═══════════ DRAWING ═══════════
function drawBG(){
  const g=new PIXI.Graphics();
  // Grid area - much lighter green field
  g.beginFill(0x2e4a2e,.45);g.drawRect(GOX,0,GC*T,GR*T);g.endFill();
  // Territory shading - subtle warm/cool tints
  g.beginFill(0x664433,.06);g.drawRect(GOX,0,GC*T,P1R*T);g.endFill();
  g.beginFill(0x334466,.06);g.drawRect(GOX,P1R*T,GC*T,(GR-P1R)*T);g.endFill();
  // Grid lines - slightly more visible
  g.lineStyle(1,0x3a5a3a,.12);
  for(let x=0;x<=GC;x++){g.moveTo(GOX+x*T,0);g.lineTo(GOX+x*T,GR*T);}
  for(let y=0;y<=GR;y++){g.moveTo(GOX,y*T);g.lineTo(GOX+GC*T,y*T);}
  // Center divider
  g.lineStyle(1.5,0x667788,.4);g.moveTo(GOX,P1R*T);g.lineTo(GOX+GC*T,P1R*T);
  bgL.addChild(g);

  // Path tiles - warmer, brighter dirt road
  const pt=new PIXI.Graphics();
  for(const[x,y]of RAW){
    pt.beginFill(0x8a7535,.45);pt.drawRoundedRect(GOX+x*T+1,y*T+1,T-2,T-2,2);pt.endFill();
  }
  pt.lineStyle(2,0xaa9955,.25);
  pt.moveTo(PATH_DN[0].px,PATH_DN[0].py);
  for(let i=1;i<PATH_DN.length;i++)pt.lineTo(PATH_DN[i].px,PATH_DN[i].py);
  bgL.addChild(pt);

  // Castles
  const castles=[[10,17,0],[10,0,1]]; // [x,y,player]
  for(const[x,y,p]of castles){
    const cx=GOX+(x+.5)*T,cy=(y+.5)*T;
    const cg=new PIXI.Graphics();
    cg.beginFill(p===0?0x223388:0x882233,.3);cg.lineStyle(2,p===0?0x4488cc:0xcc4444,.8);
    cg.drawRoundedRect(-16,-16,32,32,4);cg.endFill();cg.x=cx;cg.y=cy;
    const ci=new PIXI.Text('🏰',{fontSize:16});ci.anchor.set(.5);ci.x=cx;ci.y=cy;
    const lb=new PIXI.Text(`P${p+1}`,{fontFamily:'Cinzel',fontSize:8,fontWeight:'700',fill:p===0?0x4488cc:0xcc4444});
    lb.anchor.set(.5);lb.x=cx;lb.y=cy+(p===0?20:-20);
    if(p===1)lb.rotation=Math.PI;
    bgL.addChild(cg,ci,lb);
    pl[p]._cg=cg;
  }

  // HUDs — compact horizontal bars inside the field, not eating side columns
  // P1 HUD: bottom edge of screen, spanning the grid width
  drawHUD(0, GOX, VH-26, false);
  // P2 HUD: top edge, rotated for face-to-face
  drawHUD(1, GOX, 0, true);
}

function drawHUD(p,hx,hy,flip){
  const w=GC*T; // span full grid width
  const h=24;
  const c=new PIXI.Container();c.x=hx;c.y=hy;
  if(flip){c.rotation=Math.PI;c.x=hx+w;c.y=hy+h;}
  const bg=new PIXI.Graphics();bg.beginFill(0x0a0e14,.85);bg.drawRoundedRect(0,0,w,h,3);bg.endFill();
  bg.lineStyle(1,p===0?0x223366:0x662233,.4);bg.drawRoundedRect(0,0,w,h,3);c.addChild(bg);
  const hud={};
  // Layout: [Gold] [Income] | [HP bar] [HP text] | [XP bar] [Lv] | [Wave] [Timer]
  const ly=4; // vertical center offset
  hud.gold=_t(c,`💰 ${SGOLD}g`,11,0xc8a84b,6,ly,'600');
  hud.inc=_t(c,`+${PASV}g/s`,8,0x7a8a9a,90,ly+2);
  // HP bar
  const hpBg=new PIXI.Graphics();hpBg.beginFill(0x1c2535);hpBg.drawRoundedRect(0,0,100,8,3);hpBg.endFill();
  hpBg.x=155;hpBg.y=ly+2;c.addChild(hpBg);
  hud.hpB=new PIXI.Graphics();hud.hpB.x=155;hud.hpB.y=ly+2;c.addChild(hud.hpB);
  hud.hpT=_t(c,`🏰 ${HP}`,8,0x88ddaa,260,ly+1);
  // XP bar + Level
  const xpBg=new PIXI.Graphics();xpBg.beginFill(0x1c2535);xpBg.drawRoundedRect(0,0,80,5,2);xpBg.endFill();
  xpBg.x=330;xpBg.y=ly+4;c.addChild(xpBg);
  hud.xpB=new PIXI.Graphics();hud.xpB.x=330;hud.xpB.y=ly+4;c.addChild(hud.xpB);
  hud.lv=_t(c,'Lv1',9,0xaa66dd,415,ly,'700','Cinzel');
  hud.xpT=_t(c,'0/100',7,0x7a8a9a,450,ly+2);
  // Wave info
  hud.wav=_t(c,'W0',9,0xc8a84b,w-120,ly,'600','Cinzel');
  hud.wt=_t(c,'6s',8,0x7a8a9a,w-68,ly+1);
  // Boss portrait circle (filled after boss selection)
  hud.bossPortrait=null;
  // Gate status text
  hud.gates=_t(c,'🏹2 💣2 ❄2 ✨2',7,0x556677,w-55,ly+12);
  uiL.addChild(c);
  pl[p]._h=hud;
}
function _t(c,s,sz,fill,x,y,fw='400',ff='Inter'){
  const t=new PIXI.Text(s,{fontFamily:ff,fontSize:sz,fontWeight:fw,fill});t.x=x;t.y=y;c.addChild(t);return t;
}

function drawSlots(){
  function mk(list,p){
    const col=p===0?0x334466:0x664433;
    for(const{x,y}of list){
      const g=new PIXI.Graphics();
      g.lineStyle(1,col,.3);g.beginFill(col,.06);
      g.drawRoundedRect(0,0,T-4,T-4,3);g.endFill();
      // Subtle dot in center
      g.beginFill(col,.2);g.drawCircle((T-4)/2,(T-4)/2,2);g.endFill();
      g.x=GOX+x*T+2;g.y=y*T+2;
      g.eventMode='static';g.cursor='pointer';
      g.hitArea=new PIXI.Rectangle(-4,-4,T+4,T+4);
      const pp=p,xx=x,yy=y;
      g.on('pointerdown',e=>{e.stopPropagation();onSlot(pp,xx,yy);});
      slotL.addChild(g);
    }
  }
  mk(S0,0);mk(S1,1);
}

// ═══════════ HUD UPDATE ═══════════
function updHUD(){
  for(let p=0;p<2;p++){
    const s=pl[p],h=s._h;if(!h)continue;
    h.gold.text=`💰 ${Math.floor(s.g)}g`;
    h.inc.text=`+${s.inc}g/s`;
    const hp=Math.max(0,s.hp)/HP;
    h.hpB.clear();h.hpB.beginFill(hp>.5?0x55c888:hp>.25?0xee8833:0xe05555);
    h.hpB.drawRoundedRect(0,0,100*hp,8,3);h.hpB.endFill();
    h.hpT.text=`🏰 ${Math.max(0,Math.ceil(s.hp))}`;
    const nx=xpNeed(s.lv+1),px=xpNeed(s.lv);
    h.xpB.clear();h.xpB.beginFill(0xaa66dd);h.xpB.drawRoundedRect(0,0,80*Math.min(1,(s.xp-px)/Math.max(1,nx-px)),5,2);h.xpB.endFill();
    h.lv.text=`Lv${s.lv}`;h.xpT.text=`${s.xp}/${nx}`;
    h.wav.text=`W${wave}`;
    h.wt.text=!over?`${Math.ceil(wt)}s`:'';
    // Gate status: show max unlocked level per tower type
    const g=s.gates;
    h.gates.text=`🏹${g.archer} 💣${g.cannon} ❄${g.frost} ✨${g.magic}`;
  }
}

// ═══════════ RADIAL MENU ═══════════
function onSlot(p,x,y){
  killRadial(p);
  const tw=pl[p].tw.find(t=>t.x===x&&t.y===y);
  tw?upgRadial(p,tw):buildRadial(p,x,y);
}

function buildRadial(p,x,y){
  const cx=GOX+(x+.5)*T,cy=(y+.5)*T,ps=pl[p];
  const c=new PIXI.Container();c.x=cx;c.y=cy;
  const bg=new PIXI.Graphics();bg.beginFill(0x080c12,.6);bg.drawCircle(0,0,80);bg.endFill();
  bg.lineStyle(2,0xc8a84b,.4);bg.drawRoundedRect(-T/2+2,-T/2+2,T-4,T-4,3);
  bg.eventMode='static';bg.hitArea=new PIXI.Circle(0,0,80);
  bg.on('pointerdown',e=>{e.stopPropagation();killRadial(p);});
  c.addChild(bg);
  const ang=TK.length===4?[-Math.PI/2,0,Math.PI/2,Math.PI]:[-Math.PI/2,Math.PI/6,Math.PI*5/6];
  TK.forEach((k,i)=>{
    if(i>=ang.length)return;
    const d=TW[k],a=ang[i],ok=ps.g>=d.c;
    const bx=Math.cos(a)*54,by=Math.sin(a)*54;
    const b=new PIXI.Container();b.x=bx;b.y=by;
    const cr=new PIXI.Graphics();cr.beginFill(ok?0x141b25:0x0a0e14,.95);
    cr.lineStyle(2.5,ok?d.cl:0x333,.85);cr.drawCircle(0,0,24);cr.endFill();b.addChild(cr);
    const frames=(TW_TEX[k]&&TW_TEX[k][1])?TW_TEX[k][1]:null;
    const tex=frames&&frames.length?frames[0]:null;
    if(tex){const rs=new PIXI.Sprite(tex);const sc=28/tex.height;rs.scale.set(sc);rs.anchor.set(.5,.6);rs.y=-2;b.addChild(rs);}
    else{const ti=new PIXI.Text(d.ic,{fontSize:14});ti.anchor.set(.5);ti.y=-3;b.addChild(ti);}
    const tc=new PIXI.Text(d.c+'g',{fontFamily:'Cinzel',fontSize:8,fill:ok?0xc8a84b:0x555555});tc.anchor.set(.5);tc.y=13;b.addChild(tc);
    if(ok){b.eventMode='static';b.cursor='pointer';b.hitArea=new PIXI.Circle(0,0,26);
      b.on('pointerdown',e=>{e.stopPropagation();placeTw(p,x,y,k);killRadial(p);});}
    else b.alpha=.3;
    c.addChild(b);
  });
  if(p===1)c.rotation=Math.PI;
  radial[p]=c;radialT[p]=8;uiL.addChild(c);
}

function upgRadial(p,tw){
  const cx=GOX+(tw.x+.5)*T,cy=(tw.y+.5)*T,ps=pl[p],d=TW[tw.type],nx=tw.lv+1;
  const c=new PIXI.Container();c.x=cx;c.y=cy;
  const bg=new PIXI.Graphics();bg.beginFill(0x080c12,.6);bg.drawCircle(0,0,80);bg.endFill();
  bg.eventMode='static';bg.hitArea=new PIXI.Circle(0,0,80);
  bg.on('pointerdown',e=>{e.stopPropagation();killRadial(p);});
  c.addChild(bg);
  const inf=new PIXI.Text(`${d.ic} Lv${tw.lv}`,{fontFamily:'Cinzel',fontSize:11,fill:d.cl});
  inf.anchor.set(.5);c.addChild(inf);

  const items=[];
  if(nx<=4){const ld=d.lv[nx],cost=Math.floor(d.c*(ld?.cm||.6));
    const gated=ld?.gate&&ps.gates[tw.type]<nx;const ok=!gated&&ps.g>=cost;
    items.push({lb:gated?'🔒':`Lv${nx}`,sub:gated?'Need card':`${cost}g`,col:ok?0x55c888:0x555,ok,
      fn:()=>{upgTw(p,tw);killRadial(p);}});}
  items.push({lb:'Sell',sub:`+${Math.floor(tw.tc*.6)}g`,col:0xee8833,ok:true,
    fn:()=>{sellTw(p,tw);killRadial(p);}});

  const angs=items.length===1?[-Math.PI/2]:[-Math.PI/3,-Math.PI*2/3];
  items.forEach((it,i)=>{
    const a=angs[i],bx=Math.cos(a)*54,by=Math.sin(a)*54;
    const b=new PIXI.Container();b.x=bx;b.y=by;
    const cr=new PIXI.Graphics();cr.beginFill(0x141b25,.95);cr.lineStyle(2.5,it.col,.85);
    cr.drawCircle(0,0,24);cr.endFill();b.addChild(cr);
    const lb=new PIXI.Text(it.lb,{fontFamily:'Cinzel',fontSize:9,fill:it.col});lb.anchor.set(.5);lb.y=-4;b.addChild(lb);
    const sb=new PIXI.Text(it.sub,{fontSize:7,fill:0x778899});sb.anchor.set(.5);sb.y=10;b.addChild(sb);
    if(it.ok){b.eventMode='static';b.cursor='pointer';b.hitArea=new PIXI.Circle(0,0,26);
      b.on('pointerdown',e=>{e.stopPropagation();it.fn();});}
    else b.alpha=.35;
    c.addChild(b);
  });
  if(p===1)c.rotation=Math.PI;
  radial[p]=c;radialT[p]=8;uiL.addChild(c);
}

function killRadial(p){
  if(p!==undefined){if(radial[p]){uiL.removeChild(radial[p]);radial[p]=null;radialT[p]=0;}}
  else{for(let i=0;i<2;i++)if(radial[i]){uiL.removeChild(radial[i]);radial[i]=null;radialT[i]=0;}}
}

// ═══════════ TOWERS ═══════════
function placeTw(p,x,y,k){
  const s=pl[p],d=TW[k];if(s.g<d.c)return;
  s.g-=d.c;const tw={type:k,x,y,lv:1,cd:0,tc:d.c,fcd:0,spr:null};
  s.tw.push(tw);addXP(p,10);renderTw(p,tw);
}
function renderTw(p,tw){
  const d=TW[tw.type];if(tw.spr)twL.removeChild(tw.spr);
  const c=new PIXI.Container();

  // Level glow — scales with level
  const g=new PIXI.Graphics();
  const glowR=12+tw.lv*3;
  if(tw.lv>=2){g.lineStyle(1.5,d.cl,.35);g.drawCircle(0,0,glowR);}
  if(tw.lv>=3){g.lineStyle(2,0xffffff,.15);g.drawCircle(0,0,glowR+3);
    g.beginFill(d.cl,.08);g.drawCircle(0,0,glowR-2);g.endFill();}
  if(tw.lv>=4){g.lineStyle(1,d.cl,.2);g.drawCircle(0,0,glowR+6);}
  c.addChild(g);

  const frames=(TW_TEX[tw.type]&&TW_TEX[tw.type][tw.lv])?TW_TEX[tw.type][tw.lv]:null;
  let spr;
  if(frames&&frames.length){
    spr=new PIXI.Sprite(frames[0]);
    tw._animSpr=spr;
    tw._animFrames=frames;
  }
  if(spr){
    // Clear size jump: Lv1=70%, Lv2=85%, Lv3=105%, Lv4=125% of tile
    const scaleByLv=[0, 0.70, 0.85, 1.05, 1.25];
    const displayW=T*scaleByLv[tw.lv];
    const displayH=displayW*(spr.texture.height/spr.texture.width);
    spr.width=displayW;spr.height=displayH;
    tw._sprW=displayW;tw._sprH=displayH;
    spr.anchor.set(0.5,1);
    spr.y=T/2;
    c.addChild(spr);
  }else{
    // Fallback: colored box + emoji for towers without sprite sheets
    const fb=new PIXI.Graphics();fb.beginFill(d.cl,.3);fb.lineStyle(2,d.cl,.8);
    fb.drawRoundedRect(-12,-12,24,24,4);fb.endFill();c.addChild(fb);
    const ic=new PIXI.Text(d.ic,{fontSize:14});ic.anchor.set(.5);ic.y=-2;c.addChild(ic);
  }

  // Level badge
  const lb=new PIXI.Text(tw.lv+'',{fontFamily:'Cinzel',fontSize:7,fontWeight:'900',fill:0xffffff,
    stroke:d.cl,strokeThickness:2});
  lb.anchor.set(.5);lb.y=T/2-1;c.addChild(lb);

  c.x=GOX+(tw.x+.5)*T;c.y=(tw.y+.5)*T;
  if(p===1)c.rotation=Math.PI;
  c.eventMode='static';c.cursor='pointer';c.hitArea=new PIXI.Circle(0,0,14+tw.lv*3);
  c.on('pointerdown',e=>{e.stopPropagation();killRadial(p);upgRadial(p,tw);});
  tw.spr=c;twL.addChild(c);
}
function upgTw(p,tw){
  const s=pl[p],d=TW[tw.type],nx=tw.lv+1;if(nx>4)return; // Phase 2: max Lv4
  const ld=d.lv[nx],cost=Math.floor(d.c*(ld?.cm||.6));
  if(s.g<cost||(ld?.gate&&s.gates[tw.type]<nx))return;
  s.g-=cost;tw.lv=nx;tw.tc+=cost;addXP(p,[0,0,15,25,40][nx]||15);renderTw(p,tw);
}
function sellTw(p,tw){pl[p].g+=Math.floor(tw.tc*.6);if(tw.spr)twL.removeChild(tw.spr);pl[p].tw=pl[p].tw.filter(t=>t!==tw);}

function tSt(p,tw){
  const d=TW[tw.type];let dm=d.d,rt=d.r,rn=d.rn,ao=d.ao||0,air=d.air,sth=0,sl=d.sl||0,st=0,frz=0;
  let chain=d.chain||0,detect=d.detect||0,multi=1,crit=null,poison=null,bounce=0,stun=null,exec=0,frostNova=0;
  for(let l=2;l<=tw.lv;l++){const ld=d.lv[l];if(!ld)continue;dm*=(ld.dm||1);rt*=(ld.rm||1);
    if(ld.am)ao*=ld.am;if(ld.sa)sl+=ld.sa;if(ld.st)st=ld.st;if(ld.sth)sth=1;if(ld.frz)frz=1;
    if(ld.chain)chain+=ld.chain;if(ld.multi)multi=ld.multi;}
  // Apply augments
  const s=pl[p];
  for(const augKey of s.augs){
    const a=AUGS[augKey];if(!a)continue;
    if(tw.lv<a.minLv)continue;
    if(a.dt&&a.dt!==d.dt)continue;
    if(a.tw&&!a.tw.includes(tw.type))continue;
    if(a.stat==='rt')rt*=a.val;
    else if(a.stat==='rn')rn*=a.val;
    else if(a.stat==='crit')crit=a.val;
    else if(a.stat==='bounce')bounce+=a.val;
    else if(a.stat==='stun')stun=a.val;
    else if(a.stat==='poison')poison=a.val;
    else if(a.stat==='dmgAll'){dm*=a.val;rn*=(a.rng||1);}
    else if(a.stat==='exec')exec=a.val;
    else if(a.stat==='frostNova')frostNova=a.val;
  }
  let adj=0;for(const o of s.tw){if(o===tw)continue;
    if(Math.abs(o.x-tw.x)+Math.abs(o.y-tw.y)===1)adj+=(o.type!==tw.type?CFG_ADJB:CFG_ADJP);}
  return{dm:dm*(1+adj),rt,rn,ao,air,sth,sl,st,frz,dt:d.dt,chain,detect,multi,crit,poison,bounce,stun,exec,frostNova};
}
const CFG_ADJB=.15,CFG_ADJP=-.10;

// ═══════════ UNITS ═══════════
function spawnWave(wi){
  const wIdx=Math.min(wi, WV.length-1); // reuse last wave def if beyond table
  for(let p=0;p<2;p++){
    const s=pl[p],list=[];
    for(const{t,n}of WV[wIdx])for(let i=0;i<n;i++)list.push(t);
    // Add wave power units
    let wp=s.wp;while(wp>=3){list.push('brute');wp-=3;}while(wp>=1){list.push('runner');wp-=1;}
    // Add unlocked elite units to later waves
    if(wi>=6){const elites=Object.keys(s.unlocked);
      if(elites.length)for(let i=0;i<Math.min(wi-5,3);i++)list.push(elites[i%elites.length]);}
    // Boss wave: spawn the player's chosen boss
    if(BOSS_WAVES.has(wi+1)&&s.boss){
      const delay=(list.length+1)*500;
      setTimeout(()=>{if(!over)spawnBoss(p);},delay);
    }
    list.forEach((t,i)=>setTimeout(()=>{if(!over)spawnU(p,t);},i*500));
  }
}
// Boss spawning
function spawnBoss(sender){
  const s=pl[sender],bd=BOSSES[s.boss];if(!bd)return;
  const pts=sender===0?PATH_UP:PATH_DN;
  // HP scaling: +10% base HP per wave
  const scaledHP=Math.floor(bd.hp*(1+wave*0.06)*Math.pow(1.08,wave));
  const u={type:'boss_'+s.boss,sender,hp:scaledHP,mhp:scaledHP,dist:0,spd:bd.sp*T,
    slT:0,slA:0,stT:0,air:0,shld:0,alive:1,pts,spr:null,isBoss:1,
    pr:bd.pr||0,mr:bd.mr||0,
    mechanic:bd.mechanic,_mechT:0,_actionAnim:0,
    // Wraith phase state
    _phaseT:0,_phased:false,
    // Troll frost absorption
    _frostBoost:0,
    // Troll regen
    regen:bd.mechanic==='frostfeed'?25:0,
    // Troll/Wraith: immune to slow
    _slowImmune:bd.mechanic==='frostfeed'};
  const c=new PIXI.Container();
  // Use boss walk sprite if available
  const bTex=BOSS_TEX[s.boss];
  if(bTex&&bTex.walk&&bTex.walk.length){
    const bspr=new PIXI.Sprite(bTex.walk[0]);
    const scale=Math.min(2.0, (T*1.5)/bspr.texture.height); // 1.5 tiles tall, capped
    bspr.scale.set(scale);bspr.anchor.set(0.5,0.8);
    c.addChild(bspr);
    u._bossWalkTex=bTex.walk;u._bossSpr=bspr;u._bossScale=scale;u._walkT=0;
    // Action textures
    if(bTex.action&&bTex.action.length){
      u._bossActionTex=bTex.action;
    }
    // Player color ring
    const ring=new PIXI.Graphics();
    ring.lineStyle(2,sender===0?0x4488cc:0xcc4444,.7);
    ring.drawEllipse(0,bd.sz*0.3,bd.sz*1.2,bd.sz*0.5);
    c.addChild(ring);
  }else{
    // Fallback: colored circle + emoji
    const g=new PIXI.Graphics();
    g.beginFill(bd.cl,.8);g.drawCircle(0,0,bd.sz);g.endFill();
    g.lineStyle(3,0xffcc00,.9);g.drawCircle(0,0,bd.sz+2);
    g.lineStyle(1.5,sender===0?0x4488cc:0xcc4444,.7);g.drawCircle(0,0,bd.sz+5);
    c.addChild(g);
    const ic=new PIXI.Text(bd.ic,{fontSize:bd.sz});ic.anchor.set(.5);c.addChild(ic);
  }
  const hbY=-(bd.sz+8);
  const hb=new PIXI.Graphics();hb.beginFill(0x111824,.8);hb.drawRect(-20,hbY,40,5);hb.endFill();
  const hf=new PIXI.Graphics();hf.beginFill(0xffcc00);hf.drawRect(-20,hbY,40,5);hf.endFill();
  c.addChild(hb,hf);u._hf=hf;u._hy=hbY;u._hbW=40;
  c.x=pts[0].px;c.y=pts[0].py;u.spr=c;
  unitL.addChild(c);units[sender].push(u);
  toast(`⚡ ${bd.nm} INCOMING!`,2000);
  // No entry mechanics — all mechanics are ongoing in updUnits
}
function spawnU(sender,type){
  const d=UN[type];if(!d)return;
  // All units (including flyers) use ground path. Flyers are just immune to non-air towers.
  const pts=(sender===0?PATH_UP:PATH_DN);
  // Apply player buffs to unit stats
  const s=pl[sender],bf=s.buffs[type];
  let hp=d.hp, spd=d.sp;
  if(bf){hp=Math.floor(hp*bf.hp+(bf.hpAdd||0));spd*=bf.sp;}
  // HP scaling: +10% of base HP per wave number
  hp=Math.floor(hp*(1+wave*0.06)*Math.pow(1.08,wave));
  const u={type,sender,hp,mhp:hp,dist:0,spd:spd*T,
    slT:0,slA:0,stT:0,air:d.air||0,shld:d.shield||0,alive:1,pts,spr:null,
    pr:d.pr||0,mr:d.mr||0,stealth:d.stealth||0,regen:d.regen||0,
    revive:d.revive||0,_prevX:0};
  const c=new PIXI.Container();
  // Use sprite if available, else fallback to colored circle
  // UN_TEX[type] is either an array of frames (simple) or {walk:[...],action:[...]}
  const uRaw=UN_TEX[type];
  const uFrames=Array.isArray(uRaw)?uRaw:(uRaw&&uRaw.walk?uRaw.walk:null);
  let bd;
  if(uFrames&&uFrames.length){
    bd=new PIXI.Sprite(uFrames[0]);
    // Use full sprite size: 1 tile wide for small units, up to 1.5 tiles for big ones
    const targetW=T*(d.sz<=7?0.9:d.sz<=10?1.1:1.4);
    const scale=targetW/bd.texture.width;
    bd.scale.set(scale);
    bd.anchor.set(0.5,0.8);
    u._uFrames=uFrames;u._uSpr=bd;u._walkT=0;
    u._sprScale=scale;
  }else{
    bd=new PIXI.Graphics();
    bd.beginFill(d.cl,.85);bd.drawCircle(0,0,d.sz);bd.endFill();
    bd.lineStyle(1.5,sender===0?0x4488cc:0xcc4444,.55);bd.drawCircle(0,0,d.sz+1.5);
    if(d.air){bd.lineStyle(1,0x88ddff,.25);bd.drawCircle(0,0,d.sz+4);}
  }
  c.addChild(bd);
  // Player color ring around sprite units
  if(uFrames&&uFrames.length){
    const ringW=bd.width*0.5, ringH=bd.width*0.2;
    const ring=new PIXI.Graphics();
    ring.lineStyle(1.5,sender===0?0x4488cc:0xcc4444,.6);
    ring.drawEllipse(0,ringH*0.5,ringW,ringH);
    c.addChild(ring);
  }
  // Health bar - floating above the unit sprite
  const hbY = -(bd.height||d.sz*3)+(-6); // well above the tallest part of sprite
  const hb=new PIXI.Graphics();hb.beginFill(0x111824,.7);hb.drawRect(-9,hbY,18,3);hb.endFill();
  const hf=new PIXI.Graphics();hf.beginFill(0x5c8);hf.drawRect(-9,hbY,18,3);hf.endFill();
  c.addChild(hb,hf);u._hf=hf;u._hy=hbY;
  c.x=pts[0].px;c.y=pts[0].py;u.spr=c;
  unitL.addChild(c);units[sender].push(u);
}

function updUnits(dt){
  for(let s=0;s<2;s++){
    const tgt=1-s,ps=pl[tgt];
    for(let i=units[s].length-1;i>=0;i--){
      const u=units[s][i];if(!u.alive)continue;
      if(u.stT>0){u.stT-=dt;continue;}
      if(u.slT>0)u.slT-=dt;
      let sp=u.spd*dt;if(u.slT>0)sp*=(1-u.slA);
      // Speed boost (from Warlord War Cry etc)
      if(u._boostT>0){sp*=(1+u._boostA);u._boostT-=dt;}
      // Frost Troll: absorbed frost = permanent speed boost
      if(u._frostBoost)sp*=(1+u._frostBoost);
      u.dist+=sp;
      const pos=pAt(u.pts,u.dist);
      // Sprite direction mirroring: flip when moving left
      if(u._uSpr){
        const dx=pos.x-u._prevX;
        if(dx<-0.3)u._uSpr.scale.x=-Math.abs(u._sprScale);
        else if(dx>0.3)u._uSpr.scale.x=Math.abs(u._sprScale);
      }
      u.spr.x=pos.x;u.spr.y=pos.y;
      // Walk animation: cycle frames every 0.2s
      if(u._uFrames&&u._uSpr){
        u._walkT=(u._walkT||0)+dt;
        if(u._walkT>0.2){u._walkT-=0.2;
          const nf=u._uFrames.length;
          const ci=u._uFrames.indexOf(u._uSpr.texture);
          u._uSpr.texture=u._uFrames[(ci+1)%nf];
          // Preserve direction when swapping texture
          const dir=u._uSpr.scale.x<0?-1:1;
          u._uSpr.scale.set(dir*Math.abs(u._sprScale),Math.abs(u._sprScale));
        }
      }
      // Regen (trolls etc)
      if(u.regen)u.hp=Math.min(u.mhp,u.hp+u.regen*dt);
      // Stealth: alpha when not detected
      if(u.stealth)u.spr.alpha=0.35;

      // ── Boss walk animation ──
      if(u.isBoss&&u._bossWalkTex&&u._bossSpr){
        u._walkT=(u._walkT||0)+dt;
        if(u._actionAnim>0){
          u._actionAnim-=dt;
          if(u._bossActionTex&&u._bossActionTex.length){
            const phase=1-u._actionAnim/0.8;
            const fi=Math.min(u._bossActionTex.length-1,Math.floor(phase*u._bossActionTex.length));
            u._bossSpr.texture=u._bossActionTex[fi];
          }
        }else if(u._walkT>0.25){
          u._walkT-=0.25;
          const nf=u._bossWalkTex.length;
          const ci=u._bossWalkTex.indexOf(u._bossSpr.texture);
          u._bossSpr.texture=u._bossWalkTex[(ci+1)%nf];
        }
        // Boss direction: use dx from prevX (not yet updated)
        const bdx=pos.x-u._prevX;
        const bdir=bdx<-0.3?-1:bdx>0.3?1:(u._bossSpr.scale.x<0?-1:1);
        u._bossSpr.scale.set(bdir*Math.abs(u._bossScale),Math.abs(u._bossScale));
      }
      u._prevX=pos.x; // update prevX AFTER all direction checks
      // ── Boss ongoing mechanics (v3 final) ──
      if(u.isBoss&&u.alive&&u.mechanic){
        u._mechT=(u._mechT||0)+dt;
        const def=1-s;

        // 🗡️ Warlord: walking aura buffs friendlies, frightens enemies
        if(u.mechanic==='aura'){
          // Buff nearby friendlies: +20% speed, -15% damage taken
          for(const wu of units[s]){if(!wu.alive||wu.isBoss)continue;
            const dx=wu.spr.x-u.spr.x,dy=wu.spr.y-u.spr.y;
            if(Math.sqrt(dx*dx+dy*dy)<=3*T){wu._boostT=0.5;wu._boostA=0.2;wu._auraDR=0.15;}
          }
          // Frighten nearby ENEMY units: slow them 30% while in range
          for(const eu of units[def]){if(!eu.alive||eu.isBoss)continue;
            const dx=eu.spr.x-u.spr.x,dy=eu.spr.y-u.spr.y;
            if(Math.sqrt(dx*dx+dy*dy)<=3*T){eu.slT=Math.max(eu.slT,0.5);eu.slA=Math.max(eu.slA,.3);}
          }
        }

        // 🐍 Serpent Queen: spawn 2 runners every 5s
        if(u.mechanic==='spawn'&&u._mechT>=5){
          u._mechT-=5;
          for(let j=0;j<2;j++)setTimeout(()=>{if(!over&&u.alive)spawnU(s,'runner');},j*300);
          floatT(u.spr.x,u.spr.y-20,'🐍 spawn!',0x44cc44);u._actionAnim=0.8;
        }

        // 🐲 Elder Dragon: fire breath every 6s — damages nearest ENEMY UNIT within 3 tiles
        if(u.mechanic==='firebreath'&&u._mechT>=6){
          u._mechT-=6;
          let best=null,bd2=Infinity;
          for(const eu of units[def]){if(!eu.alive)continue;
            const dx=eu.spr.x-u.spr.x,dy=eu.spr.y-u.spr.y,d=Math.sqrt(dx*dx+dy*dy);
            if(d<=3*T&&d<bd2){bd2=d;best=eu;}
          }
          if(best){
            const fg=new PIXI.Graphics();fg.lineStyle(3,0xff6600,.8);
            fg.moveTo(u.spr.x,u.spr.y);fg.lineTo(best.spr.x,best.spr.y);
            fxL.addChild(fg);fx.push({s:fg,l:0,mx:.4,fn(e){e.s.alpha=1-e.l/e.mx;}});
            burstFX(best.spr.x,best.spr.y,T*0.8,0xff4400);
            // Deal 30 damage to the enemy unit
            best.hp-=30;floatT(best.spr.x,best.spr.y-10,'🔥-30',0xff6600);u._actionAnim=0.8;
            if(best.hp<=0){best.alive=0;const idx=units[def].indexOf(best);if(idx>=0)rmU(def,idx,false);}
          }
        }

        // 👻 Shadow Wraith: phase cycle (2s out, 4s visible) + revive dead allies
        if(u.mechanic==='phase'){
          u._phaseT=(u._phaseT||0)+dt;
          const cycle=6;
          const phase=u._phaseT%cycle;
          if(phase>=4){
            u._phased=true;u.spr.alpha=0.15;
            // While phased: try to revive 1 dead friendly per phase cycle
            if(!u._revived){u._revived=true;
              // 25% chance to revive a recently killed friendly
              if(Math.random()<0.25&&u._deadNearby){
                spawnU(s,'runner'); // simplified: spawn a runner as "revived" unit
                floatT(u.spr.x,u.spr.y-20,'👻 revive!',0xaa44ff);u._actionAnim=0.8;
              }
            }
          }else{
            u._phased=false;u.spr.alpha=1;u._revived=false;
            // Track if friendlies died nearby (for next phase)
            u._deadNearby=true;
          }
        }
      }
      const pct=Math.max(0,u.hp/u.mhp);
      const hbW=u._hbW||18; // bosses have wider HP bars
      u._hf.clear();u._hf.beginFill(u.isBoss?0xffcc00:pct>.5?0x55c888:pct>.25?0xee8833:0xe05555);
      u._hf.drawRect(-(hbW/2),u._hy,hbW*pct,u.isBoss?5:3);u._hf.endFill();
      if(pos.end){
        const cd=u.isBoss?BOSSES[pl[s].boss]?.cd||150:UN[u.type]?.cd||12;
        ps.hp-=cd;rmU(s,i,false);
        if(ps._cg){ps._cg.tint=0xff3333;setTimeout(()=>{if(ps._cg)ps._cg.tint=0xffffff;},200);}
        if(ps.hp<=0&&!over){over=true;
          const w=s+1,l=1-s;
          document.getElementById('goText').textContent='🏆 P'+w+' WINS! 🏆';
          document.getElementById('goSub').textContent='P'+(l+1)+' castle destroyed on wave '+wave;
          setTimeout(()=>document.getElementById('gameOver').classList.remove('hidden'),1500);
          toast('🏆 P'+w+' WINS! 🏆',5000);}
      }
    }
  }
}
function rmU(s,i,rew){
  const u=units[s][i];
  // Revive mechanic (revenants)
  if(rew&&u.revive&&u.revive>0){
    u.revive--;u.hp=Math.floor(u.mhp*0.3);
    floatT(u.spr.x,u.spr.y-20,'REVIVE!',0x66ff66);
    return; // don't remove
  }
  u.alive=0;
  if(rew){
    const def=1-s,ps=pl[def];
    if(u.isBoss){
      // Boss kill: escalating gold bonus + guaranteed card roll
      const bonus=100+ps.bossKills*50;
      ps.g+=bonus;ps.bossKills++;addXP(def,60);
      floatT(u.spr.x,u.spr.y-14,`+${bonus}g BOSS!`,0xffcc00);
      // Force bonus card draw even if no level-up
      setTimeout(()=>{if(!pl[def].luOn)trigLU(def);},500);
    }else{
      const d=UN[u.type];if(d){
        const goldMult=1-Math.min(0.8,pl[s].goldCut||0); // sender's goldCut reduces defender's reward
        const b=Math.max(1,Math.floor(d.bt*ps.bm*goldMult));ps.g+=b;addXP(def,d.xp);
        floatT(u.spr.x,u.spr.y-14,`+${b}g`,0xc8a84b);
      }
    }
  }
  if(u.spr)unitL.removeChild(u.spr);units[s].splice(i,1);
}

// ═══════════ TOWER AI ═══════════
function updTowers(dt){
  for(let p=0;p<2;p++){
    const en=1-p;
    const minY=(p===0?P1R:0)*T,maxY=(p===0?GR:P1R)*T;
    for(const tw of pl[p].tw){
      const st=tSt(p,tw),tx=GOX+(tw.x+.5)*T,ty=(tw.y+.5)*T;

      // ── Tower animation: cycle idle→draw→fire→reload per shot ──
      const aFrames=tw._animFrames||null;
      if(tw._animSpr&&aFrames&&aFrames.length>=2){
        if(tw._animT!=null&&tw._animT>=0){
          tw._animT-=dt;
          const cd=1/st.rt;
          const phase=tw._animT/cd;
          const nf=aFrames.length;
          let frame;
          if(nf>=4){
            if(phase>.75)frame=1;else if(phase>.5)frame=2;else if(phase>.25)frame=3;else frame=0;
          }else if(nf>=3){
            if(phase>.66)frame=1;else if(phase>.33)frame=2;else frame=0;
          }else{
            frame=phase>.5?1:0;
          }
          tw._animSpr.texture=aFrames[frame];
          if(tw._sprW){tw._animSpr.width=tw._sprW;tw._animSpr.height=tw._sprH;}
        }else{
          tw._animSpr.texture=aFrames[0];
          if(tw._sprW){tw._animSpr.width=tw._sprW;tw._animSpr.height=tw._sprH;}
        }
      }

      if(st.frz&&tw.lv>=3){tw.fcd-=dt;if(tw.fcd<=0){tw.fcd=12;
        const rP=st.rn*T;for(const u of units[en]){if(!u.alive)continue;
          const dx=u.spr.x-tx,dy=u.spr.y-ty;if(Math.sqrt(dx*dx+dy*dy)<=rP){
            if(u._slowImmune){// Frost Troll absorbs freeze too
              if(u._frostBoost<0.4){u._frostBoost=Math.min(0.4,u._frostBoost+0.08);
                floatT(u.spr.x,u.spr.y-20,'🧊 +SPD!',0x55aaff);}
            }else{u.stT=Math.max(u.stT,2);}
          }}
        burstFX(tx,ty,rP,0x55aaff);}}
      tw.cd-=dt;if(tw.cd>0)continue;
      const rP=st.rn*T;let best=null,bd=-1;
      for(const u of units[en]){if(!u.alive)continue;
        if(u.air&&!st.air)continue;
        // Immunity: sender's upgrade makes unit ignore low-level towers
        const imm=pl[en].immunity[u.type]||0;
        if(imm&&tw.lv<imm)continue;
        // Stealth check: only magic tower (detect) and sth-capable towers can see stealth
        if(u.stealth&&!st.detect&&!st.sth)continue;
        // Wraith: untargetable while phased out
        if(u._phased)continue;
        if(u.spr.y<minY||u.spr.y>maxY)continue;
        const dx=u.spr.x-tx,dy=u.spr.y-ty;
        if(Math.sqrt(dx*dx+dy*dy)<=rP&&u.dist>bd){bd=u.dist;best=u;}}
      if(!best)continue;tw.cd=1/st.rt;
      // Trigger animation cycle for any tower type
      tw._animT=tw.cd;
      if(st.sl>0&&!best.air){
        // 🧊 Frost Troll: immune to slow, ABSORBS frost for speed
        if(best._slowImmune){
          if(best._frostBoost<0.4){best._frostBoost=Math.min(0.4,best._frostBoost+0.08);
            floatT(best.spr.x,best.spr.y-20,'🧊 +SPD!',0x55aaff);}
        }else{best.slT=2;best.slA=Math.min(.8,st.sl);}
      }
      projs.push({x:tx,y:ty,tgt:best,snd:en,sp:500,dm:st.dm,dt:st.dt,ao:st.ao*T,st:st.st,cl:TW[tw.type].cl,exec:st.exec,spr:null});
    }
  }
}
function updProjs(dt){
  for(let i=projs.length-1;i>=0;i--){
    const pr=projs[i];
    if(!pr.tgt||!pr.tgt.alive){if(pr.spr)projL.removeChild(pr.spr);projs.splice(i,1);continue;}
    const dx=pr.tgt.spr.x-pr.x,dy=pr.tgt.spr.y-pr.y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<=pr.sp*dt+5){
      if(pr.ao>0){for(const u of units[pr.snd]){if(!u.alive)continue;
          const ddx=u.spr.x-pr.tgt.spr.x,ddy=u.spr.y-pr.tgt.spr.y;
          if(Math.sqrt(ddx*ddx+ddy*ddy)<=pr.ao){
            dmgU(pr.snd,u,pr.dm*(u===pr.tgt?1:.6),pr.dt,pr.exec);
            if(pr.st>0&&u===pr.tgt)u.stT=Math.max(u.stT,pr.st);}}
        burstFX(pr.tgt.spr.x,pr.tgt.spr.y,pr.ao,pr.cl);
      }else{dmgU(pr.snd,pr.tgt,pr.dm,pr.dt,pr.exec);if(pr.st>0)pr.tgt.stT=Math.max(pr.tgt.stT,pr.st);}
      if(pr.spr)projL.removeChild(pr.spr);projs.splice(i,1);
    }else{pr.x+=dx/dist*pr.sp*dt;pr.y+=dy/dist*pr.sp*dt;
      if(!pr.spr){const g=new PIXI.Graphics();g.beginFill(pr.cl,.9);g.drawCircle(0,0,2.5);g.endFill();pr.spr=g;projL.addChild(g);}
      pr.spr.x=pr.x;pr.spr.y=pr.y;}
  }
}
function dmgU(snd,u,dm,dt,exec){
  if(!u.alive)return;
  if(u._phased)return; // Wraith: no damage while phased
  if(u.shld>0&&dt==='p'){u.shld--;return;}
  const resist=dt==='p'?(u.pr||0):(u.mr||0);
  const capped=Math.min(resist,0.95);
  let finalDm=dm*(1-capped);
  // Warlord aura damage reduction
  if(u._auraDR)finalDm*=(1-u._auraDR);
  // Executioner: bonus damage to low HP targets
  if(exec&&u.hp/u.mhp<0.3)finalDm*=exec;
  u.hp-=finalDm;
  if(u.hp<=0){u.alive=0;const i=units[snd].indexOf(u);if(i>=0)rmU(snd,i,true);}
}

// ═══════════ XP / LEVEL-UP ═══════════
function addXP(p,a){const s=pl[p];s.xp+=a;while(s.xp>=xpNeed(s.lv+1)){s.lv++;trigLU(p);}}
function trigLU(p){const s=pl[p];if(s.luOn)return;s.luOn=1;s.luT=LUT;s.luC=drawCards(p);showLU(p);}
function drawCards(p){
  const s=pl[p],rates=(s.lv<=3?[90,10,0]:s.lv<=5?[70,25,5]:s.lv<=7?[50,35,15]:[30,40,30]),drawn=[];
  const av=CARDS.filter(c=>{
    if(c.ty==='gate'&&s.gates[c.tw]>=c.lv)return false;
    if(c.sub==='wb'&&s.tithe)return false;
    if(c.sub==='inc'&&s.merch>=5)return false;
    if(c.sub==='bty'&&s.bm>=2)return false;
    if(c.ty==='unlock'&&s.unlocked[c.unit])return false;
    if(c.ty==='aug'&&s.augs.includes(c.aug))return false;
    if(c.ty==='immunity'&&s.immunity[c.unit]>=c.minTwLv)return false;
    if(c.ty==='goldcut'&&s.goldCut>=0.8)return false;
    return true;
  });
  for(let i=0;i<3;i++){const roll=Math.random()*100;
    let r=roll<rates[0]?0:roll<rates[0]+rates[1]?1:2;let pool=av.filter(c=>c.r===r&&!drawn.includes(c));
    if(!pool.length)pool=av.filter(c=>!drawn.includes(c));
    if(pool.length)drawn.push(pool[Math.floor(Math.random()*pool.length)]);}
  return drawn;
}
function showLU(p){
  const s=pl[p],pan=document.getElementById('lu'+p),row=document.getElementById('cr'+p);
  row.innerHTML='';
  for(let ci=0;ci<s.luC.length;ci++){const c=s.luC[ci];
    const el=document.createElement('div');el.className='crd';el.setAttribute('data-idx',ci);el.setAttribute('data-cost',c.cost);
    el.innerHTML=`<div class="rn${c.r===2?' epic':c.r?` rare`:''}">${c.r===2?'🟣 EPIC':c.r?'🟦 RARE':'⬜ COMMON'}</div><div class="cn">${c.nm}</div><div class="dd">${c.ds}</div><div class="cp">${c.cost?c.cost+'g':'FREE'}</div>`;
    el.onclick=()=>pickCard(p,c);row.appendChild(el);}
  refreshLUCards(p);
  pan.classList.add('on');
}
function refreshLUCards(p){
  const s=pl[p],row=document.getElementById('cr'+p);if(!row)return;
  row.querySelectorAll('.crd').forEach(el=>{
    const cost=parseInt(el.getAttribute('data-cost'))||0;
    const ok=s.g>=cost;
    el.classList.toggle('no',!ok);
    const cp=el.querySelector('.cp');
    if(cp)cp.className='cp '+(cost?ok?'g':'e':'f');
  });
}
function pickCard(p,c){
  const s=pl[p];if(s.g<c.cost)return;s.g-=c.cost;
  switch(c.ty){
    case'gate':s.gates[c.tw]=Math.max(s.gates[c.tw],c.lv);toast(`${TW[c.tw].ic} Lv${c.lv}!`);break;
    case'tide':case'surge':s.wp+=(c.wp||0);toast(`⬆ Wave +${c.wp}`);break;
    case'eco':if(c.sub==='inc'){s.inc++;s.merch++;toast(`💰 ${s.inc}g/s`);}
      else if(c.sub==='bty'){s.bm=Math.min(2,s.bm*1.25);toast(`⚔ ×${s.bm.toFixed(2)}`);}
      else if(c.sub==='wb'){s.wb+=25;s.tithe=1;toast(`💰 +${s.wb}g/wave`);}break;
    case'fort':s.hp=Math.min(HP,s.hp+c.heal);toast(`🏰 +${c.heal}`);break;
    case'unlock':s.unlocked[c.unit]=1;toast(`🆕 ${UN[c.unit]?c.unit:'?'} unlocked!`);break;
    case'aug':s.augs.push(c.aug);toast(`✨ ${c.nm}`);break;
    case'buff':if(c.buff){const b=c.buff;
      if(b.type==='all'){
        // Apply to all unit types
        for(const ut of Object.keys(UN)){
          if(!s.buffs[ut])s.buffs[ut]={hp:1,sp:1};
          if(b.hp)s.buffs[ut].hp*=b.hp;if(b.sp)s.buffs[ut].sp*=b.sp;
        }
        toast(`⬆ ALL units buffed!`);
      }else{
        if(!s.buffs[b.type])s.buffs[b.type]={hp:1,sp:1};
        if(b.hp)s.buffs[b.type].hp*=(typeof b.hp==='number'&&b.hp>5?b.hp:1);
        if(b.hp&&b.hp<=5)s.buffs[b.type].hp=1;
        if(typeof b.hp==='number'&&b.hp<=5)s.buffs[b.type].hpAdd=(s.buffs[b.type].hpAdd||0)+b.hp;
        if(b.sp)s.buffs[b.type].sp*=b.sp;
        toast(`⬆ ${b.type} buffed!`);
      }}break;
    case'immunity':s.immunity[c.unit]=Math.max(s.immunity[c.unit]||0,c.minTwLv);
      toast(`🛡️ ${c.unit} ignores Lv<${c.minTwLv} towers!`);break;
    case'goldcut':s.goldCut=Math.min(0.8,s.goldCut+(c.cut||0));
      toast(`💀 Enemy gold -${Math.round(s.goldCut*100)}%!`);break;
  }closeLU(p);
}
function closeLU(p){pl[p].luOn=0;pl[p].luC=[];document.getElementById('lu'+p).classList.remove('on');}
function updLU(dt){
  for(let p=0;p<2;p++){const s=pl[p];if(!s.luOn)continue;s.luT-=dt;
    const te=document.querySelector(`#tr${p} .tv`),ri=document.querySelector(`#tr${p} .ring`);
    if(te)te.textContent=Math.ceil(Math.max(0,s.luT));
    if(ri)ri.style.strokeDashoffset=75.4*(1-Math.max(0,s.luT)/LUT);
    refreshLUCards(p);if(s.luT<=0)closeLU(p);}
}

// ═══════════ ECONOMY ═══════════
function updEco(dt){
  for(let p=0;p<2;p++){
    const s=pl[p];
    s.g+=s.inc*dt;
    // Interest: 5% every 20s on up to 300g (if no spending for 20s)
    s.intT=(s.intT||0)+dt;
    if(s.intT>=20){s.intT-=20;
      const base=Math.min(s.g,300);const interest=Math.max(1,Math.floor(base*0.05));
      s.g+=interest;floatT(GOX+GC*T/2,(p===0?VH-40:40),`+${interest}g interest`,0x88cc88);
    }
  }
}

// ═══════════ WAVES ═══════════
function updWaves(dt){
  if(over)return;
  wt-=dt;
  if(wt<=0){
    for(let p=0;p<2;p++)pl[p].g+=pl[p].wb;
    spawnWave(wave);wave++;wt=WINT;
    const isBoss=BOSS_WAVES.has(wave);
    toast(isBoss?`⚡ BOSS WAVE ${wave}! ⚡`:`Wave ${wave}!`,isBoss?2500:1500);
  }
}

// ═══════════ FX ═══════════
function floatT(x,y,s,col){
  const t=new PIXI.Text(s,{fontFamily:'Cinzel',fontSize:9,fontWeight:'700',fill:col});
  t.anchor.set(.5);t.x=x;t.y=y;
  if(y<P1R*T)t.rotation=Math.PI; // readable for P2
  fxL.addChild(t);
  fx.push({s:t,l:0,mx:.6,fn(e,d){e.s.y+=(y<P1R*T?40:-40)*d;e.s.alpha=1-e.l/e.mx;}});
}
function burstFX(x,y,r,col){
  const g=new PIXI.Graphics();g.beginFill(col,.15);g.drawCircle(0,0,r);g.endFill();
  g.x=x;g.y=y;fxL.addChild(g);fx.push({s:g,l:0,mx:.2,fn(e){e.s.alpha=1-e.l/e.mx;e.s.scale.set(1+e.l*2);}});
}
function updFX(dt){for(let i=fx.length-1;i>=0;i--){const e=fx[i];e.l+=dt;e.fn(e,dt);
  if(e.l>=e.mx){fxL.removeChild(e.s);fx.splice(i,1);}}}

function toast(s,dur=1500){const t=document.getElementById('toast');t.textContent=s;t.classList.add('on');
  clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('on'),dur);}

// ═══════════ MAIN LOOP ═══════════
function loop(delta){
  if(over)return;
  const dt=delta/60;time+=dt;
  updWaves(dt);updEco(dt);updTowers(dt);updProjs(dt);updUnits(dt);updLU(dt);updFX(dt);updHUD();
  for(let rp=0;rp<2;rp++){if(radial[rp]){radialT[rp]-=dt;if(radialT[rp]<=0)killRadial(rp);}}
  // Game ends only when a castle reaches 0 HP (handled in updUnits)
}

// ═══════════ BOOT ═══════════
loadAllSprites().catch(e=>console.warn('Sprite load error (game starts with fallbacks):',e)).finally(()=>init());
