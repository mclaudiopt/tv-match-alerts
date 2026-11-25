'use strict';
// Legacy smoke test, updated for the 0.5.x config schema: football.clubs[] instead of the old
// flat `sport` / `teamId`. It checks state, ui, config save and a test notification.
var path = '../index.js';
var factory = require(path);
var store = {
    modules: { sport: true, weather: true, news: true }, lang: 'en',
    football: {
        provider: 'espn', goalSeconds: 46, alerts: { goal: true },
        clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1' }]
    }
};
var ctx = { config: { get: function () { return store; }, set: function (s) { store = s; } } };
var shard = factory(ctx);
function fakeReq(body) {
  var dataFn = null, endFn = null;
  return {
    method: 'POST',
    on: function (ev, fn) {
      if (ev === 'data') { dataFn = fn; }
      if (ev === 'end') { endFn = fn; setTimeout(function () { if (dataFn) { dataFn(body); } endFn(); }, 0); }
    },
    destroy: function () {}
  };
}
function call(sub, method) {
  return new Promise(function (resolve) {
    var out = {};
    var res = {
      writeHead: function (code) { out.code = code; },
      end: function (b) { out.body = b; resolve(out); }
    };
    var handled = shard.route({ method: method || 'GET' }, res, sub);
    if (!handled) { resolve({ code: 404, body: 'not handled' }); }
  });
}
function post(sub, body) {
  return new Promise(function (resolve) {
    var out = {};
    var res = { writeHead: function (c) { out.code = c; }, end: function (b) { out.body = b; resolve(out); } };
    var handled = shard.route(fakeReq(JSON.stringify(body)), res, sub);
    if (!handled) { resolve({ code: 404, body: 'not handled' }); }
  });
}
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
(async function () {
  var r = await call('state');
  var s = JSON.parse(r.body);
  assert(r.code === 200 && s.config.football.clubs[0].id === '2250', 'state exposes the followed club');
  assert(s.config.football.goalSeconds === 46, 'state exposes goalSeconds');

  r = await call('ui');
  assert(r.code === 200 && r.body.length > 1000, 'ui is served');

  r = await post('config', {
    modules: { sport: true, weather: true, news: true },
    football: {
      provider: 'espn', clubs: [{ id: '1', name: 'Hawks', league: 'por.1' }],
      alerts: { card: false }, goalSeconds: 30
    },
    weather: { place: 'porto', interval: 15, quiet: false },
    news: { feeds: ['bbc'], interval: 30 }
  });
  assert(r.code === 200, 'config saved');

  r = await call('state');
  s = JSON.parse(r.body);
  assert(s.config.football.clubs[0].name === 'Hawks', 'saved club name');
  assert(s.config.football.alerts.card === false, 'saved alert switch');
  assert(s.config.weather.place === 'porto', 'saved place');
  assert(s.config.news.feeds[0] === 'bbc', 'saved feed list');
  assert(Object.keys(s.status).length === 4, 'four module statuses');

  r = await post('test', { kind: 'goal' });
  assert(r.code === 200 && JSON.parse(r.body).ok === true, 'goal test accepted');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e); process.exit(1); });
