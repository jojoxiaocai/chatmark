/**
 * ChatMark - Background Service Worker
 * Handles message coordination, AI summarization, file saving, and history.
 */

// Load lib modules (non-module service worker uses importScripts)
importScripts('./lib/storage.js', './lib/markdown.js', './lib/ai-providers.js');

console.log('[ChatMark] Service Worker loaded');

// --- Message Handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ChatMark] Received message:', message.type);

  if (message.type === 'SAVE_ANSWER') {
    handleSaveAnswer(message.data)
      .then(result => {
        console.log('[ChatMark] Save success:', result.filename);
        sendResponse(result);
      })
      .catch(err => {
        console.error('[ChatMark] Save error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'GET_HISTORY') {
    getHistory(message.limit || 50).then(history =>
      sendResponse({ success: true, history })
    );
    return true;
  }

  if (message.type === 'GET_STATS') {
    getStats().then(stats => sendResponse({ success: true, stats }));
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
    getConfig().then(config => sendResponse({ success: true, config }));
    return true;
  }
});

// --- Main Save Workflow ---
async function handleSaveAnswer(data) {
  console.log('[ChatMark] handleSaveAnswer start');
  const config = await getConfig();
  const { question, answerHtml, answerText, conversationTitle, timestamp, url } = data;

  // Convert HTML to Markdown
  const answerMarkdown = answerHtml ? htmlToMarkdown(answerHtml) : answerText;
  console.log('[ChatMark] Markdown length:', answerMarkdown.length);

  // AI Summary (optional)
  let summary = null;
  if (config.ai.enabled && config.ai.apiKey) {
    try {
      console.log('[ChatMark] Calling AI summary...');
      summary = await callSummary(config.ai, question, answerMarkdown);
      console.log('[ChatMark] AI summary done');
    } catch (err) {
      console.warn('[ChatMark] AI summary failed:', err.message);
    }
  } else {
    console.log('[ChatMark] AI summary skipped (disabled or no key)');
  }

  // Format Markdown
  const markdown = formatOutputMarkdown({
    question,
    answer: answerMarkdown,
    summary,
    title: conversationTitle,
    timestamp,
    url,
  });

  // Generate filename
  const filename = generateFilename(conversationTitle, config.save.filenameTemplate);
  console.log('[ChatMark] Filename:', filename);

  // Save file
  await saveFile(config, filename, markdown);
  console.log('[ChatMark] File saved');

  // Record history
  const entry = await addHistoryEntry({
    title: conversationTitle,
    question: question ? question.slice(0, 200) : '',
    summary: summary ? summary.slice(0, 300) : '',
    filename,
    conversationUrl: url,
  });

  return { success: true, filename, id: entry.id, summary: summary || '' };
}

// --- File Saving ---
async function saveFile(config, filename, content) {
  console.log('[ChatMark] saveFile, method:', config.save.method);

  // Try native host first if configured
  if (config.save.method === 'native' && config.save.nativePath) {
    try {
      await saveViaNativeHost(config.save.nativePath, filename, content);
      return;
    } catch (err) {
      console.warn('[ChatMark] Native host failed:', err.message, '- falling back to downloads');
    }
  }

  // Fallback: chrome.downloads
  await saveViaDownloads(config.save.downloadsSubdir, filename, content);
}

async function saveViaDownloads(subdir, filename, content) {
  // MV3 Service Worker 不支持 URL.createObjectURL
  // 将内容转为 base64 data URL 来下载
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(content);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);
  const dataUrl = 'data:text/markdown;base64,' + base64;

  const relativePath = subdir ? `${subdir}/${filename}` : filename;
  console.log('[ChatMark] Downloading to:', relativePath);

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: relativePath,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  console.log('[ChatMark] Download started, id:', downloadId);
  return downloadId;
}

async function saveViaNativeHost(basePath, filename, content) {
  const filePath = basePath.replace(/[/\\]$/, '') + '/' + filename;
  console.log('[ChatMark] Native host saving to:', filePath);

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(
        'com.chatmark.native_host',
        { action: 'save', path: filePath, content },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || 'Native host save failed'));
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}
