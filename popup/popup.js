document.addEventListener('DOMContentLoaded', async () => {
  // Load stats
  const statsResp = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  if (statsResp?.success) {
    document.getElementById('todayCount').textContent = `今日: ${statsResp.stats.todaySaved || 0}`;
    document.getElementById('totalCount').textContent = `共计: ${statsResp.stats.totalSaved || 0}`;
  }

  // Load history
  const historyResp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY', limit: 20 });
  if (historyResp?.success && historyResp.history.length > 0) {
    renderHistory(historyResp.history);
  }

  // Button handlers
  document.getElementById('btnOpenDoubao').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.doubao.com/chat/' });
  });

  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});

function renderHistory(history) {
  const list = document.getElementById('historyList');
  list.innerHTML = '';

  for (const item of history) {
    const div = document.createElement('div');
    div.className = 'history-item';

    const savedDate = item.savedAt ? formatDate(item.savedAt) : '';

    div.innerHTML = `
      <div class="title">${escapeHtml(item.title || item.filename || '未命名')}</div>
      ${item.summary ? `<div class="summary">${escapeHtml(item.summary)}</div>` : ''}
      <div class="meta">${escapeHtml(item.filename || '')} · ${savedDate}</div>
    `;

    if (item.conversationUrl) {
      div.addEventListener('click', () => {
        chrome.tabs.create({ url: item.conversationUrl });
      });
    }

    list.appendChild(div);
  }
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
