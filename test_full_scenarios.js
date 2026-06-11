import assert from 'node:assert/strict';

const API_PORT = process.env.PORT || '5001';
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}/api`;

const ADMIN = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD
};

const SAMPLE_IMAGE = `data:image/png;base64,${Buffer.alloc(12 * 1024).toString('base64')}`;

if (!ADMIN.email || !ADMIN.password) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for test_full_scenarios.js');
}

const state = {
  player1: null,
  player2: null,
  battlePair: null,
  admin: null,
  catalog: {},
  profiles: {},
  deposits: {},
  withdrawals: {},
  challenges: {},
  duels: {},
  invitations: {},
  arbitrations: {}
};

async function api(path, { token, method = 'GET', body, headers = {}, raw = false } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });

  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      ? data.message || data.details || text || `HTTP ${response.status}`
      : text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return raw ? { response, text } : data;
}

function uniqueTag(prefix) {
  return `${prefix}_${Date.now().toString().slice(-6)}`;
}

function dataUrl(sizeKb = 12) {
  return `data:image/png;base64,${Buffer.alloc(sizeKb * 1024).toString('base64')}`;
}

async function registerUser(prefix, country) {
  const tag = uniqueTag(prefix);
  const payload = {
    username: tag,
    efootballUsername: tag,
    firstName: prefix,
    lastName: 'Tester',
    phone: `+2217000${Math.floor(Math.random() * 9000 + 1000)}`,
    email: `${tag}@skill2cash.test`,
    password: 'Test123456',
    country
  };
  const result = await api('/auth/register', { method: 'POST', body: payload });
  return { token: result.token, user: result.user, payload };
}

async function loginUser(email, password) {
  const result = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: result.token, user: result.user };
}

async function ensureCatalog() {
  const [games, platforms, rooms] = await Promise.all([
    api('/games'),
    api('/platforms'),
    api('/rooms')
  ]);

  let game = games[0];
  let platform = platforms[0];

  if (!game) {
    game = await api('/games', {
      method: 'POST',
      token: state.admin.token,
      body: { name: 'eFootball', slug: 'efootball', description: 'eFootball duel' }
    });
  }

  if (!platform) {
    platform = await api('/platforms', {
      method: 'POST',
      token: state.admin.token,
      body: { name: 'PlayStation', slug: 'playstation', description: 'PlayStation platform' }
    });
  }

  let room = rooms.find((candidate) => Number(candidate.betAmount) <= 500);
  if (!room) {
    room = await api('/rooms', {
      method: 'POST',
      token: state.admin.token,
      body: {
        name: 'Starter Room',
        game: game._id,
        platform: platform._id,
        betAmount: 500,
        winMultiplier: 1.8,
        platformFee: 0.1,
        isActive: true,
        isFeatured: true,
        rules: 'Standard room'
      }
    });
  } else {
    room = room;
  }

  state.catalog = { game, platform, room };
}

async function ensurePlayerProfiles() {
  const p1 = await api('/game-profiles', {
    method: 'POST',
    token: state.player1.token,
    body: {
      game: state.catalog.game._id,
      platform: state.catalog.platform._id,
      gamertag: state.player1.user.efootballUsername,
      isPrimary: true
    }
  });

  const p2 = await api('/game-profiles', {
    method: 'POST',
    token: state.player2.token,
    body: {
      game: state.catalog.game._id,
      platform: state.catalog.platform._id,
      gamertag: state.player2.user.efootballUsername,
      isPrimary: true
    }
  });

  state.profiles = { p1, p2 };

  const search = await api(`/game-profiles/search?gamertag=${encodeURIComponent(state.player1.user.efootballUsername)}`);
  assert.ok(search.length >= 1 || search.profiles?.length >= 1, 'Game profile search should return results');

  await api(`/game-profiles/${p1._id}/verify`, {
    method: 'POST',
    token: state.admin.token,
    body: {}
  });
  await api(`/game-profiles/${p2._id}/verify`, {
    method: 'POST',
    token: state.admin.token,
    body: {}
  });

  const mine = await api('/game-profiles/my-profiles', { token: state.player1.token });
  assert.ok(Array.isArray(mine) ? mine.length >= 1 : mine.profiles?.length >= 1, 'User should see own game profiles');
}

async function ensureBattlePair() {
  if (state.battlePair) return state.battlePair;

  const battle1 = await registerUser('BattleOne', 'Cote d\'Ivoire');
  const battle2 = await registerUser('BattleTwo', 'Senegal');

  const p1 = await api('/game-profiles', {
    method: 'POST',
    token: battle1.token,
    body: {
      game: state.catalog.game._id,
      platform: state.catalog.platform._id,
      gamertag: battle1.user.efootballUsername,
      isPrimary: true
    }
  });

  const p2 = await api('/game-profiles', {
    method: 'POST',
    token: battle2.token,
    body: {
      game: state.catalog.game._id,
      platform: state.catalog.platform._id,
      gamertag: battle2.user.efootballUsername,
      isPrimary: true
    }
  });

  await api(`/game-profiles/${p1._id}/verify`, {
    method: 'POST',
    token: state.admin.token,
    body: {}
  });
  await api(`/game-profiles/${p2._id}/verify`, {
    method: 'POST',
    token: state.admin.token,
    body: {}
  });

  const battle1Deposit = await api('/wallet/deposit', {
    method: 'POST',
    token: battle1.token,
    body: {
      method: 'wave',
      amount: 5000,
      senderName: 'Battle One Sender',
      senderPhone: '+221700000111',
      transactionReference: `REF-${uniqueTag('battle1')}`,
      screenshotUrl: SAMPLE_IMAGE
    }
  });

  await api(`/admin/deposits/${battle1Deposit.deposit._id}/approve`, {
    method: 'POST',
    token: state.admin.token,
    body: { adminNote: 'Battle pair funding' }
  });

  const battle2Deposit = await api('/wallet/deposit', {
    method: 'POST',
    token: battle2.token,
    body: {
      method: 'wave',
      amount: 5000,
      senderName: 'Battle Two Sender',
      senderPhone: '+221700000222',
      transactionReference: `REF-${uniqueTag('battle2')}`,
      screenshotUrl: SAMPLE_IMAGE
    }
  });

  await api(`/admin/deposits/${battle2Deposit.deposit._id}/approve`, {
    method: 'POST',
    token: state.admin.token,
    body: { adminNote: 'Battle pair funding' }
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  state.battlePair = {
    player1: battle1,
    player2: battle2,
    profiles: { p1, p2 }
  };

  return state.battlePair;
}

async function checkNotificationsFlow(token) {
  const inbox = await api('/notifications?limit=20', { token });
  assert.ok('notifications' in inbox, 'Notifications endpoint should respond');
  await api('/notifications/read-all', { token, method: 'PATCH' });
}

async function depositAndReview(userKey, amount, approved = true) {
  const token = state[userKey].token;
  const sender = `${userKey.toUpperCase()} Sender`;
  const deposit = await api('/wallet/deposit', {
    method: 'POST',
    token,
    body: {
      method: 'wave',
      amount,
      senderName: sender,
      senderPhone: '+221700000000',
      transactionReference: `REF-${uniqueTag(userKey)}`,
      screenshotUrl: SAMPLE_IMAGE
    }
  });

  state.deposits[`${userKey}-${amount}-${approved ? 'approve' : 'reject'}`] = deposit.deposit;

  if (approved) {
    await api(`/admin/deposits/${deposit.deposit._id}/approve`, {
      method: 'POST',
      token: state.admin.token,
      body: { adminNote: 'Integration test approval' }
    });
  } else {
    await api(`/admin/deposits/${deposit.deposit._id}/reject`, {
      method: 'POST',
      token: state.admin.token,
      body: { adminNote: 'Integration test rejection' }
    });
  }

  return deposit.deposit;
}

async function withdrawalAndReview(userKey, amount, approved = true, markPaid = false) {
  const token = state[userKey].token;
  const withdrawal = await api('/wallet/withdraw', {
    method: 'POST',
    token,
    body: {
      amount,
      method: 'wave',
      phoneOrWallet: `+2217000${Math.floor(Math.random() * 9000 + 1000)}`
    }
  });

  state.withdrawals[`${userKey}-${amount}-${approved ? 'approve' : 'reject'}`] = withdrawal.withdrawal;

  if (approved) {
    await api(`/admin/withdrawals/${withdrawal.withdrawal._id}/approve`, {
      method: 'POST',
      token: state.admin.token,
      body: { adminNote: 'Integration test approval', markPaid }
    });
  } else {
    await api(`/admin/withdrawals/${withdrawal.withdrawal._id}/reject`, {
      method: 'POST',
      token: state.admin.token,
      body: { adminNote: 'Integration test rejection' }
    });
  }

  return withdrawal.withdrawal;
}

async function assertWallet(token, expectedAvailable, expectedLocked, label) {
  const walletResponse = await api('/wallet', { token });
  const wallet = walletResponse.wallet;
  assert.equal(wallet.balanceAvailable, expectedAvailable, `${label} available balance`);
  assert.equal(wallet.balanceLocked, expectedLocked, `${label} locked balance`);
  return wallet;
}

async function challengeFlow() {
  const { player1, player2 } = await ensureBattlePair();

  const challenge = await api('/challenges', {
    method: 'POST',
    token: player1.token,
    body: {
      challengedId: player2.user._id,
      amount: 1000,
      message: 'Integration duel 1'
    }
  });
  state.challenges.primary = challenge.challenge;

  const incoming = await api('/challenges/incoming', { token: player2.token });
  const outgoing = await api('/challenges/outgoing', { token: player1.token });
  assert.ok(incoming.challenges.length >= 1, 'Player2 should see incoming challenge');
  assert.ok(outgoing.challenges.length >= 1, 'Player1 should see outgoing challenge');

  const duel = await api(`/challenges/${challenge.challenge._id}/accept`, {
    method: 'POST',
    token: player2.token
  });
  state.duels.primary = duel.duel;

  const duelResult1 = await api(`/duels/${duel.duel._id}/result`, {
    method: 'POST',
    token: player1.token,
    body: {
      score: '3-1',
      declaredWinner: player1.user._id,
      screenshot: SAMPLE_IMAGE,
      comment: 'Player 1 wins'
    }
  });
  const duelResult2 = await api(`/duels/${duel.duel._id}/result`, {
    method: 'POST',
    token: player2.token,
    body: {
      score: '3-1',
      declaredWinner: player1.user._id,
      screenshot: SAMPLE_IMAGE,
      comment: 'Player 1 wins'
    }
  });
  assert.ok(duelResult1.duel || duelResult1, 'Player1 result should be recorded');
  assert.ok(duelResult2.duel || duelResult2, 'Player2 result should be recorded');

  const duelDetails = await api(`/duels/${duel.duel._id}`, { token: player1.token });
  if (duelDetails.duel.status === 'dispute') {
    await api(`/admin/disputes/${duel.duel._id}/resolve`, {
      method: 'POST',
      token: state.admin.token,
      body: { action: 'winner', winnerId: player1.user._id }
    });
  }

  const declineChallenge = await api('/challenges', {
    method: 'POST',
    token: player1.token,
    body: {
      challengedId: player2.user._id,
      amount: 500,
      message: 'Decline me'
    }
  });
  await api(`/challenges/${declineChallenge.challenge._id}/decline`, {
    method: 'POST',
    token: player2.token
  });

  const cancelChallenge = await api('/challenges', {
    method: 'POST',
    token: player1.token,
    body: {
      challengedId: player2.user._id,
      amount: 500,
      message: 'Cancel me'
    }
  });
  await api(`/challenges/${cancelChallenge.challenge._id}/cancel`, {
    method: 'POST',
    token: player1.token
  });

  const counterChallenge = await api('/challenges', {
    method: 'POST',
    token: player1.token,
    body: {
      challengedId: player2.user._id,
      amount: 700,
      message: 'Counter me'
    }
  });
  const countered = await api(`/challenges/${counterChallenge.challenge._id}/counter`, {
    method: 'POST',
    token: player2.token,
    body: { counterAmount: 700 }
  });
  assert.equal(countered.challenge.status, 'counter_offer');
  await api(`/challenges/${counterChallenge.challenge._id}/accept`, {
    method: 'POST',
    token: player2.token
  });
}

async function arbitrationFlow() {
  const { player1, player2 } = await ensureBattlePair();

  const challenge = await api('/challenges', {
    method: 'POST',
    token: player1.token,
    body: {
      challengedId: player2.user._id,
      amount: 500,
      message: 'Arbitration duel'
    }
  });
  const duel = await api(`/challenges/${challenge.challenge._id}/accept`, {
    method: 'POST',
    token: player2.token
  });

  await api(`/duels/${duel.duel._id}/result`, {
    method: 'POST',
    token: player1.token,
    body: {
      score: '2-1',
      declaredWinner: player1.user._id,
      screenshot: SAMPLE_IMAGE,
      comment: 'Challenger wins'
    }
  });
  await api(`/duels/${duel.duel._id}/result`, {
    method: 'POST',
    token: player2.token,
    body: {
      score: '1-2',
      declaredWinner: player2.user._id,
      screenshot: SAMPLE_IMAGE,
      comment: 'Opponent wins'
    }
  });

  const arbitration = await api('/arbitrations', {
    method: 'POST',
    token: player1.token,
    body: {
      duelId: duel.duel._id,
      disputeReason: 'Result mismatch'
    }
  });
  state.arbitrations.primary = arbitration._id || arbitration.arbitration?._id;

  const arbitrationId = arbitration._id || arbitration.arbitration?._id;
  const byDuel = await api(`/arbitrations/duel/${duel.duel._id}`);
  assert.ok(byDuel, 'Arbitration should be retrievable by duel');

  await api(`/arbitrations/${arbitrationId}/assign`, {
    method: 'POST',
    token: state.admin.token,
    body: {}
  });

  await api(`/arbitrations/${arbitrationId}/challenger-evidence`, {
    method: 'POST',
    token: player1.token,
    body: { screenshots: [SAMPLE_IMAGE], descriptions: ['Scoreboard proof'] }
  });
  await api(`/arbitrations/${arbitrationId}/opponent-evidence`, {
    method: 'POST',
    token: player2.token,
    body: { screenshots: [SAMPLE_IMAGE], descriptions: ['Counter proof'] }
  });

  await api(`/arbitrations/${arbitrationId}/resolve`, {
    method: 'POST',
    token: state.admin.token,
    body: { decision: 'challenger_win', decisionReason: 'Integration test resolution' }
  });
}

async function invitationFlow() {
  const { player1, player2, profiles } = await ensureBattlePair();

  const invitation = await api('/public-invitations', {
    method: 'POST',
    token: player1.token,
    body: {
      room: state.catalog.room._id,
      gameProfile: profiles.p1._id,
      mode: '1v1',
      scheduledTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      notes: 'Open invite',
      expiresHours: 2
    }
  });
  const invitationId = invitation._id || invitation.invitation?._id;
  state.invitations.primary = invitationId;

  const openInvitations = await api('/public-invitations/open');
  assert.ok(openInvitations.length >= 1 || openInvitations.invitations?.length >= 1, 'Open invitations should be listed');

  const accepted = await api(`/public-invitations/${invitationId}/accept`, {
    method: 'POST',
    token: player2.token,
    body: { acceptorGameProfileId: profiles.p2._id }
  });
  assert.ok(accepted.challenge || accepted._id, 'Invitation should accept into a challenge');

  const secondInvitation = await api('/public-invitations', {
    method: 'POST',
    token: player1.token,
    body: {
      room: state.catalog.room._id,
      gameProfile: profiles.p1._id,
      mode: '1v1',
      scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      notes: 'Close me',
      expiresHours: 2
    }
  });
  const secondInvitationId = secondInvitation._id || secondInvitation.invitation?._id;
  await api(`/public-invitations/${secondInvitationId}/close`, {
    method: 'POST',
    token: player1.token
  });
}

async function adminViews() {
  const overview = await api('/admin/overview', { token: state.admin.token });
  assert.ok(overview.users >= 3, 'Admin overview should see registered users');

  const inbox = await api('/admin/inbox', { token: state.admin.token });
  assert.ok(Array.isArray(inbox.items), 'Admin inbox should return items');

  const users = await api('/admin/users', { token: state.admin.token });
  assert.ok(users.users.length >= 3, 'Admin users list should be available');

  const duels = await api('/admin/duels', { token: state.admin.token });
  assert.ok(duels.duels.length >= 1, 'Admin duels list should be available');

  const disputes = await api('/admin/disputes', { token: state.admin.token });
  assert.ok(Array.isArray(disputes.disputes), 'Admin disputes should be available');

  const deposits = await api('/admin/deposits', { token: state.admin.token });
  assert.ok(Array.isArray(deposits.deposits), 'Admin deposits list should be available');

  const withdrawals = await api('/admin/withdrawals', { token: state.admin.token });
  assert.ok(Array.isArray(withdrawals.withdrawals), 'Admin withdrawals list should be available');

  const challenges = await api('/admin/challenges', { token: state.admin.token });
  assert.ok(Array.isArray(challenges.challenges), 'Admin challenges list should be available');

  const adminTarget = await registerUser('AdminTool', 'Ghana');
  const banResult = await api(`/admin/users/${adminTarget.user._id}/ban`, {
    method: 'POST',
    token: state.admin.token,
    body: { isBanned: true }
  });
  assert.equal(Boolean(banResult.user.isBanned), true, 'Admin should be able to ban a user');

  const unbanResult = await api(`/admin/users/${adminTarget.user._id}/ban`, {
    method: 'POST',
    token: state.admin.token,
    body: { isBanned: false }
  });
  assert.equal(Boolean(unbanResult.user.isBanned), false, 'Admin should be able to unban a user');

  const balanceResult = await api(`/admin/users/${adminTarget.user._id}/adjust-balance`, {
    method: 'POST',
    token: state.admin.token,
    body: {
      amount: 1250,
      description: 'Integration test adjustment'
    }
  });
  assert.ok(balanceResult.wallet, 'Admin balance adjustment should return a wallet');

  const targetWallet = await api('/wallet', { token: adminTarget.token });
  assert.ok(targetWallet.wallet.balanceAvailable >= 1250, 'Adjusted balance should be visible in the wallet');
}

async function profileAndNotificationFlow() {
  const profileUpdate = await api('/users/profile', {
    method: 'PATCH',
    token: state.player1.token,
    body: {
      country: 'Senegal',
      status: 'online',
      level: 'Pro'
    }
  });
  assert.equal(profileUpdate.user.status, 'online');

  const request = await api('/users/username-change-requests', {
    method: 'POST',
    token: state.player1.token,
    body: {
      requestedUsername: `${state.player1.user.username}X`,
      reason: 'Integration test request'
    }
  });

  const requests = await api('/users/username-change-requests/me', { token: state.player1.token });
  assert.ok(requests.requests.length >= 1, 'Username change requests should be listed');

  await api(`/admin/username-change-requests/${request.request._id}/reject`, {
    method: 'POST',
    token: state.admin.token,
    body: { adminNote: 'Integration test rejection' }
  });

  await checkNotificationsFlow(state.player1.token);
  await checkNotificationsFlow(state.player2.token);
}

async function main() {
  console.log('Starting full system integration scenarios...');

  state.admin = await loginUser(ADMIN.email, ADMIN.password);
  state.player1 = await registerUser('ClientOne', 'France');
  state.player2 = await registerUser('ClientTwo', 'Senegal');

  const runStep = async (name, fn) => {
    console.log(`-> ${name}`);
    return await fn();
  };

  await runStep('catalog', ensureCatalog);
  await runStep('profiles', ensurePlayerProfiles);
  await runStep('profile_notifications', profileAndNotificationFlow);

  await runStep('deposits', async () => {
    await depositAndReview('player1', 10000, true);
    await depositAndReview('player2', 10000, true);
    await depositAndReview('player1', 3000, false);
    await assertWallet(state.player1.token, 10000, 0, 'Player1 after deposits');
    await assertWallet(state.player2.token, 10000, 0, 'Player2 after deposits');
  });

  await runStep('withdrawals', async () => {
    await withdrawalAndReview('player2', 2000, true, true);
    await withdrawalAndReview('player1', 1000, false, false);
    await assertWallet(state.player1.token, 10000, 0, 'Player1 after withdrawal rejection');
    await assertWallet(state.player2.token, 8000, 0, 'Player2 after withdrawal approval');
  });

  await runStep('invitation_flow', invitationFlow);
  await runStep('arbitration_flow', arbitrationFlow);
  await runStep('challenge_flow', challengeFlow);

  await runStep('wallet_sanity', async () => {
    const walletsBeforeSettle = await Promise.all([
      api('/wallet', { token: state.player1.token }),
      api('/wallet', { token: state.player2.token })
    ]);
    assert.ok(walletsBeforeSettle[0].wallet.balanceAvailable >= 0, 'Player1 wallet should remain valid');
    assert.ok(walletsBeforeSettle[1].wallet.balanceAvailable >= 0, 'Player2 wallet should remain valid');
  });

  await runStep('admin_views', adminViews);

  console.log('Full system integration scenarios passed.');
}

main().catch((error) => {
  console.error('Full system integration scenarios failed:');
  console.error(error.message);
  process.exit(1);
});
