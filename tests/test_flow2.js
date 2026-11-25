'use strict';
// Mocked end-to-end test, updated for the 0.5.x schema and notify defaults:
// notification fields (source/group/sound/mode), news baseline, several new headlines,
// two goals between polls and the 1 s global banner gap.
var https = require('https'), http = require('http');
var sent = [];

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
  return { events: [{ id: id, date: new Date().toISOString(), name: 'Match', status: { displayClock: clock, type: { state: state, description: desc } }, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: 2250, displayName: 'Sporting CP', shortDisplayName: 'Sporting' }, score: String(hs) },
    { homeAway: 'away', team: { id: 2251, displayName: 'Benfica', shortDisplayName: 'Benfica' }, score: String(as) }
  ], details: details || [] }] }] };
}
function goal(min, team, player) {
  return { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: min }, team: { id: team }, athletesInvolved: [{ displayName: player }] };
}
var board = [
  ev('e1', 'in', 'First Half', "5'", 0, 0),
  ev('e1', 'in', 'First Half', "20'", 2, 0, [goal("10'", '2250', 'Gyokeres'), goal("18'", '2250', 'Trincao')]),
  ev('e1', 'in', 'Second Half', "60'", 2, 1, [goal("10'", '2250', 'Gyokeres'), goal("18'", '2250', 'Trincao'), goal("55'", '2251', 'Di Maria')]),
  ev('e1', 'post', 'Full Time', "90'", 2, 1, [goal("10'", '2250', 'Gyokeres'), goal("18'", '2250', 'Trincao'), goal("55'", '2251', 'Di Maria')])
];
var summary = { keyEvents: [] };
var feedA = '<?xml version="1.0"?><rss><channel>' +
  '<item><title>Manchete &amp; velha &#039;A&#039;</title><link>http://x/1</link></item>' +
  '</channel></rss>';
var feedB = '<?xml version="1.0"?><rss><channel>' +
  '<item><title>Manchete nova 2</title><link>http://x/3</link></item>' +
  '<item><title>Manchete nova 1</title><link>http://x/2</link></item>' +
  '<item><title>Manchete &amp; velha &#039;A&#039;</title><link>http://x/1</link></item>' +
  '</channel></rss>';
var sportStep = 0, newsStep = 0, feeds = [feedA, feedB];
var lastDetails = [];
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

