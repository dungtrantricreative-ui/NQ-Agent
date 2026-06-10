import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { webSearch } from './tools/search.js';
import { fetchPageText } from './tools/fetchPage.js';
import { executeCommand } from './tools/terminal.js';
import { writeFile, readFile } from './tools/fileOps.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const OPENROUTER_URL = 'https://openrouter-api.dungtrantricreative.workers.dev/v1/chat/completions';
const MODEL = 'nex-agi/nex-n2-pro:free';

// Định nghĩa các tool
const tools = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Tìm kiếm thông tin trên web. Trả về danh sách kết quả (tiêu đề, link, snippet).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khóa tìm kiếm' },
          num: { type: 'number', description: 'Số lượng kết quả (tối đa 10)', default: 5 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_webpage',
      description: 'Tải nội dung văn bản từ một URL. Dùng để đọc chi tiết bài viết.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL của trang cần tải' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Thực thi lệnh terminal trong môi trường sandbox (/tmp/agent-sandbox). Các lệnh được phép: ls, cat, echo, mkdir, touch, curl, wget, python3, node, git, grep, find, head, tail.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Lệnh shell cần chạy' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Tạo hoặc ghi đè file trong sandbox.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Tên file (chỉ trong /tmp/agent-sandbox/)' },
          content: { type: 'string', description: 'Nội dung văn bản' }
        },
        required: ['filename', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Đọc nội dung file từ sandbox.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Tên file cần đọc' }
        },
        required: ['filename']
      }
    }
  }
];

// Lịch sử hội thoại lưu tạm trên server (có thể dùng session)
const sessions = {};

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  if (!sessions[sessionId]) {
    sessions[sessionId] = [
      { role: 'system', content: 'Bạn là trợ lý AI thông minh, có khả năng tìm kiếm web, đọc trang, chạy terminal, tạo file. Hãy sử dụng các công cụ khi cần để hoàn thành nhiệm vụ. Nếu cần tìm kiếm sâu (hơn 100 nguồn), bạn có thể lặp tìm kiếm, đọc từng trang và tổng hợp.' }
    ];
  }
  const history = sessions[sessionId];
  history.push({ role: 'user', content: message });

  // Streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let finishReason = null;
  let currentHistory = [...history];

  while (!finishReason || finishReason === 'tool_calls') {
    const body = {
      model: MODEL,
      messages: currentHistory,
      tools: tools,
      tool_choice: 'auto',
      stream: true
    };

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: `OpenRouter error ${response.status}` })}\n\n`);
      res.end();
      return;
    }

    // Xử lý stream từ OpenRouter
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAssistantContent = '';
    let toolCallsMap = {};
    let finishReasonFromStream = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // giữ phần dư

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') {
          finishReasonFromStream = 'stop';
          break;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          finishReasonFromStream = choice.finish_reason;

          if (delta?.content) {
            fullAssistantContent += delta.content;
            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
          }

          // Xử lý tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }
              if (tc.id) toolCallsMap[index].id = tc.id;
              if (tc.function?.name) toolCallsMap[index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[index].function.arguments += tc.function.arguments;
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (finishReasonFromStream === 'stop') break;
    }

    finishReason = finishReasonFromStream;

    if (finishReason === 'stop') {
      // Gửi sự kiện kết thúc
      res.write(`data: [DONE]\n\n`);
      res.end();
      if (fullAssistantContent) {
        history.push({ role: 'assistant', content: fullAssistantContent });
      }
      break;
    } else if (finishReason === 'tool_calls' || Object.keys(toolCallsMap).length > 0) {
      // Tạo message assistant với tool_calls
      const assistantToolCalls = Object.values(toolCallsMap).map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));
      history.push({ role: 'assistant', content: null, tool_calls: assistantToolCalls });

      // Thực thi từng tool và thêm kết quả
      for (const tc of assistantToolCalls) {
        const funcName = tc.function.name;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (e) {
          args = {};
        }
        let result;
        try {
          switch (funcName) {
            case 'web_search':
              result = await webSearch(args.query, args.num || 5);
              break;
            case 'fetch_webpage':
              result = await fetchPageText(args.url);
              break;
            case 'execute_command':
              result = await executeCommand(args.command);
              break;
            case 'write_file':
              result = await writeFile(args.filename, args.content);
              break;
            case 'read_file':
              result = await readFile(args.filename);
              break;
            default:
              result = { error: 'Unknown function' };
          }
        } catch (err) {
          result = { error: err.message };
        }
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }

      // Cập nhật currentHistory và tiếp tục vòng lặp
      currentHistory = [...history];
      finishReason = 'tool_calls'; // để tiếp tục
    } else {
      // Trường hợp bất thường
      res.write(`data: [DONE]\n\n`);
      res.end();
      break;
    }
  }
});

// Endpoint tạo session mới
app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = [];
  res.json({ sessionId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
});
