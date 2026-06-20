import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/app-setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
}

/** Build a fully-configured Nest app (same middleware as production) for e2e tests. */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  setupApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}
