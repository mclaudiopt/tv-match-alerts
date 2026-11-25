'use strict';
// Regressions from the code audit: legacy baselines, explicitly empty sim clubs, wrong config
// types and malformed query strings must not break the Shard.
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
function race(id, name) {
  return { id: id, name: name, date: new Date().toISOString(), status: { type: { state: 'in' } },
    competitions: [{ competitors: [
      { order: 1, athlete: { id: 'd1', displayName: 'Alonso' } },
      { order: 2, athlete: { id: 'd2', displayName: 'Norris' } }
    ] }] };
}
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host) && /scoreboard/.test(opt.path)) {
      return void respond(cb, 200, JSON.stringify({ events: /racing\/f1/.test(opt.path) ? [race('r1', 'Race One')] : [] }));
    }
    if (/geocoding/.test(opt.host)) { return void respond(cb, 200, '{"results":[]}'); }
    respond(cb, 200, '{}');
  });
  return emitter();
};
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function () { var rq = emitter(); rq.write = function () {}; rq.end = function () {}; return rq; };

var factory = require('../index.js');
// A baseline written by an older Shard has no `keys`; it must be treated as empty.
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'en', civ: { enabled: false },
  football: { provider: 'espn', clubs: [] },
  others: { picks: [{ sport: 'f1', teamId: 'r1', name: 'Race One' }, { sport: 'f1', teamId: 'stale', name: 'Old Race' }] },
  history: { last: { 'other:f1:r1|espn-r1': { at: Date.now(), state: 'in', desc: 'Race One', our: 0, opp: 0 } } }
};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function call(sub, method, body, url) {
  return new Promise(function (resolve) {
    var res = { writeHead: function (c) { this.code = c; }, end: function (p) {
      var parsed = null; try { parsed = JSON.parse(p); } catch (e) { parsed = p; }
      resolve({ code: this.code, body: parsed });
    } };
    var r = { method: method, url: url, on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body || {})); f(); }); }
    }, destroy: function () {} };
    shard.route(r, res, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 100); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start();
  await call('poll', 'POST', { module: 'sport' }); await wait();
  var st = await call('state', 'GET');
  assert(st.body.watches['other:f1:r1'], 'the valid race watch was analysed');
  assert(st.body.watches['other:f1:stale'] && st.body.watches['other:f1:stale'].line === '',
    'a stale race id does not follow the first race on the board');

  var sim = await call('config', 'POST', { sim: { clubs: [] } });
  st = await call('state', 'GET');
  assert(sim.code === 200 && st.body.config.sim.clubs.length === 0, 'an explicitly empty sim list stays empty');

  var bad = await call('config', 'POST', { weather: { interval: 'abc' } });
  assert(bad.code === 400 && /expected a number/.test(bad.body.error), 'wrong config types return 400');

  var query = await call('geocode', 'GET', null, '/api/geocode?name=%ZZ');
  assert(query.code === 200 || query.code === 400, 'malformed query escapes do not throw');

  var card = shard.card();
  assert(card.rows.length <= 7 && card.choosable === true, 'Control center card returns at most 7 choosable rows');
  assert(card.rows.some(function (r) { return r.id === 'check-civ'; }), 'card offers a civil-protection check');
  assert(shard.cardSelect('check-weather').ok === true, 'cardSelect runs a manual check');
  assert(shard.cardSelect('bogus').ok === false, 'unknown card action is refused');
  var detail = shard.status();
  assert('civ' in detail && 'health' in detail, 'dashboard status includes civ and provider health');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
