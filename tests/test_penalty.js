'use strict';
// Penalties: ESPN sends "Penalty - Saved" with scoringPlay=false, so the old code dropped it
// (no goal, no banner). A missed penalty must announce its own banner; a scored one stays a goal.
var https = require('https'), http = require('http');
var sent = [], realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };
function emitter() {
  var h = {};
  return { on: function (e, f) { (h[e] = h[e] || []).push(f); return this; },
    emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {}, statusCode: 200 };
}
function respond(cb, code, text) {
  var r = emitter(); r.statusCode = code;
  setImmediate(function () { r.emit('data', text); r.emit('end'); });
  cb(r); return r;
}
function board() {
  return { events: [{ id: 'e1', date: new Date().toISOString(), status: { displayClock: "30'", type: { state: 'in', description: 'First Half' } }, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: 2250, displayName: 'Sporting CP', shortDisplayName: 'Sporting' }, score: '0' },
    { homeAway: 'away', team: { id: 360, displayName: 'Manchester United', shortDisplayName: 'Man Utd' }, score: '0' }
  ], details: [] }] }] };
}
function penalty(saved) {
  return { id: '55664792', type: { text: saved ? 'Penalty - Saved' : 'Penalty - Scored', type: saved ? 'penalty---saved' : 'penalty---scored' },
    text: saved ? 'Penalty saved. Luis Suarez (Sporting CP) right footed shot saved.' : 'Penalty scored by Luis Suarez (Sporting CP).',
    scoringPlay: !saved, clock: { displayValue: "30'" }, team: { id: '2250', displayName: 'Sporting CP' },
    participants: [{ athlete: { displayName: 'Luis Suarez' } }] };
}
var step = 0;
var summaries = [
  { keyEvents: [] },
  { keyEvents: [penalty(true)] },
  { keyEvents: [penalty(false)] },
  { keyEvents: [penalty(false)] }
];
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host)) {
      if (/summary/.test(opt.path)) { return void respond(cb, 200, JSON.stringify(summaries[Math.min(step, summaries.length - 1)])); }
      if (!/^\/apis\/site\/v2\/sports\/soccer\/uefa\.champions\/scoreboard$/.test(opt.path)) {
        return void respond(cb, 200, JSON.stringify({ events: [] }));
      }
      return void respond(cb, 200, JSON.stringify(board()));
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
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'pt',
  football: { provider: 'espn', clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1', comps: ['uefa.champions'] }],
    nextGame: { enabled: false, minutes: 30 } },
  civ: { enabled: false }
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
function tick() { offset += 70000; step++; return post('poll', { module: 'sport' }).then(function () { return wait(120); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
(async function () {
  shard.start(); await wait();
  await post('poll', { module: 'sport' }); await wait(120);
  assert(sent.length === 0, 'first poll is a baseline');

  await tick();
  assert(sent.length === 1 && /Penalty falhado/.test(sent[0].title) && /Luis Suarez/.test(sent[0].message), 'a saved penalty announces who missed it');
  assert(!sent[0].mode && sent[0].group === false && !sent[0].sound, 'penalty uses the normal sport banner path with hub defaults');

  sent = [];
  await tick();
  assert(sent.length === 1 && /GOLO/.test(sent[0].title) && /Luis Suarez/.test(sent[0].message), 'a scored penalty is still announced as a goal');

  sent = [];
  await tick();
  assert(sent.length === 0, 'the same penalty is not announced twice');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error('FAIL', e.stack || e); process.exit(1); });
