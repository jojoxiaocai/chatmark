/**
 * ChatMark - Background Service Worker
 * Two save modes: QUICK_SAVE (instant) and SMART_SAVE (streaming AI summary via port)
 */

importScripts('./lib/storage.js', './lib/markdown.js', './lib/ai-providers.js');

console.log('[ChatMark] Service Worker loaded');

// --- One-shot messages ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'QUICK_SAVE') {
    handleQuickSave(message.data).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }
  if (message.type === 'GET_HISTORY') {
    getHistory(message.limit || 50).then(h => sendResponse({ success: true, history: h }));
    return true;
  }
  if (message.type === 'GET_STATS') {
    getStats().then(s => sendResponse({ success: true, stats: s }));
    return true;
  }
  if (message.type === 'CLEAR_HISTORY') {
    clearHistory().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'TEST_AI_CONNECTION') {
    testConnection(message.config).then(sendResponse).catch(err =>
      sendResponse({ success: false, message: err.message })
    );
    return true;
  }
  if (message.type === 'GET_CONFIG') {
    getConfig().then(c => sendResponse({ success: true, config: c }));
    return true;
  }
});

// --- Port for streaming AI save ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'smart-save') return;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'SMART_SAVE') handleSmartSave(msg.data, port);
  });
});

// === Quick Save: instant, no AI ===
async function handleQuickSave(data) {
  const config = await getConfig();
  const { question, answerHtml, answerText, conversationTitle, timestamp, url } = data;
  const answer = answerHtml ? htmlToMarkdown(answerHtml) : answerText;

  const md = formatOutputMarkdown({ question, answer, summary: null, title: conversationTitle, timestamp, url });
  const filename = generateFilename(conversationTitle, config.save.filenameTemplate);
  await saveFile(config, filename, md);

  await addHistoryEntry({ title: conversationTitle, question: (question || '').slice(0, 200), summary: '', filename, conversationUrl: url });
  return { success: true, filename };
}

// === Smart Save: streaming AI summary ===
async function handleSmartSave(data, port) {
  try {
    const config = await getConfig();
    const { question, answerHtml, answerText, conversationTitle, timestamp, url } = data;
    const answer = answerHtml ? htmlToMarkdown(answerHtml) : answerText;

    if (!config.ai.enabled || !config.ai.apiKey) {
      // No AI → quick save fallback
      const result = await handleQuickSave(data);
      port.postMessage({ type: 'done', filename: result.filename, summary: '' });
      return;
    }

    // Stream summary chunks to content script
    let summary = '';
    try {
      summary = await callSummaryStream(config.ai, question, answer, (chunk) => {
        port.postMessage({ type: 'chunk', text: chunk });
      });
    } catch (err) {
      port.postMessage({ type: 'chunk', text: `\n[摘要失败: ${err.message}]` });
    }

    const md = formatOutputMarkdown({ question, answer, summary: summary || null, title: conversationTitle, timestamp, url });
    const filename = generateFilename(conversationTitle, config.save.filenameTemplate);
    await saveFile(config, filename, md);

    await addHistoryEntry({ title: conversationTitle, question: (question || '').slice(0, 200), summary: (summary || '').slice(0, 300), filename, conversationUrl: url });
    port.postMessage({ type: 'done', filename, summary });
  } catch (err) {
    port.postMessage({ type: 'error', message: err.message });
  }
}

// === File Saving ===
async function saveFile(config, filename, content) {
  if (config.save.method === 'native' && config.save.nativePath) {
    try {
      await saveViaNativeHost(config.save.nativePath, filename, content);
      return;
    } catch (err) {
      console.warn('[ChatMark] Native host failed:', err.message);
    }
  }
  await saveViaDownloads(config.save.downloadsSubdir, filename, content);
}

async function saveViaDownloads(subdir, filename, content) {
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(content);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const dataUrl = 'data:text/markdown;base64,' + btoa(binary);
  const path = subdir ? `${subdir}/${filename}` : filename;
  await chrome.downloads.download({ url: dataUrl, filename: path, saveAs: false, conflictAction: 'uniquify' });
}

async function saveViaNativeHost(basePath, filename, content) {
  const filePath = basePath.replace(/[/\\]$/, '') + '/' + filename;
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage('com.chatmark.native_host', { action: 'save', path: filePath, content }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp?.success) resolve(resp); else reject(new Error(resp?.error || 'save failed'));
      });
    } catch (e) { reject(e); }
  });
}
