/* 多伦多炮王 (Snapfire) - simulation core.
   Runs in the browser (window.SnapSim) and in Node (module.exports) so the
   ballistics and outcome rules can be verified headlessly. No rendering here. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SnapSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var W = 1800, H = 720, GROUND = 690;
  var GRAV = 1000;          // px/s^2
  var BALL_R = 9;           // cannonball radius
  var SPLASH = 46;          // splash radius around the impact point
  var POWER_MIN = 250, POWER_MAX = 1500;
  var START_AMMO = 10, START_YEAR = 2016;
  var FIELD_SIZE = 5;       // heroes kept on the field
  var HERO_H = 68;          // world height of a standing hero
  var MUZZLE = { x: 150, y: 290 };   // cannon pivot on the CN Tower pod
  var BARREL = 44;          // launch offset along the shot direction
  var SIM_DT = 1 / 240, MAX_T = 12, PATH_EVERY = 4;

  /* ---------- roster ---------- */
  var HEROES = [
    { key: "cm",      name: "水晶室女",   g: "f", asp: 0.475 },
    { key: "lina",    name: "莉娜",       g: "f", asp: 0.405 },
    { key: "wr",      name: "风行者",     g: "f", asp: 0.53 },
    { key: "mirana",  name: "米拉娜",     g: "f", asp: 0.55 },
    { key: "luna",    name: "露娜",       g: "f", asp: 0.54 },
    { key: "drow",    name: "卓尔游侠",   g: "f", asp: 0.56 },
    { key: "qop",     name: "痛苦女王",   g: "f", asp: 0.55 },
    { key: "pa",      name: "幻影刺客",   g: "f", asp: 0.58 },
    { key: "ta",      name: "圣堂刺客",   g: "f", asp: 0.56 },
    { key: "venge",   name: "复仇之魂",   g: "f", asp: 0.615 },
    { key: "lc",      name: "军团指挥官", g: "f", asp: 0.70 },
    { key: "marci",   name: "玛西",       g: "f", asp: 0.515 },
    { key: "dawn",    name: "破晓辰星",   g: "f", asp: 0.645 },
    { key: "muerta",  name: "天涯墨客",   g: "f", asp: 0.62 },
    { key: "willow",  name: "黑暗柳树",   g: "f", asp: 0.655 },
    { key: "ww",      name: "寒冬飞龙",   g: "f", asp: 0.795 },
    { key: "axe",     name: "斧王",       g: "m", asp: 0.65 },
    { key: "pudge",   name: "帕吉",       g: "m", asp: 0.845 },
    { key: "invoker", name: "祈求者",     g: "m", asp: 0.51 },
    { key: "am",      name: "敌法师",     g: "m", asp: 0.725 },
    { key: "jugg",    name: "主宰",       g: "m", asp: 0.595 },
    { key: "kunkka",  name: "昆卡",       g: "m", asp: 0.555 },
    { key: "zeus",    name: "宙斯",       g: "m", asp: 0.45 },
    { key: "brew",    name: "酒仙",       g: "m", asp: 0.66 }
  ];
  var FEMALE_P = 0.67;

  /* ---------- Toronto skyline layout ----------
     ax: anchor x as fraction of width; ay: pixels the hero sinks below the
     sprite bounding-box top so it does not float on pointy roofs. */
  var BUILDINGS = [
    { key: "rogers",   x: 230,  w: 254, h: 130, ax: 0.50, ay: 6,  label: "罗渣士中心" },
    { key: "cityhall", x: 570,  w: 202, h: 250, ax: 0.25, ay: 4,  label: "市政厅" },
    { key: "condo",    x: 795,  w: 117, h: 360, ax: 0.50, ay: 2,  label: "湖景公寓" },
    { key: "brick",    x: 940,  w: 119, h: 220, ax: 0.50, ay: 4,  label: "老砖楼" },
    { key: "ocad",     x: 1090, w: 160, h: 200, ax: 0.50, ay: 4,  label: "OCAD" },
    { key: "flatiron", x: 1320, w: 85,  h: 245, ax: 0.50, ay: 14, label: "熨斗楼" },
    { key: "rom",      x: 1430, w: 194, h: 150, ax: 0.38, ay: 14, label: "ROM 水晶" },
    { key: "sign",     x: 1630, w: 168, h: 68,  ax: 0.50, ay: 6,  label: "TORONTO 招牌" }
  ];
  var GAP_XS = [205, 530, 1285];
  var TOWER_RECT = { x: 90, y: 310, w: 76, h: GROUND - 310 };

  var ANCHORS = (function () {
    var out = [];
    var i;
    for (i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      out.push({ x: b.x + b.w * b.ax, y: GROUND - b.h + b.ay, on: b.key });
    }
    for (i = 0; i < GAP_XS.length; i++) {
      out.push({ x: GAP_XS[i], y: GROUND, on: "ground" });
    }
    return out;
  })();

  var SOLIDS = (function () {
    var out = [];
    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      out.push({ x: b.x, y: GROUND - b.h, w: b.w, h: b.h });
    }
    out.push(TOWER_RECT);
    return out;
  })();

  /* ---------- helpers ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function distToRect(px, py, r) {
    var dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    var dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function heroRect(u) {
    return { x: u.x0, y: u.y0, w: u.w, h: u.h };
  }

  var CN_DIG = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  function cnNum(n) {
    if (n <= 10) return n === 10 ? "十" : CN_DIG[n];
    if (n < 20) return "十" + CN_DIG[n % 10];
    var tens = (n / 10) | 0, ones = n % 10;
    return CN_DIG[tens] + "十" + (ones ? CN_DIG[ones] : "");
  }

  /* ---------- state ---------- */
  function createGame(seed, opts) {
    var state = {
      seed: seed == null ? (Math.random() * 1e9) | 0 : seed,
      ammo: START_AMMO,
      shot: 0,
      over: false,
      endReason: null,   // "bust" | "dry"
      endHero: null,
      inFlight: false,
      field: [],         // heroes currently standing in Toronto
      collections: [],   // {gen, shot, year, key, name, repeat}
      log: [],           // per shot: {shot, year, result, gens, maleKey}
      muzzle: (opts && opts.muzzle) || { x: MUZZLE.x, y: MUZZLE.y },
      nextUnitId: 1
    };
    state.rng = mulberry32(state.seed);
    fillField(state);
    return state;
  }

  function onField(state, key) {
    for (var i = 0; i < state.field.length; i++) {
      if (state.field[i].key === key) return true;
    }
    return false;
  }

  function fillField(state) {
    var spawns = [];
    var guard = 0;
    while (state.field.length < FIELD_SIZE && guard++ < 60) {
      var used = {};
      var i;
      for (i = 0; i < state.field.length; i++) used[state.field[i].anchor] = true;
      var free = [];
      for (i = 0; i < ANCHORS.length; i++) if (!used[i]) free.push(i);
      if (!free.length) break;
      var ai = free[(state.rng() * free.length) | 0];
      var g = state.rng() < FEMALE_P ? "f" : "m";
      var pool = [];
      for (i = 0; i < HEROES.length; i++) {
        if (HEROES[i].g === g && !onField(state, HEROES[i].key)) pool.push(HEROES[i]);
      }
      if (!pool.length) {
        for (i = 0; i < HEROES.length; i++) if (HEROES[i].g === g) pool.push(HEROES[i]);
      }
      var hero = pool[(state.rng() * pool.length) | 0];
      var a = ANCHORS[ai];
      var w = Math.round(hero.asp * HERO_H);
      var u = {
        id: state.nextUnitId++,
        key: hero.key, name: hero.name, g: hero.g,
        anchor: ai,
        x0: a.x - w / 2, y0: a.y - HERO_H, w: w, h: HERO_H,
        phase: state.rng() * Math.PI * 2
      };
      state.field.push(u);
      spawns.push(u);
    }
    return spawns;
  }

  /* ---------- ballistics (pure: used for both preview and the real shot) ---------- */
  function computeShot(state, vx, vy) {
    var p = Math.sqrt(vx * vx + vy * vy) || 1;
    var ox = state.muzzle.x + (vx / p) * BARREL;
    var oy = state.muzzle.y + (vy / p) * BARREL;
    var x = ox, y = oy, t = 0, step = 0;
    var path = [{ x: x, y: y, t: 0 }];
    var impact = null, directHit = null;
    var i, u;

    while (t < MAX_T) {
      vy += GRAV * SIM_DT;
      x += vx * SIM_DT;
      y += vy * SIM_DT;
      t += SIM_DT;
      step++;
      if (step % PATH_EVERY === 0) path.push({ x: x, y: y, t: t });

      if (x < -60 || x > W + 80) break;                    // gone into the lake / off the map
      if (y + BALL_R >= GROUND) {                          // street level
        impact = { x: x, y: GROUND - BALL_R };
        break;
      }
      var hit = false;
      for (i = 0; i < state.field.length; i++) {           // heroes first: direct hits count
        u = state.field[i];
        if (distToRect(x, y, heroRect(u)) <= BALL_R) {
          impact = { x: x, y: y };
          directHit = u;
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (i = 0; i < SOLIDS.length; i++) {
          if (distToRect(x, y, SOLIDS[i]) <= BALL_R) {
            impact = { x: x, y: y };
            hit = true;
            break;
          }
        }
      }
      if (hit) break;
    }
    if (impact) path.push({ x: impact.x, y: impact.y, t: t });

    var males = [], females = [];
    if (impact) {
      for (i = 0; i < state.field.length; i++) {
        u = state.field[i];
        if (distToRect(impact.x, impact.y, heroRect(u)) <= SPLASH) {
          (u.g === "m" ? males : females).push(u);
        }
      }
    }
    return {
      vx: vx, vy: vy, ox: ox, oy: oy,
      path: path, impact: impact, flightT: t,
      directHit: directHit, males: males, females: females
    };
  }

  /* ---------- firing ---------- */
  function fire(state, vx, vy) {
    if (state.over || state.inFlight || state.ammo <= 0) return null;
    var s = computeShot(state, vx, vy);
    state.ammo--;
    state.shot++;
    state.inFlight = true;
    s.shotIndex = state.shot;
    s.year = START_YEAR + state.shot - 1;
    return s;
  }

  function resolve(state, s) {
    state.inFlight = false;
    var events = [];
    var entry = { shot: s.shotIndex, year: s.year, result: "miss", gens: [] };
    var i;

    if (s.males.length) {                       // any male in the blast: instant bust
      var m = s.males[0];
      state.over = true;
      state.endReason = "bust";
      state.endHero = { key: m.key, name: m.name };
      entry.result = "male";
      entry.maleKey = m.key;
      entry.maleName = m.name;
      events.push({ type: "male", unit: m });
      events.push({ type: "end", reason: "bust" });
    } else if (s.females.length) {
      entry.result = "collect";
      var got = s.females.slice().sort(function (a, b) { return a.x0 - b.x0; });
      for (i = 0; i < got.length; i++) {
        var u = got[i];
        var repeat = false;
        for (var j = 0; j < state.collections.length; j++) {
          if (state.collections[j].key === u.key) { repeat = true; break; }
        }
        var col = {
          gen: state.collections.length + 1,
          shot: s.shotIndex, year: s.year,
          key: u.key, name: u.name, repeat: repeat
        };
        state.collections.push(col);
        state.ammo++;
        entry.gens.push(col.gen);
        var fi = state.field.indexOf(u);
        if (fi >= 0) state.field.splice(fi, 1);
        events.push({ type: "collect", col: col, unit: u });
      }
    } else {
      entry.result = s.impact ? "miss" : "lost";
    }
    state.log.push(entry);

    if (!state.over) {
      var sp = fillField(state);
      for (i = 0; i < sp.length; i++) events.push({ type: "spawn", unit: sp[i] });
      if (state.ammo <= 0) {
        state.over = true;
        state.endReason = "dry";
        events.push({ type: "end", reason: "dry" });
      }
    }
    return events;
  }

  return {
    W: W, H: H, GROUND: GROUND, GRAV: GRAV,
    BALL_R: BALL_R, SPLASH: SPLASH,
    POWER_MIN: POWER_MIN, POWER_MAX: POWER_MAX,
    START_AMMO: START_AMMO, START_YEAR: START_YEAR,
    HERO_H: HERO_H, MUZZLE: MUZZLE, BARREL: BARREL,
    HEROES: HEROES, BUILDINGS: BUILDINGS, GAP_XS: GAP_XS,
    ANCHORS: ANCHORS, SOLIDS: SOLIDS, TOWER_RECT: TOWER_RECT,
    cnNum: cnNum,
    createGame: createGame,
    computeShot: computeShot,
    fire: fire,
    resolve: resolve
  };
});
