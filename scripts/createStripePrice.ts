import { stripe } from '@/libs/Stripe';
import type { PricingPlan } from '@/types/Subscription';
import { AppConfig, PricingPlanList } from '@/utils/AppConfig';

const createStripePrice = async (plan: PricingPlan) => {
  const product = await stripe.products.create({
    name: `${AppConfig.name} - ${plan.id}`,
  });

  const price = await stripe.prices.create({
    unit_amount: plan.price * 100,
    currency: 'usd',
    recurring: {
      interval: plan.interval,
    },
    product: product.id,
  });

  console.log(`Plan: ${plan.id} - Price ID: ${price.id}`);
};

async function main() {
  console.log('Create Stripe price started');

  // run sequentially (not in parallel) with classic loop, `forEach` is not designed for asynchronous code.
  for (const plan of PricingPlanList.slice(1)) {
    await createStripePrice(plan);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Create Stripe price failed');
  console.log(error);
  process.exit(1);
});
