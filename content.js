/**
 * ChatMark - Content Script
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
const ICON_SAVE = `<svg class="chatmark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const ICON_CHECK = `<svg class="chatmark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_LOADING = `<svg class="chatmark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;

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
    console.log('[ChatMark] No custom config, using defaults');
  }

  // Wait for chat content to appear
  await waitForChat();

  // Scan existing messages
  scanAndInjectButtons();

  // Observe for new messages
  startObserver();

  // Watch for SPA navigation
  watchNavigation();

  console.log('[ChatMark] Initialized');
}

// --- Wait for chat DOM to be ready ---
function waitForChat() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const messages = findAssistantMessages();
      if (messages.length > 0) {
        console.log(`[ChatMark] Found ${messages.length} assistant messages`);
        resolve();
        return;
      }
      // Also check if at least the page structure is loaded
      const unionMessages = document.querySelectorAll(SELECTORS.unionMessage);
      if (unionMessages.length > 0) {
        console.log(`[ChatMark] Found ${unionMessages.length} union messages`);
        resolve();
        return;
      }
      if (attempts > 60) {
        // After 30 seconds, start observing anyway
        console.log('[ChatMark] Timeout waiting for messages, starting observer anyway');
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

// --- SVG for smart save button ---
const ICON_SMART = `<svg class="chatmark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

// --- Inject two save buttons into a message element ---
function injectSaveButton(messageEl) {
  if (messageEl.querySelector('.chatmark-save-btn')) return;

  // Quick save button: 📋
  const quickBtn = document.createElement('button');
  quickBtn.className = 'chatmark-save-btn';
  quickBtn.title = '快速保存';
  quickBtn.innerHTML = ICON_SAVE;
  quickBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onQuickSave(quickBtn, messageEl);
  });

  // Smart save button: ✨
  const smartBtn = document.createElement('button');
  smartBtn.className = 'chatmark-save-btn chatmark-smart-btn';
  smartBtn.title = 'AI 笔记';
  smartBtn.innerHTML = ICON_SMART;
  smartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onSmartSave(smartBtn, messageEl);
  });

  const actionBar = findActionBar(messageEl);
  if (actionBar) {
    actionBar.appendChild(quickBtn);
    actionBar.appendChild(smartBtn);
  } else {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:10;display:flex;gap:2px;';
    wrapper.appendChild(quickBtn);
    wrapper.appendChild(smartBtn);
    messageEl.style.position = messageEl.style.position || 'relative';
    messageEl.appendChild(wrapper);
  }
}

// --- Collect message data ---
function collectMessageData(messageEl) {
  return {
    question: findUserQuestion(messageEl),
    answerHtml: extractMessageHtml(messageEl),
    answerText: extractTextContent(messageEl),
    conversationTitle: extractConversationTitle(),
    timestamp: new Date().toISOString(),
    url: location.href,
  };
}

// --- Quick Save: instant, no AI ---
async function onQuickSave(btn, messageEl) {
  if (btn.classList.contains('saving')) return;
  btn.classList.add('saving');
  btn.innerHTML = ICON_LOADING;

  // Show brief card
  showCardSimple('saving', '正在保存...');

  try {
    const data = collectMessageData(messageEl);
    const resp = await chrome.runtime.sendMessage({ type: 'QUICK_SAVE', data });

    if (resp?.success) {
      btn.classList.remove('saving');
      btn.classList.add('saved');
      btn.innerHTML = ICON_CHECK;
      showCardSimple('done', '已保存', resp.filename);
      setTimeout(() => { btn.classList.remove('saved'); btn.innerHTML = ICON_SAVE; }, 2000);
    } else {
      throw new Error(resp?.error || '保存失败');
    }
  } catch (err) {
    btn.classList.remove('saving');
    btn.innerHTML = ICON_SAVE;
    showCardSimple('error', '保存失败', err.message);
  }
}

// --- Smart Save: streaming AI summary ---
function onSmartSave(btn, messageEl) {
  if (btn.classList.contains('saving')) return;
  btn.classList.add('saving');
  btn.innerHTML = ICON_LOADING;

  const data = collectMessageData(messageEl);
  const question = data.question;

  // Show streaming card immediately
  const card = getOrCreateCard();
  const body = card.querySelector('.chatmark-card-body');
  body.innerHTML = `
    <div class="chatmark-card-loading">
      <div class="spinner"></div>
      <span>正在生成 AI 笔记...</span>
      <span class="chatmark-card-status saving">生成中</span>
    </div>
    ${question ? `<div class="chatmark-card-summary"><div class="question">${escapeHtml(question.slice(0, 100))}</div></div>` : ''}
    <div class="chatmark-card-summary"><div class="label">摘要</div><div class="text chatmark-stream-text"></div></div>
  `;
  card.classList.add('show');

  const streamText = body.querySelector('.chatmark-stream-text');
  const port = chrome.runtime.connect({ name: 'smart-save' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'chunk') {
      // Append streaming text
      streamText.textContent += msg.text;
      // Auto-scroll
      const bodyEl = card.querySelector('.chatmark-card-body');
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }

    if (msg.type === 'done') {
      btn.classList.remove('saving');
      btn.classList.add('saved');
      btn.innerHTML = ICON_CHECK;

      // Update card to done state
      const loadingEl = body.querySelector('.chatmark-card-loading');
      if (loadingEl) {
        loadingEl.innerHTML = `
          <span style="color:#22c55e;font-size:16px;">✓</span>
          <span>已保存</span>
          <span class="chatmark-card-status done">完成</span>
        `;
      }
      if (msg.filename) {
        const fp = document.createElement('div');
        fp.className = 'chatmark-card-filepath';
        fp.textContent = msg.filename;
        body.appendChild(fp);
      }

      setTimeout(() => { btn.classList.remove('saved'); btn.innerHTML = ICON_SMART; }, 3000);
      autoHideCard(card, 10000);
      port.disconnect();
    }

    if (msg.type === 'error') {
      btn.classList.remove('saving');
      btn.innerHTML = ICON_SMART;
      const loadingEl = body.querySelector('.chatmark-card-loading');
      if (loadingEl) {
        loadingEl.innerHTML = `
          <span style="color:#ef4444;font-size:16px;">✕</span>
          <span>保存失败</span>
          <span class="chatmark-card-status error">失败</span>
        `;
      }
      streamText.textContent = msg.message;
      streamText.style.color = '#fca5a5';
      autoHideCard(card, 8000);
      port.disconnect();
    }
  });

  port.postMessage({ type: 'SMART_SAVE', data });
}

// --- Card Helpers ---
function getOrCreateCard() {
  let card = document.querySelector('.chatmark-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'chatmark-card';
    card.innerHTML = `
      <div class="chatmark-card-header">
        <div class="title"><span class="icon">📋</span><span>ChatMark</span></div>
        <button class="chatmark-card-close">&times;</button>
      </div>
      <div class="chatmark-card-body"></div>
    `;
    document.body.appendChild(card);
    card.querySelector('.chatmark-card-close').addEventListener('click', () => card.classList.remove('show'));
  }
  clearTimeout(getOrCreateCard._hideTimer);
  return card;
}

function showCardSimple(status, text, detail) {
  const card = getOrCreateCard();
  const body = card.querySelector('.chatmark-card-body');
  const icons = { saving: '<div class="spinner"></div>', done: '<span style="color:#22c55e;font-size:16px;">✓</span>', error: '<span style="color:#ef4444;font-size:16px;">✕</span>' };
  const badges = { saving: '<span class="chatmark-card-status saving">保存中</span>', done: '<span class="chatmark-card-status done">完成</span>', error: '<span class="chatmark-card-status error">失败</span>' };

  body.innerHTML = `
    <div class="chatmark-card-loading">${icons[status]}<span>${escapeHtml(text)}</span>${badges[status]}</div>
    ${detail ? `<div class="chatmark-card-filepath">${escapeHtml(detail)}</div>` : ''}
  `;
  card.classList.add('show');
  if (status !== 'saving') autoHideCard(card, 4000);
}

function autoHideCard(card, delay) {
  clearTimeout(getOrCreateCard._hideTimer);
  getOrCreateCard._hideTimer = setTimeout(() => card.classList.remove('show'), delay);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Scan DOM and inject buttons ---
function scanAndInjectButtons() {
  const messages = findAssistantMessages();
  console.log(`[ChatMark] Scan found ${messages.length} assistant messages`);
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
  console.log('[ChatMark] Navigation detected, re-scanning...');
  setTimeout(() => {
    scanAndInjectButtons();
    startObserver();
  }, 1500);
}

// --- Start ---
init();
