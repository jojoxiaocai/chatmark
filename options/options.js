const PROVIDER_DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '推荐: gpt-4o-mini, gpt-4o' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514', hint: '推荐: claude-sonnet-4-20250514, claude-haiku-4-5-20251001' },
  doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', hint: '填写火山引擎推理接入点 ID，如 ep-xxxxxxxx' },
  custom: { baseUrl: '', model: '', hint: '填写 OpenAI 兼容的模型名称' },
};

const DEFAULT_PROMPT = '你是一个知识笔记助手。请用1-2句话提炼以下问答的核心知识点，要求：\n1. 像笔记标题一样简洁，让人一眼就能回忆起这个知识\n2. 突出关键结论或方法，不要泛泛而谈\n3. 用中文回复\n\n用户问题：{question}\n\nAI回答：{answer}';

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindEvents();
});

async function loadConfig() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (!resp?.success) return;
  const config = resp.config;

  // AI
  document.getElementById('aiProvider').value = config.ai.provider;
  document.getElementById('aiApiKey').value = config.ai.apiKey;
  document.getElementById('aiBaseUrl').value = config.ai.baseUrl;
  document.getElementById('aiModel').value = config.ai.model;
  // Show the saved prompt, or the default if empty/old
  document.getElementById('aiPrompt').value = config.ai.summaryPrompt || DEFAULT_PROMPT;
  updateProviderHint(config.ai.provider);

  // Save
  const method = config.save.method || 'native';
  const radio = document.querySelector(`input[name="saveMethod"][value="${method}"]`);
  if (radio) radio.checked = true;
  document.getElementById('downloadsSubdir').value = config.save.downloadsSubdir;
  document.getElementById('nativePath').value = config.save.nativePath;
  document.getElementById('filenameTemplate').value = config.save.filenameTemplate;
  toggleSaveMethod(method);
  updateSavePathHint(config.save.nativePath);

  // Selectors
  document.getElementById('selChatContainer').value = config.selectors.chatContainer;
  document.getElementById('selAssistantMsg').value = config.selectors.assistantMessage;
  document.getElementById('selUserMsg').value = config.selectors.userMessage;

  // Storage info
  const statsResp = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  if (statsResp?.success) {
    document.getElementById('storageInfo').textContent = `共 ${statsResp.stats.totalSaved || 0} 条收藏记录`;
  }
}

function bindEvents() {
  // Provider change
  document.getElementById('aiProvider').addEventListener('change', (e) => {
    const provider = e.target.value;
    const defaults = PROVIDER_DEFAULTS[provider];
    document.getElementById('aiBaseUrl').value = defaults.baseUrl;
    document.getElementById('aiModel').value = defaults.model;
    updateProviderHint(provider);
  });

  // Toggle API key visibility
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const input = document.getElementById('aiApiKey');
    const btn = document.getElementById('toggleApiKey');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '隐藏';
    } else {
      input.type = 'password';
      btn.textContent = '显示';
    }
  });

  // Reset prompt to default
  document.getElementById('btnResetPrompt').addEventListener('click', () => {
    document.getElementById('aiPrompt').value = DEFAULT_PROMPT;
  });

  // Test connection
  document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const resultEl = document.getElementById('testResult');
    resultEl.textContent = '测试中...';
    resultEl.className = 'test-result';

    const config = {
      provider: document.getElementById('aiProvider').value,
      apiKey: document.getElementById('aiApiKey').value,
      baseUrl: document.getElementById('aiBaseUrl').value,
      model: document.getElementById('aiModel').value,
      timeout: 15000,
    };

    const resp = await chrome.runtime.sendMessage({ type: 'TEST_AI_CONNECTION', config });
    if (resp?.success) {
      resultEl.textContent = resp.message;
      resultEl.className = 'test-result success';
    } else {
      resultEl.textContent = resp?.message || '测试失败';
      resultEl.className = 'test-result error';
    }
  });

  // Directory picker
  document.getElementById('btnPickDir').addEventListener('click', pickDirectory);

  // Save method toggle
  document.querySelectorAll('input[name="saveMethod"]').forEach(radio => {
    radio.addEventListener('change', (e) => toggleSaveMethod(e.target.value));
  });

  // Advanced toggle
  document.getElementById('toggleAdvanced').addEventListener('click', () => {
    const fields = document.getElementById('advancedFields');
    const btn = document.getElementById('toggleAdvanced');
    fields.classList.toggle('hidden');
    btn.textContent = fields.classList.contains('hidden') ? '展开' : '收起';
  });

  // Save config
  document.getElementById('btnSave').addEventListener('click', saveConfig);

  // Export history
  document.getElementById('btnExportHistory').addEventListener('click', exportHistory);

  // Clear history
  document.getElementById('btnClearHistory').addEventListener('click', async () => {
    if (confirm('确定清空所有收藏历史？此操作不可撤销。')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      document.getElementById('storageInfo').textContent = '共 0 条收藏记录';
    }
  });
}

