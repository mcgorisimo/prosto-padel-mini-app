const { test: base, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ENV = [
  'E2E_TARGET',
  'E2E_SUPABASE_URL',
  'E2E_SUPABASE_ANON_KEY',
  'E2E_SUPABASE_SERVICE_ROLE_KEY',
  'E2E_STAGING_PROJECT_REF',
  'E2E_PRODUCTION_PROJECT_REF',
];

const accountTemplates = {
  organizer_rating_2_0: {
    first_name: 'LiveOrganizer',
    last_name: 'Two',
    username: 'live_organizer_2_0',
    rating: 2.0,
    is_verified: true,
    role: 'user',
  },
  player_rating_1_5: {
    first_name: 'LiveLow',
    last_name: 'Player',
    username: 'live_player_1_5',
    rating: 1.5,
    is_verified: true,
    role: 'user',
  },
  player_rating_3_0: {
    first_name: 'LiveWithin',
    last_name: 'Player',
    username: 'live_player_3_0',
    rating: 3.0,
    is_verified: true,
    role: 'user',
  },
};

function readEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

function loadE2EEnv() {
  const localEnv = readEnvFile('.env.e2e.local');
  for (const [key, value] of Object.entries(localEnv)) {
    if (process.env[key] == null) process.env[key] = value;
  }

  if (!process.env.VITE_SUPABASE_URL && process.env.E2E_SUPABASE_URL) {
    process.env.VITE_SUPABASE_URL = process.env.E2E_SUPABASE_URL;
  }

  if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.E2E_SUPABASE_ANON_KEY) {
    process.env.VITE_SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY;
  }
}

function getProjectRef(url) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return '';
  }
}

