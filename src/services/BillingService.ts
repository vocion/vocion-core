import type Stripe from 'stripe';

import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { stripe } from '@/libs/Stripe';
import {
  type IStripeSubscription,
  type PlanDetails,
  type PricingPlan,
  SUBSCRIPTION_STATUS,
} from '@/types/Subscription';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';
import { getBaseUrl, MILLISECONDS_IN_ONE_DAY } from '@/utils/Helpers';

import {
  getStripeCustomerId,
  updateStripeSubscription,
  upsertStripeCustomerId,
} from './OrganizationService';

export const retrieveSubscriptionAndUpdate = async (subscriptionId: string) => {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = subscription.customer;

  if (
    typeof customerId !== 'string' ||
    subscription.items.data[0] === undefined
  ) {
    throw new Error('Invalid Stripe subscription data');
  }

  try {
    updateStripeSubscription(customerId, {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionPriceId: subscription.items.data[0].price.id,
      stripeSubscriptionStatus: subscription.status,
      stripeSubscriptionCurrentPeriodEnd:
        subscription.current_period_end * 1000,
    });

    logger.info('Subscription has been updated');
  } catch (error) {
    logger.error(error, 'An error occurred while updating subscription');
  }
};

export const processWebhookEvent = async (event: Stripe.Event) => {
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object;

    await retrieveSubscriptionAndUpdate(subscription.id);
  } else if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object;

    if (
      checkoutSession.mode === 'subscription' &&
      typeof checkoutSession.subscription === 'string'
    ) {
      await retrieveSubscriptionAndUpdate(checkoutSession.subscription);
    }
  }
};

export const createOrRetrieveCustomer = async (orgId: string) => {
  const organization = await getStripeCustomerId(orgId);

  const customerId = organization?.stripeCustomerId;

  if (customerId) {
    return customerId;
  }

  const stripeCustomer = await stripe.customers.create({
    metadata: {
      organizationId: orgId,
    },
  });

  await upsertStripeCustomerId(stripeCustomer.id, orgId);

  return stripeCustomer.id;
};

export const createCheckoutSession = (
  plan: PricingPlan,
  customerId: string,
  locale: Stripe.Checkout.SessionCreateParams.Locale,
) => {
  const baseUrl = getBaseUrl();

  return stripe.checkout.sessions.create({
    ui_mode: 'hosted',
    mode: 'subscription',
    line_items: [
      {
        price: plan[`${Env.BILLING_PLAN_ENV}PriceId`],
        // For metered billing, do not pass quantity
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/dashboard/billing/checkout-confirmation`,
    cancel_url: `${baseUrl}/dashboard/billing`,
    customer: customerId,
    locale,
  });
};

export const createBillingPortal = (
  customerId: string,
  locale: Stripe.BillingPortal.SessionCreateParams.Locale,
) => {
  const baseUrl = getBaseUrl();

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/dashboard/billing`,
    locale,
  });
};

export const determineSubscriptionPlan = (
  stripeDetails?: IStripeSubscription,
): PlanDetails => {
  const isActive =
    stripeDetails !== undefined &&
    stripeDetails.stripeSubscriptionId !== null &&
    stripeDetails.stripeSubscriptionPriceId !== null &&
    stripeDetails.stripeSubscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE &&
    stripeDetails.stripeSubscriptionCurrentPeriodEnd !== null &&
    stripeDetails.stripeSubscriptionCurrentPeriodEnd + MILLISECONDS_IN_ONE_DAY >
      Date.now();

  if (isActive) {
    const plan = PricingPlanList.find((elt) => {
      const priceId = elt[`${Env.BILLING_PLAN_ENV}PriceId`];

      return priceId === stripeDetails.stripeSubscriptionPriceId;
    });

    if (plan) {
      return { isPaid: true, plan, stripeDetails };
    }
  }

  const freePlan = PricingPlanList.find((elt) => elt.id === PLAN_ID.FREE);

  if (!freePlan) {
    throw new Error('Free plan not found');
  }

  return { isPaid: false, plan: freePlan };
};
