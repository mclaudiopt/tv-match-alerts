'use strict';
// Per-club alert overrides: a club with goal=false stays silent, others inherit the global alerts.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };
var stage = 0, sent = [];
function emitter() {
  var h = {};
  return { on: function (e, f) { (h[e] = h[e] || []).push(f); return this; }, emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {}, statusCode: 200 };
}
function respond(cb, code, text) {
  var r = emitter(); r.statusCode = code;
  setImmediate(function () { r.emit('data', text); r.emit('end'); });
  cb(r); return r;
}
function ev(id, team, name, home, away, details) {
  return { id: id, date: new Date().toISOString(),
    status: { displayClock: "55'", type: { state: 'in', description: 'Second Half' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '2250', displayName: 'Sporting', shortDisplayName: 'Sporting' }, score: String(home) },
      { homeAway: 'away', team: { id: '2251', displayName: 'Porto', shortDisplayName: 'Porto' }, score: String(away) }
    ], details: details || [] }] };
}
function serve(opt, cb) {
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) { return respond(cb, 200, JSON.stringify({ keyEvents: [] })); }
    var m = /\/sports\/(.+?)\/scoreboard/.exec(opt.path), key = m ? m[1] : '';
    if (key === 'soccer/por.taca.portugal') { return respond(cb, 200, JSON.stringify({ events: [] })); }
    if (key !== 'soccer/por.1') { return respond(cb, 200, JSON.stringify({ events: [] })); }
    var sg = [[0, 0], [1, 0]][Math.min(stage, 1)];
    var details = stage > 0 ? [{ type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "70'" },
      team: { id: '2250' }, athletesInvolved: [{ displayName: 'Gyokeres' }] }] : [];
    var e1 = ev('e1', '2250', 'Sporting', sg[0], sg[1], details);
    var bn = [[0, 0], [1, 0]][Math.min(stage, 1)];
    var bd = stage > 0 ? [{ type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "22'" },
      team: { id: '1929' }, athletesInvolved: [{ displayName: 'Di Maria' }] }] : [];
    var e2 = { id: 'e2', date: new Date().toISOString(),
      status: { displayClock: "30'", type: { state: 'in', description: 'First Half' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '1929', displayName: 'Benfica', shortDisplayName: 'Benfica' }, score: String(bn[0]) },
        { homeAway: 'away', team: { id: '2252', displayName: 'Braga', shortDisplayName: 'Braga' }, score: '0' }
      ], details: bd }] };
    return respond(cb, 200, JSON.stringify({ events: [e1, e2] }));
  }
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron','golo'] } }));
  }
  return respond(cb, 500, '');
}
https.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.get = https.get;
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};
var factory = require('../index.js');
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'pt',
  football: {
    provider: 'espn',
    clubs: [
      { id: '2250', name: 'Sporting', league: 'por.1', comps: ['por.1'], news: false,
        alerts: { goal: false, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true } },
      { id: '1929', name: 'Benfica', league: 'por.1', comps: ['por.1'], news: false }
    ],
    alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
    goalSeconds: 30, otherSeconds: 10, sound: false, mode: 'overlay',
    nextGame: { enabled: false, minutes: 30 }
  }
};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function post(sub, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (p) { resolve(p ? JSON.parse(p) : null); } };
    var req = { method: 'POST', on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body)); f(); }); }
    }, destroy: function () {} };
    shard.route(req, res, sub);
  });
}
function get(sub) {
  return new Promise(function (resolve) {
    shard.route({ method: 'GET', on: function () {} },
      { writeHead: function () {}, end: function (p) { resolve(JSON.parse(p)); } }, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 200); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start(); await wait(150);
  await post('poll', { module: 'sport' }); await wait(400);
  assert(sent.length === 0, 'baseline only');
  var st = await get('state');
  assert(st.config.football.clubs[0].alerts.goal === false, 'per-club override is exposed in the config');
  assert(!st.config.football.clubs[1].alerts, 'a club without overrides inherits the global alerts');

  offset += 70000; stage = 1; sent = [];
  await post('poll', { module: 'sport' }); await wait(500);
  console.log(sent.map(function (x) { return x.title + ' | ' + x.message; }).join('\n'));
  assert(sent.length === 1, 'only one goal is announced (' + sent.length + ')');
  assert(/BENFICA/.test(sent[0].title), 'the club with goal=true announces its goal');
  assert(!/SPORTING/.test(sent[0].title), 'the club with goal=false stays silent');

  var cfg = await post('config', { football: { clubs: [
    { id: '2250', name: 'Sporting', league: 'por.1', comps: ['por.1'], alerts: { goal: true, against: false } },
    { id: '1929', name: 'Benfica', league: 'por.1', comps: ['por.1'] }
  ] } });
  assert(cfg.config.football.clubs[0].alerts.goal === true && cfg.config.football.clubs[0].alerts.against === false,
    'per-club alerts are saved through the config route');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
