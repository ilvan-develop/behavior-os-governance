#!/bin/bash
# Fix ESM module extensions in compiled JavaScript files
# This script adds .js extensions to relative imports

echo "🔧 Fixing ESM module extensions in behavior-os dist..."

# Find all JS files in dist directories
find packages/*/dist -name "*.js" -type f | while read -r file; do
    # Replace imports without extensions
    sed -i.bak 's/from '"'"'\.\/\([^'"'"'"]*[^'"'"'"].\{0,\}'"'"'/from '"'"'.\/\1.js'"'"'/g' "$file" 2>/dev/null || true
    rm -f "${file}.bak"
done

echo "✅ ESM module extensions fixed!"
