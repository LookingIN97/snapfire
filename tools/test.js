/* Headless regression for game.js: ballistics determinism, ammo bookkeeping,
   and the three outcome branches (collect / male bust / dry). */
"use strict";
var S = require("../game.js");
var failures = 0;

function ok(cond, msg) {
  if (cond) console.log("  ok  " + msg);
  else { failures++; console.error("FAIL  " + msg); }
}

/* find a velocity whose splash covers the given unit and matches want(shot) */
function aimAt(state, unit, want) {
  for (var p = S.POWER_MIN + 50; p <= S.POWER_MAX; p += 25) {
    for (var deg = -20; deg <= 80; deg += 1) {
      var a = deg * Math.PI / 180;
      var vx = Math.cos(a) * p, vy = -Math.sin(a) * p;
      var s = S.computeShot(state, vx, vy);
      if (want(s, unit)) return { vx: vx, vy: vy, s: s };
    }
  }
  return null;
}

function hitsUnit(s, unit) {
  for (var i = 0; i < s.females.length; i++) if (s.females[i].id === unit.id) return s.males.length === 0;
  for (i = 0; i < s.males.length; i++) if (s.males[i].id === unit.id) return true;
  return false;
}

function missAll(s) { return s.impact && !s.females.length && !s.males.length; }

/* 1. determinism: preview == fire for the same velocity */
(function () {
  console.log("determinism");
  var st = S.createGame(7);
  var a = S.computeShot(st, 800, -600);
  var b = S.computeShot(st, 800, -600);
  ok(a.impact && b.impact && a.impact.x === b.impact.x && a.impact.y === b.impact.y,
    "same velocity, same impact point");
  var f = S.fire(st, 800, -600);
  ok(f.impact.x === a.impact.x && f.impact.y === a.impact.y, "fire matches preview");
  ok(st.ammo === S.START_AMMO - 1 && st.shot === 1, "ammo/shot bookkeeping after fire");
})();

/* 2. collect branch: ammo refund, gen counter, banner data, field refill */
(function () {
  console.log("collect branch");
  var st = S.createGame(11);
  var girl = null;
  for (var i = 0; i < st.field.length; i++) if (st.field[i].g === "f") { girl = st.field[i]; break; }
  ok(!!girl, "female on the field");
  var aim = aimAt(st, girl, hitsUnit);
  ok(!!aim, "found a firing solution onto her");
  var s = S.fire(st, aim.vx, aim.vy);
  var ammoAfterFire = st.ammo;
  var evs = S.resolve(st, s);
  var collected = evs.filter(function (e) { return e.type === "collect"; });
  ok(collected.length >= 1, "collect event emitted");
  ok(st.collections.length === collected.length, "collections recorded");
  ok(st.collections[0].gen === 1 && st.collections[0].year === S.START_YEAR, "1代目 in 2016");
  ok(st.ammo === ammoAfterFire + collected.length, "one ammo back per girl");
  ok(st.field.length === 5, "field refilled to 5");
  ok(!st.over, "game continues");
  var log = st.log[0];
  ok(log.result === "collect" && log.gens.length === collected.length, "log entry consistent");
})();

/* 3. male branch: instant bust even when females share the splash */
(function () {
  console.log("male bust branch");
  var st = null, man = null, aim = null;
  for (var seed = 1; seed < 200 && !aim; seed++) {
    st = S.createGame(seed);
    for (var i = 0; i < st.field.length; i++) {
      if (st.field[i].g === "m") {
        man = st.field[i];
        aim = aimAt(st, man, hitsUnit);
        if (aim) break;
      }
    }
  }
  ok(!!aim, "found a male target with a firing solution (seed scan)");
  var s = S.fire(st, aim.vx, aim.vy);
  S.resolve(st, s);
  ok(st.over && st.endReason === "bust", "game over: bust");
  ok(st.endHero && st.endHero.key === man.key, "bust hero recorded: " + (st.endHero && st.endHero.name));
  ok(st.log[st.log.length - 1].result === "male", "log marks male hit");
})();

/* 4. dry branch: waste all shots into the lake */
(function () {
  console.log("dry branch");
  var st = S.createGame(3);
  var n = 0;
  while (!st.over && n < 50) {
    var found = null;
    for (var p = S.POWER_MAX; p >= S.POWER_MIN && !found; p -= 40) {
      var s0 = S.computeShot(st, p, -p * 0.9);
      if (!s0.females.length && !s0.males.length) found = { vx: p, vy: -p * 0.9 };
    }
    ok(!!found, "shot " + (n + 1) + ": found a harmless lob");
    var s = S.fire(st, found.vx, found.vy);
    S.resolve(st, s);
    n++;
  }
  ok(st.over && st.endReason === "dry", "game over: dry after " + n + " shots");
  ok(n === S.START_AMMO, "exactly " + S.START_AMMO + " wasted shots");
  ok(st.log.length === S.START_AMMO, "log has one entry per shot");
  var lastYear = st.log[st.log.length - 1].year;
  ok(lastYear === S.START_YEAR + S.START_AMMO - 1, "timeline ends at " + lastYear);
})();

/* 5. repeat collection flag + cnNum */
(function () {
  console.log("misc");
  ok(S.cnNum(1) === "一" && S.cnNum(10) === "十" && S.cnNum(14) === "十四" && S.cnNum(23) === "二十三", "chinese numerals");
  var st = S.createGame(5);
  // force two collections of the same hero key
  st.collections.push({ gen: 1, shot: 1, year: 2016, key: "lina", name: "莉娜", repeat: false });
  var girl = null;
  for (var i = 0; i < st.field.length; i++) if (st.field[i].g === "f") { girl = st.field[i]; break; }
  girl.key = "lina"; girl.name = "莉娜";
  var aim = aimAt(st, girl, hitsUnit);
  if (aim) {
    var s = S.fire(st, aim.vx, aim.vy);
    S.resolve(st, s);
    var last = st.collections[st.collections.length - 1];
    ok(last.key !== "lina" || last.repeat === true, "repeat flag set on double lina");
  } else {
    console.log("  (skip repeat check: no solution)");
  }
})();

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures ? 1 : 0);
