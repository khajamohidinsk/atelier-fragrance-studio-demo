import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Atelier server exited before becoming ready');
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return response.json();
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Atelier server health endpoint');
}

test('Ollama mode needs no API key and parses its native chat response', async t => {
  let ollamaRequest;
  const fakeOllama = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    ollamaRequest = JSON.parse(raw);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model: 'test-model',
      message: { role: 'assistant', content: JSON.stringify({ term: 'powdery', explanation: 'A soft, dry impression reminiscent of cosmetic powder.' }) },
      done: true
    }));
  });
  fakeOllama.listen(0, '127.0.0.1');
  await once(fakeOllama, 'listening');
  const ollamaPort = fakeOllama.address().port;
  const appPort = await unusedPort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const child = spawn(process.execPath, ['server.cjs'], {
    env: {
      ...process.env,
      PORT: String(appPort),
      AI_PROVIDER: 'ollama',
      AI_API_URL: `http://127.0.0.1:${ollamaPort}/api/chat`,
      AI_MODEL: 'test-model',
      AI_API_KEY: ''
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => fakeOllama.close(resolve));
  });

  const health = await waitForHealth(appUrl, child);
  assert.equal(health.aiConfigured, true);
  assert.equal(health.aiProvider, 'ollama');
  assert.equal(health.aiModel, 'test-model');

  const response = await fetch(`${appUrl}/api/scent-companion/assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'explain', term: 'powdery' })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.term, 'powdery');
  assert.match(result.explanation, /soft, dry impression/);
  assert.equal(result.meta.provider, 'ollama');
  assert.equal(ollamaRequest.model, 'test-model');
  assert.equal(ollamaRequest.stream, false);
  assert.equal(ollamaRequest.format, 'json');
  assert.equal(ollamaRequest.messages[1].content.includes('powdery'), true);
});
