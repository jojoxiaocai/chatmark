/**
 * AI Provider Abstraction Layer
 * Supports: OpenAI, Anthropic Claude, Doubao/Volcengine, Custom OpenAI-compatible
 */

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    name: 'Claude',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  doubao: {
    name: '豆包/火山引擎',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
  },
  custom: {
    name: '自定义 (OpenAI兼容)',
    defaultBaseUrl: '',
    defaultModel: '',
  },
};

// PROVIDERS exported as global

/**
 * Generate a summary for an AI chat answer
 */
async function callSummary(aiConfig, question, answer) {
  const prompt = (aiConfig.summaryPrompt || '请为以下AI回答生成一个简洁的摘要（3-5句话），保留核心要点：\n\n用户问题：{question}\n\nAI回答：{answer}')
    .replace('{question}', question || '(无问题)')
    .replace('{answer}', truncate(answer, 4000));

  const messages = [{ role: 'user', content: prompt }];
  const result = await callProvider(aiConfig, messages);
  return result;
}

/**
 * Test connection to the configured AI provider
 */
async function testConnection(aiConfig) {
  try {
    const messages = [{ role: 'user', content: '你好，请回复OK' }];
    const result = await callProvider(aiConfig, messages);
    if (result) {
      return { success: true, message: `连接成功！回复: ${result.slice(0, 50)}` };
    }
    return { success: false, message: '未收到回复' };
  } catch (err) {
    return { success: false, message: `连接失败: ${err.message}` };
  }
}

/**
 * Route to the correct provider handler
 */
async function callProvider(aiConfig, messages) {
  const { provider, apiKey, baseUrl, model, timeout = 30000 } = aiConfig;

  if (!apiKey) throw new Error('未配置 API Key');

  if (provider === 'anthropic') {
    return callAnthropic({ apiKey, baseUrl, model, timeout }, messages);
  }

  // OpenAI, Doubao, Custom all use OpenAI-compatible endpoint
  return callOpenAICompatible({ apiKey, baseUrl, model, timeout }, messages);
}

/**
 * OpenAI-compatible API (covers OpenAI, Doubao/Volcengine, custom)
 */
async function callOpenAICompatible(config, messages) {
  const { apiKey, baseUrl, model, timeout } = config;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Anthropic Claude API
 */
async function callAnthropic(config, messages) {
  const { apiKey, baseUrl, model, timeout } = config;
  const url = `${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n...(内容已截断)';
}
