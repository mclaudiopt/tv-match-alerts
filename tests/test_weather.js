'use strict';
// Weather provider + schedule test: morning until 10h (today), night after 18h (tomorrow),
// Open-Meteo and IPMA providers.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0, sent = [];
Date.now = function () { return realNow() + offset; };
function setHour(h) { var d = new Date(); d.setHours(h, 0, 0, 0); offset = d.getTime() - realNow(); }
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
function serve(opt, cb) {
  if (/api\.open-meteo\.com/.test(opt.host)) {
    return respond(cb, 200, JSON.stringify({
      current: { temperature_2m: '12', weather_code: 3 },
      daily: { temperature_2m_max: ['18', '21'], temperature_2m_min: ['10', '12'],
        precipitation_probability_max: ['20', '70'], weather_code: [3, 63] }
    }));
  }
  if (/api\.ipma\.pt/.test(opt.host)) {
    if (/distrits-islands/.test(opt.path)) {
      return respond(cb, 200, JSON.stringify({ data: [
        { idAreaAviso: 'LRA', globalIdLocal: 1100900, local: 'Leiria', latitude: '39.7473', longitude: '-8.8069' }
      ] }));
    }
    if (/weather-type-classe/.test(opt.path)) {
      return respond(cb, 200, JSON.stringify({ data: [
        { idWeatherType: 3, descWeatherTypePT: 'Nublado' }, { idWeatherType: 6, descWeatherTypePT: 'Chuva' }
      ] }));
    }
    if (/1100900/.test(opt.path)) {
      return respond(cb, 200, JSON.stringify({ data: [
        { forecastDate: '2026-11-24', tMax: '16', tMin: '10', precipitaProb: '30', idWeatherType: 3 },
        { forecastDate: '2026-11-25', tMax: '19', tMin: '11', precipitaProb: '80', idWeatherType: 6 }
      ] }));
    }
  }
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron','golo'] } }));
  }
  respond(cb, 500, '');
}
https.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.get = https.get;
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};
var factory = require('../index.js');
var store = { modules: { sport: false, weather: true, news: false }, lang: 'pt',
  weather: { place: 'lisbon', custom: [], provider: 'openmeteo', when: 'morning', interval: 60, seconds: 12, quiet: false, sound: false, mode: 'overlay', volume: 70 } };
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
function get(sub) {
  return new Promise(function (resolve) {
    shard.route({ method: 'GET', on: function () {} },
      { writeHead: function () {}, end: function (p) { resolve(JSON.parse(p)); } }, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 150); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
function poll() { return post('poll', { module: 'weather' }).then(function () { return wait(250); }); }

(async function () {
  shard.start(); await wait();

  setHour(9); sent = []; await poll();
  console.log(sent.map(function (x) { return x.title + ' | ' + x.message; }).join('\n'));
  assert(sent.length === 1 && /Max 18/.test(sent[0].message), 'morning at 09h announces today (Max 18)');
  assert(sent[0].mode === 'overlay', 'weather uses the configured style');
  assert(sent[0].volume === 70, 'weather uses its own volume');

  setHour(11); sent = []; await poll();
  assert(sent.length === 0, 'morning after 10h sends nothing');
  var st = await get('state');
  assert(/Max 18/.test(st.status.weather.line), 'the forecast is still fetched and shown in the panel');

  await post('config', { weather: { when: 'night' } });
  setHour(19); sent = []; await poll();
  console.log(sent.map(function (x) { return x.message; }).join('\n'));
  assert(sent.length === 1 && /Max 21/.test(sent[0].message), 'night after 18h announces tomorrow (Max 21)');
  assert(/amanh/.test(sent[0].message), 'the message says it is tomorrow');

  setHour(12); sent = []; await poll();
  assert(sent.length === 0, 'night before 18h sends nothing');

  await post('config', { weather: { provider: 'ipma', when: 'morning' } });
  setHour(9); offset += 86400000;  // next morning: clears the global rate-limit window
  sent = []; await poll();
  console.log(sent.map(function (x) { return x.message; }).join('\n'));
  assert(sent.length === 1 && /Max 16/.test(sent[0].message), 'IPMA provider uses the official forecast (Max 16)');
  assert(/Nublado/.test(sent[0].message), 'IPMA weather type is translated to Portuguese');

  var bad = await post('config', { weather: { provider: 'nope' } });
  assert(bad && bad.error, 'an unknown weather provider is rejected');
  var bad2 = await post('config', { weather: { when: 'nope' } });
  assert(bad2 && bad2.error, 'an unknown weather schedule is rejected');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
