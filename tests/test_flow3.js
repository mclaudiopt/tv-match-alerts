'use strict';
// Mocked end-to-end test for 0.4.0: several clubs (each with its own competitions), other sports,
// several news sources, club news and the migration from the old single-team config.
var https = require('https'), http = require('http');
var sent = [];
var realNow = Date.now, offset = 0;
Date.now = function () { return realNow() + offset; };
var stage = 0;

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
function side(id, name, home, score) {
  return { homeAway: home ? 'home' : 'away', team: { id: id, displayName: name, shortDisplayName: name }, score: String(score) };
}
function ev(id, hs, as, details, state) {
  return { id: id, date: new Date(Date.now()).toISOString(),
    status: { displayClock: "55'", type: { state: state || 'in', description: 'Second Half' } },
    competitions: [{ competitors: [side('2250', 'Sporting CP', true, hs[0]), side('2251', 'Porto', false, hs[1])], details: details || [] }] };
}
function ev2(id, hs, as, details) {
  return { id: id, date: new Date(Date.now()).toISOString(),
    status: { displayClock: "30'", type: { state: 'in', description: 'First Half' } },
    competitions: [{ competitors: [side('1929', 'Benfica', true, hs), side('2252', 'Braga', false, as)], details: details || [] }] };
}
function goal(min, team, player) {
  return { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: min }, team: { id: team }, athletesInvolved: [{ displayName: player }] };
}
function goalRole(min, team, player) {
  return { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: min }, team: { id: team },
    participants: [ { type: 'scorer', athlete: { displayName: player } }, { type: 'assist', athlete: { displayName: 'Assist' } } ] };
}
function nba(id, hs, as) {
  return { id: id, date: new Date(Date.now()).toISOString(),
    status: { displayClock: 'Q3', type: { state: 'in', description: '3rd Quarter' } },
    competitions: [{ competitors: [side('13', 'Lakers', true, hs), side('2', 'Celtics', false, as)], details: [] }] };
}

function boards() {
  var sporting = [[0, 0], [1, 0], [1, 0], [1, 0], [1, 1]][Math.min(stage, 4)];
  var benfica = [[0, 0], [0, 0], [1, 0], [1, 0], [1, 0]][Math.min(stage, 4)];
  var lakers = [[0, 0], [0, 0], [0, 0], [2, 0], [2, 0]][Math.min(stage, 4)];
  var sDetails = stage >= 1 ? [goal("10'", '2250', 'Gyokeres')] : [];
  if (stage >= 4) { sDetails = [goal("10'", '2250', 'Gyokeres'), goal("60'", '2251', 'Evanilson')]; }
  var bDetails = stage >= 2 ? [goalRole("22'", '1929', 'Di Maria')] : [];
  return {
    'soccer/por.1': [ev('e1', sporting, sporting[1], sDetails), ev2('e2', benfica, benfica[1], bDetails)],
    'soccer/por.taca.portugal': [],
    'basketball/nba': [nba('e3', lakers[0], lakers[1])]
  };
}
var newsStage = 0;
var feeds = {
  rtp: ['<?xml version="1.0"?><rss><channel><item><title>RTP velha</title><link>http://r/1</link></item></channel></rss>',
        '<?xml version="1.0"?><rss><channel><item><title>RTP nova</title><link>http://r/2</link></item><item><title>RTP velha</title><link>http://r/1</link></item></channel></rss>'],
  cnn: ['<?xml version="1.0"?><rss><channel><item><title>CNN old</title><link>http://c/1</link></item></channel></rss>',
        '<?xml version="1.0"?><rss><channel><item><title>CNN new</title><link>http://c/2</link></item><item><title>CNN old</title><link>http://c/1</link></item></channel></rss>'],
  google: ['<?xml version="1.0"?><rss><channel><item><title>Clube velha</title><link>http://g/1</link></item></channel></rss>',
           '<?xml version="1.0"?><rss><channel><item><title>Clube nova</title><link>http://g/2</link></item><item><title>Clube velha</title><link>http://g/1</link></item></channel></rss>']
};

