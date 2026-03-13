/**
 * Doubao Collector - Content Script
 * Injected into doubao.com/chat/* pages.
 * Observes the chat DOM, injects save buttons, and extracts message content.
 *
 * Doubao uses data-testid attributes for its DOM structure:
 *   - div[data-testid="union_message"]        → 消息容器（包含用户和AI消息）
 *   - div[data-testid="receive_message"]       → AI 回答消息块
 *   - div[data-testid="send_message"]          → 用户发送的消息块
 *   - div[data-testid="message_text_content"]  → 消息文本内容区域
 *   - button[data-testid="message_action_copy"] → 复制按钮（操作栏标志）
 */

// SVG Icons
const ICON_SAVE = `<svg class="doubao-collector-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const ICON_CHECK = `<svg class="doubao-collector-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_LOADING = `<svg class="doubao-collector-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;

// --- Doubao DOM Selectors (based on real data-testid attributes) ---
const SELECTORS = {
  // Primary selectors (data-testid based)
  assistantMessage: 'div[data-testid="receive_message"]',
  userMessage: 'div[data-testid="send_message"]',
  unionMessage: 'div[data-testid="union_message"]',
  messageContent: 'div[data-testid="message_text_content"]',
  copyButton: 'button[data-testid="message_action_copy"]',
  dislikeButton: 'button[data-testid="message_action_dislike"]',
};

let customSelectors = {};
let observer = null;
let lastUrl = location.href;

// --- Initialization ---
async function init() {
  // Load custom selector overrides from storage
  try {
    const result = await chrome.storage.local.get('config');
    if (result.config && result.config.selectors) {
      customSelectors = result.config.selectors;
    }
  } catch (e) {
    console.log('[Doubao Collector] No custom config, using defaults');
  }

  // Wait for chat content to appear
  await waitForChat();

  // Scan existing messages
  scanAndInjectButtons();

  // Observe for new messages
  startObserver();

  // Watch for SPA navigation
  watchNavigation();

  console.log('[Doubao Collector] Initialized');
}

