'use strict';
// Proactive weather warnings from the hourly forecast, sent once and persisted.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0, sent = [];
Date.now = function () { return realNow() + offset; };
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
function iso(min) { return new Date(realNow() + min * 60000).toISOString().slice(0, 16); }
function forecast() {
  var times = [iso(20), iso(40), iso(60), iso(90)];
  return {
    current: { temperature_2m: '18', weather_code: 0 },
    daily: { temperature_2m_max: ['22'], temperature_2m_min: ['11'], precipitation_probability_max: ['40'], weather_code: [0] },
    hourly: { time: times, temperature_2m: ['20', '35', '38', '30'],
      precipitation_probability: ['20', '80', '70', '10'], weather_code: ['0', '1', '95', '1'],
      wind_speed_10m: ['12', '60', '20', '10'] }
  };
}
https.get = function (opt, cb) { return respond(cb, 200, JSON.stringify(forecast())); };
http.get = function (opt, cb) {
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron','golo'] } }));
  }
  return respond(cb, 500, '');
};
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};
var factory = require('../index.js');
var store = {
  modules: { sport: false, weather: true, news: false }, lang: 'pt',
  weather: { place: 'lisbon', custom: [], provider: 'openmeteo', when: 'always', interval: 60, seconds: 12,
    quiet: false, sound: false, mode: 'overlay', volume: 70,
    proactive: { enabled: true, minutes: 60, rain: true, wind: true, heat: true, storm: true,
      rainPct: 70, windKmh: 50, heatC: 35, stormCode: 90 } }
};
function make() { return factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } }); }
function post(shard, sub, body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (p) { resolve(p ? JSON.parse(p) : null); } };
    var req = { method: 'POST', on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body)); f(); }); }
    }, destroy: function () {} };
    shard.route(req, res, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 200); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  var s1 = make(); s1.start(); await wait(150);
  await post(s1, 'poll', { module: 'weather' }); await wait(4500);  // 4 banners, 1 s apart
  console.log(sent.map(function (x) { return x.title + ' | ' + x.message; }).join('\n'));
  assert(sent.length === 4, 'one warning per phenomenon inside the look-ahead window (' + sent.length + ')');
  assert(sent.every(function (x) { return /Tempo a caminho/.test(x.title); }), 'all use the advance-warning title');
  assert(sent.some(function (x) { return /Chuva/.test(x.message) && /80%/.test(x.message); }), 'rain probability is shown');
  assert(sent.some(function (x) { return /Vento/.test(x.message) && /60 km\/h/.test(x.message); }), 'wind threshold is shown');
  assert(sent.some(function (x) { return /Calor/.test(x.message) && /°C/.test(x.message); }), 'heat threshold is shown');
  assert(sent.some(function (x) { return /Trovoada/.test(x.message); }), 'thunderstorm is announced');
  assert(sent.every(function (x) { return !x.sound && x.volume === 70; }), 'warnings are silent and respect the weather volume');
  assert(store.weatherNotified && Object.keys(store.weatherNotified).length === 4, 'warned hours are saved in ctx.config');
  s1.stop();

  // Fresh Shard instance (new rate-limit window) with the same persisted config.
  sent = []; offset = 0;
  var s2 = make(); s2.start(); await wait(150);
  await post(s2, 'poll', { module: 'weather' }); await wait(500);
  assert(!sent.some(function (x) { return /Tempo a caminho/.test(x.title); }),
    'a restart does not repeat the same hourly warnings (the regular weather banner may still show)');
  assert(Object.keys(store.weatherNotified).length === 4, 'no new warning ids were added after restart');
  s2.stop();

  var cfg = await post(make(), 'config', { weather: { proactive: {
    enabled: false, minutes: 120, rainPct: 80, windKmh: 40, heatC: 32, stormCode: 96
  } } });
  assert(cfg.config.weather.proactive.enabled === false && cfg.config.weather.proactive.minutes === 120,
    'the controls are saved in the config');
  assert(cfg.config.weather.proactive.rainPct === 80 && cfg.config.weather.proactive.windKmh === 40 &&
    cfg.config.weather.proactive.heatC === 32 && cfg.config.weather.proactive.stormCode === 96,
    'all thresholds are parametrizable');

  // Advance warnings must obey "when to notify" (morning ends at 10h; real time is later here).
  store.weather.when = 'morning';
  store.weatherNotified = {};
  offset = 0;
  sent = [];
  var s4 = make(); s4.start(); await wait(150);
  await post(s4, 'poll', { module: 'weather' }); await wait(500);
  assert(!sent.some(function (x) { return /Tempo a caminho/.test(x.title); }),
    'advance warnings obey the when-to-notify window');
  s4.stop();

  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
