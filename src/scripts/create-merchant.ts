import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
} from '../auth/api-key';

// Usage: npm run merchant:create -- "My Shop" http://localhost:4000/webhooks
async function main(): Promise<void> {
  const name = process.argv[2] ?? 'Test Merchant';
  const webhookUrl = process.argv[3] ?? null;

  const prisma = new PrismaClient();
  try {
    const apiKey = generateApiKey();
    const webhookSecret = generateWebhookSecret();

    const merchant = await prisma.merchant.create({
      data: { name, apiKeyHash: hashApiKey(apiKey), webhookUrl, webhookSecret },
    });

    // eslint-disable-next-line no-console
    console.log(
      [
        `Merchant created: ${merchant.name} (${merchant.id})`,
        `API key (shown once, only its hash is stored): ${apiKey}`,
        `Webhook secret: ${webhookSecret}`,
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
