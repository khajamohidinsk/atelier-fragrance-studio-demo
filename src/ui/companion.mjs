import { addCompanionEntry, deleteCompanionEntry, updateCompanionEntry } from '../domain/store.mjs';
import { normalizeChatHistory, prepareChatRequest } from '../domain/chat-history.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function initScentCompanion({ getState, persist, toast, materialNames = [] }) {
  const root = document.querySelector('#screen-companion');
  if (!root) return;
  const form = root.querySelector('#companion-form');
  const list = root.querySelector('#companion-entry-list');
  const state = { editingId: '', lastAiResult: null, recognition: null, dictation: null, briefingText: '', synthesis: false, chatHistory: [] };
  const fields = name => form.elements[name];
  const status = (text, className = '') => { const node = root.querySelector('#companion-save-status'); node.textContent = text; node.className = `status-dot ${className}`; };

  function entries() { return [...(getState().companionEntries || [])].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); }

  function resetForm() {
    if (state.dictation?.active) {
      state.dictation.userStopped = true;
      state.dictation.active = false;
      try { state.recognition?.stop(); } catch { /* already ended */ }
    }
    state.editingId = '';
    state.lastAiResult = null;
    if (state.dictation) {
      state.dictation.lastSessionHadFinalText = false;
      state.dictation.currentEntrySpeech = false;
    }
    form.reset();
    fields('evaluationType').value = 'neat';
    root.querySelector('#companion-editor-heading').textContent = 'New observation';
    root.querySelector('#companion-reset').textContent = 'Clear form';
    root.querySelector('#companion-ai-suggestions').hidden = true;
    root.querySelector('#companion-ai-suggestions').innerHTML = '';
    root.querySelector('#companion-ai-status').textContent = 'AI guidance requires server configuration.';
    status('Ready');
  }

  function editEntry(entry) {
    state.editingId = entry.id;
    fields('materialName').value = entry.materialName;
    fields('evaluationType').value = entry.evaluationType;
    fields('concentration').value = entry.concentration;
    fields('evaluationMethod').value = entry.evaluationMethod;
    fields('elapsedTime').value = entry.elapsedTime;
    fields('observationText').value = entry.correctedText || entry.originalText;
    root.querySelector('#companion-editor-heading').textContent = 'Edit observation';
    root.querySelector('#companion-reset').textContent = 'Cancel edit';
    root.querySelector('#companion-ai-suggestions').hidden = true;
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    const currentEntries = entries();
    root.querySelector('#companion-entry-count').textContent = String(currentEntries.length);
    list.innerHTML = '';
    if (!currentEntries.length) {
      list.innerHTML = '<div class="empty-state"><strong>No observations yet.</strong>Save your first sensory note and it will stay available after you reload this browser.</div>';
      return;
    }
    currentEntries.forEach(entry => {
      const article = document.createElement('article');
      article.className = 'entry-card';
      article.dataset.id = entry.id;
      const date = new Date(entry.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      article.innerHTML = `<div class="entry-card-top"><div><span class="entry-material">${esc(entry.materialName)}</span><span class="entry-context">${esc(entry.evaluationType)}${entry.concentration ? ` · ${esc(entry.concentration)}` : ''}</span></div><span class="entry-date">${esc(date)}</span></div><p class="entry-text"></p><div class="entry-card-bottom"><span>${entry.source === 'speech' ? '◉ Dictated' : '✎ Typed'}${entry.evaluationMethod ? ` · ${esc(entry.evaluationMethod)}` : ''}${entry.elapsedTime ? ` · ${esc(entry.elapsedTime)}` : ''}</span><div><button class="entry-action" data-companion-edit type="button">Edit</button><button class="entry-action danger" data-companion-delete type="button">Delete</button></div></div>`;
      article.querySelector('.entry-text').textContent = entry.correctedText || entry.originalText;
      list.appendChild(article);
    });
  }

  function collect() {
    return {
      materialName: fields('materialName').value.trim(),
      evaluationType: fields('evaluationType').value,
      concentration: fields('concentration').value.trim(),
      evaluationMethod: fields('evaluationMethod').value.trim(),
      elapsedTime: fields('elapsedTime').value.trim(),
      text: fields('observationText').value.trim()
    };
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = collect();
    if (!values.materialName || !values.text) { status('Material and observation are required', 'error'); return; }
    const existing = state.editingId ? getState().companionEntries.find(entry => entry.id === state.editingId) : null;
    const input = { ...values, originalText: existing?.originalText || values.text, correctedText: values.text, source: state.dictation?.currentEntrySpeech ? 'speech' : existing?.source || 'typed', aiSuggestions: existing?.aiSuggestions || [] };
    const next = existing ? updateCompanionEntry(getState(), state.editingId, input) : addCompanionEntry(getState(), input);
    if (!persist(next)) { status('Save failed — your text is still in the editor', 'error'); return; }
    status('Saved in Atelier state', 'success');
    toast(existing ? 'Scent Companion observation updated' : 'Scent Companion observation saved');
    resetForm();
  });

  root.querySelector('#companion-reset').addEventListener('click', resetForm);
  list.addEventListener('click', event => {
    const article = event.target.closest('[data-id]');
    if (!article) return;
    const entry = getState().companionEntries.find(item => item.id === article.dataset.id);
    if (event.target.closest('[data-companion-edit]') && entry) editEntry(entry);
    if (event.target.closest('[data-companion-delete]')) {
      persist(deleteCompanionEntry(getState(), article.dataset.id));
      if (state.editingId === article.dataset.id) resetForm();
      toast('Scent Companion observation deleted');
    }
  });

  function initMaterials() {
    const options = [...new Set([...materialNames, ...(getState().materials || []).map(item => item.name).filter(Boolean)])].sort();
    root.querySelector('#companion-material-options').innerHTML = options.map(name => `<option value="${esc(name)}"></option>`).join('');
  }

  function setSpeechStatus(text) { root.querySelector('#companion-speech-status').textContent = text; }

  function initRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const start = root.querySelector('#companion-start-dictation');
    const stop = root.querySelector('#companion-stop-dictation');
    if (!Recognition) { start.disabled = true; setSpeechStatus('Speech recognition is not supported here. Type your observation instead.'); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    state.recognition = recognition;
    state.dictation = { active: false, userStopped: false, fatal: false, startedAt: 0, autoRestarts: 0, baseText: '', accumulatedText: '', sessionFinalSegments: [], sessionInterim: '', lastSessionHadFinalText: false, currentEntrySpeech: false, restartTimer: null };

    function composedText() { return [state.dictation.baseText, state.dictation.accumulatedText, state.dictation.sessionFinalSegments.filter(Boolean).join(' '), state.dictation.sessionInterim].map(value => value.trim()).filter(Boolean).join(' ').trim(); }
    function flushSession() {
      const sessionText = state.dictation.sessionFinalSegments.filter(Boolean).join(' ').trim();
      if (sessionText) state.dictation.accumulatedText = [state.dictation.accumulatedText, sessionText].filter(Boolean).join(' ').trim();
      state.dictation.sessionFinalSegments = [];
      state.dictation.sessionInterim = '';
      fields('observationText').value = [state.dictation.baseText, state.dictation.accumulatedText].filter(Boolean).join(' ').trim();
    }
    function canRestart() { return state.dictation.active && !state.dictation.userStopped && !state.dictation.fatal && Date.now() - state.dictation.startedAt < 10 * 60 * 1000 && state.dictation.autoRestarts < 24; }
    function restart() {
      if (!canRestart()) { state.dictation.active = false; start.disabled = false; stop.disabled = true; setSpeechStatus(state.dictation.userStopped ? 'Dictation stopped.' : 'Dictation reached the browser session limit. Review the transcript or start again.'); return; }
      state.dictation.autoRestarts += 1;
      state.dictation.sessionFinalSegments = [];
      state.dictation.sessionInterim = '';
      window.setTimeout(() => { if (!canRestart()) return; try { recognition.start(); setSpeechStatus('Listening…'); } catch { state.dictation.restartTimer = window.setTimeout(restart, 500); } }, 250);
    }
    recognition.onstart = () => { start.disabled = true; stop.disabled = false; setSpeechStatus(state.dictation.autoRestarts ? 'Listening… resumed after a browser pause.' : 'Listening… speak naturally.'); };
    recognition.onresult = event => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) { state.dictation.sessionFinalSegments[index] = transcript; state.dictation.lastSessionHadFinalText = true; state.dictation.currentEntrySpeech = true; }
        else state.dictation.sessionInterim = transcript;
      }
      fields('observationText').value = composedText();
    };
    recognition.onerror = event => {
      const fatalErrors = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
      const messages = { 'not-allowed': 'Microphone permission was denied. You can keep typing manually.', 'service-not-allowed': 'Speech service permission was denied. Type your observation instead.', 'audio-capture': 'No microphone was available. Type your observation instead.', 'no-speech': 'No speech was detected; keeping the transcript and listening again.', network: 'Speech recognition lost its network connection; keeping the transcript.' };
      if (fatalErrors.has(event.error)) state.dictation.fatal = true;
      setSpeechStatus(messages[event.error] || `Speech recognition error: ${event.error}. Manual typing is still available.`);
    };
    recognition.onend = () => {
      flushSession();
      if (canRestart()) { setSpeechStatus('Pausing briefly; keeping your transcript…'); restart(); }
      else { state.dictation.active = false; start.disabled = false; stop.disabled = true; if (!state.dictation.fatal && !state.dictation.userStopped) setSpeechStatus('Transcript ready to review.'); }
    };
    start.addEventListener('click', () => {
      if (!state.dictation.active) { state.dictation.active = true; state.dictation.userStopped = false; state.dictation.fatal = false; state.dictation.startedAt = Date.now(); state.dictation.autoRestarts = 0; state.dictation.baseText = fields('observationText').value.trim(); state.dictation.accumulatedText = ''; state.dictation.lastSessionHadFinalText = false; }
      try { recognition.start(); } catch { setSpeechStatus('Speech recognition is already active; the transcript is still editable.'); }
    });
    stop.addEventListener('click', () => { state.dictation.userStopped = true; state.dictation.active = false; if (state.dictation.restartTimer) window.clearTimeout(state.dictation.restartTimer); try { recognition.stop(); } catch { /* already ended */ } setSpeechStatus('Stopping…'); });
  }

  async function requestAi(action, payload) {
    const response = await fetch('/api/scent-companion/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, locale: navigator.language || 'en-US', ...payload }) });
    let result; try { result = await response.json(); } catch { throw new Error('The AI service returned an unreadable response.'); }
    if (!response.ok || !result.ok) throw new Error(result?.error?.message || 'AI assistance is unavailable.');
    return result;
  }

  function addChatMessage(role, text, intent = '') {
    const node = document.createElement('div');
    node.className = `chat-message ${role}`;
    if (intent) {
      const label = document.createElement('span');
      label.className = 'chat-intent';
      label.textContent = intent;
      node.appendChild(label);
    }
    const content = document.createElement('p');
    content.textContent = text;
    node.appendChild(content);
    root.querySelector('#companion-chat-messages').appendChild(node);
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  root.querySelector('#companion-chat-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = root.querySelector('#companion-chat-input');
    const message = input.value.trim();
    if (!message) return;
    const send = root.querySelector('#companion-chat-send');
    const statusNode = root.querySelector('#companion-chat-status');
    addChatMessage('user', message);
    // The current message is sent in the dedicated "message" field, not also in history.
    // Only successful prior turns are kept as model context.
    const chatRequest = prepareChatRequest(message, state.chatHistory, 8);
    const priorHistory = chatRequest.history;
    input.value = '';
    send.disabled = true;
    statusNode.textContent = 'Thinking with the configured language model…';
    try {
      const result = await requestAi('chat', { ...chatRequest, context: { materialName: fields('materialName').value.trim(), evaluationType: fields('evaluationType').value, observation: fields('observationText').value.trim() } });
      const answer = result.answer || result.clarifyingQuestion || 'I need a little more detail before I can help.';
      addChatMessage('assistant', answer, result.intent || 'companion');
      state.chatHistory = normalizeChatHistory([
        ...priorHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: answer }
      ], 8);
      statusNode.textContent = result.clarifyingQuestion ? 'A little more detail will help.' : 'Answer ready.';
    } catch (error) {
      statusNode.textContent = error.message;
      addChatMessage('assistant error', 'I could not reach the configured AI service. Your message remains in this conversation; you can try again when the provider is available.');
    } finally { send.disabled = false; }
  });

  function renderAi(result, type) {
    state.lastAiResult = result;
    const box = root.querySelector('#companion-ai-suggestions');
    box.hidden = false;
    box.innerHTML = '';
    const heading = document.createElement('strong'); heading.textContent = type === 'explain' ? `About “${result.term || ''}”` : 'Suggestions to review'; box.appendChild(heading);
    if (type === 'explain') { const text = document.createElement('p'); text.textContent = result.explanation || 'No explanation was returned.'; box.appendChild(text); return; }
    if (result.preservedObservation) { const original = document.createElement('p'); original.className = 'ai-original'; original.textContent = `Your words: ${result.preservedObservation}`; box.appendChild(original); }
    if (Array.isArray(result.suggestions)) { const listNode = document.createElement('ul'); result.suggestions.forEach(item => { const node = document.createElement('li'); node.innerHTML = `<b>${esc(item.term || 'Term')}</b> — ${esc(item.meaning || '')}${item.why ? `<small>${esc(item.why)}</small>` : ''}`; listNode.appendChild(node); }); box.appendChild(listNode); }
    if (result.clearerWording) { const clearer = document.createElement('div'); clearer.className = 'clearer-wording'; clearer.innerHTML = '<span>Optional clearer wording</span><p></p><button class="secondary-button small" data-apply-ai type="button">Use in editor for review</button>'; clearer.querySelector('p').textContent = result.clearerWording; box.appendChild(clearer); }
    const note = document.createElement('small'); note.className = 'ai-disclaimer'; note.textContent = 'Review suggestions before saving. They never replace your observation automatically.'; box.appendChild(note);
  }

  root.querySelector('#companion-assist').addEventListener('click', async () => {
    const values = collect(); if (!values.text) { root.querySelector('#companion-ai-status').textContent = 'Write or dictate an observation first.'; return; }
    const button = root.querySelector('#companion-assist'); button.disabled = true; root.querySelector('#companion-ai-status').textContent = 'Asking the configured language model…';
    try { renderAi(await requestAi('vocabulary', { observation: { materialName: values.materialName, evaluationType: values.evaluationType, text: values.text } }), 'vocabulary'); root.querySelector('#companion-ai-status').textContent = 'Suggestions ready for your review.'; } catch (error) { root.querySelector('#companion-ai-status').textContent = error.message; } finally { button.disabled = false; }
  });
  root.querySelector('#companion-explain').addEventListener('click', async () => {
    const term = root.querySelector('#companion-term').value.trim(); if (!term) { root.querySelector('#companion-ai-status').textContent = 'Enter a perfumery term to explain.'; return; }
    const button = root.querySelector('#companion-explain'); button.disabled = true; root.querySelector('#companion-ai-status').textContent = 'Looking up a beginner-friendly explanation…';
    try { renderAi(await requestAi('explain', { term }), 'explain'); root.querySelector('#companion-ai-status').textContent = 'Explanation ready.'; } catch (error) { root.querySelector('#companion-ai-status').textContent = error.message; } finally { button.disabled = false; }
  });
  root.querySelector('#companion-ai-suggestions').addEventListener('click', event => { if (event.target.closest('[data-apply-ai]') && state.lastAiResult?.clearerWording) { fields('observationText').value = state.lastAiResult.clearerWording; root.querySelector('#companion-ai-status').textContent = 'Wording copied into the editor. Review it before saving.'; } });

  function renderBriefing(result) {
    const box = root.querySelector('#companion-briefing-result'); box.hidden = false; box.innerHTML = '';
    const sections = [['Intended scent character', result.intendedCharacter], ['Ingredient roles', Array.isArray(result.roles) ? result.roles.join(' ') : result.roles], ['Opening', result.opening], ['Heart', result.heart], ['Dry-down', result.dryDown], ['Useful things to evaluate', Array.isArray(result.uncertainties) ? result.uncertainties.join(' ') : result.uncertainties]];
    sections.forEach(([heading, value]) => { if (!value) return; const section = document.createElement('div'); section.innerHTML = `<span>${esc(heading)}</span><p></p>`; section.querySelector('p').textContent = value; box.appendChild(section); });
    state.briefingText = result.spokenText || sections.filter(([, value]) => value).map(([heading, value]) => `${heading}. ${value}`).join(' ');
    root.querySelector('#companion-listen').disabled = !('speechSynthesis' in window) || !state.briefingText;
  }
  root.querySelector('#companion-generate-briefing').addEventListener('click', async () => {
    const briefing = root.querySelector('#companion-briefing-input').value.trim(); if (!briefing) { root.querySelector('#companion-briefing-status').textContent = 'Add a blend description or formula note first.'; return; }
    const button = root.querySelector('#companion-generate-briefing'); button.disabled = true; root.querySelector('#companion-briefing-status').textContent = 'Preparing a concise formulation briefing…';
    try { renderBriefing(await requestAi('briefing', { briefing })); root.querySelector('#companion-briefing-status').textContent = 'Briefing ready. This is intended development from supplied information, not a physical trial result.'; } catch (error) { root.querySelector('#companion-briefing-status').textContent = error.message; root.querySelector('#companion-briefing-result').hidden = true; } finally { button.disabled = false; }
  });

  function initSynthesis() {
    const listen = root.querySelector('#companion-listen'); const pause = root.querySelector('#companion-pause'); const stop = root.querySelector('#companion-stop-speaking');
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { root.querySelector('#companion-synthesis-status').textContent = 'Speech synthesis is not supported here. The briefing text remains visible.'; return; }
    const reset = () => { listen.disabled = !state.briefingText; pause.disabled = true; stop.disabled = true; pause.textContent = 'Ⅱ Pause'; };
    listen.addEventListener('click', () => { if (!state.briefingText) return; window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(state.briefingText); utterance.lang = navigator.language || 'en-US'; utterance.rate = 0.95; utterance.onstart = () => { pause.disabled = false; stop.disabled = false; listen.disabled = true; root.querySelector('#companion-synthesis-status').textContent = 'Reading briefing aloud…'; }; utterance.onend = () => { root.querySelector('#companion-synthesis-status').textContent = 'Finished.'; reset(); }; utterance.onerror = () => { root.querySelector('#companion-synthesis-status').textContent = 'Could not read this briefing.'; reset(); }; window.speechSynthesis.speak(utterance); });
    pause.addEventListener('click', () => { if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); pause.textContent = 'Ⅱ Pause'; root.querySelector('#companion-synthesis-status').textContent = 'Reading briefing aloud…'; } else { window.speechSynthesis.pause(); pause.textContent = '▶ Resume'; root.querySelector('#companion-synthesis-status').textContent = 'Paused.'; } });
    stop.addEventListener('click', () => { window.speechSynthesis.cancel(); root.querySelector('#companion-synthesis-status').textContent = 'Stopped.'; reset(); });
    reset();
  }

  initMaterials();
  initRecognition();
  initSynthesis();
  render();
  return { render, resetForm };
}
