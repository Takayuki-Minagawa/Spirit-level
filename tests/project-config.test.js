const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('GitHub Pages deployment is gated by the same local checks', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /\n  test:\n/);
  assert.match(workflow, /run: npm run check/);
  assert.match(workflow, /\n  deploy:\n    needs: test\n/);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
});

test('README documents the implemented behavior and valid local URL', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /HOLD/);
  assert.match(readme, /±0\.5°/);
  assert.match(readme, /±0\.8°/);
  assert.match(readme, /http:\/\/localhost:8000\/spirit-level\//);
  assert.doesNotMatch(readme, /https:\/\/localhost:8000/);
  assert.doesNotMatch(readme, /\[username\]/);
  assert.doesNotMatch(readme, /├── sample\//);
});

test('local scripts and styles referenced by the app pages exist', () => {
  const pages = [
    path.join(root, 'spirit-level/index.html'),
    path.join(root, 'spirit-level/app/index.html')
  ];

  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];
    for (const [, reference] of references) {
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(page), reference)),
        true,
        `${reference} referenced by ${page} must exist`
      );
    }
  }
});
