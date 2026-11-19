#!/bin/sh
# Download pdf.js's test PDFs (the files in its repository; the .link files pointing
# elsewhere on the web are left out) into .corpus/pdfs. Pinned, so CI results only
# change when this commit does.
set -e
PDFJS_COMMIT=81b2255fe0a0b79854c26ec6193eb5ce6681b4dc
DEST=.corpus/pdfs
[ -f "$DEST/.commit" ] && [ "$(cat "$DEST/.commit")" = "$PDFJS_COMMIT" ] && exit 0
rm -rf .corpus/pdfjs "$DEST"
git init -q .corpus/pdfjs
cd .corpus/pdfjs
git remote add origin https://github.com/mozilla/pdf.js.git
git sparse-checkout set --no-cone /test/pdfs/*.pdf
git fetch -q --depth 1 --filter=blob:none origin "$PDFJS_COMMIT"
git checkout -q FETCH_HEAD
cd ../..
mv .corpus/pdfjs/test/pdfs "$DEST"
rm -rf .corpus/pdfjs
echo "$PDFJS_COMMIT" > "$DEST/.commit"
echo "$(ls "$DEST" | wc -l) PDFs in $DEST"
