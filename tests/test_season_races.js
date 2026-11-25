'use strict';
// The F1 picker must list the whole season (ESPN ?dates=YYYY), sorted by date, and fall back to
// the current scoreboard when the season request fails.
var https = require('https'), http = require('http');
var realNow = Date.now, offset = 0;
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
function race(id, name, date, state) {
  return { id: id, name: name, date: date, status: { type: { state: state } } };
}
var season = { events: [
  race('r9', 'Late Race', '2026-11-01T12:00Z', 'pre'),
  race('r1', 'Early Race', '2026-03-01T12:00Z', 'post')
] };
var current = { events: [race('r9', 'Current Race', '2026-11-01T12:00Z', 'in')] };
var seasonFails = false;
https.get = function (opt, cb) {
  setImmediate(function () {
    if (/espn/.test(opt.host)) {
      if (/dates=/.test(opt.path)) {
        if (seasonFails) { return void respond(cb, 502, 'bad'); }
        return void respond(cb, 200, JSON.stringify(season));
      }
      return void respond(cb, 200, JSON.stringify(current));
    }
    respond(cb, 500, '');
  });
  return emitter();
};
http.get = function (opt, cb) { return respond(cb, 500, ''); };
http.request = function () { var rq = emitter(); rq.write = function () {}; rq.end = function () {}; return rq; };

var factory = require('../index.js');
var store = { modules: { sport: false, weather: false, news: false }, civ: { enabled: false }, lang: 'en' };
var shard = factory({ config: { get: function () { return store; }, set: function (s) { store = s; } } });
function get(sub) {
  return new Promise(function (resolve) {
    shard.route({ method: 'GET', on: function () {} },
      { writeHead: function () {}, end: function (p) { resolve(JSON.parse(p)); } }, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 50); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }

(async function () {
  var r = await get('races'); await wait();
  assert(r.season === true, 'season scoreboard is used for the picker');
  assert(r.races.length === 2, 'all season events are returned (' + r.races.length + ')');
  assert(r.races[0].id === 'r1' && r.races[1].id === 'r9', 'events are sorted by date');
  assert(r.races[0].past === true && r.races[1].past === false, 'past flag comes from the event state');

  seasonFails = true;
  offset += 21600001;                 // expire the 6 h season cache
  r = await get('races'); await wait();
  assert(r.season === false, 'a failed season request falls back to the current scoreboard');
  assert(r.races.length === 1 && r.races[0].id === 'r9', 'fallback lists the current race only');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
