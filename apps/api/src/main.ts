import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  if (!process.env.DATABASE_URL && process.env.AWS_DB_SECRET_ARN) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' });
    const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.AWS_DB_SECRET_ARN }));
    const secret = JSON.parse(result.SecretString || '{}') as { username:string; password:string; host:string; port:number; dbname:string };
    const database = encodeURIComponent(secret.dbname || process.env.DB_NAME || 'gloomi');
    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port || process.env.DB_PORT || 5432}/${database}?schema=public&sslmode=require`;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL or AWS_DB_SECRET_ARN must be configured');
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) throw new Error('JWT secrets must be configured');
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? 'http://localhost:5173', credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT || 3000);
}
void bootstrap();
