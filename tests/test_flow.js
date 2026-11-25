'use strict';
// End-to-end smoke flow with real assertions: sport baseline/goal, weather test and
// news baseline/new headline. All HTTP is mocked; no TV or network is needed.
var https = require('https'), http = require('http');
var sent = [];
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

function emitter() {
  var h = {};
  return {
    on: function (e, f) { (h[e] = h[e] || []).push(f); return this; },
    emit: function (e, a) { (h[e] || []).forEach(function (f) { f(a); }); },
    setEncoding: function () {}, resume: function () {}, destroy: function () {}
  };
}
function respond(cb, code, text) {
  var r = emitter();
  r.statusCode = code;
  setImmediate(function () { r.emit('data', text); r.emit('end'); });
  cb(r);
  return r;
}
function ev(id, state, desc, clock, hs, as, details) {
  return { events: [{ id: id, date: new Date().toISOString(), status: { displayClock: clock, type: { state: state, description: desc } }, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: 2250, displayName: 'Sporting CP', shortDisplayName: 'Sporting' }, score: String(hs) },
    { homeAway: 'away', team: { id: 2251, displayName: 'Benfica', shortDisplayName: 'Benfica' }, score: String(as) }
  ], details: details || [] }] }] };
}
function goal(min, team, player) {
  return { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: min }, team: { id: team }, athletesInvolved: [{ displayName: player }] };
}
var board = [
  ev('e1', 'pre', 'Scheduled', "0'", 0, 0),
  ev('e1', 'in', 'First Half', "12'", 1, 0, [goal("10'", '2250', 'Gyokeres')]),
  ev('e1', 'in', 'Halftime', "45'", 1, 1, [goal("10'", '2250', 'Gyokeres'), goal("40'", '2251', 'Di Maria')]),
  ev('e1', 'post', 'Full Time', "90'", 1, 1, [goal("10'", '2250', 'Gyokeres'), goal("40'", '2251', 'Di Maria')])
];
var summary = { keyEvents: [] };
var sportStep = 0, newsStep = 0;
var feeds = [
  '<?xml version="1.0"?><rss><channel><item><title>Primeira noticia</title><link>http://x/1</link></item></channel></rss>',
  '<?xml version="1.0"?><rss><channel><item><title>Segunda noticia</title><link>http://x/2</link></item><item><title>Primeira noticia</title><link>http://x/1</link></item></channel></rss>'
];
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host)) {
      if (/summary/.test(opt.path)) { return void respond(cb, 200, JSON.stringify(summary)); }
      // Only the followed competition carries the scripted match; next-fixture scans stay empty.
      if (!/^\/apis\/site\/v2\/sports\/soccer\/por\.1\/scoreboard$/.test(opt.path)) {
        return void respond(cb, 200, JSON.stringify({ events: [] }));
      }
      var d = board[Math.min(sportStep++, board.length - 1)];
      summary = { keyEvents: d.events[0].competitions[0].details };
      return void respond(cb, 200, JSON.stringify(d));
    }
    if (/open-meteo/.test(opt.host)) {
      return void respond(cb, 200, JSON.stringify({ current: { temperature_2m: 18.4, weather_code: 61 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12], precipitation_probability_max: [70] } }));
    }
    if (/news\.google|rtp/.test(opt.host)) {
      return void respond(cb, 200, feeds[Math.min(newsStep++, feeds.length - 1)]);
    }
    respond(cb, 500, '');
  });
  return emitter();
};
// No real localhost connection in refreshSounds(): `reward` is forwarded unchanged.
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { sent.push(JSON.parse(body)); if (cb) { cb(emitter()); } };
  return rq;
};

var factory = require('../index.js');
var store = {};
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 70); }); }
function settle() { return wait(2300); }
function title(i) { return sent[i] ? (sent[i].title + ' | ' + sent[i].message) : ''; }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  store = {
    modules: { sport: true, weather: true, news: true }, lang: 'en',
    football: { provider: 'espn', clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1' }] },
    news: { feeds: ['gnewspt'], interval: 30, seconds: 12, quiet: false, count: 2 }
  };
  shard.start();
  await wait();

  await post('poll', { module: 'sport' }); await wait();
  assert(sent.length === 0, 'first sport poll is a baseline');

  offset += 70000;
  await post('poll', { module: 'sport' }); await settle();
  assert(sent.length > 0, 'a goal between polls sends at least one banner');
  assert(/Gyokeres/.test(title(0)), 'goal banner names the scorer');
  assert(sent[0].source === 'tv-alerts', 'source is tv-alerts');
  assert(sent[0].sound === 'reward', 'sport uses the reward sound');

  sent = [];
  // The banner gap uses Date.now(), so advance the fake clock between sends.
  offset += 2000;
  await post('test', { kind: 'weather' }); await wait(1200);
  assert(sent.length === 1 && /Weather/.test(title(0)), 'weather test sends a banner');

  sent = [];
  await post('poll', { module: 'news' }); await wait();
  assert(sent.length === 0, 'news first read is a baseline');
  // 4 banners already went out in this fake minute; move past the global rate-limit window.
  offset += 70000;
  await post('poll', { module: 'news' }); await settle();
  assert(sent.length === 1 && /Segunda noticia/.test(title(0)), 'a new headline is announced');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error('FAIL', e.stack || e); process.exit(1); });
