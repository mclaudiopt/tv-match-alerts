'use strict';
// Goal simulation buttons: silent real notify, editable club list, no changes to followed clubs.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };
var sent = [];
function emitter() {
  var h = {};
  return { on: function (e, f) { (h[e] = h[e] || []).push(f); return this; }, emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {} };
}
function respond(cb, code, text) {
  var r = emitter(); r.statusCode = code;
  setImmediate(function () { r.emit('data', text); r.emit('end'); });
  cb(r); return r;
}
https.get = function (opt, cb) { return respond(cb, 500, ''); };
http.get = function (opt, cb) {
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron','golo'] } }));
  }
  return respond(cb, 500, '');
};
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};
var factory = require('../index.js');
var store = { modules: { sport: false, weather: false, news: false } };
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 120); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start(); await wait();
  var st = await get('state');
  assert(st.config.sim.clubs.length === 4, 'four default test clubs (Sporting, Benfica, Porto, Feyenoord)');
  assert(st.config.sim.clubs[2].id === '437' && st.config.sim.clubs[3].id === '142', 'Porto and Feyenoord ids are correct');
  assert(st.config.football.clubs.length === 0, 'test clubs do not change the followed clubs');

  sent = [];
  var r = await post('test-club', { id: '2250' }); await wait(150);
  console.log(JSON.stringify(sent));
  assert(r.ok && sent.length === 1, 'test-club sends exactly one notification');
  var n = sent[0];
  assert(n.title === 'Golo! Sporting' && n.message === 'Sporting 1-0 Benfica', 'title and message follow the club');
  assert(n.level === 'ok' && n.mode === 'overlay' && n.theme === 'sport', 'level, overlay mode and sport theme');
  assert(n.image === 'https://a.espncdn.com/i/teamlogos/soccer/500/2250.png', 'PNG crest is sent as image');
  assert(n.duration === 8 && n.group === false && n.source === 'tv-alerts', 'duration, group and source');
  assert(!n.sound && !n.icon, 'the simulated goal is silent and has no emoji icon');

  var bad = await post('test-club', { id: '999' });
  assert(bad && bad.error, 'unknown test club is rejected');

  var cfg = await post('config', { sim: { clubs: [
    { id: '2250', name: 'Sporting', level: 'warn', msg: 'Golo meu', logo: 'https://x/escudo.png' }
  ] } });
  assert(cfg.config.sim.clubs.length === 1 && cfg.config.sim.clubs[0].level === 'warn', 'the list is editable');
  offset += 61000;  // clear the global 4-per-minute window
  sent = [];
  await post('test-club', { id: '2250' }); await wait(150);
  assert(sent.length === 1 && sent[0].level === 'warn' && sent[0].image === 'https://x/escudo.png' &&
    sent[0].message === 'Golo meu', 'customised club is used by the button');
  var badCfg = await post('config', { sim: { clubs: [{ id: 'abc', name: 'X' }] } });
  assert(badCfg && badCfg.error, 'a bad test club is rejected');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