// --- Wait for chat DOM to be ready ---
function waitForChat() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const messages = findAssistantMessages();
      if (messages.length > 0) {
        console.log(`[Doubao Collector] Found ${messages.length} assistant messages`);
        resolve();
        return;
      }
      // Also check if at least the page structure is loaded
      const unionMessages = document.querySelectorAll(SELECTORS.unionMessage);
      if (unionMessages.length > 0) {
        console.log(`[Doubao Collector] Found ${unionMessages.length} union messages`);
        resolve();
        return;
      }
      if (attempts > 60) {
        // After 30 seconds, start observing anyway
        console.log('[Doubao Collector] Timeout waiting for messages, starting observer anyway');
        resolve();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

// --- Find all assistant (AI) messages ---
function findAssistantMessages() {
  // Custom selector override
  const customSel = customSelectors.assistantMessage;
  if (customSel) {
    const els = document.querySelectorAll(customSel);
    if (els.length > 0) return [...els];
  }

  // Primary: data-testid="receive_message"
  const primary = document.querySelectorAll(SELECTORS.assistantMessage);
  if (primary.length > 0) return [...primary];

  // Fallback: look inside union_message containers for non-user messages
  const unions = document.querySelectorAll(SELECTORS.unionMessage);
  const results = [];
  for (const union of unions) {
    // If it doesn't contain a send_message, it's likely an AI message
    if (!union.querySelector(SELECTORS.userMessage)) {
      results.push(union);
    }
  }
  if (results.length > 0) return results;

  // Last resort: structural heuristic
  return findMessagesByStructure();
}

// --- Structural heuristic fallback ---
function findMessagesByStructure() {
  // Look for any container with multiple child divs that have copy buttons
  const copyButtons = document.querySelectorAll(SELECTORS.copyButton);
  const messages = [];
  for (const btn of copyButtons) {
    // Walk up to find the message container
    const msgContainer = btn.closest(SELECTORS.unionMessage)
      || btn.closest('[data-testid]')
      || btn.parentElement?.parentElement?.parentElement;
    if (msgContainer && !messages.includes(msgContainer)) {
      messages.push(msgContainer);
    }
  }
  return messages;
}

// --- Find the user question for a given assistant message ---
function findUserQuestion(assistantEl) {
  // Strategy 1: Look for preceding send_message in the DOM
  const customSel = customSelectors.userMessage;
  const userSel = customSel || SELECTORS.userMessage;

  // The assistant message might be inside a union_message.
  // Look for the previous union_message that contains a send_message.
  const parentUnion = assistantEl.closest(SELECTORS.unionMessage) || assistantEl;
  let prev = parentUnion.previousElementSibling;
  while (prev) {
    // Check if this element IS a user message
    if (prev.matches && prev.matches(userSel)) {
      return extractTextContent(prev);
    }
    // Check if it CONTAINS a user message
    const userMsg = prev.querySelector(userSel);
    if (userMsg) {
      return extractTextContent(userMsg);
    }
    // Check for message_text_content inside as fallback
    const textContent = prev.querySelector(SELECTORS.messageContent);
    if (textContent) {
      const text = textContent.textContent.trim();
      if (text.length > 0 && text.length < 1000) {
        return text;
      }
    }
    prev = prev.previousElementSibling;
  }

  // Strategy 2: If assistant message is within a conversation flow,
  // look for send_message anywhere before this receive_message in document order
  const allUserMsgs = document.querySelectorAll(userSel);
  const allAiMsgs = document.querySelectorAll(SELECTORS.assistantMessage);
  const aiIndex = [...allAiMsgs].indexOf(assistantEl);
  if (aiIndex >= 0 && aiIndex < allUserMsgs.length) {
    return extractTextContent(allUserMsgs[aiIndex]);
  }

  return '';
}

// --- Extract text content from an element ---
function extractTextContent(el) {
  // Prefer message_text_content within the element
  const contentEl = el.querySelector(SELECTORS.messageContent);
  if (contentEl) return contentEl.textContent.trim();
  return (el.textContent || '').trim();
}

// --- Extract rich HTML content from a message ---
function extractMessageHtml(messageEl) {
  // Custom override
  const customSel = customSelectors.messageContent;
  if (customSel) {
    const content = messageEl.querySelector(customSel);
    if (content) return content.innerHTML;
  }

  // Primary: data-testid="message_text_content"
  const content = messageEl.querySelector(SELECTORS.messageContent);
  if (content) return content.innerHTML;

  // Fallback: look for markdown-rendered areas
  const markdownArea = messageEl.querySelector('[class*="markdown"]')
    || messageEl.querySelector('[class*="content"]');
  if (markdownArea) return markdownArea.innerHTML;

  // Last resort: entire message HTML
  return messageEl.innerHTML;
}

// --- Extract conversation title ---
function extractConversationTitle() {
  // Try common patterns for conversation title
  const titleSelectors = [
    // Doubao sidebar active item
    '[class*="active"] [class*="title"]',
    '[class*="selected"] [class*="title"]',
    '[class*="chat-title"]',
    '[class*="conversation-title"]',
    'nav [class*="active"] span',
    'header h1',
    'header [class*="title"]',
  ];

  for (const sel of titleSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim();
        if (text && text.length > 0 && text.length < 200) return text;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Fallback: document title
  const docTitle = document.title.replace(/[-|–—].*$/, '').trim();
  return docTitle || '未命名对话';
}

// --- Find the action bar for a message (where copy/like buttons are) ---
function findActionBar(messageEl) {
  // Look for the parent of the copy button
  const copyBtn = messageEl.querySelector(SELECTORS.copyButton);
  if (copyBtn && copyBtn.parentElement) {
    return copyBtn.parentElement;
  }

  // Look for the parent of the dislike button
  const dislikeBtn = messageEl.querySelector(SELECTORS.dislikeButton);
  if (dislikeBtn && dislikeBtn.parentElement) {
    return dislikeBtn.parentElement;
  }

  return null;
}

// --- Inject save button into a message element ---
function injectSaveButton(messageEl) {
  if (messageEl.querySelector('.doubao-collector-save-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'doubao-collector-save-btn';
  btn.title = '保存到 Markdown';
  btn.innerHTML = ICON_SAVE;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onSaveClick(btn, messageEl);
  });

  // Try to insert next to the copy button in the action bar
  const actionBar = findActionBar(messageEl);
  if (actionBar) {
    actionBar.appendChild(btn);
  } else {
    // Fallback: create a floating button at the bottom-right of the message
    btn.style.position = 'absolute';
    btn.style.right = '8px';
    btn.style.bottom = '8px';
    btn.style.zIndex = '10';
    messageEl.style.position = messageEl.style.position || 'relative';
    messageEl.appendChild(btn);
  }
}

// --- Handle save button click ---
async function onSaveClick(btn, messageEl) {
  if (btn.classList.contains('saving') || btn.classList.contains('saved')) return;

  btn.classList.add('saving');
  btn.innerHTML = ICON_LOADING;

  const answerText = extractTextContent(messageEl);
  const question = findUserQuestion(messageEl);

  // Show progress card immediately
  showCard({
    status: 'saving',
    statusText: '正在记录中...',
    question: question ? question.slice(0, 100) : '',
    summary: '',
    filename: '',
  });

  try {
    const answerHtml = extractMessageHtml(messageEl);
    const title = extractConversationTitle();

    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_ANSWER',
      data: {
        question,
        answerHtml,
        answerText,
        conversationTitle: title,
        timestamp: new Date().toISOString(),
        url: location.href,
      },
    });

    if (response && response.success) {
      btn.classList.remove('saving');
      btn.classList.add('saved');
      btn.innerHTML = ICON_CHECK;

      // Show success card with summary
      showCard({
        status: 'done',
        statusText: '已保存',
        question: question ? question.slice(0, 100) : '',
        summary: response.summary || answerText.slice(0, 150) + '...',
        filename: response.filename || '',
      });

      setTimeout(() => {
        btn.classList.remove('saved');
        btn.innerHTML = ICON_SAVE;
      }, 3000);
    } else {
      throw new Error(response?.error || '保存失败');
    }
  } catch (err) {
    console.error('[Doubao Collector] Save failed:', err);
    btn.classList.remove('saving');
    btn.innerHTML = ICON_SAVE;

    showCard({
      status: 'error',
      statusText: '保存失败',
      question: '',
      summary: err.message,
      filename: '',
    });
  }
}

