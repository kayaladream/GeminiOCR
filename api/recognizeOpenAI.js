import OpenAI from 'openai';

// 自定义API配置
const API_CONFIG = {
  baseURL: 'https://api.openai-proxy.com/v1', // 自定义API地址
  defaultHeaders: {
    'Custom-Header': 'your-custom-header-value',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    // 添加其他自定义请求头
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData } = req.body;

    // 创建OpenAI客户端实例，使用自定义配置
    const configuration = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: API_CONFIG.baseURL,
      defaultHeaders: API_CONFIG.defaultHeaders
    };

    const openai = new OpenAI(configuration);

    // 创建请求选项
    const requestOptions = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请你识别图片中的文字内容并输出，如果有格式不规整可以根据内容排版，或者单词错误中文词汇错误可以纠正，不要有任何开场白、解释、描述、总结或结束语。"
            },
            {
              type: "image_url",
              image_url: {
                url: imageData
              }
            }
          ]
        }
      ],
      max_tokens: 4096,
      stream: true,
    };

    // 设置响应头以支持流式传输
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 发起流式请求
    const stream = await openai.chat.completions.create(requestOptions);

    // 处理流式响应
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}