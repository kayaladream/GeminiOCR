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

export default async function handler(req, res) {
  console.log(`[INFO] 收到请求 ${req.method} ${req.url}`); 

  // --- 1. 请求方法验证 ---
  if (req.method !== 'POST') {
    console.warn(`[WARN] 非法请求方法: ${req.method}`); 
    // 设置响应头，明确告知允许的方法
    res.setHeader('Allow', ['POST']);
    // 返回 405 Method Not Allowed 状态码
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: '只支持POST请求',
      },
    });
  }

  // --- 2. API 密钥检查 ---
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`[ERROR] 服务器配置错误: GEMINI_API_KEY 未设置`); 
    // 返回 500 Internal Server Error，因为这是服务器配置问题
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_CONFIG_ERROR',
        message: '服务器内部配置错误 (API Key Missing)',
      },
    });
  }

  try {
    // --- 3. 请求体参数验证 ---
    const { imageData, mimeType } = req.body;
    if (!imageData || !mimeType) {
      const missingParams = [];
      if (!imageData) missingParams.push('imageData');
      if (!mimeType) missingParams.push('mimeType');
      console.warn(`[WARN] 请求参数缺失: ${missingParams.join(', ')}`); // 移除了 reqId
      // 返回 400 Bad Request 状态码，因为是客户端请求问题
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: `请求体缺少必需参数: ${missingParams.join(', ')}`,
        },
      });
    }

    // 简单验证 mimeType 格式（可以根据需要添加更严格的图片类型检查）
    if (!mimeType.startsWith('image/')) {
        console.warn(`[WARN] 无效的 mimeType: ${mimeType}`); // 移除了 reqId
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MIME_TYPE',
            message: `无效的 mimeType: ${mimeType}，应为 'image/...' 格式`,
          },
        });
    }

    console.log(`[INFO] 参数校验通过, 图片类型: ${mimeType}`); // 移除了 reqId

    // --- 4. 初始化 Google Generative AI 客户端 ---
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelConfig = {
      // 建议使用 'gemini-pro-vision' 或最新的、稳定的 vision 模型
      model: "gemini-pro-vision",
      generationConfig: {
        temperature: 0.4, // OCR 任务较低温度可能更稳定
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ],
    };
    console.log(`[INFO] 使用模型配置: ${JSON.stringify({...modelConfig, model: modelConfig.model}, null, 2)}`); // 移除了 reqId, 日志中不显示 API Key
    const model = genAI.getGenerativeModel(modelConfig);
    console.log(`[INFO] Google AI 模型 (${modelConfig.model}) 初始化成功`); // 移除了 reqId

    // --- 5. 准备图像数据 ---
    const imagePart = {
      inlineData: {
        data: imageData, // 确保 imageData 是 Base64 编码的字符串
        mimeType: mimeType
      },
    };

    // 截断日志中的提示词，避免过长
    const promptSnippet = ADVANCED_PROMPT.length > 100 ? ADVANCED_PROMPT.slice(0, 100) + '...' : ADVANCED_PROMPT;
    console.log(`[INFO] 向 Gemini 发送提示词 (片段): ${promptSnippet}`); // 移除了 reqId

    // --- 6. 调用模型并进行流式处理 ---
    console.log(`[INFO] 开始调用模型: ${modelConfig.model}`); // 移除了 reqId
    const result = await model.generateContentStream([ADVANCED_PROMPT, imagePart]);

    // --- 7. 设置 SSE 响应头 ---
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', // SSE 标准 MIME 类型
      'Cache-Control': 'no-cache',        // 禁止缓存
      'Connection': 'keep-alive',         // 保持连接
      // 'X-Request-ID': reqId,           // 移除了 X-Request-ID 头
      'Transfer-Encoding': 'chunked'      // 明确使用分块传输
    });
    console.log(`[INFO] SSE 响应头已发送，开始流式传输数据`); // 移除了 reqId

    // --- 8. 处理流式响应 ---
    let fullResponseText = ""; // 用于记录完整的响应文本（调试用）
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponseText += chunkText; // 累加文本块
      // 发送 SSE 数据：`data: json_string\n\n`
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    // --- 9. 结束响应 ---
    res.end(); // 必须调用 end() 来关闭 SSE 连接
    // console.log(`[DEBUG] 完整响应文本:\n${fullResponseText}`); // 可以取消注释用于调试，移除了 reqId
    console.log(`[INFO] 流式传输完成，请求处理成功`); // 移除了 reqId

  } catch (error) {
    // --- 10. 统一错误处理 ---
    console.error(`[ERROR] 处理请求时发生错误:`, error.message); // 移除了 reqId
    // 记录完整的错误堆栈信息
    if (error.stack) {
        console.error(`[ERROR] 错误堆栈: ${error.stack}`); // 移除了 reqId
    } else {
        console.error(`[ERROR] 错误详情:`, error); // 移除了 reqId
    }

    // 默认错误状态码和信息
    let statusCode = 500;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = '处理图片时发生未知错误';

    // 尝试根据错误信息判断错误类型
    if (error.message) {
        const lowerCaseError = error.message.toLowerCase();
         if (lowerCaseError.includes('api key not valid') || lowerCaseError.includes('api_key')) {
            statusCode = 500;
            errorCode = 'INVALID_API_KEY';
            errorMessage = '服务器配置错误 (API 密钥无效或过期)';
        } else if (lowerCaseError.includes('invalid argument') || lowerCaseError.includes('image format is not supported') || lowerCaseError.includes('could not decode image')) {
            statusCode = 400;
            errorCode = 'INVALID_IMAGE_DATA';
            errorMessage = '图片数据无效或格式不支持';
        } else if (lowerCaseError.includes('quota exceeded') || lowerCaseError.includes('rate limit')) {
            statusCode = 429;
            errorCode = 'RATE_LIMIT_EXCEEDED';
            errorMessage = '请求频率过高，请稍后再试';
        } else if (lowerCaseError.includes('content filter') || lowerCaseError.includes('safety policy violation') || (error.response && error.response.promptFeedback?.blockReason)) {
            statusCode = 400;
            errorCode = 'CONTENT_BLOCKED';
            errorMessage = '请求因内容安全策略被阻止';
            // console.error(`[ERROR] 内容被阻止原因:`, error.response?.promptFeedback); // 移除了 reqId
        } else if (lowerCaseError.includes('network error') || lowerCaseError.includes('fetch failed') || lowerCaseError.includes('timeout')) {
            statusCode = 503;
            errorCode = 'SERVICE_UNAVAILABLE';
            errorMessage = '无法连接到 AI 服务，请稍后重试';
        }
    }

    // 检查响应头是否已经发送
    if (res.headersSent) {
      console.error(`[ERROR] 错误发生在流式传输期间，无法发送 JSON 错误响应。连接将中断。`); // 移除了 reqId
      res.end();
    } else {
      console.log(`[INFO] 发送错误响应: Status=${statusCode}, Code=${errorCode}, Message=${errorMessage}`); // 移除了 reqId
      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
      });
    }
  }
}
