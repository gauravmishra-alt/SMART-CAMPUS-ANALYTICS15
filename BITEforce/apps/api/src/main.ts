import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false }));
  app.use(cookieParser());
  app.enableCors({ origin: (config.get<string>('CORS_ORIGIN') || 'http://localhost:5173').split(',').map(s => s.trim()), credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true, transformOptions: { enableImplicitConversion: true } }));
  const port = Number(config.get('API_PORT') || 4000);
  await app.listen(port, '0.0.0.0');
}
bootstrap().catch(err => { console.error('Unable to start SmartCampus API', err); process.exit(1); });
