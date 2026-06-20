import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { CustomerAuthService } from '../src/modules/customer-auth/customer-auth.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Customer auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const codes: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const notifications = app.get(NotificationsService);
    jest.spyOn(notifications, 'send').mockImplementation(async (to, _subj, html) => {
      const m = /(\d{6})/.exec(html);
      if (m) codes[to] = m[1];
    });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function freshAgent() {
    const agent = request.agent(app.getHttpServer());
    const html = (await agent.get('/register')).text;
    const csrf = /name="_csrf" value="([a-f0-9]{32,})"/.exec(html)![1];
    return { agent, csrf };
  }

  async function makeVerified(email: string, password: string) {
    return prisma.customer.create({
      data: {
        email,
        name: 'Verified',
        passwordHash: await bcrypt.hash(password, 4),
        emailVerifiedAt: new Date(),
      },
    });
  }

  it('registers, emails an OTP, verifies, logs in, and reaches /account', async () => {
    await resetDb(prisma);
    const { agent, csrf } = await freshAgent();

    const reg = await agent
      .post('/register')
      .type('form')
      .send({ name: 'Tess', email: 'tess@test.local', password: 'Password1', _csrf: csrf });
    expect(reg.status).toBe(302);
    expect(reg.headers.location).toContain('/verify');
    expect(codes['tess@test.local']).toMatch(/^\d{6}$/);

    const verify = await agent
      .post('/verify')
      .type('form')
      .send({ email: 'tess@test.local', code: codes['tess@test.local'], _csrf: csrf });
    expect(verify.status).toBe(302);
    expect(verify.headers.location).toBe('/account?welcome=1');
    expect((verify.headers['set-cookie'] as unknown as string[]).join(';')).toContain('sv_customer');

    const account = await agent.get('/account');
    expect(account.status).toBe(200);
    expect(account.text).toContain('My account');

    const customer = await prisma.customer.findUnique({ where: { email: 'tess@test.local' } });
    expect(customer?.emailVerifiedAt).toBeTruthy();
  });

  it('rejects a wrong OTP, then accepts the correct one', async () => {
    await resetDb(prisma);
    const { agent, csrf } = await freshAgent();
    await agent.post('/register').type('form')
      .send({ name: 'Otp', email: 'otp@test.local', password: 'Password1', _csrf: csrf }).expect(302);

    const bad = await agent.post('/verify').type('form')
      .send({ email: 'otp@test.local', code: '000000', _csrf: csrf });
    expect(bad.status).toBe(400);
    const good = await agent.post('/verify').type('form')
      .send({ email: 'otp@test.local', code: codes['otp@test.local'], _csrf: csrf });
    expect(good.status).toBe(302);
  });

  it('blocks login until the email is verified', async () => {
    await resetDb(prisma);
    const { agent, csrf } = await freshAgent();
    await agent.post('/register').type('form')
      .send({ name: 'Unv', email: 'unv@test.local', password: 'Password1', _csrf: csrf }).expect(302);

    const login = await agent.post('/login').type('form')
      .send({ email: 'unv@test.local', password: 'Password1', _csrf: csrf });
    expect(login.status).toBe(302);
    expect(login.headers.location).toContain('/verify');
  });

  it('allows re-registering an unverified email (no duplicate, details updated)', async () => {
    await resetDb(prisma);
    const { agent, csrf } = await freshAgent();
    await agent.post('/register').type('form')
      .send({ name: 'First', email: 're@test.local', password: 'Password1', _csrf: csrf }).expect(302);
    // bypass the 60s resend cooldown
    await prisma.customerOtp.updateMany({ data: { createdAt: new Date(Date.now() - 120000) } });

    const again = await agent.post('/register').type('form')
      .send({ name: 'Second', email: 're@test.local', password: 'Password2', _csrf: csrf });
    expect(again.status).toBe(302);
    expect(await prisma.customer.count({ where: { email: 're@test.local' } })).toBe(1);
    const c = await prisma.customer.findUnique({ where: { email: 're@test.local' } });
    expect(c?.name).toBe('Second');
  });

  it('rejects registering an already-verified email', async () => {
    await resetDb(prisma);
    await makeVerified('taken@test.local', 'Password1');
    const { agent, csrf } = await freshAgent();
    const res = await agent.post('/register').type('form')
      .send({ name: 'X', email: 'taken@test.local', password: 'Password1', _csrf: csrf });
    expect(res.status).toBe(400);
  });

  it('resets a forgotten password via OTP, then logs in with the new one', async () => {
    await resetDb(prisma);
    await makeVerified('fp@test.local', 'OldPass1');
    const { agent, csrf } = await freshAgent();

    await agent.post('/forgot').type('form').send({ email: 'fp@test.local', _csrf: csrf }).expect(302);
    expect(codes['fp@test.local']).toMatch(/^\d{6}$/);
    await agent.post('/reset').type('form')
      .send({ email: 'fp@test.local', code: codes['fp@test.local'], password: 'BrandNew123', _csrf: csrf })
      .expect(302);

    const { agent: a2, csrf: c2 } = await freshAgent();
    const login = await a2.post('/login').type('form')
      .send({ email: 'fp@test.local', password: 'BrandNew123', _csrf: c2 });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/account');
  });

  it('lets a logged-in customer change their password', async () => {
    await resetDb(prisma);
    const { agent, csrf } = await freshAgent();
    await agent.post('/register').type('form')
      .send({ name: 'Chg', email: 'chg@test.local', password: 'Password1', _csrf: csrf }).expect(302);
    await agent.post('/verify').type('form')
      .send({ email: 'chg@test.local', code: codes['chg@test.local'], _csrf: csrf }).expect(302);

    const change = await agent.post('/account/password').type('form')
      .send({ currentPassword: 'Password1', newPassword: 'Updated123', _csrf: csrf });
    expect(change.status).toBe(302);
    expect(change.headers.location).toBe('/account?pw=1');

    const { agent: a2, csrf: c2 } = await freshAgent();
    const login = await a2.post('/login').type('form')
      .send({ email: 'chg@test.local', password: 'Updated123', _csrf: c2 });
    expect(login.headers.location).toBe('/account');
  });

  it('guards /account when not logged in', async () => {
    const res = await request(app.getHttpServer()).get('/account');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('upserts a Google account (verified) and is idempotent', async () => {
    await resetDb(prisma);
    const auth = app.get(CustomerAuthService);
    const c1 = await auth.googleUpsert({ googleId: 'g-123', email: 'g@test.local', name: 'G', picture: 'http://x/p.png' });
    expect(c1.googleId).toBe('g-123');
    expect(c1.emailVerifiedAt).toBeTruthy();
    const c2 = await auth.googleUpsert({ googleId: 'g-123', email: 'g@test.local', name: 'G' });
    expect(c2.id).toBe(c1.id);
  });
});
