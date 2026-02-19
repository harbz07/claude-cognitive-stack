#!/usr/bin/env bash
# ============================================================
# deploy.sh — Deploy Cognitive Runtime to Cloudflare Pages
# ============================================================
# Prerequisites:
#   1. CLOUDFLARE_API_TOKEN env var set (or `wrangler login`)
#   2. Node.js + npm installed
#   3. Run from project root
# ============================================================

set -euo pipefail

PROJECT_NAME="cognitive-runtime"
D1_DB_NAME="cognitive-runtime-production"

echo "🧠 Deploying Cognitive Runtime Service..."
echo "────────────────────────────────────────"

# ── Step 1: Build ─────────────────────────────────────────
echo "📦 Building..."
npm run build
echo "✅ Build complete"

# ── Step 2: Ensure D1 database exists ─────────────────────
echo "🗄️  Checking D1 database..."
DB_ID=$(npx wrangler d1 list --json 2>/dev/null | node -e "
  const data = require('fs').readFileSync('/dev/stdin','utf8');
  const dbs = JSON.parse(data);
  const db = dbs.find(d => d.name === '${D1_DB_NAME}');
  if (db) process.stdout.write(db.uuid);
" 2>/dev/null || echo "")

if [ -z "$DB_ID" ]; then
  echo "Creating D1 database: ${D1_DB_NAME}..."
  DB_ID=$(npx wrangler d1 create "${D1_DB_NAME}" --json 2>/dev/null | node -e "
    const data = require('fs').readFileSync('/dev/stdin','utf8');
    const result = JSON.parse(data);
    process.stdout.write(result.uuid);
  ")
  echo "✅ Created D1 database: ${DB_ID}"
else
  echo "✅ D1 database exists: ${DB_ID}"
fi

# ── Step 3: Update wrangler.jsonc with real DB ID ─────────
echo "📝 Updating wrangler.jsonc with database_id..."
sed -i "s|\\\${D1_DATABASE_ID}|${DB_ID}|g" wrangler.jsonc
echo "✅ Config updated"

# ── Step 4: Deploy to Cloudflare Pages ────────────────────
echo "🚀 Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name "${PROJECT_NAME}"
echo ""
echo "✅ Deployment complete!"
echo ""

# ── Step 5: Remind about secrets ──────────────────────────
echo "⚠️  Don't forget to set secrets:"
echo "   npx wrangler pages secret put OPENAI_API_KEY --project-name ${PROJECT_NAME}"
echo "   npx wrangler pages secret put OPENAI_BASE_URL --project-name ${PROJECT_NAME}"
echo "   npx wrangler pages secret put MASTER_KEY --project-name ${PROJECT_NAME}"
echo ""
echo "🌐 Your app will be live at: https://${PROJECT_NAME}.pages.dev"
echo "📋 Initialize DB: curl https://${PROJECT_NAME}.pages.dev/api/init"
