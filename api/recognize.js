import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
你是一名专业的OCR识别助手，请你识别图片中的文字内容并输出，需遵循以下规范和要求：

1.  **数学公式规范：**
    *   独立的数学公式使用 $$，例如：$$E = mc^2$$
    *   行内数学公式使用 $，例如：能量公式 $E = mc^2$
    *   保持原文中的变量名称不变

2.  **表格规范：**
    *   如果图片中存在类似"表格"的内容，请使用标准 Markdown 表格语法输出。例如：
      | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
      |---------------|---------|-------|----------|
      | Copy Writing  | $50/hr  | 4     | $200.00  |
      | Website Design| $50/hr  | 2     | $100.00  |
    *   表头与单元格之间需使用"|-"分隔行，并保证每列至少有三个"-"进行对齐。
    *   金额部分需包含货币符号以及小数点（如果原文有）。
    *   若识别到表格，也不能忽略表格外的文字。

3.  **分段要求：**
    *   每个分段之间用两个换行符分隔，确保 Markdown 中显示正确的分段效果。

4.  **文字识别要求：**
    *   不能省略任何文字。
    *   尽量保持原文的段落结构和大致排版（如缩进，但优先遵循Markdown标准格式）。
    *   专业术语和特定名词需要准确识别。
    *   不要将所有以数字、符号开头的段落识别为有序或无序列表，不要应用任何非原文指示的 Markdown 列表格式。

5.  **识别与标记不确定项：**
    *   识别图片中的所有文字。
    *   对于那些因为图像模糊、字迹潦草或其他原因导致你**识别不确定**或**可能出错**的文字或词语，请使用**粗体** (**bold**) 标记出来。

6.  **上下文校对与纠错：**
    *   在识别完成后，请仔细检查文本内容。
    *   利用上下文信息，修正识别结果中可能存在的错别字、拼写错误或明显的语法错误。
    *   将你**修正过**的文字或词语用*斜体* (*italic*) 标记出来，以清晰展示修改痕跡。

7.  **输出要求：**
    *   直接输出处理后的内容，不要添加任何说明、前言或总结。
`;

// 验证支持的图片类型
const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Vercel最大执行时间60秒，设置为55秒留出处理时间
const PROCESS_TIMEOUT = 55000; 

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('[ERROR] 非法请求方法:', req.method);
    return res.status(405).json({ error: '只支持POST请求' });
  }

  // 添加响应结束检查
  let responseEnded = false;
  req.on('close', () => {
    if (!responseEnded) {
      console.warn('[WARN] 客户端提前关闭了连接');
      responseEnded = true;
    }
  });

  try {
    const { imageData, mimeType } = req.body;
    
    // 增强参数验证
    if (!imageData || !mimeType) {
      console.error('[ERROR] 缺少参数:', { imageData: !!imageData, mimeType: !!mimeType });
      return res.status(400).json({ error: '缺少imageData或mimeType参数' });
    }

    // 添加输入验证增强
    if (!VALID_MIME_TYPES.includes(mimeType)) {
      return res.status(415).json({ 
        error: `不支持的图片类型，仅支持: ${VALID_MIME_TYPES.join(', ')}`
      });
    }

    if (imageData.length > 5 * 1024 * 1024) { // 5MB限制
      return res.status(413).json({ error: '图片大小超过5MB限制' });
    }

    console.log('[LOG] 收到请求，图片类型:', mimeType);

    // 初始化模型
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelConfig = {
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: 0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    };
    console.log('[LOG] 使用的模型配置:', JSON.stringify(modelConfig, null, 2)); 
    const model = genAI.getGenerativeModel(modelConfig);

    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      },
    };

    console.log('[LOG] 向Gemini发送提示词:', ADVANCED_PROMPT.slice(0, 31) + '...');

    // 添加请求超时处理（针对Vercel的60秒限制）
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`处理超时（超过${PROCESS_TIMEOUT/1000}秒）`));
      }, PROCESS_TIMEOUT);
    });

    console.log('[LOG] 开始调用模型:', modelConfig.model);
    
    // 使用Promise.race实现超时控制
    const result = await Promise.race([
      model.generateContentStream([ADVANCED_PROMPT, imagePart]),
      timeoutPromise
    ]);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for await (const chunk of result.stream) {
      if (responseEnded) break; // 如果客户端已断开则停止处理
      const chunkText = chunk.text();
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    responseEnded = true;
    res.end();
    console.log('[LOG] 请求处理完成');

  } catch (error) {
    if (responseEnded) return; // 如果响应已结束则不再处理错误
    
    console.error('[ERROR] 处理失败:', error.message);
    console.error(error.stack);
    
    let errorMessage = '处理图片时出错';
    let statusCode = 500;
    
    if (error.message.includes('API_KEY')) {
      errorMessage = '服务器配置错误（API密钥无效）';
      statusCode = 503;
    } else if (error.message.includes('image')) {
      errorMessage = '图片格式不支持';
      statusCode = 415;
    } else if (error.message.includes('quota')) {
      errorMessage = 'API配额已用完';
      statusCode = 429;
    } else if (error.message.includes('network')) {
      errorMessage = '网络连接问题';
      statusCode = 502;
    } else if (error.message.includes('超时')) {
      errorMessage = '处理时间过长，请尝试简化图片内容';
      statusCode = 504;
    }

    if (!responseEnded) {
      res.status(statusCode).json({ 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? {
          message: error.message,
          stack: error.stack
        } : null
      });
      responseEnded = true;
    }
  }
}