function validateLiveEnv() {
  loadE2EEnv();

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Live E2E requires local staging credentials. Missing env: ${missing.join(', ')}. ` +
      'Create .env.e2e.local from .env.e2e.example.'
    );
  }

  if (process.env.E2E_TARGET !== 'staging') {
    throw new Error('Live E2E is allowed only with E2E_TARGET=staging.');
  }

  const projectRef = getProjectRef(process.env.E2E_SUPABASE_URL);
  if (!projectRef) {
    throw new Error('E2E_SUPABASE_URL must be a valid Supabase project URL.');
  }

  if (projectRef !== process.env.E2E_STAGING_PROJECT_REF) {
    throw new Error('E2E_SUPABASE_URL project ref does not match E2E_STAGING_PROJECT_REF.');
  }

  if (projectRef === process.env.E2E_PRODUCTION_PROJECT_REF) {
    throw new Error('Refusing to run live E2E against the production Supabase project ref.');
  }

  if (process.env.VITE_SUPABASE_URL !== process.env.E2E_SUPABASE_URL) {
    throw new Error('VITE_SUPABASE_URL must match E2E_SUPABASE_URL for live staging E2E.');
  }

  if (process.env.VITE_SUPABASE_ANON_KEY !== process.env.E2E_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY must match E2E_SUPABASE_ANON_KEY for live staging E2E.');
  }

  return {
    url: process.env.E2E_SUPABASE_URL,
    anonKey: process.env.E2E_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    projectRef,
    authStorageKey: `sb-${projectRef}-auth-token`,
  };
}

function ratingIdxFor(rating) {
  if (rating <= 1.5) return 0;
  if (rating <= 2.2) return 1;
  if (rating <= 3.2) return 2;
  if (rating <= 5.0) return 3;
  if (rating <= 6.5) return 4;
  if (rating <= 7.5) return 5;
  return 6;
}

function tomorrowISO(offset = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function tomorrowLabel(offset = 1) {
  return new Date(`${tomorrowISO(offset)}T12:00:00`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    .replace(' г.', '');
}

function slotFor(account, overrides = {}) {
  return {
    id: account.id,
    firstName: account.first_name,
    lastName: account.last_name,
    username: account.username,
    ratingIdx: ratingIdxFor(Number(account.rating)),
    numericRating: Number(account.rating),
    isVerified: account.is_verified === true,
    sidePreference: account.side_preference || 'Both',
    isOrganizer: false,
    ...overrides,
  };
}

function uniqueSuffix(testInfo) {
  const title = testInfo.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${title}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
}

class StagingFixture {
  constructor(config, testInfo) {
    this.config = config;
    this.testInfo = testInfo;
    this.suffix = uniqueSuffix(testInfo);
    this.createdMatchIds = [];
    this.createdUserIds = [];
    this.createdEmails = [];
    this.service = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.anon = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async createAccount(templateName, overrides = {}) {
    const template = accountTemplates[templateName];
    if (!template) throw new Error(`Unknown E2E account template: ${templateName}`);

    const account = {
      ...template,
      ...overrides,
    };
    const password = `E2E-${crypto.randomUUID()}-Aa1!`;
    const localName = `${account.username}_${this.suffix}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 60);
    const email = `${localName}@prostopadel-e2e.test`.toLowerCase();

    const { data: authData, error: createError } = await this.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: account.first_name,
        last_name: account.last_name,
        username: localName,
      },
    });
    if (createError) throw createError;

    const userId = authData?.user?.id;
    if (!userId) throw new Error('Supabase admin.createUser returned no user id.');

    this.createdUserIds.push(userId);
    this.createdEmails.push(email);

    const profile = {
      id: userId,
      first_name: account.first_name,
      last_name: account.last_name,
      email,
      username: localName,
      role: account.role,
      rating: account.rating,
      is_verified: account.is_verified,
      side_preference: account.side_preference || 'Both',
      language: 'RU',
    };

    const { error: profileError } = await this.service
      .from('profiles')
      .upsert(profile, { onConflict: 'id' });
    if (profileError) throw profileError;

    const liveAccount = {
      ...account,
      ...profile,
      password,
    };

    const { data: sessionData, error: signInError } = await this.anon.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
    if (!sessionData?.session) throw new Error('Supabase signInWithPassword returned no session.');

    liveAccount.session = sessionData.session;
    return liveAccount;
  }

  async createMatch({
    owner,
    title,
    isPrivate = false,
    isRated = false,
    ratingMin = 2,
    ratingMax = 5,
    status = 'open',
    extraSlots = [],
  }) {
    const id = crypto.randomUUID();
    const ownerSlot = slotFor(owner, { isOrganizer: true });
    const filledSlots = [ownerSlot, ...extraSlots].filter(Boolean);
    const participants = filledSlots.map((player) => player.id).filter(Boolean);

    const row = {
      id,
      owner_id: owner.id,
      date: tomorrowLabel(),
      dateISO: tomorrowISO(),
      time: '19:00',
      duration: 1.5,
      courtId: 'p1',
      courtName: 'Court E2E',
      courtType: 'panoramic',
      isPrime: true,
      type: 'match',
      scenario: isPrivate ? 'private' : 'social',
      title: `${title} ${this.suffix}`,
      description: `live-e2e ${this.suffix}`,
      status,
      ratingMin,
      ratingMax,
      players: filledSlots.length,
      filledSlots,
      participants,
      isPrivate,
      paymentStatus: 'full',
      is_rating_match: isRated,
    };

    const { data, error } = await this.service
      .from('matches')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;

    this.createdMatchIds.push(id);
    return data;
  }

  async getMatch(matchId) {
    const { data, error } = await this.service
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();
    if (error) throw error;
    return data;
  }

  async expectParticipant(matchId, userId) {
    await expect.poll(async () => {
      const match = await this.getMatch(matchId);
      const participants = Array.isArray(match.participants) ? match.participants : [];
      const hasSlot = Array.isArray(match.filledSlots)
        ? match.filledSlots.some((slot) => slot?.id === userId)
        : false;
      return participants.includes(userId) && hasSlot;
    }, { message: `Expected ${userId} to be saved in match ${matchId}` }).toBe(true);
  }

  async expectNoParticipant(matchId, userId) {
    await expect.poll(async () => {
      const match = await this.getMatch(matchId);
      const participants = Array.isArray(match.participants) ? match.participants : [];
      const hasSlot = Array.isArray(match.filledSlots)
        ? match.filledSlots.some((slot) => slot?.id === userId)
        : false;

      return !participants.includes(userId) && !hasSlot;
    }, { message: `Expected ${userId} to be removed from match ${matchId}` }).toBe(true);
  }

  async cleanup() {
    if (this.createdMatchIds.length > 0) {
      await this.service.from('messages').delete().in('match_id', this.createdMatchIds);
      await this.service.from('matches').delete().in('id', this.createdMatchIds);
    }

    if (this.createdUserIds.length > 0) {
      await this.service.from('profiles').delete().in('id', this.createdUserIds);
    }

    for (const userId of [...this.createdUserIds].reverse()) {
      await this.service.auth.admin.deleteUser(userId);
    }
  }
}

async function mockTelegramShell(page, account) {
  await page.addInitScript((telegramUser) => {
    window.Telegram = {
      WebApp: {
        initData: 'query_id=live-e2e',
        initDataUnsafe: {
          query_id: 'live-e2e-query',
          user: telegramUser,
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, selectionChanged() {}, notificationOccurred() {} },
        ready() {},
        expand() {},
        close() {},
        sendData() {},
        showConfirm(_message, callback) { callback(true); },
      },
    };
  }, {
    id: 900000001,
    first_name: account.first_name,
    last_name: account.last_name,
    username: account.username,
    photo_url: '',
  });
}

async function setAuthenticatedSession(page, config, account) {
  await page.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, {
    storageKey: config.authStorageKey,
    session: account.session,
  });
}

async function runLiveE2E() {
  validateLiveEnv();

  const child = spawn(process.execPath, [
    path.join('scripts', 'e2e.cjs'),
    'tests/e2e/padel-domain.live.spec.js',
    '--grep',
    '@live',
    '--workers=1',
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  process.exit(exitCode);
}

const test = base.extend({
  staging: async ({}, use, testInfo) => {
    const config = validateLiveEnv();
    const fixture = new StagingFixture(config, testInfo);

    try {
      await use(fixture);
    } finally {
      await fixture.cleanup();
    }
  },
});

if (require.main === module) {
  runLiveE2E().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  test,
  expect,
  mockTelegramShell,
  setAuthenticatedSession,
  slotFor,
};
