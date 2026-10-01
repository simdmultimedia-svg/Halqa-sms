#!/usr/bin/env bash
# ============================================================================
# CICK Enterprise — Generate TypeScript Types from Supabase Schema
# ============================================================================
#
# Usage:
#   ./supabase/scripts/generate-types.sh
#
# Prerequisites:
#   - Supabase CLI installed (npx supabase or global install)
#   - Local Supabase instance running (supabase start)
#
# Output:
#   supabase/types/database.ts
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$PROJECT_ROOT/supabase/types/database.ts"

echo "🔄 Generating TypeScript types from local Supabase schema..."

npx supabase gen types typescript --local > "$OUTPUT_FILE"

echo "✅ Types generated successfully: $OUTPUT_FILE"
echo "   $(wc -l < "$OUTPUT_FILE") lines written."
