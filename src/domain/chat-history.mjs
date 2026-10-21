const DEFAULT_HISTORY_LIMIT = 8;

function assistantText(content) {
  if (content && typeof content === 'object') {
    const text = content.answer ?? content.clarifyingQuestion ?? content.content;
    return typeof text === 'string' ? text.trim() : '';
  }
  if (typeof content !== 'string') return '';
  const text = content.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const answer = parsed.answer ?? parsed.clarifyingQuestion;
      if (typeof answer === 'string') return answer.trim();
    }
  } catch { /* A user's ordinary text can resemble JSON; preserve it when it is not an answer envelope. */ }
  return text;
}

/**
 * Normalize only conversational user/assistant turns for model context.
 * Assistant JSON envelopes are reduced to their answer text; metadata is never replayed.
 */
export function normalizeChatHistory(history, limit = DEFAULT_HISTORY_LIMIT) {
  if (!Array.isArray(history) || !Number.isInteger(limit) || limit < 1) return [];
  const normalized = [];
  for (const turn of history) {
    if (!turn || !['user', 'assistant'].includes(turn.role)) continue;
    const content = turn.role === 'assistant'
      ? assistantText(turn.content)
      : typeof turn.content === 'string' ? turn.content.trim() : '';
    if (!content) continue;
    normalized.push({ role: turn.role, content });
  }
  return normalized.slice(-limit);
}
