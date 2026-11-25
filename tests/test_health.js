'use strict';
// Provider health is exposed on /api/state and /api/last, and POST /api/clearlog empties the log.
var https = require('https'), http = require('http');
var failNext = false;

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
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/open-meteo/.test(opt.host)) {
      if (failNext) { return void respond(cb, 502, 'bad'); }
      return void respond(cb, 200, JSON.stringify({ current: { temperature_2m: 18, weather_code: 61 },
        daily: { temperature_2m_max: [22], temperature_2m_min: [12], precipitation_probability_max: [70] } }));
    }
    respond(cb, 500, '');
  });
  return emitter();
};
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function () { var rq = emitter(); rq.write = function () {}; rq.end = function () {}; return rq; };

var factory = require('../index.js');
var store = {
  modules: { sport: false, weather: true, news: false }, civ: { enabled: false }, lang: 'en',
  weather: { place: 'lisbon', interval: 60, seconds: 10, quiet: false, sound: false, mode: 'banner', volume: 100 }
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 100); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start();
  await req('poll', 'POST', { module: 'weather' }); await wait();
  var pub = await req('last', 'GET');
  assert(pub.health && pub.health['open-meteo'] && pub.health['open-meteo'].okAt > 0, 'successful fetch is recorded');
  assert(pub.health['open-meteo'].fails === 0, 'successful fetch resets consecutive failures');

  failNext = true;
  await req('poll', 'POST', { module: 'weather' }); await wait();
  pub = await req('last', 'GET');
  assert(pub.health['open-meteo'].fails > 0, 'failed fetch is recorded');
  assert(pub.health['open-meteo'].failAt > 0, 'failure time is recorded');

  var cleared = await req('clearlog', 'POST');
  assert(cleared.ok === true, 'clearlog route answers ok');
  var st = await req('state', 'GET');
  assert(st.log.length === 0, 'log is empty after clearlog');

  shard.stop();
  console.log('\nALL GOOD');
  process.exit(0);
})().catch(function (e) { console.error(e.stack); process.exit(1); });
