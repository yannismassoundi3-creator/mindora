import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { ORIGINES_AUTORISEES } from './common/origines';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Sécurité
  app.use(helmet());
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? ORIGINES_AUTORISEES : true,
    credentials: true,
  });
  app.use(cookieParser());

  // Validation globale
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime les propriétés non attendues
      forbidNonWhitelisted: true, // rejette les requêtes avec des propriétés non attendues
      transform: true, // transforme les payloads selon les types DTO
    }),
  );

  // Configuration Swagger (Documentation) - Désactivé en production
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Disciplix API')
      .setDescription('API du backend de Disciplix - Coaching IA et Productivité')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Lancement du serveur
  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`🚀 Disciplix Backend is running on: http://localhost:${port}`);
}
bootstrap();
