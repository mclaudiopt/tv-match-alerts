'use strict';
// Regression: "First Half" is playing time, not the interval. A kick-off must announce the
// start only; the interval must be announced when ESPN really says "Halftime".
var https = require('https'), http = require('http');
var sent = [];
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

function emitter() {
  var h = {};
  return {
    on: function (e, f) { (h[e] = h[e] || []).push(f); return this; },
    emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {}, statusCode: 200
  };
}
function respond(cb, code, text) {
  var r = emitter();
  r.statusCode = code;
  setImmediate(function () { r.emit('data', text); r.emit('end'); });
  cb(r);
  return r;
}
function ev(id, state, desc, clock) {
  return { events: [{ id: id, date: new Date().toISOString(), status: { displayClock: clock, type: { state: state, description: desc } }, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: 2250, displayName: 'Sporting CP', shortDisplayName: 'Sporting' }, score: '0' },
    { homeAway: 'away', team: { id: 3624, displayName: 'Manchester United', shortDisplayName: 'Man Utd' }, score: '0' }
  ], details: [] }] }] };
}
var board = [
  ev('e1', 'pre', 'Scheduled', ''),
  ev('e1', 'in', 'First Half', "2'"),
  ev('e1', 'in', 'Halftime', "45'"),
  ev('e1', 'in', 'Second Half', "60'"),
  ev('e1', 'post', 'Full Time', "90'")
];
var sportStep = 0;
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host)) {
      if (/summary/.test(opt.path)) { return void respond(cb, 200, JSON.stringify({ keyEvents: [] })); }
      // Only the followed competition carries the scripted match; next-fixture scans stay empty.
      if (!/^\/apis\/site\/v2\/sports\/soccer\/por\.1\/scoreboard$/.test(opt.path)) {
        return void respond(cb, 200, JSON.stringify({ events: [] }));
      }
      return void respond(cb, 200, JSON.stringify(board[Math.min(sportStep++, board.length - 1)]));
    }
    respond(cb, 500, '');
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
var store = {};
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
function settle() { return wait(2300); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
function poll() { offset += 70000; return post('poll', { module: 'sport' }).then(settle); }

(async function () {
  store = {
    modules: { sport: true, weather: false, news: false }, lang: 'pt',
    football: { provider: 'espn', clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1' }],
      nextGame: { enabled: false, minutes: 30 } },
    civ: { enabled: false }
  };
  shard.start();
  await wait();

  await post('poll', { module: 'sport' }); await wait();
  assert(sent.length === 0, 'first poll is a baseline');

  await poll();
  assert(sent.length === 1 && /Come\u00E7ou o jogo/.test(sent[0].title), 'kick-off announces only the start, not the interval');

  sent = [];
  await poll();
  assert(sent.length === 1 && /Intervalo/.test(sent[0].title), 'the real Halftime announces the interval');

  sent = [];
  await poll();
  assert(sent.length === 0, 'Second Half does not announce another interval');

  sent = [];
  await poll();
  assert(sent.length === 1 && /Fim do jogo/.test(sent[0].title), 'full time is still announced');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error('FAIL', e.stack || e); process.exit(1); });
