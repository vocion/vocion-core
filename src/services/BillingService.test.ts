import { describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_STATUS } from '@/types/Subscription';
import { PLAN_ID } from '@/utils/AppConfig';
import { determineSubscriptionPlan } from './BillingService';

vi.mock('@/libs/DB');

describe('BillingService', () => {
  describe('determineSubscriptionPlan function', () => {
    it('should return the free plan if the organization has no data', () => {
      const result = determineSubscriptionPlan();

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe(PLAN_ID.FREE);
    });

    it('should return the free plan if the organization has an inactive subscription', () => {
      let result = determineSubscriptionPlan({
        stripeSubscriptionId: null,
        stripeSubscriptionPriceId: null,
        stripeSubscriptionStatus: null,
        stripeSubscriptionCurrentPeriodEnd: null,
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe(PLAN_ID.FREE);

      result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'RANDOM_PRICE_ID',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.PENDING,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe(PLAN_ID.FREE);
    });

    it('should return the free plan if the organization has an active subscription but the priceId is incorrect', () => {
      const result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'RANDOM_PRICE_ID',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeFalsy();
      expect(result.plan.id).toBe(PLAN_ID.FREE);
    });

    it('should return the correct plan if the organization has an active subscription', () => {
      const result = determineSubscriptionPlan({
        stripeSubscriptionId: 'RANDOM_ID',
        stripeSubscriptionPriceId: 'price_enterprise_test',
        stripeSubscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        stripeSubscriptionCurrentPeriodEnd: Date.now(),
      });

      expect(result.isPaid).toBeTruthy();
      expect(result.plan.id).toBe(PLAN_ID.ENTERPRISE);
    });
  });
});