async function pickDirectory() {
  const hintEl = document.getElementById('savePathHint');

  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const fullPath = prompt(
        `你选择了文件夹: "${dirHandle.name}"\n\n由于浏览器限制无法获取完整路径。\n请输入该文件夹的完整路径（如 D:/MyNotes）:`,
        ''
      );
      if (fullPath) {
        document.getElementById('nativePath').value = fullPath;
        updateSavePathHint(fullPath);
        document.querySelector('input[name="saveMethod"][value="native"]').checked = true;
        toggleSaveMethod('native');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        hintEl.textContent = '选择目录失败: ' + err.message;
        hintEl.style.color = '#ef4444';
      }
    }
    return;
  }

  const path = prompt('请输入保存目录的完整路径（如 D:/MyNotes）:');
  if (path) {
    document.getElementById('nativePath').value = path;
    updateSavePathHint(path);
    document.querySelector('input[name="saveMethod"][value="native"]').checked = true;
    toggleSaveMethod('native');
  }
}

function updateSavePathHint(path) {
  const hintEl = document.getElementById('savePathHint');
  if (path) {
    hintEl.textContent = `笔记将保存到: ${path}/`;
    hintEl.style.color = '#22c55e';
  } else {
    hintEl.textContent = '选择一个本地文件夹，笔记将保存到该目录（需安装 Native Helper）';
    hintEl.style.color = '';
  }
}

async function saveConfig() {
  const config = {
    ai: {
      enabled: true,
      provider: document.getElementById('aiProvider').value,
      apiKey: document.getElementById('aiApiKey').value,
      baseUrl: document.getElementById('aiBaseUrl').value,
      model: document.getElementById('aiModel').value,
      summaryPrompt: document.getElementById('aiPrompt').value,
    },
    save: {
      method: document.querySelector('input[name="saveMethod"]:checked').value,
      downloadsSubdir: document.getElementById('downloadsSubdir').value,
      nativePath: document.getElementById('nativePath').value,
      filenameTemplate: document.getElementById('filenameTemplate').value,
    },
    selectors: {
      chatContainer: document.getElementById('selChatContainer').value,
      assistantMessage: document.getElementById('selAssistantMsg').value,
      userMessage: document.getElementById('selUserMsg').value,
    },
  };

  await chrome.storage.local.set({ config });

  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = '已保存';
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

async function exportHistory() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY', limit: 9999 });
  if (!resp?.success) return;

  const jsonStr = JSON.stringify(resp.history, null, 2);
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `chatmark-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function toggleSaveMethod(method) {
  document.getElementById('downloadsDirField').classList.toggle('hidden', method !== 'downloads');
}

function updateProviderHint(provider) {
  const hint = PROVIDER_DEFAULTS[provider]?.hint || '';
  document.getElementById('modelHint').textContent = hint;
}
