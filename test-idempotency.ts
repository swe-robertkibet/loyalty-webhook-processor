import { generateWebhookSignature } from './src/utils/verifySignature';

const BASE_URL = 'http://localhost:3000';

interface WebhookPayload {
  eventId: string;
  type: string;
  userId: string;
  amount: number;
  currency: string;
  timestamp: string;
}

interface UserData {
  userId: string;
  points: number;
}

interface TransactionData {
  transactions?: Array<{
    transactionId: string;
    userId: string;
    points: number;
    type: string;
    timestamp: string;
  }>;
}

async function sendWebhook(payload: WebhookPayload): Promise<any> {
  const payloadString = JSON.stringify(payload);
  const signature = generateWebhookSignature(payloadString);

  const response = await fetch(`${BASE_URL}/webhooks/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
    },
    body: payloadString,
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function testIdempotency() {
  console.log('Testing Webhook Idempotency\n');
  console.log('=' .repeat(60));

  // LEts TEST PAYLOAD
  const payload: WebhookPayload = {
    eventId: 'test-payment-12345',
    type: 'payment.completed',
    userId: 'user-alice',
    amount: 10000,
    currency: 'USD',
    timestamp: new Date().toISOString(),
  };

  console.log('\nFirst Request - Should create new event and award points');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const response1 = await sendWebhook(payload);
  console.log('\nResponse 1:');
  console.log(`   Status: ${response1.status}`);
  console.log(`   Data:`, JSON.stringify(response1.data, null, 2));

  // WAIT A BIT FOR WORKER TO PROCESS
  console.log('\nWaiting 2 seconds for worker to process...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // SEND SAME WEBHOOK AGAIN
  console.log('\nSecond Request - Same eventId (testing idempotency)');
  const response2 = await sendWebhook(payload);
  console.log('\nResponse 2:');
  console.log(`   Status: ${response2.status}`);
  console.log(`   Data:`, JSON.stringify(response2.data, null, 2));

  // CHECK USER POINTS
  console.log('\nChecking user points...');
  const userResponse = await fetch(`${BASE_URL}/users/user-alice`);
  const userData = await userResponse.json() as UserData;
  console.log('   User Data:', JSON.stringify(userData, null, 2));

  // CHECK TRANSACTIONS
  console.log('\nChecking transactions...');
  const txResponse = await fetch(`${BASE_URL}/transactions?userId=user-alice`);
  const txData = await txResponse.json() as TransactionData;
  console.log('   Transactions:', JSON.stringify(txData, null, 2));

  const txCount = txData.transactions?.length || 0;

  console.log('\n' + '='.repeat(60));
  console.log('\nIDEMPOTENCY TEST RESULTS:');
  console.log(`   • First request: ${response1.data.message}`);
  console.log(`   • Second request: ${response2.data.message}`);
  console.log(`   • User points: ${userData.points} (should be 1, not 2)`);
  console.log(`   • Transaction count: ${txCount} (should be 1, not 2)`);

  if (userData.points === 1 && txCount === 1) {
    console.log('\nIDEMPOTENCY TEST PASSED! Points awarded only once.');
  } else {
    console.log('\nIDEMPOTENCY TEST FAILED! Duplicate points detected.');
  }
}

testIdempotency().catch(console.error);
