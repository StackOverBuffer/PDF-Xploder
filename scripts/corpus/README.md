# PDF corpus test

Every PDF in [pdf.js's test collection](https://github.com/mozilla/pdf.js/tree/master/test/pdfs)
(the ~1,100 files in its repository; the `.link` files that point elsewhere on the web are left out)
goes through the steps the app takes:

1. **Open and draw** every page with pdf.js, read its text and comments.
2. **Make it editable**: decrypt files that open without a password, import comments into the model.
3. **Save**: comments written back, every file rewritten once (as any edit does).
4. **Reopen** the saved file: same number of pages, the first pages draw.
5. **qpdf --check** the saved file. Errors count when the original had none, warnings when the original was clean.

Files pdf.js refuses (broken on purpose), files that need a password and files pdf-lib cannot parse
(the app opens those read-only) are counted, not failed. A file that hangs (over 2 minutes) or kills its
process is a problem.

```sh
sudo apt-get install qpdf          # once
scripts/corpus/fetch.sh            # pdf.js's test files into .corpus/pdfs (pinned commit, ~150 MB)
npm run corpus                     # all files, 2 to 3 minutes on 4 cores
npm run corpus -- .corpus/pdfs --only issue5334.pdf,bug1980958.pdf
npm run corpus -- .corpus/pdfs --update   # rewrite known-issues.json from this run
```

CI runs it as the `corpus` job. Problems listed in `known-issues.json` (file → kinds of problem:
`render`, `import`, `save`, `reopen`, `page count`, `qpdf`, `qpdf warning`, `timeout`, `crash`) are
reported in the job summary but do not fail it; anything new does. When a fix makes a known issue go
away, the summary says so: run with `--update` to drop it from the list. Per-file results are
uploaded as the `corpus-results` artifact.

Environment: `CORPUS_MAX_PAGES` (pages drawn per file, default all), `CORPUS_TIMEOUT` (ms per file).
