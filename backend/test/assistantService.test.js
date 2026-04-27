import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalAssistantReply, buildSystemPrompt, extractAnthropicText, extractOpenAIText, extractOpponentSearchQuery, looksLikeAnthropicBaseUrl, normalizeMessages, resolveProviderUrl, shouldResolveLocalAction } from '../src/services/assistantService.js';

test('assistant helpers keep only usable messages and trim history', () => {
  const messages = normalizeMessages([
    { role: 'system', content: 'ignore' },
    { role: 'user', content: '  Hello  ' },
    { role: 'assistant', content: 'Reply' },
    { role: 'user', content: '' }
  ]);

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Reply' }
  ]);
});

test('assistant helpers extract text from Anthropic and OpenAI responses', () => {
  assert.equal(extractAnthropicText({ content: [{ type: 'text', text: 'Salut' }] }), 'Salut');
  assert.equal(extractOpenAIText({ choices: [{ message: { content: 'Bonjour' } }] }), 'Bonjour');
});

test('assistant url resolution appends the expected API path', () => {
  assert.equal(resolveProviderUrl('https://example.com', '/v1/messages'), 'https://example.com/v1/messages');
  assert.equal(resolveProviderUrl('https://example.com/', '/v1/messages'), 'https://example.com/v1/messages');
});

test('assistant detects anthropic hosts accurately', () => {
  assert.equal(looksLikeAnthropicBaseUrl('https://api.anthropic.com'), true);
  assert.equal(looksLikeAnthropicBaseUrl('https://yellowfire.ru'), false);
});

test('assistant recognizes past-opponent search requests', () => {
  assert.equal(shouldResolveLocalAction("Trouve-moi un joueur déjà affronté"), true);
  assert.equal(extractOpponentSearchQuery("Trouve-moi un joueur déjà affronté"), '');
  assert.equal(extractOpponentSearchQuery("Cherche un joueur nommé Malik"), 'Malik');
});

test('assistant system prompt includes site rules', () => {
  const prompt = buildSystemPrompt({ user: null, view: 'dashboard', context: 'Site' });
  assert.match(prompt, /SKILL2CASH/);
  assert.match(prompt, /dashboard/);
});

test('assistant local fallback answers common site questions without provider access', () => {
  const reply = buildLocalAssistantReply({
    user: {
      username: 'Malick',
      role: 'user',
      wins: 12,
      losses: 3,
      currentStreak: 4,
      trustScore: 81,
      trustTier: 'fiable',
      trustProfile: { score: 81, tierLabel: 'Fiable', signals: [{ label: 'Compte actif' }] }
    },
    prompt: 'Comment fonctionne le wallet ?',
    view: 'dashboard',
    context: ''
  });

  assert.equal(reply.provider, 'local-fallback');
  assert.match(reply.reply, /wallet/i);
  assert.match(reply.reply, /confiance/i);
});
