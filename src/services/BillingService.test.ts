import { vi } from 'vitest';

import { BILLING_INTERVAL, SUBSCRIPTION_STATUS } from '@/types/Subscription';

import { determineSubscriptionPlan } from './BillingService';

vi.mock('@/utils/AppConfig', () => ({
  PLAN_ID: {
    FREE: 'free',
    PREMIUM: 'premium',
  },
  PricingPlanList: [
    {
      id: 'free',
      price: 0,
      interval: BILLING_INTERVAL.MONTH,
      devPriceId: '',
      prodPriceId: '',
      features: {},
    },
    {
      id: 'premium',
      price: 79,
      interval: BILLING_INTERVAL.MONTH,
      devPriceId: '',
      prodPriceId: 'price_123',
      features: {},
    },
  ],
}));

describe('BillingService', () => {
  describe('determineSubscriptionPlan function', () => {
    it('should return the free plan if the organization has no data', () => {
      const result = determineSubscriptionPlan();

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe('free');
    });

    it('should return the free plan if the organization has an inactive subscription', () => {
      let result = determineSubscriptionPlan({
        stripeSubscriptionId: null,
        stripeSubscriptionPriceId: null,
        stripeSubscriptionStatus: null,
        stripeSubscriptionCurrentPeriodEnd: null,
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe('free');

      result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'RANDOM_PRICE_ID',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.PENDING,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe('free');
    });

    it('should return the free plan if the organization has an active subscription but the priceId is incorrect', () => {
      const result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'RANDOM_PRICE_ID',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe('free');
    });

    it('should return the correct plan if the organization has an active subscription', () => {
      const result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'price_123',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeTruthy();
      expect(result.plan.id).toBe('premium');
    });
  });
});
