// Jest globalSetup: create the test database and apply migrations once.
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { URL } from 'url';

const TEST_DB = 'saimas_vintage_test';

export default async function globalSetup(): Promise<void> {
  const devUrl =
    process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/saimas_vintage';

  // Connect to the existing dev DB on the same server to create the test DB.
  const admin = new PrismaClient({ datasources: { db: { url: devUrl } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
  await admin.$disconnect();

  const testUrl = new URL(devUrl);
  testUrl.pathname = `/${TEST_DB}`;

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });
}
