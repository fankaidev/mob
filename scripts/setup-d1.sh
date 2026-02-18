#!/bin/bash
set -e

echo "🚀 Setting up D1 database for Mob Chat"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler is not installed"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Check if already logged in
echo "📋 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Please login to Cloudflare:"
    wrangler login
fi

echo ""
echo "1️⃣  Creating D1 database 'mob-session'..."
echo ""

# Create D1 database
OUTPUT=$(wrangler d1 create mob-session 2>&1)
echo "$OUTPUT"

# Extract database ID from output
DATABASE_ID=$(echo "$OUTPUT" | grep "database_id" | sed -n 's/.*database_id = "\([^"]*\)".*/\1/p')

if [ -z "$DATABASE_ID" ]; then
    echo ""
    echo "⚠️  Could not extract database ID. It might already exist."
    echo "Run: wrangler d1 list"
    echo "Then manually update wrangler.jsonc with your database ID"
    exit 0
fi

echo ""
echo "✅ Database created with ID: $DATABASE_ID"
echo ""

# Update wrangler.jsonc with the database ID
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/replace-with-your-d1-id/$DATABASE_ID/" wrangler.jsonc
else
    # Linux
    sed -i "s/replace-with-your-d1-id/$DATABASE_ID/" wrangler.jsonc
fi

echo "2️⃣  Applying database schema..."
echo ""

# Apply schema to local database (for development)
wrangler d1 execute mob-session --local --file=schema.sql

# Apply schema to remote database (for production)
wrangler d1 execute mob-session --remote --file=schema.sql

echo ""
echo "✅ Schema applied successfully"
echo ""
echo "3️⃣  Verifying database setup..."
echo ""

# List tables to verify
wrangler d1 execute mob-session --local --command="SELECT name FROM sqlite_master WHERE type='table'"

echo ""
echo "🎉 D1 database setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start development server: npm run dev"
echo "  2. Open browser and configure API key in Settings"
echo ""
