'use strict';
// Lightweight ES5 gate for the shipped Node code (the TV runs Node 4.4). The published catalog
// runs a full ES5 parser; this catches accidental ES6+ syntax before pack/install locally.
var fs = require('fs'), path = require('path');
var files = ['index.js', 'news.js', 'providers/espn.js', 'providers/af.js'];
var root = path.join(__dirname, '..');

function strip(src) {
    var out = '', i = 0, n = src.length, state = 'code', quote = '', c, d;
    while (i < n) {
        c = src.charAt(i); d = src.charAt(i + 1);
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; i++; continue; }
            out += c; i++; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += '\n'; } i++; continue; }
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; }
            else { if (c === '\n') { out += '\n'; } i++; }
            continue;
        }
        if (state === 'str') {
            if (c === '\\') { i += 2; continue; }
            if (c === quote) { state = 'code'; }
            if (c === '\n') { out += '\n'; }
            i++;
        }
    }
    return out;
}
var bad = 0;
files.forEach(function (f) {
    var code = strip(fs.readFileSync(path.join(root, f), 'utf8'));
    if (/\b(let|const|class|async|await|yield)\b|=>|`|\.\.\.|\?\.|\?\?/.test(code)) {
        console.log('ES6+ construct in ' + f); bad++;
    }
});
console.log(bad ? 'ES5 check failed' : 'ES5 OK (' + files.length + ' files)');
process.exit(bad ? 1 : 0);
