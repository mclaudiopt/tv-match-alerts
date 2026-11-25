'use strict';
// Focused test for the Proteção Civil tab: IPMA district filter, ANEPC notices, keyword-filtered
// breaking news, baseline/dedupe, level switches and NC notify fields.
var https = require('https'), http = require('http');
var sent = [], stage = 0, escalate = false;
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
function warning(area, type, level, start, end) {
  return { text: 'Ondas de noroeste 4 a 4,5 m', awarenessTypeName: type, idAreaAviso: area,
    awarenessLevelID: level, startTime: start, endTime: end };
}
// Fixed dates made this test expire at a given hour of the day. Always keep the mocked warnings
// inside their validity window, relative to the moment the test runs.
function when(days, hour) {
  var d = new Date();
  d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function serve(opt, cb) {
  if (/api\.ipma\.pt/.test(opt.host)) {
    var list = [
      warning('LRA', 'Agitação Marítima', escalate ? 'red' : 'orange', when(-1, 21), when(1, 12)),
      warning('LSB', 'Chuva', 'red', when(-1, 21), when(1, 12))
    ];
    if (stage > 0) { list.push(warning('LRA', 'Chuva Forte', 'red', when(0, 8), when(1, 18))); }
    return respond(cb, 200, JSON.stringify(list));
  }
  if (/prociv\.gov\.pt/.test(opt.host)) {
    var html = '<div class="box-avisos">' +
      "<div class=\"Tipo\">Ativo</div><div class=\"fs-14\">20.11.2026</div>" +
      "<p class=h3-style mt-0\">Aviso 22 | Chuva persistente</p>" +
      "window.location.href='/pt/avisos-a-populacao/aviso-22-chuva-persistente/'" +
      '</div><div class="box-avisos"><div class="Tipo">Arquivo</div><div class="fs-14">01.01.2026</div>' +
      "<p class=h3-style>Aviso antigo</p></div>";
    return respond(cb, 200, html);
  }
  if (/noticiasaominuto/.test(opt.host)) {
    var xml = '<?xml version="1.0"?><rss><channel>' +
      '<item><title>Incendio em Lisboa: evacuação de moradores</title><link>http://nm/1</link></item>' +
      '<item><title>Seleção Nacional treina normalmente</title><link>http://nm/2</link></item></channel></rss>';
    return respond(cb, 200, xml);
  }
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron','golo'] } }));
  }
  respond(cb, 500, '');
}
https.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};

var factory = require('../index.js');
var store = {
  modules: { sport: false, weather: false, news: false }, lang: 'pt',
  civ: { enabled: true, district: 'LRA', levels: { yellow: false, orange: true, red: true },
    anepc: true, news: true, keywords: 'evacuação,incêndio', interval: 10, seconds: 20, sound: true, mode: 'overlay', volume: 80 }
};
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

(async function () {
  shard.start(); await wait();
  await post('poll', { module: 'civ' }); await wait(400);
  var st = await get('state');
  console.log('civ: ' + JSON.stringify(st.civ, null, 1).slice(0, 900));
  assert(st.civ.length === 3, 'one IPMA warning, one ANEPC notice and one filtered news item (' + st.civ.length + ')');
  assert(st.civ.filter(function (a) { return a.area === 'LSB'; }).length === 0, 'other districts are filtered out');
  assert(st.civ.some(function (a) { return a.source === 'ANEPC' && /Aviso 22/.test(a.title); }), 'ANEPC notice is parsed');
  assert(st.civ.some(function (a) { return /evacuação/.test(a.title); }), 'breaking news with a keyword is included');
  assert(sent.length === 0, 'the first poll is only a baseline');

  // An orange warning upgraded to red is a new alert and must be announced.
  escalate = true; sent = [];
  await post('poll', { module: 'civ' }); await wait(400);
  assert(sent.length >= 1, 'an escalation from orange to red is announced');
  escalate = false;

  stage = 1; sent = [];
  await post('poll', { module: 'civ' }); await wait(400);
  console.log(sent.map(function (x) { return x.title + ' | ' + x.level + ' | ' + x.mode + ' | ' + x.sound; }).join('\n'));
  assert(sent.length === 1, 'a new red warning sends exactly one banner');
  assert(sent[0].level === 'alert' && sent[0].mode === 'overlay', 'red uses alert level and overlay');
  assert(sent[0].priority === 'high', 'a red civil warning bypasses quiet hours (priority high)');
  assert(sent[0].volume === 80, 'civil protection uses its own volume');
  assert(sent[0].source === 'tv-alerts' && sent[0].group === false, 'notify keeps source and group=false');

  sent = [];
  await post('poll', { module: 'civ' }); await wait(300);
  assert(sent.length === 0, 'the same warning is not announced twice');

  // Yellow is hidden until explicitly enabled, then announced with a discreet banner.
  var cfg = await post('config', { civ: { levels: { yellow: true } } });
  assert(cfg.config.civ.levels.yellow === true, 'yellow level switch is saved');
  stage = 2; sent = [];
  await post('test', { kind: 'civ' }); await wait(400);
  assert(sent.length >= 1, 'the civ test button sends a banner');

  // The button must not go silent just because every active warning was already announced.
  await wait(1300);
  sent = [];
  await post('test', { kind: 'civ' }); await wait(400);
  assert(sent.length >= 1, 'the civ test still sends when the warning was already seen');

  await wait(1300);
  await post('config', { civ: { enabled: false } });
  sent = [];
  await post('test', { kind: 'civ' }); await wait(400);
  assert(sent.length >= 1, 'the civ test works even with the module switched off');

  var bad = await post('config', { civ: { district: 'NOPE' } });
  assert(bad && bad.error, 'an unknown district is rejected');
  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
