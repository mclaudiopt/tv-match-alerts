'use strict';
// Two F1 picks with different ESPN event ids must follow two different races,
// each with its own watch, baseline and winner banner.
var https = require('https'), http = require('http');
var sent = [];
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

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
function race(id, name, leader, second, state) {
  return { id: id, name: name, date: new Date().toISOString(),
    status: { type: { state: state, description: state === 'post' ? 'Race Complete' : 'Live' } },
    competitions: [{ competitors: [
      { order: 1, athlete: { id: 'd1', displayName: leader } },
      { order: 2, athlete: { id: 'd2', displayName: second } }
    ] }] };
}
var board = [
  [race('r1', 'Race A', 'Alonso', 'Hamilton', 'in'), race('r2', 'Race B', 'Verstappen', 'Norris', 'in')],
  [race('r1', 'Race A', 'Alonso', 'Hamilton', 'post'), race('r2', 'Race B', 'Verstappen', 'Norris', 'post')]
];
var step = 0;
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host) && /racing\/f1/.test(opt.path) && /scoreboard/.test(opt.path)) {
      return void respond(cb, 200, JSON.stringify({ events: board[Math.min(step, board.length - 1)] }));
    }
    respond(cb, 200, '{"events":[]}');
  });
  return emitter();
};
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};

var factory = require('../index.js');
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'en',
  football: { provider: 'espn', clubs: [] },
  others: { picks: [
    { sport: 'f1', teamId: 'r1', name: 'Race A' },
    { sport: 'f1', teamId: 'r2', name: 'Race B' }
  ] }
};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function req(sub, method, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (p) { resolve(JSON.parse(p)); } };
    var r = { method: method, on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body || {})); f(); }); }
    }, destroy: function () {} };
    shard.route(r, res, sub);
  });
}
function post(sub, body) { return req(sub, 'POST', body); }
function get(sub) { return req(sub, 'GET'); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start();
  var races = await get('races');
  assert(races.races && races.races.length === 2, '/api/races lists both races');

  await post('poll', { module: 'sport' }); await wait();
  var st = await get('state');
  var keys = Object.keys(st.watches);
  assert(keys.length === 2, 'two F1 picks produce two watches (' + keys.length + ')');
  assert(keys.indexOf('other:f1:r1') > -1 && keys.indexOf('other:f1:r2') > -1, 'watch keys use the race event ids');
  assert(/Alonso/.test(st.watches['other:f1:r1'].line), 'first pick follows Race A');
  assert(/Verstappen/.test(st.watches['other:f1:r2'].line), 'second pick follows Race B');

  sent = [];
  offset += 70000;
  step = 1;
  await post('poll', { module: 'sport' }); await wait(2300);
  assert(sent.length === 2, 'both races announce a winner (' + sent.length + ')');
  assert(/Alonso/.test(sent[0].title + sent[0].message), 'first banner is Race A');
  assert(/Verstappen/.test(sent[1].title + sent[1].message), 'second banner is Race B');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
