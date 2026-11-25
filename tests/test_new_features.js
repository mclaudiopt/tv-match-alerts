'use strict';
// New features in 0.5.30: several picks of the same sport (team picks with different ids and
// whole-race picks with different names) and the public /api/last endpoint (no config or keys).
var https = require('https'), http = require('http');
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
https.get = function (opt, cb) { return respond(cb, 200, opt.path && /scoreboard/.test(opt.path) ? '{"events":[]}' : '{}'); };
http.get = function (opt, cb) { return respond(cb, 200, '{"events":[]}'); };
http.request = function () { var rq = emitter(); rq.write = function () {}; rq.end = function () {}; return rq; };

var factory = require('../index.js');
var store = {};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function post(sub, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function (c) { this.code = c; }, end: function (p) { resolve({ code: this.code, body: JSON.parse(p) }); } };
    var req = { method: 'POST', on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body)); f(); }); }
    }, destroy: function () {} };
    shard.route(req, res, sub);
  });
}
function get(sub) {
  return new Promise(function (resolve) {
    var res = { writeHead: function (c) { this.code = c; }, end: function (p) { resolve({ code: this.code, body: JSON.parse(p) }); } };
    shard.route({ method: 'GET', on: function () {} }, res, sub);
  });
}
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }

(async function () {
  shard.start();
  var r = await post('config', {
    modules: { sport: true, weather: false, news: false }, lang: 'en',
    keys: { apifootball: 'SECRET-KEY-MUST-NOT-LEAK' },
    football: { provider: 'espn', clubs: [] },
    others: {
      picks: [
        { sport: 'basketball', teamId: '13', name: 'Hawks' },
        { sport: 'basketball', teamId: '14', name: 'Celtics' },
        { sport: 'f1', teamId: '', name: 'Grand Prix A' },
        { sport: 'f1', teamId: '', name: 'Grand Prix B' }
      ]
    }
  });
  assert(r.code === 200, 'config with repeated sports saved');

  var st = await get('state');
  var picks = st.body.config.others.picks;
  assert(picks.length === 4, 'four picks kept (2 basketball + 2 F1)');
  assert(picks[0].teamId === '13' && picks[1].teamId === '14' && picks[0].sport === picks[1].sport,
    'two basketball picks of the same sport kept');
  assert(picks[2].name === 'Grand Prix A' && picks[3].name === 'Grand Prix B',
    'two whole-race picks of the same sport kept');
  assert(st.body.config.maxPicks === 10, 'panel knows the pick limit');

  // Duplicate picks are still deduped.
  r = await post('config', {
    others: { picks: [
      { sport: 'basketball', teamId: '13', name: 'Hawks' },
      { sport: 'basketball', teamId: '13', name: 'Hawks again' },
      { sport: 'f1', teamId: '', name: 'Grand Prix A' },
      { sport: 'f1', teamId: '', name: 'Grand Prix A' }
    ] }
  });
  st = await get('state');
  assert(st.body.config.others.picks.length === 2, 'duplicate picks are deduped');

  // Restore a config with a secret and call /api/last.
  await post('config', {
    keys: { apifootball: 'SECRET-KEY-MUST-NOT-LEAK' },
    others: { picks: [
      { sport: 'basketball', teamId: '13', name: 'Hawks' },
      { sport: 'basketball', teamId: '14', name: 'Celtics' }
    ] }
  });
  // Poll once so watch keys really exist; without this the assertion below is vacuous.
  await post('poll', { module: 'sport' }); await wait();
  var last = await get('last');
  assert(last.code === 200, '/api/last answers 200');
  var body = JSON.stringify(last.body);
  assert(last.body.version && last.body.at > 0, '/api/last has version and timestamp');
  assert(last.body.status && last.body.watches && Array.isArray(last.body.next) && Array.isArray(last.body.civ) && last.body.last && Array.isArray(last.body.log),
    '/api/last has status, watches, next, civ, last and log');
  assert(body.indexOf('SECRET-KEY-MUST-NOT-LEAK') === -1, '/api/last does not expose the API key');
  assert(!last.body.config && !last.body.keys && !last.body.hasKey && !last.body.providers && !last.body.feeds,
    '/api/last carries no config, key flag, providers or feed list');

  // Two basketball watches must have distinct keys.
  var keys = Object.keys(last.body.watches);
  assert(keys.length === 2 && keys.some(function (k) { return k.indexOf('basketball:13') > -1; }) &&
    keys.some(function (k) { return k.indexOf('basketball:14') > -1; }),
    'watch status uses the two pick keys (' + keys.length + ')');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
