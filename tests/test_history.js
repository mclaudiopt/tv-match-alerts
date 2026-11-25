'use strict';
// Persist baselines: newsSeen, last and seenEvent survive a Shard restart.
var https = require('https'), http = require('http');
var stage = 0, sent = [];
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
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) {
      var ev = stage > 0 ? [{ type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "10'" },
        team: { id: '2250' }, athletesInvolved: [{ displayName: 'Gyokeres' }] }] : [];
      return respond(cb, 200, JSON.stringify({ keyEvents: ev }));
    }
    return respond(cb, 200, JSON.stringify({ events: [{
      id: 'e1', date: new Date().toISOString(),
      status: { displayClock: "55'", type: { state: 'in', description: 'Second Half' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '2250', displayName: 'Sporting CP', shortDisplayName: 'Sporting' }, score: String(stage > 0 ? 1 : 0) },
        { homeAway: 'away', team: { id: '2251', displayName: 'Porto', shortDisplayName: 'Porto' }, score: '0' }
      ], details: [] }]
    }] }));
  }
  if (/rtp/.test(opt.host)) {
    var xml = '<?xml version="1.0"?><rss><channel><item><title>Velha</title><link>http://r/1</link></item>' +
      (stage > 0 ? '<item><title>Nova</title><link>http://r/2</link></item>' : '') + '</channel></rss>';
    return respond(cb, 200, xml);
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
var store = {
  modules: { sport: true, weather: false, news: true }, lang: 'pt',
  football: { provider: 'espn', clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1', comps: ['por.1'], news: false }],
    alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
    goalSeconds: 30, otherSeconds: 10, sound: false, mode: 'overlay', nextGame: { enabled: false, minutes: 30 } },
  others: { picks: [] },
  news: { feeds: ['rtp'], interval: 30, seconds: 12, quiet: false, count: 2, sound: false, mode: 'banner' }
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
async function poll(shard, mod) { await post(shard, 'poll', { module: mod }); await wait(700); }

(async function () {
  // First run: baselines only.
  var s1 = make(); s1.start(); await wait(150);
  await poll(s1, 'sport'); await poll(s1, 'news');
  assert(sent.length === 0, 'first run is only a baseline');
  assert(store.history && store.history.newsSeen && store.history.newsSeen.rtp, 'newsSeen saved in ctx.config');
  assert(store.history.last && Object.keys(store.history.last).length === 1, 'match baseline saved in ctx.config');
  assert(store.history.at > 0, 'history has a timestamp');
  s1.stop();

  // Second run with new data: the baselines must be restored, not re-created.
  stage = 1; sent = [];
  var s2 = make(); s2.start(); await wait(150);
  await poll(s2, 'sport'); await poll(s2, 'news');
  console.log(sent.map(function (x) { return x.title + ' | ' + x.message; }).join('\n'));
  assert(sent.some(function (x) { return /GOLO/.test(x.title) && /Gyokeres/.test(x.message); }),
    'a goal after restart is announced against the restored baseline');
  assert(sent.some(function (x) { return /Nova/.test(x.message); }),
    'a new headline after restart is announced against the restored baseline');
  s2.stop();

  // Third run with no new data: neither the goal nor the headline may repeat.
  sent = [];
  var s3 = make(); s3.start(); await wait(150);
  await poll(s3, 'sport'); await poll(s3, 'news');
  assert(sent.length === 0, 'a third restart does not repeat the goal or the headline');
  s3.stop();

  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
