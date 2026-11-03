# Tests

Integration tests that drive the real UI code in jsdom against a local mock
OpenAI-compatible server. No API key or network access needed.

```bash
npm install --no-save jsdom          # only dependency
node ../tests/../tests/run-mock.js &  # or see run-mock.js
node tests/ui-test.js                # BYO-key flow over http
node tests/file-protocol-test.js     # file:// detection and diagnostics
```

`run-mock.js` is a 60-line mock of `/v1/chat/completions` that returns a valid
portrait JSON. It also records each request so the tests can assert on the
model id, auth header, and normalised URL.
