#!/bin/bash
# TRIVA Backend Deployment Script for VPS
# Run as: chmod +x deploy.sh && ./deploy.sh

set -e

echo "🚀 Deploying TRIVA Backend..."

# Pull latest code
git pull origin main

# Install dependencies
cd backend
npm ci --only=production=false

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Build TypeScript
npm run build

# Restart PM2 process
if pm2 list | grep -q "triva-backend"; then
  pm2 restart triva-backend
else
  pm2 start dist/index.js --name triva-backend --log logs/pm2.log
fi

pm2 save

echo "✅ Deployment complete!"
pm2 status