https.get = function (opt, cb) {
  var r = emitter();
  setImmediate(function () {
    if (process.env.DBG) { console.log('GET', opt.host, opt.path); }
    if (/espn/.test(opt.host)) {
      if (/summary/.test(opt.path)) { return void respond(cb, 200, JSON.stringify(summary)); }
      // Only the followed competition carries the scripted match. Other leagues and the
      // next-fixture scan (?dates=) stay empty so they cannot consume the scripted steps.
      if (!/^\/apis\/site\/v2\/sports\/soccer\/por\.1\/scoreboard$/.test(opt.path)) {
        return void respond(cb, 200, JSON.stringify({ events: [] }));
      }
      var d = board[Math.min(sportStep++, board.length - 1)];
      lastDetails = d.events[0].competitions[0].details;
      summary = { keyEvents: lastDetails };
      return void respond(cb, 200, JSON.stringify(d));
    }
    if (/rtp/.test(opt.host)) { return void respond(cb, 200, feeds[Math.min(newsStep++, feeds.length - 1)]); }
    if (/open-meteo/.test(opt.host)) {
      return void respond(cb, 200, JSON.stringify({ current: { temperature_2m: 15, weather_code: 61 }, daily: { temperature_2m_max: [18], temperature_2m_min: [11], precipitation_probability_max: [88] } }));
    }
    respond(cb, 500, '');
  });
  return r;
};
// Avoid a real localhost connection in refreshSounds(): no mock means no allowed-sound list,
// so `reward` is forwarded unchanged (the current default for sport notifications).
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
// The Shard spaces banners at least 1 s apart and news headlines another 1 s apart.
function settle() { return wait(2300); }
function show(label) {
  console.log('--- ' + label);
  sent.forEach(function (x) {
    console.log(JSON.stringify({ title: x.title, message: x.message, mode: x.mode, sound: x.sound, source: x.source, group: x.group }));
  });
}
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  store = {
    modules: { sport: true, weather: false, news: true }, lang: 'pt',
    football: { provider: 'espn', clubs: [{ id: '2250', name: 'Sporting', league: 'por.1' }] },
    news: { feeds: ['rtp'], interval: 30, seconds: 12, quiet: false, count: 2 }
  };
  shard.start();
  await wait();

  // 1) first sport poll is a baseline (no banner)
  await post('poll', { module: 'sport' }); await wait();
  assert(sent.length === 0, 'first sport poll only builds the baseline');

  // 2) two goals in one poll -> two banners, both with source/group/sound/mode
  offset += 70000;
  await post('poll', { module: 'sport' }); await settle();
  show('two goals');
  assert(sent.length === 2, 'two goals between polls give two banners');
  assert(sent[0].title.indexOf('GOLO') > -1, 'goal banner title');
  assert(sent[0].source === 'tv-alerts', 'source is tv-alerts');
  assert(sent[0].group === false, 'group is disabled for sport');
  assert(sent[0].sound === 'reward', 'sport uses the reward sound');
  assert(sent[0].mode === 'overlay', 'default sport mode is overlay');

  // 3) opponent goal
  sent = [];
  offset += 70000;
  await post('poll', { module: 'sport' }); await wait();
  show('opponent goal');
  assert(sent.length === 1 && sent[0].title.indexOf('Golo do') === 0, 'opponent goal announced');

  // 4) full-time, still no duplicate goal
  sent = [];
  offset += 70000;
  await post('poll', { module: 'sport' }); await wait();
  show('full time');
  assert(sent.length === 1 && /Fim do jogo/.test(sent[0].title), 'only the full-time banner at the end');

  // 5) news: first poll is a baseline, nothing announced
  sent = [];
  await post('poll', { module: 'news' }); await wait();
  show('news baseline');
  assert(sent.length === 0, 'news first read announces nothing');

  // 6) two new headlines, count 2 -> two banners, entities decoded
  await post('poll', { module: 'news' }); await settle();
  show('news new');
  assert(sent.length === 2, 'count 2 announces two headlines');
  assert(sent[0].message === 'Manchete nova 2', 'newest headline first');
  assert(sent[1].message === 'Manchete nova 1', 'second headline');

  // 7) mode full
  sent = [];
  store = JSON.parse(JSON.stringify(store));
  store.football.mode = 'full'; store.football.sound = false;
  offset += 70000;
  await post('test', { kind: 'card' }); await wait(1200);
  show('mode full');
  assert(sent.length === 1 && sent[0].mode === 'full', 'mode full reaches the notify body');
  assert(!sent[0].sound, 'sound off sends no sound field');

  // 8) overlay is accepted and forwarded
  sent = [];
  store = JSON.parse(JSON.stringify(store));
  store.football.mode = 'overlay'; store.football.sound = true;
  await post('test', { kind: 'start' }); await wait();
  assert(sent.length === 1 && sent[0].mode === 'overlay', 'mode overlay is forwarded');

  // 9) weather test uses the saved overlay mode (the bug that made tests go out as banner)
  sent = [];
  store = JSON.parse(JSON.stringify(store));
  store.weather = { place: 'lisbon', interval: 60, seconds: 12, quiet: true, mode: 'overlay' };
  offset += 70000;
  await post('test', { kind: 'weather' }); await wait(1200);
  show('weather overlay');
  assert(sent.length === 1 && sent[0].mode === 'overlay', 'weather test uses overlay mode');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.message); process.exit(1); });