function serve(opt, cb) {
  if (/site\.api\.espn\.com/.test(opt.host)) {
    if (/summary/.test(opt.path)) {
      var b = boards(), key = 'soccer/por.1', em = /event=([^&]+)/.exec(opt.path), ke = [];
      if (em && em[1] === 'e1') { ke = b[key][0].competitions[0].details || []; }
      if (em && em[1] === 'e2') { ke = b[key][1].competitions[0].details || []; }
      return respond(cb, 200, JSON.stringify({ keyEvents: ke }));
    }
    var m = /\/sports\/(.+?)\/scoreboard/.exec(opt.path);
    var key = m ? m[1] : '';
    return respond(cb, 200, JSON.stringify({ events: boards()[key] || [] }));
  }
  if (/rtp/.test(opt.host)) { return respond(cb, 200, feeds.rtp[Math.min(newsStage, 1)]); }
  if (/cnn/.test(opt.host)) { return respond(cb, 200, feeds.cnn[Math.min(newsStage, 1)]); }
  if (/news\.google\.com/.test(opt.host)) { return respond(cb, 200, feeds.google[Math.min(newsStage, 1)]); }
  if (/geocoding-api\.open-meteo\.com/.test(opt.host)) {
    return respond(cb, 200, JSON.stringify({ results: [
      { id: 2270437, name: 'Caldas da Rainha', latitude: 39.40326, longitude: -9.13839, admin1: 'Distrito de Leiria', country: 'Portugal' }
    ] }));
  }
  if (/api\.open-meteo\.com/.test(opt.host)) {
    return respond(cb, 200, JSON.stringify({
      current: { temperature_2m: '18.4', weather_code: 3 },
      daily: { temperature_2m_max: ['21'], temperature_2m_min: ['11'], precipitation_probability_max: ['20'] }
    }));
  }
  respond(cb, 500, '');
}
https.get = function (opt, cb) { setImmediate(function () { serve(opt, cb); }); return emitter(); };
http.get = function (opt, cb) {
  if (opt.host === '127.0.0.1' && /notification-center/.test(opt.path)) {
    // Mock NC without `golo`: the Shard must fall back to `alert` for goals.
    return respond(cb, 200, JSON.stringify({ enums: { sound: ['chime','soft','reward','success','alert','rotation','open','poweron'] } }));
  }
  setImmediate(function () { serve(opt, cb); }); return emitter();
};
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
    var res = { writeHead: function () {}, end: function (payload) { resolve(payload ? JSON.parse(payload) : null); } };
    var req = { method: 'POST', on: function (e, f) {
      if (e === 'data') { this._d = f; }
      if (e === 'end') { var self = this; setImmediate(function () { self._d(JSON.stringify(body)); f(); }); }
    }, destroy: function () {} };
    shard.route(req, res, sub);
  });
}
function get(sub) {
  return new Promise(function (resolve) {
    var res = { writeHead: function () {}, end: function (payload) { resolve(JSON.parse(payload)); } };
    shard.route({ method: 'GET', on: function () {} }, res, sub);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 120); }); }
function assert(ok, msg) { if (!ok) { throw new Error('FAILED: ' + msg); } console.log('ok - ' + msg); }
function titles() { return sent.map(function (x) { return x.title + ' | ' + x.message; }); }

