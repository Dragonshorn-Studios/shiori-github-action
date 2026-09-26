import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMarkdown } from '../src/model.js';

test('normalizes AFFiNE markdown export artifacts', () => {
  const input = `Work through one item per&#10;issue.\n\n1. First\n1. Second\n\n## Other\n1. New list\n\nUse [AGENTS.md/README/CI](http://AGENTS.md/README/CI) and [deferred.md](http://deferred.md).\nKeep [example.com/guide.md](http://example.com/guide.md) linked.\nWait up to \\~30 min.\n\n\`\`\` markdown\nbody\n\`\`\``;
  const output = normalizeMarkdown(input);

  assert.match(output, /one item per\nissue/);
  assert.match(output, /1\. First\n2\. Second/);
  assert.match(output, /\n1\. New list/);
  assert.match(output, /`AGENTS\.md\/README\/CI`/);
  assert.match(output, /`deferred\.md`/);
  assert.match(output, /\[example\.com\/guide\.md\]\(http:\/\/example\.com\/guide\.md\)/);
  assert.match(output, /up to ~30 min/);
  assert.match(output, /```markdown\nbody/);
});

test('renumbers nested ordered lists independently', () => {
  const output = normalizeMarkdown('1. Parent\n  1. Child one\n  1. Child two\n1. Parent two');
  assert.equal(output, '1. Parent\n  1. Child one\n  2. Child two\n2. Parent two\n');
});

test('does not normalize literal examples inside code fences', () => {
  const output = normalizeMarkdown('``` markdown\n1. literal\n1. literal\n[deferred.md](http://deferred.md) \\~ &#10;\n```');
  assert.equal(output, '```markdown\n1. literal\n1. literal\n[deferred.md](http://deferred.md) \\~ &#10;\n```\n');
});
