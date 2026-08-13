import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { OfferPromptService } from './offer-prompt.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, OfferPromptService],
  exports: [SubscriptionsService, OfferPromptService],
})
export class SubscriptionsModule {}
