'use strict';
// Global banner limit: at most 4 per minute, 1 s apart, excess queued and never dropped.
// high-priority civil-protection notices bypass the limit.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0, sent = [];
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
  rq.end = function () { sent.push({ body: JSON.parse(body), at: Date.now() }); if (cb) { cb(emitter()); } };
  return rq;
};
var factory = require('../index.js');
var store = { modules: { sport: false, weather: false, news: false }, lang: 'en' };
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start(); await wait(150);
  // Five different test banners fired back to back.
  for (var i = 0; i < 5; i++) { await post('test', { kind: ['goal','card','start','end','score'][i] }); }
  await wait(4500);
  console.log('sent after 4.5s: ' + sent.map(function (x) { return x.body.title; }).join(' | '));
  assert(sent.length === 4, 'only 4 banners go out in the first minute (' + sent.length + ')');
  var gaps = [];
  for (var g = 1; g < sent.length; g++) { gaps.push(sent[g].at - sent[g - 1].at); }
  assert(Math.min.apply(null, gaps) >= 950, 'banners are at least 1 s apart (' + gaps.join(',') + ')');
  assert(!sent.some(function (x) { return x.body.title === 'Score update'; }), 'the fifth banner is still waiting');

  // Move the clock past the minute boundary: the next enqueue drains the queue, nothing is lost.
  offset += 61000;
  await post('test', { kind: 'goal' }); await wait(200);
  assert(sent.some(function (x) { return x.body.title === 'Score update'; }), 'the queued fifth banner is delivered later');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
