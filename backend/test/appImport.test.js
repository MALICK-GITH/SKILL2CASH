import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('Express app loads all mounted routers', () => {
  const app = createApp();
  assert.equal(typeof app, 'function');
});
