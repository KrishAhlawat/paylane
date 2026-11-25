import { z } from 'zod';

/** Largest single payment: Rs 1 crore, expressed in paise. Well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT = 1_000_000_000;

export const createPaymentSchema = z
  .object({
    /** Integer minor units (paise). 10000 = Rs 100.00 */
    amount: z.number().int().positive().max(MAX_AMOUNT),
    currency: z.literal('INR').default('INR'),
    /** Opaque test token. Real card numbers are never accepted or stored. */
    payment_method_token: z.string().regex(/^tok_[a-z0-9_]{1,64}$/i, 'must look like tok_xxx'),
    metadata: z
      .record(z.string().max(500))
      .refine((m) => Object.keys(m).length <= 20, 'at most 20 metadata keys')
      .optional(),
  })
  .strict();

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
