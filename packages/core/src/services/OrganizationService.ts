import type { IStripeSubscription } from '@/types/Subscription';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { organizationSchema } from '@/models/Schema';

export const getStripeCustomerId = (orgId: string) => {
  return db.query.organizationSchema.findFirst({
    where: eq(organizationSchema.id, orgId),
    columns: { stripeCustomerId: true },
  });
};

export const upsertStripeCustomerId = (
  stripeCustomerId: string,
  orgId: string,
) => {
  return db
    .insert(organizationSchema)
    .values({ id: orgId, stripeCustomerId })
    .onConflictDoUpdate({
      target: organizationSchema.id,
      set: {
        stripeCustomerId,
      },
    });
};

export const getStripeSubscription = (orgId: string) => {
  return db.query.organizationSchema.findFirst({
    where: eq(organizationSchema.id, orgId),
    columns: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripeSubscriptionPriceId: true,
      stripeSubscriptionStatus: true,
      stripeSubscriptionCurrentPeriodEnd: true,
    },
  });
};

export const updateStripeSubscription = (
  customerId: string,
  subscription: IStripeSubscription,
) => {
  return db
    .update(organizationSchema)
    .set({
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeSubscriptionPriceId: subscription.stripeSubscriptionPriceId,
      stripeSubscriptionStatus: subscription.stripeSubscriptionStatus,
      stripeSubscriptionCurrentPeriodEnd:
        subscription.stripeSubscriptionCurrentPeriodEnd,
    })
    .where(eq(organizationSchema.stripeCustomerId, customerId));
};
