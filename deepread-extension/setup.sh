#!/bin/bash
# Run this once from inside the deepread-extension folder
# It downloads pdf.js locally so Chrome CSP doesn't block it

mkdir -p lib

echo "Downloading pdf.js..."
curl -L "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" -o lib/pdf.min.js
curl -L "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" -o lib/pdf.worker.min.js

echo ""
echo "Done! Files saved to lib/"
ls -lh lib/
echo ""
echo "Now reload the extension in chrome://extensions"
