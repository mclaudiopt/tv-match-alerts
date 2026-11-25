'use strict';
// Focused test for B3: next fixture in /api/state and a single pre-kick-off banner.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };

var sent = [], scoreCalls = [];
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
function pad(n) { return ('0' + n).slice(-2); }
function ymd(d) { return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()); }
function futureDay() {
  var d = new Date(); d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + 5 * 86400000);
}
function eventOn(day) {
  var iso = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate()) + 'T20:30:00Z';
  function side(id, name, home) {
    return { homeAway: home ? 'home' : 'away', team: { id: id, displayName: name, shortDisplayName: name }, score: '0' };
  }
  return { id: 'next1', date: iso, name: 'Sporting CP at FC Porto',
    status: { displayClock: '', type: { state: 'pre', description: 'Scheduled' } },
    competitions: [{ competitors: [side('2250', 'Sporting CP', true), side('2251', 'FC Porto', false)], details: [] }] };
}
function serve(opt, cb) {
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) { return respond(cb, 200, JSON.stringify({ keyEvents: [] })); }
    scoreCalls.push(opt.path);
    var m = /[?&]dates=(\d{8})/.exec(opt.path);
    if (!m) { return respond(cb, 200, JSON.stringify({ events: [] })); } // no match today
    var day = new Date(Number(m[1].slice(0, 4)), Number(m[1].slice(4, 6)) - 1, Number(m[1].slice(6, 8)));
    var evs = ymd(day) === ymd(futureDay()) ? [eventOn(day)] : [];
    return respond(cb, 200, JSON.stringify({ events: evs }));
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
  modules: { sport: true, weather: false, news: false }, lang: 'en',
  football: {
    provider: 'espn',
    clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1', comps: ['por.1'], news: false }],
    alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
    goalSeconds: 30, otherSeconds: 10, sound: true, mode: 'overlay',
    nextGame: { enabled: true, minutes: 30 }
  },
  others: { picks: [], alerts: { start: true, half: true, end: true, score: false }, seconds: 10, sound: true, mode: 'overlay' },
  news: { feeds: ['rtp'], interval: 30, seconds: 12, quiet: true, count: 1, sound: false, mode: 'banner' }
};
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function post(sub, body, which) {
  var target = which || shard;
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (p) { resolve(p ? JSON.parse(p) : null); } };
    var req = { method: 'POST', on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body)); f(); }); }
    }, destroy: function () {} };
    target.route(req, res, sub);
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
function poll() { return post('poll', { module: 'sport' }).then(function () { return wait(1200); }); }

(async function () {
  shard.start();
  await wait();
  await poll();
  var st = await get('state');
  console.log('next: ' + JSON.stringify(st.next));
  assert(st.next.length === 1, 'the next fixture is exposed in /api/state');
  assert(/Sporting CP/.test(st.next[0].club) && /FC Porto/.test(st.next[0].away), 'both teams are shown');
  assert(/20:30/.test(st.next[0].line) && /d[a-z]*/.test(st.next[0].line), 'local kick-off time is formatted');
  assert(scoreCalls.some(function (p) { return /dates=/.test(p); }), 'future days are scanned with ?dates=');
  assert(scoreCalls.filter(function (p) { return /dates=/.test(p); }).length <= 6,
    'the scan stops at the first day with a match (' + scoreCalls.filter(function (p) { return /dates=/.test(p); }).length + ' requests)');

  // A second poll must reuse the cache: no new dated requests.
  var before = scoreCalls.length;
  await poll();
  assert(scoreCalls.length - before <= 1, 'the next fixture is cached for an hour');

  // The panel button posts kind:'next': one banner, without marking the real warning as sent.
  sent = [];
  await post('test', { kind: 'next' }); await wait(200);
  assert(sent.length === 1 && sent[0].title === 'PRE-MATCH', 'kind=next sends one PRE-MATCH banner');
  assert(sent[0].mode === 'overlay' && sent[0].group === false, 'the warning test uses the sport style');
  assert(sent[0].image === 'https://a.espncdn.com/i/teamlogos/soccer/500/2250.png',
    'the warning test also shows the club crest');
  var afterTest = await get('state');
  assert(afterTest.next.length === 1, 'the test does not consume the real next fixture');

  // Move to 25 min before kick-off: exactly one warning banner.
  sent = [];
  offset = new Date(st.next[0].dateMs).getTime() - realNow() - 25 * 60000;
  await poll();
  console.log(sent.map(function (x) { return x.title + ' | ' + x.message; }).join('\n'));
  assert(sent.length === 1 && sent[0].title === 'PRE-MATCH', 'a PRE-MATCH banner is sent 25 min before kick-off');
  assert(sent[0].mode === 'overlay' && sent[0].source === 'tv-alerts', 'warning uses the sport style and source');

  sent = [];
  await poll();
  assert(sent.length === 0, 'the warning is sent only once for the same fixture');
  assert(store.nextNotified && store.nextNotified['espn-next1'], 'the warned fixture id is saved in ctx.config');

  // A brand-new Shard instance with the same config simulates a TV restart.
  var hint = store.nextHints && store.nextHints['club:2250'];
  assert(hint && /^\d{8}$/.test(hint.date), 'the found fixture date is saved as a hint');
  var shard2 = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
  shard.stop();
  shard2.start(); await wait(200);
  scoreCalls.length = 0;
  sent = [];
  await post('poll', { module: 'sport' }, shard2); await wait(400);
  var dates = scoreCalls.filter(function (p) { return /dates=/.test(p); }).map(function (p) {
    return /dates=(\d{8})/.exec(p)[1];
  });
  assert(dates.length <= 2, 'restart scans only the saved day (' + dates.length + ' dated requests)');
  assert(dates.every(function (d) { return d === hint.date; }), 'the scan starts at the saved date');
  assert(sent.length === 0, 'a restarted Shard does not repeat the warning');
  shard2.stop();
  shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
  shard.start(); await wait(200);

  // Turn it off: saving the config is enough, no banner even inside the window.
  var cfg = await post('config', { football: { nextGame: { enabled: false, minutes: 15 } } });
  assert(cfg.config.football.nextGame.enabled === false && cfg.config.football.nextGame.minutes === 15,
    'warning settings are saved in the config');
  sent = [];
  offset += 60000;
  await poll();
  assert(sent.length === 0, 'a disabled warning sends nothing');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
