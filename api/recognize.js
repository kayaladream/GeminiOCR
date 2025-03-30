import { GoogleGenerativeAI } from "@google/generative-ai";

// 配置日志前缀（方便筛选）
const LOG_PREFIX = '[OCR-API]';
const DEBUG_MODE = process.env.NODE_ENV === 'development'; // 开发环境显示更详细日志

export default async function handler(req, res) {
  const startTime = Date.now();
  
  // 1. 记录请求开始
  console.log(`${LOG_PREFIX} 收到请求 | 方法: ${req.method} | 路径: ${req.url}`);
  if (DEBUG_MODE) {
    console.debug(`${LOG_PREFIX} 请求头:`, JSON.stringify(req.headers, null, 2));
  }

  // 2. 检查请求方法
  if (req.method !== 'POST') {
    const errorMsg = `${LOG_PREFIX} 不允许的请求方法: ${req.method}`;
    console.error(errorMsg);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 3. 获取并验证请求体
    const { imageData, mimeType } = req.body;
    if (!imageData || !mimeType) {
      const errorMsg = `${LOG_PREFIX} 缺少必要参数 | imageData: ${!!imageData} | mimeType: ${!!mimeType}`;
      console.error(errorMsg);
      return res.status(400).json({ error: 'Missing imageData or mimeType' });
    }

    console.log(`${LOG_PREFIX} 开始处理 | 图片类型: ${mimeType} | 数据长度: ${imageData.length}`);

    // 4. 初始化模型
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

    // 5. 构造图片数据
    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      },
    };

    // 6. 定义提示词（重点记录部分）
    const prompt = "请你识别图片中的文字内容并输出，如果有格式不规整可以根据内容排版，或者单词错误中文词汇错误可以纠正，但纠正后的词要用“加粗”方式显示文本。不要有任何开场白、解释、描述、总结或结束语。";
    
    // 详细记录提示词和图片元数据
    console.log(`${LOG_PREFIX} 发送给Gemini的提示词:\n${'='.repeat(30)}\n${prompt}\n${'='.repeat(30)}`);
    if (DEBUG_MODE) {
      console.debug(`${LOG_PREFIX} 图片元数据:`, {
        mimeType,
        dataPrefix: imageData.slice(0, 50) + '...'
      });
    }

    // 7. 调用Gemini API
    const apiStartTime = Date.now();
    console.log(`${LOG_PREFIX} 开始调用Gemini API...`);
    
    const result = await model.generateContentStream([prompt, imagePart]);

    // 8. 设置流式响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 9. 流式传输处理
    let chunkCount = 0;
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
      chunkCount++;
      
      if (DEBUG_MODE) {
        console.debug(`${LOG_PREFIX} 收到数据块[${chunkCount}]:`, chunkText.slice(0, 100) + (chunkText.length > 100 ? '...' : ''));
      }
    }

    // 10. 请求完成
    const duration = Date.now() - startTime;
    console.log(`${LOG_PREFIX} 请求完成 | 耗时: ${duration}ms | 数据块数量: ${chunkCount}`);
    res.end();

  } catch (error) {
    // 错误处理（带详细日志）
    const errorLog = {
      message: error.message,
      stack: error.stack,
      request: {
        method: req.method,
        headers: req.headers,
        body: DEBUG_MODE ? req.body : '[PROD REDACTED]'
      }
    };
    
    console.error(`${LOG_PREFIX} 处理失败!\n${'='.repeat(50)}`);
    console.error(errorLog);
    console.error(`${'='.repeat(50)}`);

    // 返回错误响应
    res.status(500).json({ 
      error: 'Internal Server Error',
      requestId: req.headers['x-request-id'] || null
    });
  }
}
