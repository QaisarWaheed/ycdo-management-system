import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { initCloudinary } from './config/cloudinary.config';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  // Capacitor Android/iOS WebView origins
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'https://hrms-web.ycdo.org.pk',
  'https://hrms.ycdo.org.pk',
  'https://portal.ycdo.org.pk',
  'https://hrms-portal.ycdo.org.pk',
  'https://hrms.testingpurpose.cloud',
  'https://portal.testingpurpose.cloud',
  'https://hrms-portal.testingpurpose.cloud',
];

/** Extra browser origins from CapRover, comma-separated. */
function resolveCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...fromEnv])];
}

async function bootstrap() {
  initCloudinary();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
