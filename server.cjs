const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {URL} = require("node:url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai-compatible").toLowerCase();
const AI_API_URL = process.env.AI_API_URL || (AI_PROVIDER === "ollama" ? "http://127.0.0.1:11434/api/chat" : "");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || (AI_PROVIDER === "ollama" ? "qwen2.5-coder:7b" : "");
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || (AI_PROVIDER === "ollama" ? 120000 : 15000));
const MAX_BODY = 64 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(response, status, body) {
  response.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
  response.end(JSON.stringify(body));
}

function sendError(response, status, code, message) {
  sendJson(response, status, {ok: false, error: {code, message}});
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let content = "";
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request too large"), {code: "REQUEST_TOO_LARGE"}));
        request.destroy();
        return;
      }
      content += chunk;
    });
    request.on("end", () => {
      try { resolve(JSON.parse(content || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON"), {code: "INVALID_JSON"})); }
    });
    request.on("error", reject);
  });
}

function configured() {
  if (AI_PROVIDER === "ollama") return Boolean(AI_API_URL && AI_MODEL);
  return AI_PROVIDER === "openai-compatible" && Boolean(AI_API_URL && AI_API_KEY && AI_MODEL);
}

function cleanJsonText(text) {
  return String(text || "").replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "").trim();
}

function buildPrompt(body) {
  const base = "You are a careful beginner-friendly perfumery assistant. Preserve user observations exactly as observations, distinguish suggestions or intentions from physical trial results, never claim to know exactly what a person smelled, and never invent formula percentages, safety information, measurements, or ingredients not supplied. Return only valid JSON.";
  if (body.action === "chat") return `${base}\nYou are in a conversational Scent Companion. Decide whether the user's free-form message is asking for a term explanation, observation analysis/vocabulary help, a formulation briefing, or clarification. Return {"intent":"explain"|"observation"|"briefing"|"clarify"|"general","answer":string,"clarifyingQuestion":string|null}. If the request is unclear, use intent clarify, keep answer short, and ask one useful question. Use only the supplied message, recent conversation, and optional editor context. Do not silently rewrite or save the user's observation. Message: ${JSON.stringify(body.message || "")} Recent conversation: ${JSON.stringify(body.history || [])} Editor context: ${JSON.stringify(body.context || {})}`;
  if (body.action === "vocabulary") return `${base}\nReturn {"preservedObservation":string,"suggestions":[{"term":string,"meaning":string,"why":string}],"clearerWording":string}. Offer no more than five optional terms. User observation: ${JSON.stringify(body.observation || {})}`;
  if (body.action === "explain") return `${base}\nExplain the perfumery term for a beginner. Return {"term":string,"explanation":string}. Term: ${JSON.stringify(body.term || "")}`;
  return `${base}\nReturn {"intendedCharacter":string,"roles":[string],"opening":string,"heart":string,"dryDown":string,"uncertainties":[string],"spokenText":string}. Only describe opening, heart, or dry-down when the supplied information supports an intended development; otherwise say it is uncertain. Blend description: ${JSON.stringify(body.briefing || "")}`;
}

function validateRequest(body) {
  if (!body || !["chat", "vocabulary", "explain", "briefing"].includes(body.action)) return "Expected action chat, vocabulary, explain, or briefing.";
  if (body.action === "chat" && (!body.message || typeof body.message !== "string" || body.message.length > 5000)) return "A non-empty message under 5000 characters is required.";
  if (body.action === "explain" && (!body.term || typeof body.term !== "string" || body.term.length > 80)) return "A short term is required.";
  if (body.action === "briefing" && (!body.briefing || typeof body.briefing !== "string" || body.briefing.length > 7000)) return "A blend description is required and must be under 7000 characters.";
  if (body.action === "vocabulary" && (!body.observation || typeof body.observation.text !== "string" || !body.observation.text.trim() || body.observation.text.length > 5000)) return "A non-empty observation under 5000 characters is required.";
  return "";
}

async function askProvider(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const prompt = buildPrompt(body);
    const headers = {"Content-Type": "application/json"};
    let endpoint = AI_API_URL;
    let requestBody;
    if (AI_PROVIDER === "ollama") {
      requestBody = {model: AI_MODEL, stream: false, format: "json", options: {temperature: 0.25}, messages: [
        {role: "system", content: "You return concise, valid JSON only. Do not wrap JSON in markdown."},
        {role: "user", content: prompt}
      ]};
    } else {
      headers.Authorization = `Bearer ${AI_API_KEY}`;
      requestBody = {model: AI_MODEL, temperature: 0.25, messages: [
        {role: "system", content: "You return concise JSON only."},
        {role: "user", content: prompt}
      ]};
    }
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (!upstream.ok) throw new Error(`Provider returned ${upstream.status}`);
    const payload = await upstream.json();
    const content = AI_PROVIDER === "ollama" ? payload?.message?.content : payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Provider returned no message content");
    try { return JSON.parse(cleanJsonText(content)); }
    catch { throw new Error("Provider returned invalid JSON"); }
  } finally {
    clearTimeout(timeout);
  }
}

async function handleAi(request, response) {
  if (!configured()) {
    sendError(response, 503, "AI_NOT_CONFIGURED", AI_PROVIDER === "ollama"
      ? "Ollama is selected but no model is configured. Set AI_MODEL or use the default qwen2.5-coder:7b."
      : "Language-model assistance is not configured. Set AI_API_URL, AI_API_KEY, and AI_MODEL, or set AI_PROVIDER=ollama for local inference.");
    return;
  }
  let body;
  try { body = await readJson(request); }
  catch (error) {
    if (error.code === "REQUEST_TOO_LARGE") sendError(response, 413, error.code, "Request is too large.");
    else sendError(response, 400, error.code || "INVALID_JSON", "Send valid JSON.");
    return;
  }
  const validationMessage = validateRequest(body);
  if (validationMessage) { sendError(response, 400, "INVALID_REQUEST", validationMessage); return; }
  try {
    const result = await askProvider(body);
    sendJson(response, 200, {ok: true, ...result, meta: {provider: AI_PROVIDER, model: AI_MODEL}});
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    sendError(response, 502, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE", timedOut
      ? "The language model took too long to respond. Try a shorter request or increase AI_TIMEOUT_MS."
      : AI_PROVIDER === "ollama"
        ? "Could not get a valid response from local Ollama. Check that Ollama is running and the configured model is available."
        : "The configured language-model provider could not complete this request.");
  }
}

function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT + path.sep)) { sendError(response, 403, "FORBIDDEN", "That path is not available."); return; }
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) { sendError(response, 404, "NOT_FOUND", "File not found."); return; }
    response.writeHead(200, {"Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache"});
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/health") {
    if (request.method !== "GET") { sendError(response, 405, "METHOD_NOT_ALLOWED", "Use GET."); return; }
    sendJson(response, 200, {ok: true, aiConfigured: configured(), aiProvider: AI_PROVIDER, aiModel: AI_MODEL || null});
    return;
  }
  if (url.pathname === "/api/scent-companion/assist") {
    if (request.method !== "POST") { sendError(response, 405, "METHOD_NOT_ALLOWED", "Use POST."); return; }
    await handleAi(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { sendError(response, 405, "METHOD_NOT_ALLOWED", "Use GET."); return; }
  serveStatic(request, response, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Atelier is running at http://localhost:${PORT}`);
  console.log(`AI assistance: ${configured() ? `${AI_PROVIDER} / ${AI_MODEL}` : "not configured (journal and speech still work)"}`);
});
