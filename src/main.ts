import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './app-setup';

async function bootstrap(): Promise<void> {
  // bodyParser:false → setupApp attaches the JSON + urlencoded parsers explicitly
  // and in a known order before CSRF/static middleware.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  setupApp(app);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(
    `${process.env.APP_NAME ?? "Saima's Vintage"} listening on port ${port} [${process.env.NODE_ENV ?? 'development'}]`,
  );
}

void bootstrap();
