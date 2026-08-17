import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { CadenceGlobaleGuard } from './common/cadence-globale.guard';

// Imports des modules 
import { AuthModule } from './auth/auth.module';
// import { UsersModule } from './users/users.module'; // A implémenter plus tard
import { PrismaModule } from './prisma/prisma.module';
import { AiCoachingModule } from './ai-coaching/ai-coaching.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { CalendarModule } from './calendar/calendar.module';
import { SyncModule } from './sync/sync.module';
import { PushModule } from './push/push.module';
import { AdminModule } from './admin/admin.module';
import { RelanceModule } from './relances/relance.module';
import { ActiviteModule } from './activite/activite.module';

@Module({
  imports: [
    // Configuration globale des variables d'environnement
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Protection contre le brute force / DDOS
    //
    // Les options restent un tableau, et non un objet portant un `getTracker`
    // commun : un `getTracker` déclaré ici écraserait celui de **tous** les gardes,
    // y compris la méthode de `CadenceGuard`, qui compte les messages du coach par
    // compte. La clé se choisit donc dans chaque garde, pas dans la configuration.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{
        ttl: 60000,
        limit: config.get('NODE_ENV') === 'production' ? 100 : 1000,
      }],
    }),

    // Le garde de cadence lit le compte dans le jeton présenté, après en avoir
    // vérifié la signature : sans ce module, il n'a pas de quoi la contrôler.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET')!,
      }),
    }),

    // Modules du Domaine
    PrismaModule,
    AuthModule,
    AiCoachingModule,
    SubscriptionsModule,
    CalendarModule,
    SyncModule,
    PushModule,
    AdminModule,
    RelanceModule,
    ActiviteModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CadenceGlobaleGuard,
    }
  ],
})
export class AppModule {}
