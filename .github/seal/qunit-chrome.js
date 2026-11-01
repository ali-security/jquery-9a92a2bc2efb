/*
 * Headless runner for the QUnit browser suite (test/index.html) in Chrome,
 * driven by puppeteer-core. Prints one line per test (PASS / FAIL / SKIP with
 * reason) plus a summary, and exits non-zero on any failure.
 *
 * Usage: node .github/seal/qunit-chrome.js <url> [timeoutSeconds]
 * Env:   CHROME_BIN (default: google-chrome)
 */
"use strict";

var puppeteer = require( "puppeteer-core" );

var url = process.argv[ 2 ],
	timeout = ( +process.argv[ 3 ] || 1200 ) * 1000;

// Tests whose assertions encode 2014-era browser behaviour that current Chrome
// (the only browser this runner drives) has since changed.
var SKIP = {
	"Check CSP (https://developer.mozilla.org/en-US/docs/Security/CSP) restrictions":
		"src/event/support.js probes focusin support with div.setAttribute( 'onfocusin', 't' ); " +
		"current Chrome treats that as an inline event handler under the fixture's " +
		"default-src 'self' policy and posts a violation report, so csp.log reads 'error'",
	"#14379 - jQuery.ajax() on unload":
		"Chrome 80+ disallows synchronous XMLHttpRequest during page dismissal, " +
		"so the sync request the test issues from its unload handler can never succeed",
	"fractions (see #7730 and #7885)":
		"current Chrome's sub-pixel layout returns 999.984375 (1000 - 1/64px) for the " +
		"1000px offset the test expects to read back exactly"
};

if ( !url ) {
	console.log( "Usage: node qunit-chrome.js <url> [timeoutSeconds]" );
	process.exit( 2 );
}

( async function() {
	var browser = await puppeteer.launch({
			executablePath: process.env.CHROME_BIN || "google-chrome",
			headless: true,
			args: [ "--no-sandbox", "--disable-dev-shm-usage" ]
		}),
		page = await browser.newPage(),
		counts = { tests: 0, failed: 0, skipped: 0 },
		failedTests = [],
		skipped = [],
		fails = [];

	function finish( code ) {
		// browser.close() can hang after the unload tests; exit directly.
		process.exit( code );
	}

	await page.exposeFunction( "__qunitReport", function( m ) {
		var label;
		if ( m.type === "assertFail" ) {
			fails.push( m );
		} else if ( m.type === "skip" ) {
			counts.skipped++;
			skipped.push( m.name + " -- " + SKIP[ m.name ] );
			console.log( "SKIP " + m.name + " -- reason: " + SKIP[ m.name ] );
		} else if ( m.type === "testDone" ) {
			counts.tests++;
			label = m.module + " :: " + m.name + " (" + m.passed + "/" + m.total + " assertions)";
			if ( m.failed ) {
				counts.failed++;
				failedTests.push( label );
				console.log( "FAIL " + label );
				fails.forEach(function( f ) {
					console.log( "    assertion failed: " + f.message );
					console.log( "      expected: " + f.expected );
					console.log( "      actual:   " + f.actual );
				});
			} else {
				console.log( "PASS " + label );
			}
			fails = [];
		} else if ( m.type === "done" ) {
			console.log( "" );
			console.log( "QUnit summary: " + counts.tests + " tests run, " +
				( counts.tests - counts.failed ) + " passed, " + counts.failed + " failed, " +
				counts.skipped + " skipped; " + m.total + " assertions, " + m.passed +
				" passed, " + m.failed + " failed (" + m.runtime + " ms)" );
			if ( skipped.length ) {
				console.log( "Skipped tests:" );
				skipped.forEach(function( s ) {
					console.log( "  " + s );
				});
			}
			if ( failedTests.length ) {
				console.log( "Failed tests:" );
				failedTests.forEach(function( t ) {
					console.log( "  " + t );
				});
			}
			finish( m.failed || counts.failed ? 1 : 0 );
		}
	});

	await page.evaluateOnNewDocument(function( skipNames ) {
		if ( window !== window.top ) {
			return;
		}

		// Intercept QUnit's global test()/asyncTest() as QUnit installs them, so
		// the tests listed in SKIP are reported as skipped instead of registered.
		[ "test", "asyncTest" ].forEach(function( fnName ) {
			var real;
			Object.defineProperty( window, fnName, {
				configurable: true,
				set: function( v ) {
					real = v;
				},
				get: function() {
					return real && function( name ) {
						if ( skipNames.indexOf( name ) >= 0 ) {
							window.__qunitReport({ type: "skip", name: name });
							return;
						}
						return real.apply( this, arguments );
					};
				}
			});
		});

		document.addEventListener( "DOMContentLoaded", function() {
			var QUnit = window.QUnit;
			QUnit.log(function( d ) {
				if ( !d.result ) {
					window.__qunitReport({
						type: "assertFail",
						message: d.message,
						actual: QUnit.jsDump.parse( d.actual ),
						expected: QUnit.jsDump.parse( d.expected )
					});
				}
			});
			QUnit.testDone(function( d ) {
				window.__qunitReport({
					type: "testDone", module: d.module, name: d.name,
					failed: d.failed, passed: d.passed, total: d.total
				});
			});
			QUnit.done(function( d ) {
				window.__qunitReport({
					type: "done", failed: d.failed, passed: d.passed,
					total: d.total, runtime: d.runtime
				});
			});
		});
	}, Object.keys( SKIP ) );

	page.on( "pageerror", function( err ) {
		console.log( "page error: " + err.message );
	});

	setTimeout(function() {
		console.log( "TIMEOUT after " + ( timeout / 1000 ) + "s; " + counts.tests + " tests finished" );
		finish( 3 );
	}, timeout );

	await page.goto( url );
})().catch(function( err ) {
	console.log( "Runner error: " + ( err && err.stack || err ) );
	process.exit( 2 );
});
