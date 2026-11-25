'use strict';
// Focused test for the 0.4.6 robustness fixes:
//  A1 one failing competition must not hide the clubs in the good ones
//  A2 two clubs in the same match share ONE summary request
//  A7 empty/far-off scoreboards cached 5 min / 2 min, near kick-off 20 s
//  A3 at most 4 news banners per poll, 1/s, leftovers announced in the next poll
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

var sent = [], scoreCalls = {}, summaryCalls = 0, failCup = true;
var board = { state: 'pre', inMinutes: 10, details: [] };
var newsStage = 0;
function side(id, name, score, home) {
  return { homeAway: home ? 'home' : 'away', team: { id: id, displayName: name, shortDisplayName: name }, score: String(score) };
}
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
function scoreboard() {
  var date = new Date(Date.now() + board.inMinutes * 60000).toISOString();
  return { events: [{
    id: 'e1', date: date,
    status: { displayClock: "45'", type: { state: board.state, description: board.state === 'pre' ? 'Scheduled' : 'Second Half' } },
    competitions: [{ competitors: [side('2250', 'Sporting', 0, true), side('2251', 'Benfica', 0, false)], details: board.details }]
  }] };
}
function rss(prefix, n) {
  var s = '<?xml version="1.0"?><rss><channel>';
  for (var i = 0; i < n; i++) {
    s += '<item><title>' + prefix + ' ' + (i + 1) + '</title><link>http://' + prefix + '/' + i + '</link></item>';
  }
  return s + '</channel></rss>';
}
function serve(opt, cb) {
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) { summaryCalls++; return respond(cb, 200, JSON.stringify({ keyEvents: [] })); }
    var m = /\/sports\/(.+?)\/scoreboard/.exec(opt.path), key = m ? m[1] : '';
    scoreCalls[key] = (scoreCalls[key] || 0) + 1;
    if (key === 'soccer/por.taca.portugal' && failCup) { return respond(cb, 503, 'cup down'); }
    return respond(cb, 200, JSON.stringify(scoreboard()));
  }
  if (/rtp/.test(opt.host)) {
    return respond(cb, 200, rss('rtp', newsStage === 0 ? 1 : 5));
  }
  if (/cnn/.test(opt.host)) {
    return respond(cb, 200, rss('cnn', newsStage === 0 ? 1 : 5));
  }
  respond(cb, 500, '');
}
https.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.get = https.get;
http.request = function (opt, cb) {
  var rq = emitter(), body = '';
  rq.write = function (d) { body += d; };
  rq.end = function () { var x = JSON.parse(body); x._t = Date.now(); sent.push(x); if (cb) { cb(emitter()); } };
  return rq;
};

var factory = require('../index.js');
var store = {
  modules: { sport: true, weather: false, news: true }, lang: 'en',
  football: {
    provider: 'espn',
    clubs: [
      { id: '2250', name: 'Sporting', league: 'por.1', comps: ['por.1', 'por.taca.portugal'], news: false },
      { id: '2251', name: 'Benfica', league: 'por.1', comps: ['por.1'], news: false }
    ],
    alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
    goalSeconds: 30, otherSeconds: 10, sound: true, mode: 'overlay'
  },
  others: { picks: [], alerts: { start: true, half: true, end: true, score: false }, seconds: 10, sound: true, mode: 'overlay' },
  news: { feeds: ['rtp', 'cnn'], interval: 30, seconds: 12, quiet: false, count: 3, sound: false, mode: 'banner' }
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 120); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
function pollSport() { return post('poll', { module: 'sport' }).then(function () { return wait(180); }); }
function pollNews(ms) { return post('poll', { module: 'news' }).then(function () { return wait(ms || 180); }); }

(async function () {
  shard.start();
  await wait();

  // --- A7: cache TTL from the status of the scoreboard -----------------------------------------
  await pollSport();
  assert(scoreCalls['soccer/por.1'] === 1, 'first sport poll fetches por.1 once');

  offset += 70000; await pollSport();
  assert(scoreCalls['soccer/por.1'] === 2, 'kick-off within 30 min -> fetched again after 20 s');

  board.inMinutes = 90;                      // now too far away: 2 min cache
  offset += 70000; await pollSport();
  assert(scoreCalls['soccer/por.1'] === 3, 'distant kick-off -> fetched after the old TTL expired');
  offset += 70000; await pollSport();
  assert(scoreCalls['soccer/por.1'] === 3, 'distant kick-off -> cached for 2 min');

  // --- A1 + A2: failing cup and a shared summary -----------------------------------------------
  board.state = 'in';                        // summary is only fetched for a live match
  summaryCalls = 0;
  sent = [];
  offset += 70000; await pollSport();
  var st = await get('state');
  console.log('sport error: ' + JSON.stringify(st.status.sport.error));
  console.log('watches: ' + JSON.stringify(st.watches));
  assert(!st.status.sport.error, 'a failed competition does not fail the whole sport module');
  assert(st.watches['club:2250'] && st.watches['club:2250'].line &&
    st.watches['club:2251'] && st.watches['club:2251'].line,
    'both clubs were still analysed from the good competition');
  assert(st.log.some(function (x) { return x.mod === 'sport' && x.kind === 'error' && /por\.taca/.test(x.text); }),
    'the failed competition is logged on its own');
  assert(summaryCalls === 1, 'two clubs in the same match share ONE summary request (' + summaryCalls + ')');

  // --- A3: global news budget, spacing and leftovers -------------------------------------------
  offset += 61000;  // clear the global 4-per-minute window
  await post('test', { kind: 'goal' }); await wait(1600);  // forces the queued sport banner out
  await pollNews(300);                       // baseline for both feeds
  sent = [];                                 // ignore banners left over from the sport section

  offset += 61000;  // fresh minute for the news batch
  newsStage = 1; sent = [];
  await pollNews(3500);
  assert(sent.length === 4, 'a poll with 6 new headlines sends at most 4 banners (' + sent.length + ')');
  assert(sent[0].message === 'rtp 2' && sent[3].message === 'cnn 2',
    'banners go in feed order and do not exceed the budget');
  var gaps = [];
  for (var gi = 1; gi < sent.length; gi++) { gaps.push(sent[gi]._t - sent[gi - 1]._t); }
  assert(Math.min.apply(null, gaps) >= 950, 'news banners are at least 1 s apart (' + gaps.join(',') + ')');

  offset += 61000;  // fresh minute for the leftovers
  sent = [];
  await pollNews(3500);
  assert(sent.length === 4, 'the 4 headlines left over are sent in the next poll (' + sent.length + ')');
  assert(sent.some(function (x) { return x.message === 'cnn 5'; }), 'leftovers from the second feed are not lost');

  sent = [];
  await pollNews(200);
  assert(sent.length === 0, 'a third poll with nothing new is silent');

   // spacing is asserted on the timestamps of the notify calls in the first two batches
  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