(async function () {
  store = {
    modules: { sport: true, weather: false, news: true },
    lang: 'pt',
    football: {
      provider: 'espn',
      clubs: [
        { id: '2250', name: 'Sporting CP', league: 'por.1', comps: ['por.1', 'por.taca.portugal'], news: true },
        { id: '1929', name: 'Benfica', league: 'por.1', comps: ['por.1'], news: false }
      ],
      alerts: { goal: true, against: true, card: true, sub: true, varNo: true, start: true, half: true, end: true },
      goalSeconds: 30, otherSeconds: 10, sound: true, mode: 'overlay', volume: 40
    },
    others: {
      picks: [{ sport: 'basketball', league: 'basketball', teamId: '13', name: 'Lakers' }],
      alerts: { start: true, half: true, end: true, score: true },
      seconds: 10, sound: true, mode: 'overlay', volume: 55
    },
    news: { feeds: ['rtp', 'cnn'], interval: 30, seconds: 12, quiet: false, count: 1, sound: false, mode: 'banner', volume: 30 }
  };
  shard.start();
  await wait();

  // 1) baseline (the mocked HTTP chain can take a few ticks; wait for the busy guard to clear)
  await post('poll', { module: 'sport' }); await wait(1200);
  assert(sent.length === 0, 'first sport poll is only a baseline');

  // 2) Sporting goal
  offset += 70000; stage = 1;
  await post('poll', { module: 'sport' }); await wait(500);
  assert(sent.length === 1 && /SPORTING/.test(sent[0].title), 'goal announced for the first club');
  assert(sent[0].sound === 'reward', 'sport notifications use reward by default');
  assert(sent[0].volume === 40, 'goal uses the football volume from the config');
  assert(sent[0].image === 'https://a.espncdn.com/i/teamlogos/soccer/500/2250.png',
    'goal carries the club crest as the overlay icon');
  assert(/Gyokeres/.test(sent[0].title) && /Gyokeres/.test(sent[0].message),
    'goal banner names the scorer in the title and the message');
  assert(sent[0].mode === 'overlay', 'football uses overlay');
  assert(sent[0].group === false, 'group false for football');
  assert(/Sporting CP 1-0 Porto/.test(sent[0].message), 'scoreboard only for the chosen club');

  // 3) Benfica goal in its own match
  sent = []; offset += 70000; stage = 2;
  await post('poll', { module: 'sport' }); await wait(200);
  console.log(titles().join('\n'));
  assert(sent.length === 1 && /BENFICA/.test(sent[0].title), 'second club announced with its own name');
  assert(/Di Maria/.test(sent[0].title) && /Di Maria/.test(sent[0].message),
    'scorer is read from ESPN participants with an explicit role');

  // 4) other sport: score change
  sent = []; offset += 70000; stage = 3;
  await post('poll', { module: 'sport' }); await wait(200);
  console.log(titles().join('\n'));
  assert(sent.length === 1 && /Lakers 2-0 Celtics/.test(sent[0].message), 'other sport score change announced');
  assert(sent[0].sound === 'reward', 'other sports also use reward');
  assert(sent[0].volume === 55, 'other sports use their own volume');
  assert(sent[0].image === 'https://a.espncdn.com/i/teamlogos/nba/500/13.png',
    'other sport carries its team crest');

  // 5) opponent goal
  sent = []; offset += 70000; stage = 4;
  await post('poll', { module: 'sport' }); await wait(200);
  console.log(titles().join('\n'));
  assert(sent.length === 1 && /Porto/.test(sent[0].title), 'goal against announced');
  assert(/Evanilson/.test(sent[0].title) && /Evanilson/.test(sent[0].message), 'opponent goal also names the scorer');

  // 6) news: two sources + club news, first read is a baseline
  offset += 61000;  // clear the global 4-per-minute window used by the sport tests
  sent = [];
  await post('poll', { module: 'news' }); await wait(300);
  assert(sent.length === 0, 'news baseline for every source');

  // 7) new headline in each source
  sent = []; newsStage = 1;
  await post('poll', { module: 'news' }); await wait(3200); // three banners, at least 1 s apart
  console.log(titles().join('\n'));
  assert(sent.length === 3, 'one banner per source (RTP, CNN, club news)');
  assert(sent.some(function (x) { return /RTP nova/.test(x.message); }), 'RTP headline');
  assert(sent.some(function (x) { return /CNN new/.test(x.message); }), 'CNN headline');
  assert(sent.some(function (x) { return /Clube nova/.test(x.message); }), 'club news headline');
  assert(sent.every(function (x) { return x.source === 'tv-alerts'; }), 'every notify carries the source');
  assert(sent.every(function (x) { return x.volume === 30; }), 'news uses its own volume');

  // 8) news test: nothing new must still show one headline, and only one
  offset += 61000;
  sent = [];
  await post('poll', { module: 'news' }); await wait(300);
  assert(sent.length === 0, 'a normal news poll with nothing new sends nothing');
  await post('test', { kind: 'news' }); await wait(400);
  console.log(titles().join('\n'));
  assert(sent.length === 1, 'news test shows exactly one headline even with nothing new');
  assert(/RTP nova/.test(sent[0].message), 'news test shows the newest headline of the first source');

  // 8b) the panel language switch saves the language only
  var lr = await post('config', { lang: 'en' });
  assert(lr.config.lang === 'en' && lr.config.football.clubs.length === 2, 'language change keeps the clubs');

  // 9) migration: an old 0.3 config with one team becomes one club
  store = {
    modules: { sport: true, weather: false, news: false }, lang: 'en',
    sport: { provider: 'espn', sport: 'soccer', league: 'por.1', teamId: '2250', teamName: 'Sporting CP',
      on: { goal: true }, goalSeconds: 30, otherSeconds: 10, sound: true, mode: 'banner' }
  };
  var st = await get('state');
  assert(st.config.football.clubs.length === 1 && st.config.football.clubs[0].id === '2250', 'old single-team config migrates to one club');
  assert(st.config.football.clubs[0].comps.indexOf('uefa.champions') >= 0, 'migrated club gets its competitions');

  // 9) config route: add a club, remove another, save feeds
  var r = await post('config', {
    football: { clubs: [{ id: '2250', name: 'Sporting CP', league: 'por.1', comps: ['por.1'], news: true }] },
    news: { feeds: ['bbc', 'reuters'] }
  });
  assert(r.config.football.clubs.length === 1 && r.config.news.feeds.join(',') === 'bbc,reuters', 'config saves clubs and feeds');
  var bad = await post('config', { news: { feeds: ['nope'] } });
  assert(bad && bad.error, 'unknown feed is rejected');
  var gn = await post('config', { news: { feeds: ['gnewspt'] } });
  assert(gn.config.news.feeds.length === 1 && gn.config.news.feeds[0] === 'gnewspt',
    'Google News (PT) can be the only news source');
  assert(gn.config.maxClubs === 3, 'the panel caps the clubs at 3');
  var tooMany = await post('config', { football: { clubs: [
    { id: '1', name: 'A', league: 'por.1', comps: ['por.1'] },
    { id: '2', name: 'B', league: 'por.1', comps: ['por.1'] },
    { id: '3', name: 'C', league: 'por.1', comps: ['por.1'] },
    { id: '4', name: 'D', league: 'por.1', comps: ['por.1'] }
  ] } });
  assert(tooMany && tooMany.error, 'a fourth club is rejected');

  // 10) custom place: search by name, save it, and get weather for those coordinates
  store.modules.weather = true;
  var geo = await post('geocode', { name: 'Caldas da Rainha' });
  assert(geo.places.length === 1 && geo.places[0].id === 'c2270437' &&
    geo.places[0].lat === 39.40326, 'geocoding returns the coordinates from the name');
  assert(/Leiria/.test(geo.places[0].name), 'the result is labelled with its region');
  var saved = await post('config', { weather: { custom: geo.places, place: geo.places[0].id } });
  assert(saved.config.weather.place === 'c2270437' && saved.config.weather.custom.length === 1,
    'custom place is saved and selected');
  assert(saved.config.places.length === 13 && saved.config.places[12].id === 'c2270437',
    'custom place appears in the place list of the panel');
  offset += 86400000;  // clear the global rate-limit window before the weather test
  sent = [];
  await post('test', { kind: 'weather' }); await wait(500);
  console.log(titles().join('\n'));
  assert(sent.length === 1 && /Caldas da Rainha/.test(sent[0].message),
    'weather banner uses the custom place');
  var badPlace = await post('config', { weather: { custom: [{ id: 'c1', name: 'x', lat: 999, lon: 0 }] } });
  assert(badPlace && badPlace.error, 'a place with bad coordinates is rejected');
  var removed = await post('config', { weather: { custom: [], place: 'c2270437' } });
  assert(removed && removed.error, 'a removed place cannot stay selected');
  var after = await post('config', { weather: { custom: [] } });
  assert(after.config.weather.place === 'lisbon', 'removing the selected place falls back to Lisboa');

  store = { modules: { sport: false, weather: false, news: false } };
  var fresh = await get('state');
  assert(fresh.config.news.feeds.join(',') === 'gnewspt', 'a fresh config uses only Google News (PT)');

  shard.stop();
  console.log('\nALL GOOD');
})().catch(function (e) { console.error(e.message); process.exit(1); });
