import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Cors
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  PORTAL_URL: z.string().default('http://localhost:5174'),
  // Mongike payment gateway
  MONGIKE_API_KEY: z.string().min(1, 'MONGIKE_API_KEY is required'),
  MONGIKE_API_URL: z.string().url().default('https://mongike.com'),
  // Backend public URL (used for webhook registration)
  APP_URL: z.string().url(),
  // Platform webhook shared secret (activation/subscription callbacks)
  ACTIVATION_WEBHOOK_SECRET: z.string().min(32, 'ACTIVATION_WEBHOOK_SECRET must be at least 32 characters'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
