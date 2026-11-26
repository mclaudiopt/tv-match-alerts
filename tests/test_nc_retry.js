'use strict';
// The hub's answer decides: a 429 or a 5xx is tried again after a wait, a 400 is not, stop() cancels what waits; every notification has a category.
var https = require('https'), http = require('http');
var sent = [], answers = [], timers = [], realTimeout = setTimeout, realClear = clearTimeout;
function emitter() {
  var h = {};
  return { on: function (e, f) { (h[e] = h[e] || []).push(f); return this; }, emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {}, statusCode: 200 };
}
https.get = http.get = function (opt, cb) { var r = emitter(); r.statusCode = 500; cb(r); setImmediate(function () { r.emit('end'); }); return emitter(); };
http.request = function (opt, cb) {
  var rq = emitter(), text = '';
  rq.write = function (t) { text += t; };
  rq.end = function () {
    sent.push(JSON.parse(text));
    var a = answers.shift() || { code: 200, body: { ok: true, status: 'queued' } }, r = emitter();
    r.statusCode = a.code; cb(r);
    setImmediate(function () { r.emit('data', JSON.stringify(a.body)); r.emit('end'); });
  };
  return rq;
};
// The waits before a retry (28 and 30 s here) are kept and run by hand.
global.setTimeout = function (f, ms) { if (ms === 28000 || ms === 30000) { var t = { f: f, ms: ms, off: false }; timers.push(t); return t; } return realTimeout(f, ms); };
global.clearTimeout = function (t) { if (t && t.f) { t.off = true; return; } realClear(t); };
var factory = require('../index.js');
var store = { modules: { sport: false, weather: false, news: false }, civ: { enabled: false }, lang: 'en' };
function make() { return factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } }); }
function pause() { return new Promise(function (r) { realTimeout(r, 40); }); }
function test(shard) {
  var r = { method: 'POST', on: function (e, f) { if (e === 'data') { this._d = f; } if (e === 'end') { var self = this; setImmediate(function () { self._d('{"kind":"goal"}'); f(); }); } }, destroy: function () {} };
  shard.route(r, { writeHead: function () {}, end: function () {} }, 'test');
  return pause();
}
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
(async function () {
  var shard = make();
  shard.start();
  answers = [{ code: 429, body: { error: 'queue full', retryAfter: 28 } }];
  await test(shard);
  var waiting = timers.filter(function (t) { return t.ms === 28000 && !t.off; });
  assert(sent.length === 1 && sent[0].category === 'goal' && waiting.length === 1, 'a 429 waits what the hub asks, and the notification has a category');
  waiting[0].off = true; waiting[0].f(); await pause();
  assert(sent.length === 2, 'it is sent again');
  shard.stop();
  var shard2 = make();
  shard2.start(); await test(shard2); shard2.stop();
  shard2 = make(); shard2.start(); sent = []; timers = [];
  answers = [{ code: 400, body: { error: 'message is required' } }, { code: 500, body: {} }];
  await test(shard2);
  assert(sent.length === 1 && !timers.some(function (t) { return t.ms === 30000; }), 'a 400 is not tried again');
  shard2.stop();
  var shard3 = make();
  shard3.start(); timers = []; answers = [{ code: 500, body: {} }];
  await test(shard3);
  assert(timers.some(function (t) { return t.ms === 30000 && !t.off; }), 'a 500 waits for a retry');
  shard3.stop();
  assert(timers.every(function (t) { return t.off || t.ms !== 30000; }), 'stop() cancels the retry');
  console.log('ALL GOOD');
  process.exit(0);
})().catch(function (e) { console.log(e.message); process.exit(1); });
