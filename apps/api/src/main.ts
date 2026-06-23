import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://hrms-web.ycdo.org.pk',
      'https://hrms.ycdo.org.pk',
      'https://portal.ycdo.org.pk',
      'https://hrms-portal.ycdo.org.pk',
      'https://hrms.testingpurpose.cloud',
      'https://portal.testingpurpose.cloud',
      'https://hrms-portal.testingpurpose.cloud',
    ],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
