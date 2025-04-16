import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
You are a professional OCR assistant. Please recognize the text content in the image and output it, adhering to the following specifications and requirements:
1.  **Mathematical Formula Specification:**
    * Use $$ for standalone mathematical formulas, e.g., $$E = mc^2$$
    * Use $ for inline mathematical formulas, e.g., the energy formula $E = mc^2$
    * Preserve the original variable names.
2.  **Table Specification:**
    * If the image contains content resembling a "table", please output it using standard Markdown table syntax. For example:
        | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
        |---------------|---------|-------|----------|
        | Copy Writing  | $50/hr  | 4     | $200.00  |
        | Website Design| $50/hr  | 2     | $100.00  |
    * Separate the header row from the content rows using a separator line (e.g., |---|---|). Ensure each column's separator has at least three hyphens (-) for alignment.
    * Monetary amounts should include the currency symbol and decimal points (if present in the original).
    * If a table is recognized, do not ignore the text outside the table.
3.  **Paragraph Requirements:**
    * Separate each paragraph with two newline characters to ensure correct paragraph rendering in Markdown.
4.  **Text Recognition Requirements:**
    * Do not omit any text.
    * Try to maintain the original paragraph structure and general layout (like indentation, but prioritize standard Markdown formatting).
    * Accurately recognize professional terminology and specific nouns.
    * Do not automatically format paragraphs starting with numbers or symbols as ordered or unordered lists; do not apply any Markdown list formatting that isn't explicitly indicated in the original text.
5.  **Identifying and Marking Uncertainties:**
      * Recognize all text in the image.
      * For text or words that you are uncertain about recognizing or might have recognized incorrectly due to image blurriness, illegible handwriting, or other reasons, please mark them using **bold** formatting.
6.  **Contextual Proofreading and Correction:**
    * After recognition is complete, please carefully review the text content.
    * Use contextual information to correct potential typos, spelling errors, or obvious grammatical mistakes in the recognition results.
    * Mark the words or phrases you have corrected using *italic* formatting to clearly show the modifications.
7.  **Output Requirements:**
    * Directly output the processed content without adding any explanations, preambles, or summaries.
`;

const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PROCESS_TIMEOUT = 55000; 

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('[ERROR] 非法请求方法:', req.method);
    return res.status(405).json({ error: '只支持POST请求' });
  }

  let responseEnded = false;
  req.on('close', () => {
    if (!responseEnded) {
      console.warn('[WARN] 客户端提前关闭了连接');
      responseEnded = true;
    }
  });

  try {
    const { imageData, mimeType } = req.body;
    
    if (!imageData || !mimeType) {
      console.error('[ERROR] 缺少参数:', { imageData: !!imageData, mimeType: !!mimeType });
      return res.status(400).json({ error: '缺少imageData或mimeType参数' });
    }

    if (!VALID_MIME_TYPES.includes(mimeType)) {
      return res.status(415).json({ 
        error: `不支持的图片类型，仅支持: ${VALID_MIME_TYPES.join(', ')}`
      });
    }

    if (imageData.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: '图片大小超过5MB限制' });
    }

    console.log('[LOG] 收到请求，图片类型:', mimeType);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelConfig = {
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: 0.1,
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

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`处理超时（超过${PROCESS_TIMEOUT/1000}秒）`));
      }, PROCESS_TIMEOUT);
    });

    console.log('[LOG] 开始调用模型:', modelConfig.model);
    
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
      if (responseEnded) break; 
      const chunkText = chunk.text();
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    responseEnded = true;
    res.end();
    console.log('[LOG] 请求处理完成');

  } catch (error) {
    if (responseEnded) return; 
    
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
