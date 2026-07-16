const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('diagnostics page loads external maintainable assets', () => {
  const html = fs.readFileSync(path.join(root, 'spirit-level/index.html'), 'utf8');
  assert.match(html, /href="diagnostics\.css"/);
  assert.match(html, /src="diagnostics\.js"/);
  assert.doesNotMatch(html, /<script>\s*\(function/);
  assert.match(html, /id="resultBox" aria-live="polite"/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/);
});

test('measurement page exposes hold, recovery, and accessible dialog controls', () => {
  const html = fs.readFileSync(path.join(root, 'spirit-level/app/index.html'), 'utf8');
  assert.match(html, /id="holdBtn"[^>]+aria-pressed="false"/);
  assert.match(html, /id="basisValue"/);
  assert.match(html, /id="sensorRecovery"[^>]+role="alert"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="helpDialogTitle"/);
  assert.match(html, /id="levelIndicator"[^>]+aria-live="polite"/);
  assert.match(html, /src="measurement-state\.js"/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/);
});

test('styles support responsive level geometry and reduced motion', () => {
  const appCss = fs.readFileSync(path.join(root, 'spirit-level/app/style.css'), 'utf8');
  const diagnosticsCss = fs.readFileSync(path.join(root, 'spirit-level/diagnostics.css'), 'utf8');
  assert.match(appCss, /width:\s*min\(280px, 100%\)/);
  assert.match(appCss, /aspect-ratio:\s*1/);
  assert.match(appCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(diagnosticsCss, /prefers-reduced-motion:\s*reduce/);
});
