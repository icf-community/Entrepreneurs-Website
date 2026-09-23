import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPage } from "./loadtest-response.mjs";

test("a real rendered page passes, but HTTP 200 alone does not", () => {
  assert.equal(classifyPage(200, '<h1>Hello</h1>', true, 'Hello').ok, true);
  for (const body of ['', '<h1>Sign in</h1>', '<h1>Challenge</h1>']) {
    assert.equal(classifyPage(200, body, true, 'People you can reach').ok, false);
  }
});
test("both HTTP and streamed redirects fail authenticated checks", () => {
  for (const [status, body] of [[307, ''], [200, 'NEXT_REDIRECT;replace;/login;307;'],
    [200, '<meta id="__next-page-redirect" content="0;url=/pending">']]) {
    assert.equal(classifyPage(status, body, true).ok, false);
    assert.equal(classifyPage(status, body, false).ok, true);
  }
});
test("stream failures after the heading and transport failures do not pass", () => {
  for (const body of ['<h1>Hello</h1><script>$RX("B:0","123")</script>',
    '<h1>Something went wrong.</h1>', '<h1>Application error:</h1>']) {
    assert.equal(classifyPage(200, body, true).ok, false);
  }
  for (const status of [0, 403, 429, 500, 503]) {
    assert.equal(classifyPage(status, '<h1>Hello</h1>', true).ok, false);
  }
});
