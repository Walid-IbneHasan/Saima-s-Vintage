import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Redirects (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('redirects an old product path to the new product path', async () => {
    await resetDb(prisma);
    await prisma.redirect.create({
      data: {
        fromPath: '/p/old-dress',
        toPath: '/p/new-dress',
        statusCode: 301,
      },
    });

    const res = await request(app.getHttpServer()).get('/p/old-dress');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/p/new-dress');
  });

  it('redirects an old category path to the new category path', async () => {
    await resetDb(prisma);
    await prisma.redirect.create({
      data: {
        fromPath: '/c/old-cat',
        toPath: '/c/new-cat',
        statusCode: 301,
      },
    });

    const res = await request(app.getHttpServer()).get('/c/old-cat');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/c/new-cat');
  });

  it('returns 404 for an unknown product path without a redirect', async () => {
    await resetDb(prisma);

    const res = await request(app.getHttpServer()).get('/p/no-such-slug');
    expect(res.status).toBe(404);
  });
});
