'use strict';
// The banner queue must be bounded, drops must be logged, and a failed POST to the
// Notification Center must leave a trace in the Shard log.
var https = require('https'), http = require('http');
var sent = [], failNext = false;

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
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function (opt, cb) {
  var rq = emitter();
  rq.write = function () {};
  rq.end = function () {
    if (failNext) { setImmediate(function () { rq.emit('error', new Error('NC down')); }); }
    else { sent.push(opt); }
    if (cb) { cb(emitter()); }
  };
  return rq;
};

var factory = require('../index.js');
var store = { modules: { sport: false, weather: false, news: false }, civ: { enabled: false }, lang: 'en' };
function make() { return factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } }); }
function req(shard, sub, method, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (p) { resolve(JSON.parse(p)); } };
    var r = { method: method, on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body || {})); f(); }); }
    }, destroy: function () {} };
    shard.route(r, res, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 50); }); }
function logText(st) { return (st.log || []).map(function (x) { return x.text; }).join('\n'); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  var shard = make();
  shard.start();
  for (var i = 0; i < 20; i++) { await req(shard, 'test', 'POST', { kind: 'goal' }); }
  await wait(100);
  var pub = await req(shard, 'last', 'GET');
  assert(pub.notify && pub.notify.queued <= 12, 'queue is bounded (' + (pub.notify && pub.notify.queued) + ')');
  var st = await req(shard, 'state', 'GET');
  assert(/oldest banner dropped/.test(logText(st)), 'an overflowed banner is logged as dropped');
  shard.stop();

  // Fresh Shard: no queued banners, so the next test banner is sent immediately and can fail.
  var shard2 = make();
  shard2.start();
  failNext = true;
  await req(shard2, 'test', 'POST', { kind: 'goal' });
  await wait(100);
  st = await req(shard2, 'state', 'GET');
  assert(/NC down/.test(logText(st)), 'a failed notify POST is logged');
  shard2.stop();

  console.log('\nALL GOOD');
  // The mocked http.request leaves no real sockets, but the two Shards' timers can keep the loop
  // alive on some Node versions. The assertions are done, so end explicitly.
  process.exit(0);
})().catch(function (e) { console.error(e.stack); process.exit(1); });
