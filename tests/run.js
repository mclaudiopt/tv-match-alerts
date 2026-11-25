'use strict';
// Single runner for the Shard's mocked tests: node tests/run.js
// A test passes only when it exits 0 and prints ALL GOOD (so a script with no
// assertions cannot pass silently).
var fs = require('fs'), path = require('path'), cp = require('child_process');
var dir = __dirname;
var files = fs.readdirSync(dir).filter(function (f) { return /^test_.*\.js$/.test(f); }).sort();
var failed = 0;
files.forEach(function (f) {
  var r = cp.spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 120000 });
  var out = String(r.stdout || '') + String(r.stderr || '');
  var ok = r.status === 0 && /ALL GOOD/.test(out);
  if (!ok) { failed++; }
  var lines = out.split(/\r?\n/).filter(function (l) { return l.trim(); });
  var last = lines.length ? lines[lines.length - 1].trim() : '(no output)';
  console.log((ok ? 'PASS ' : 'FAIL ') + f + ' :: ' + last);
  if (!ok && r.error) { console.log('  ' + r.error.message); }
});
console.log('\n' + (files.length - failed) + '/' + files.length + ' passed');
process.exit(failed ? 1 : 0);
