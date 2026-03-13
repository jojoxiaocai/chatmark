const PROVIDER_DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '推荐: gpt-4o-mini, gpt-4o' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514', hint: '推荐: claude-sonnet-4-20250514, claude-haiku-4-5-20251001' },
  doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', hint: '填写火山引擎推理接入点 ID，如 ep-xxxxxxxx' },
  custom: { baseUrl: '', model: '', hint: '填写 OpenAI 兼容的模型名称' },
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindEvents();
});

async function loadConfig() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (!resp?.success) return;
  const config = resp.config;

  // AI
  document.getElementById('aiEnabled').checked = config.ai.enabled;
  document.getElementById('aiProvider').value = config.ai.provider;
  document.getElementById('aiApiKey').value = config.ai.apiKey;
  document.getElementById('aiBaseUrl').value = config.ai.baseUrl;
  document.getElementById('aiModel').value = config.ai.model;
  document.getElementById('aiPrompt').value = config.ai.summaryPrompt;
  updateProviderHint(config.ai.provider);
  toggleAiFields(config.ai.enabled);

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
  // AI enabled toggle
  document.getElementById('aiEnabled').addEventListener('change', (e) => {
    toggleAiFields(e.target.checked);
  });

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

  // Directory picker button
  document.getElementById('btnPickDir').addEventListener('click', pickDirectory);

  // Save method toggle
  document.querySelectorAll('input[name="saveMethod"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      toggleSaveMethod(e.target.value);
    });
  });

  // Advanced toggle
  document.getElementById('toggleAdvanced').addEventListener('click', () => {
    const fields = document.getElementById('advancedFields');
    const btn = document.getElementById('toggleAdvanced');
    if (fields.classList.contains('hidden')) {
      fields.classList.remove('hidden');
      btn.textContent = '收起';
    } else {
      fields.classList.add('hidden');
      btn.textContent = '展开';
    }
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

// --- Directory Picker ---
async function pickDirectory() {
  const hintEl = document.getElementById('savePathHint');

  // Method 1: Try File System Access API (showDirectoryPicker)
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const path = dirHandle.name;
      // We can't get the full absolute path from showDirectoryPicker.
      // Prompt user to enter the full path manually after selecting.
      const fullPath = prompt(
        `你选择了文件夹: "${path}"\n\n` +
        `由于浏览器安全限制，无法获取完整路径。\n` +
        `请输入该文件夹的完整路径（例如 D:/MyNotes/doubao）:`,
        ''
      );
      if (fullPath) {
        document.getElementById('nativePath').value = fullPath;
        updateSavePathHint(fullPath);
        // Auto switch to native method
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

  // Method 2: Fallback - prompt for path directly
  const path = prompt('请输入保存目录的完整路径（例如 D:/MyNotes/doubao）:');
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
      enabled: document.getElementById('aiEnabled').checked,
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

function toggleAiFields(enabled) {
  const fields = document.getElementById('aiFields');
  fields.style.opacity = enabled ? '1' : '0.4';
  fields.style.pointerEvents = enabled ? 'auto' : 'none';
}

function toggleSaveMethod(method) {
  document.getElementById('downloadsDirField').classList.toggle('hidden', method !== 'downloads');
}

function updateProviderHint(provider) {
  const hint = PROVIDER_DEFAULTS[provider]?.hint || '';
  document.getElementById('modelHint').textContent = hint;
}
