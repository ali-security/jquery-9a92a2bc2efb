#!/usr/bin/env bash
# Run the QUnit browser suite (test/index.html, every module listed in
# test/data/testinit.js) headlessly in Chrome via .github/seal/qunit-chrome.js.
# The test pages need PHP (test/data/*.php), served here by PHP's built-in
# server with several workers so the long-polling helpers
# (e.g. test/data/core/dont_return.php) don't block other requests.
#
# Usage: .github/seal/run-browser-tests.sh [query-string]   e.g. "module=core"
# Env:   PHP (default php), CHROME_BIN, NODE_PATH (where puppeteer-core lives)
set -u

ROOT="$( cd "$( dirname "$0" )/../.." && pwd )"
PORT="${PORT:-8000}"
PHP="${PHP:-php}"
QUERY="${1:-}"

PHP_CLI_SERVER_WORKERS=4 "$PHP" -S "127.0.0.1:$PORT" -t "$ROOT" > /tmp/php-server.log 2>&1 &
PHP_PID=$!
trap 'kill $PHP_PID 2>/dev/null' EXIT
sleep 2

echo "Browser: $( "${CHROME_BIN:-google-chrome}" --version 2>/dev/null ); $( "$PHP" --version | head -1 )"
node "$ROOT/.github/seal/qunit-chrome.js" "http://127.0.0.1:$PORT/test/index.html${QUERY:+?$QUERY}" 1200
