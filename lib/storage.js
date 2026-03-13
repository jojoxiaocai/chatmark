const DEFAULT_CONFIG = {
  ai: {
    enabled: true,
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    summaryPrompt: '请为以下AI回答生成一个简洁的摘要（3-5句话），保留核心要点：\n\n用户问题：{question}\n\nAI回答：{answer}',
    maxTokens: 500,
    timeout: 30000,
  },
  save: {
    method: 'downloads',
    downloadsSubdir: 'chatmark',
    nativePath: '',
    filenameTemplate: '{date}_{title}',
  },
  selectors: {
    chatContainer: '',
    assistantMessage: '',
    userMessage: '',
    messageContent: '',
    actionBar: '',
  },
};

const MAX_HISTORY = 500;

async function getConfig() {
  const result = await chrome.storage.local.get('config');
  const saved = result.config || {};
  return {
    ai: { ...DEFAULT_CONFIG.ai, ...saved.ai },
    save: { ...DEFAULT_CONFIG.save, ...saved.save },
    selectors: { ...DEFAULT_CONFIG.selectors, ...saved.selectors },
  };
}

async function setConfig(partial) {
  const current = await getConfig();
  const updated = {
    ai: { ...current.ai, ...(partial.ai || {}) },
    save: { ...current.save, ...(partial.save || {}) },
    selectors: { ...current.selectors, ...(partial.selectors || {}) },
  };
  await chrome.storage.local.set({ config: updated });
  return updated;
}

async function getHistory(limit = 50) {
  const result = await chrome.storage.local.get('history');
  const history = result.history || [];
  return history.slice(0, limit);
}

async function addHistoryEntry(entry) {
  const result = await chrome.storage.local.get(['history', 'stats']);
  const history = result.history || [];
  const stats = result.stats || { totalSaved: 0 };

  history.unshift({
    ...entry,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  });

  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  stats.totalSaved += 1;
  stats.lastSavedAt = new Date().toISOString();

  await chrome.storage.local.set({ history, stats });
  return history[0];
}

async function clearHistory() {
  await chrome.storage.local.set({ history: [], stats: { totalSaved: 0, lastSavedAt: null } });
}

async function getStats() {
  const result = await chrome.storage.local.get(['stats', 'history']);
  const stats = result.stats || { totalSaved: 0, lastSavedAt: null };
  const history = result.history || [];

  const today = new Date().toISOString().slice(0, 10);
  const todaySaved = history.filter(h => h.savedAt && h.savedAt.startsWith(today)).length;

  return { ...stats, todaySaved };
}
