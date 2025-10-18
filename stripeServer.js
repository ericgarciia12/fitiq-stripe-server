require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);



const app = express();
const PORT = process.env.PORT || 4242;

// ✅ Middleware
app.use(cors());
app.use('/webhook', bodyParser.raw({ type: 'application/json' })); // Stripe requires raw for webhook verification
app.use(express.json()); // all other routes stay normal

// ✅ Health check
app.get('/ping', (req, res) => {
  res.send('✅ Stripe server is alive');
});

// ✅ Subscription creation route
app.post('/create-subscription', async (req, res) => {
  const { email, name, userId } = req.body;
  console.log('📩 Incoming subscription request for:', email);

  try {
    // 1. Find or create customer
    const existingCustomers = await stripe.customers.list({ email });
    let customer = existingCustomers.data.length ? existingCustomers.data[0] : null;

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        name,
        metadata: { fitiqUserId: userId },
      });
      console.log('✅ Created new customer:', customer.id);
    }

    // 2. Create subscription with free trial and SetupIntent
// ✅ Existing subscription logic (you already have this)
const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: 'price_1SJHhxGk0bAMCn4gDM6SLFIl' }],
  payment_behavior: 'default_incomplete',
  payment_settings: {
    save_default_payment_method: 'on_subscription',
  },
  trial_period_days: 2,
  expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
});



// ✅ Get either intent
let clientSecret;
if (subscription.latest_invoice?.payment_intent) {
  clientSecret = subscription.latest_invoice.payment_intent.client_secret;
} else if (subscription.pending_setup_intent) {
  clientSecret = subscription.pending_setup_intent.client_secret;
}

// ✅ NEW: Generate ephemeral key (needed for SetupIntent flow)
const ephemeralKey = await stripe.ephemeralKeys.create(
  { customer: customer.id },
  { apiVersion: '2022-11-15' }
);

// ✅ Send all 3 back
if (!clientSecret) {
  console.error('❌ No clientSecret returned from Stripe.');
  return res.status(500).json({ error: 'No client secret available from Stripe.' });
}

res.json({
  success: true,
  clientSecret,
  customerId: customer.id,
  subscriptionId: subscription.id,
  ephemeralKey: ephemeralKey.secret,
});



  } catch (err) {
    console.error('🔥 Stripe Error:', err.message);
    if (err.raw) console.error('📦 Raw error:', err.raw);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

// ✅ Webhook to handle Stripe events
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 🎯 Event handling
  switch (event.type) {
    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      console.log('✅ Payment succeeded:', invoice.id);
      break;

    case 'customer.subscription.created':
      const sub = event.data.object;
      console.log('🆕 Subscription created:', sub.id);
      break;

    case 'customer.subscription.deleted':
      console.log('❌ Subscription canceled');
      break;

    default:
      console.log(`📦 Unhandled event type: ${event.type}`);
  }

  res.status(200).send('Webhook received');
});

// ✅ Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stripe server running on port ${PORT}`);
});
