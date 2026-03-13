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
 * Generate summary with streaming, calls onChunk for each token
 */
async function callSummaryStream(aiConfig, question, answer, onChunk) {
  const prompt = (aiConfig.summaryPrompt || '你是一个知识笔记助手。请用1-2句话提炼以下问答的核心知识点，要求：\n1. 像笔记标题一样简洁，让人一眼就能回忆起这个知识\n2. 突出关键结论或方法，不要泛泛而谈\n3. 用中文回复\n\n用户问题：{question}\n\nAI回答：{answer}')
    .replace('{question}', question || '(无问题)')
    .replace('{answer}', truncate(answer, 4000));

  const messages = [{ role: 'user', content: prompt }];
  return callProviderStream(aiConfig, messages, onChunk);
}

/**
 * Non-streaming summary (kept for backward compatibility)
 */
async function callSummary(aiConfig, question, answer) {
  let result = '';
  await callSummaryStream(aiConfig, question, answer, (chunk) => { result += chunk; });
  return result;
}

/**
 * Test connection to the configured AI provider
 */
async function testConnection(aiConfig) {
  try {
    const messages = [{ role: 'user', content: '你好，请回复OK' }];
    let result = '';
    await callProviderStream(aiConfig, messages, (chunk) => { result += chunk; });
    if (result) {
      return { success: true, message: `连接成功！回复: ${result.slice(0, 50)}` };
    }
    return { success: false, message: '未收到回复' };
  } catch (err) {
    return { success: false, message: `连接失败: ${err.message}` };
  }
}

/**
 * Route to the correct streaming provider handler
 */
async function callProviderStream(aiConfig, messages, onChunk) {
  const { provider, apiKey, baseUrl, model, timeout = 30000 } = aiConfig;
  if (!apiKey) throw new Error('未配置 API Key');

  if (provider === 'anthropic') {
    return streamAnthropic({ apiKey, baseUrl, model, timeout }, messages, onChunk);
  }
  return streamOpenAICompatible({ apiKey, baseUrl, model, timeout }, messages, onChunk);
}

/**
 * Streaming OpenAI-compatible API
 */
async function streamOpenAICompatible(config, messages, onChunk) {
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
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
        } catch (e) {
          // skip malformed chunks
        }
      }
    }

    return fullText;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming Anthropic Claude API
 */
async function streamAnthropic(config, messages, onChunk) {
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
        stream: true,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            const content = json.delta?.text;
            if (content) {
              fullText += content;
              onChunk(content);
            }
          }
        } catch (e) {
          // skip
        }
      }
    }

    return fullText;
  } finally {
    clearTimeout(timer);
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n...(内容已截断)';
}