// --- Floating Progress Card ---
function showCard({ status, statusText, question, summary, filename }) {
  let card = document.querySelector('.doubao-collector-card');

  if (!card) {
    card = document.createElement('div');
    card.className = 'doubao-collector-card';
    card.innerHTML = `
      <div class="doubao-collector-card-header">
        <div class="title">
          <span class="icon">📋</span>
          <span>豆包收藏助手</span>
        </div>
        <button class="doubao-collector-card-close">&times;</button>
      </div>
      <div class="doubao-collector-card-body"></div>
    `;
    document.body.appendChild(card);

    card.querySelector('.doubao-collector-card-close').addEventListener('click', () => {
      card.classList.remove('show');
    });
  }

  const body = card.querySelector('.doubao-collector-card-body');

  if (status === 'saving') {
    body.innerHTML = `
      <div class="doubao-collector-card-loading">
        <div class="spinner"></div>
        <span>${statusText}</span>
        <span class="doubao-collector-card-status saving">记录中</span>
      </div>
      ${question ? `<div class="doubao-collector-card-summary"><div class="question">💬 ${escapeHtml(question)}</div></div>` : ''}
    `;
  } else if (status === 'done') {
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="color:#22c55e;font-size:18px;">✓</span>
        <span style="font-size:14px;font-weight:500;">${statusText}</span>
        <span class="doubao-collector-card-status done">完成</span>
      </div>
      ${question ? `<div class="doubao-collector-card-summary"><div class="question">💬 ${escapeHtml(question)}</div></div>` : ''}
      ${summary ? `<div class="doubao-collector-card-summary"><div class="label">摘要</div><div class="text">${escapeHtml(summary)}</div></div>` : ''}
      ${filename ? `<div class="doubao-collector-card-filepath">📄 ${escapeHtml(filename)}</div>` : ''}
    `;
  } else if (status === 'error') {
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="color:#ef4444;font-size:18px;">✕</span>
        <span style="font-size:14px;font-weight:500;">${statusText}</span>
        <span class="doubao-collector-card-status error">失败</span>
      </div>
      ${summary ? `<div class="doubao-collector-card-summary"><div class="text" style="color:#fca5a5;">${escapeHtml(summary)}</div></div>` : ''}
    `;
  }

  // Show card with animation
  requestAnimationFrame(() => {
    card.classList.add('show');
  });

  // Auto hide after 8 seconds for success/error
  if (status !== 'saving') {
    clearTimeout(showCard._hideTimer);
    showCard._hideTimer = setTimeout(() => {
      card.classList.remove('show');
    }, 8000);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Scan DOM and inject buttons ---
function scanAndInjectButtons() {
  const messages = findAssistantMessages();
  console.log(`[Doubao Collector] Scan found ${messages.length} assistant messages`);
  for (const msg of messages) {
    injectSaveButton(msg);
  }
}

// --- MutationObserver for new messages ---
function startObserver() {
  if (observer) observer.disconnect();

  // Observe the document body since we now know the exact selectors to look for
  observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the new node is or contains an assistant message
          if (node.matches && node.matches(SELECTORS.assistantMessage)) {
            shouldScan = true;
            break;
          }
          if (node.querySelector && node.querySelector(SELECTORS.assistantMessage)) {
            shouldScan = true;
            break;
          }
          // Also check for union_message or copy button appearing
          if (node.matches && (
            node.matches(SELECTORS.unionMessage) ||
            node.matches(SELECTORS.copyButton)
          )) {
            shouldScan = true;
            break;
          }
          if (node.querySelector && (
            node.querySelector(SELECTORS.unionMessage) ||
            node.querySelector(SELECTORS.copyButton)
          )) {
            shouldScan = true;
            break;
          }
        }
      }
      if (shouldScan) break;
    }
    if (shouldScan) {
      // Debounce: wait for streaming to settle
      clearTimeout(startObserver._timer);
      startObserver._timer = setTimeout(() => {
        scanAndInjectButtons();
      }, 1000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// --- SPA Navigation Detection ---
function watchNavigation() {
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    }
  }, 1000);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(onNavigate, 500);
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    setTimeout(onNavigate, 500);
  };

  window.addEventListener('popstate', () => setTimeout(onNavigate, 500));
}

function onNavigate() {
  console.log('[Doubao Collector] Navigation detected, re-scanning...');
  setTimeout(() => {
    scanAndInjectButtons();
    startObserver();
  }, 1500);
}

// --- Start ---
init();
