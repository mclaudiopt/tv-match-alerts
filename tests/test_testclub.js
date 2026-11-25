'use strict';
// "Test with" club: /api/test accepts {kind, club} and the banner carries that club's
// name, crest and style, even when the club has that alert switched off.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };
var sent = [];
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
function serve(opt, cb) {
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) { return respond(cb, 200, JSON.stringify({ keyEvents: [] })); }
    return respond(cb, 200, JSON.stringify({ events: [] }));
  }
  if (/notification-center/.test(opt.path || '')) {
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime', 'soft', 'reward', 'success', 'alert', 'rotation', 'open', 'poweron', 'golo'] } }));
  }
  return respond(cb, 500, '');
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
var store = {
  modules: { sport: true, weather: false, news: false }, lang: 'pt',
  football: {
    provider: 'espn',
    clubs: [
      { id: '2250', name: 'Sporting', league: 'por.1', comps: ['por.1'], news: false,
        alerts: { goal: false, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true } },
      { id: '1929', name: 'Benfica', league: 'por.1', comps: ['por.1'], news: false }
    ],
    alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
    goalSeconds: 30, otherSeconds: 10, sound: false, mode: 'overlay',
    nextGame: { enabled: false, minutes: 30 }
  }
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 200); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  shard.start(); await wait(200);
  sent = [];

  // 1. The picked club is the one in the banner, not the first club in the list.
  var r = await post('test', { kind: 'goal', club: '1929' });
  await wait(300);
  assert(r && r.ok, 'the test route answers ok');
  assert(sent.length === 1, 'one banner is sent for the picked club');
  var body = sent[0];
  assert(/BENFICA/.test(body.title), 'the banner names the picked club (' + body.title + ')');
  assert(/1929/.test(body.image || ''), 'the banner carries the picked club crest (' + (body.image || 'no image') + ')');
  assert(body.mode === 'overlay', 'the football style is kept (' + body.mode + ')');
  assert(!body.sound, 'the test banner stays silent');

  // 2. Tests ignore the per-club alert switches: a club with goals off can still be tested.
  offset += 61000; sent = [];
  await post('test', { kind: 'goal', club: '2250' });
  await wait(300);
  assert(sent.length === 1 && /SPORTING/.test(sent[0].title),
    'a club with goal alerts off still sends the test (' + (sent[0] && sent[0].title) + ')');

  // 3. Without a club the first followed club is used (old behaviour kept).
  offset += 61000; sent = [];
  await post('test', { kind: 'card', club: '' });
  await wait(300);
  assert(sent.length === 1 && /sporting/i.test(JSON.stringify(sent[0])),
    'no club falls back to the first club (' + (sent[0] && (sent[0].title + ' | ' + sent[0].message)) + ')');

  // 4. An unknown id must not break the button.
  offset += 61000; sent = [];
  var bad = await post('test', { kind: 'start', club: '999999' });
  await wait(300);
  assert(bad && bad.ok && sent.length === 1, 'an unknown club id falls back instead of failing');

  // 5. The panel style wins: a test follows the mode saved in the config.
  offset += 61000; sent = [];
  await post('config', { football: { mode: 'banner' } });
  await post('test', { kind: 'end', club: '1929' });
  await wait(300);
  assert(sent.length === 1 && sent[0].mode === 'banner', 'the chosen mode is used (' + (sent[0] && sent[0].mode) + ')');

  // 6. The config keeps the clubs untouched (a test never edits them).
  offset += 61000; sent = [];
  var st = await get('state');
  assert(st.config.football.clubs[1].id === '1929' && st.config.football.clubs[0].alerts.goal === false,
    'the test does not change the followed clubs');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.message); process.exit(1); });
