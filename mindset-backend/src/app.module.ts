import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';

// Imports des modules 
import { AuthModule } from './auth/auth.module';
// import { UsersModule } from './users/users.module'; // A implémenter plus tard
import { PrismaModule } from './prisma/prisma.module';
import { AiCoachingModule } from './ai-coaching/ai-coaching.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { CalendarModule } from './calendar/calendar.module';
import { SyncModule } from './sync/sync.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    // Configuration globale des variables d'environnement
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Protection contre le brute force / DDOS
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{
        ttl: 60000,
        limit: config.get('NODE_ENV') === 'production' ? 100 : 1000,
      }],
    }),

    // Modules du Domaine
    PrismaModule,
    AuthModule,
    AiCoachingModule,
    SubscriptionsModule,
    CalendarModule,
    SyncModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
