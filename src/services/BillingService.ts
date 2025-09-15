import type Stripe from 'stripe';
import type { IStripeSubscription, PlanDetails, PricingPlan, StripeLocale } from '@/types/Subscription';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { stripe } from '@/libs/Stripe';
import { SUBSCRIPTION_STATUS } from '@/types/Subscription';
import { AppConfig, PLAN_ID, PricingPlanList } from '@/utils/AppConfig';
import { getBaseUrl, MILLISECONDS_IN_ONE_DAY } from '@/utils/Helpers';
import { getStripeCustomerId, updateStripeSubscription, upsertStripeCustomerId } from './OrganizationService';

const retrieveSubscriptionAndUpdate = async (subscriptionId: string) => {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = subscription.customer;

  if (
    typeof customerId !== 'string'
    || subscription.items.data[0] === undefined
  ) {
    throw new Error('Invalid Stripe subscription data');
  }

  try {
    await updateStripeSubscription(customerId, {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionPriceId: subscription.items.data[0].price.id,
      stripeSubscriptionStatus: subscription.status,
      stripeSubscriptionCurrentPeriodEnd:
        subscription.items.data[0].current_period_end * 1000,
    });

    logger.info('Subscription has been updated');
  } catch (error: any) {
    logger.error(error, 'An error occurred while updating subscription');
  }
};

export const processWebhookEvent = async (event: Stripe.Event) => {
  if (
    event.type === 'customer.subscription.created'
    || event.type === 'customer.subscription.updated'
    || event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object;

    await retrieveSubscriptionAndUpdate(subscription.id);
  } else if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object;

    if (
      checkoutSession.mode === 'subscription'
      && typeof checkoutSession.subscription === 'string'
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

// Map app locale to the configured Stripe locale with a safe fallback
const toStripeLocale = (locale: string): StripeLocale => {
  const stripeLocale = AppConfig.locales.find(elt => elt.id === locale)?.stripeLocale;
  const fallback: StripeLocale = 'auto';

  return stripeLocale ?? fallback;
};

export const createCheckoutSession = (
  plan: PricingPlan,
  customerId: string,
  locale: string,
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
    locale: toStripeLocale(locale),
  });
};

export const createBillingPortal = (
  customerId: string,
  locale: string,
) => {
  const baseUrl = getBaseUrl();

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/dashboard/billing`,
    locale: toStripeLocale(locale),
  });
};

export const determineSubscriptionPlan = (
  stripeDetails?: IStripeSubscription,
): PlanDetails => {
  const isActive = stripeDetails !== undefined
    && stripeDetails.stripeSubscriptionId !== null
    && stripeDetails.stripeSubscriptionPriceId !== null
    && stripeDetails.stripeSubscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE
    && stripeDetails.stripeSubscriptionCurrentPeriodEnd !== null
    && stripeDetails.stripeSubscriptionCurrentPeriodEnd + MILLISECONDS_IN_ONE_DAY > Date.now();

  if (isActive) {
    const plan = Object.values(PricingPlanList).find((elt) => {
      const priceId = elt[`${Env.BILLING_PLAN_ENV}PriceId`];

      return priceId === stripeDetails.stripeSubscriptionPriceId;
    });

    if (plan) {
      return { isPaid: true, plan, stripeDetails };
    }
  }

  const freePlan = PricingPlanList[PLAN_ID.FREE];

  if (!freePlan) {
    throw new Error('Free plan not found');
  }

  return { isPaid: false, plan: freePlan };
};
