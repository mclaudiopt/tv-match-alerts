'use strict';
// Two basketball picks of the same sport must produce two independent watch keys and each must
// track its own match (no collision on a shared "other:basketball:all" key).
var https = require('https'), http = require('http');
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
function side(id, name, home) {
  return { homeAway: home, team: { id: id, displayName: name, shortDisplayName: name }, score: '0' };
}
function event(id, teamId, name) {
  return { id: id, date: new Date().toISOString(), status: { displayClock: '', type: { state: 'in', description: 'Live' } },
    competitions: [{ competitors: [side(teamId, name, 'home'), side('999', 'Other', 'away')] }] };
}
https.get = function (opt, cb) {
  if (/dates=/.test(opt.path)) { return respond(cb, 200, '{"events":[]}'); }
  if (/scoreboard/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ events: [event('g1', '13', 'Hawks'), event('g2', '14', 'Celtics')] }));
  }
  return respond(cb, 200, '{}');
};
http.get = function (opt, cb) { return respond(cb, 200, '{"events":[]}'); };
http.request = function () { var rq = emitter(); rq.write = function () {}; rq.end = function () {}; return rq; };

var factory = require('../index.js');
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'en',
  football: { provider: 'espn', clubs: [] },
  others: { picks: [
    { sport: 'basketball', teamId: '13', name: 'Hawks' },
    { sport: 'basketball', teamId: '14', name: 'Celtics' }
  ] }
};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function post(sub, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function () { resolve(); } };
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
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start();
  await post('poll', { module: 'sport' });
  await new Promise(function (r) { setTimeout(r, 150); });
  var st = await get('state');
  var keys = Object.keys(st.watches);
  console.log(JSON.stringify(st.watches, null, 1));
  assert(keys.length === 2, 'two basketball picks produce two watches (' + keys.length + ')');
  assert(keys.indexOf('other:basketball:13') > -1, 'Hawks watch key contains its team id');
  assert(keys.indexOf('other:basketball:14') > -1, 'Celtics watch key contains its team id');
  assert(/Hawks/.test(st.watches['other:basketball:13'].line), 'Hawks watch follows its own match');
  assert(/Celtics/.test(st.watches['other:basketball:14'].line), 'Celtics watch follows its own match');
  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
