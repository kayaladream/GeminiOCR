import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
## Processing Workflow Explanation
1. Perform initial OCR recognition → Mark low-confidence characters
2. Conduct semantic analysis → Correct obvious errors
3. Perform secondary validation → Ensure the accuracy of markings and corrections

## Special Handling Rules
*   Handwritten documents: Apply a lenient marking strategy (confidence threshold lowered by 15%)
*   Printed documents: Apply a strict correction strategy (requires dual validation)
*   Table content: Only permit correction of numerical/symbol errors; do not modify textual content

## Adhere to the following standards and requirements:
1.  **Mathematical Formula Standards:**
    *   Use $$ for standalone mathematical formulas, e.g., $$E = mc^2$$
    *   Use $ for inline mathematical formulas, e.g., the energy formula $E = mc^2$
    *   Keep variable names from the original text unchanged

2.  **Table Standards:**
    *   If the image contains table-like content, use standard Markdown table syntax for output. For example:
      | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
      |---------------|---------|-------|----------|
      | Copy Writing  | $50/hr  | 4     | $200.00  |
      | Website Design| $50/hr  | 2     | $100.00  |
    *   Separate headers and cells with "|-" lines, with at least three "-" per column for alignment.
    *   Tables should not be broken into paragraphs; each row should immediately follow the previous one.
    *   Monetary amounts must include currency symbols and decimal points (if present in the original text).
    *   If a table is identified, do not ignore the text outside of it.

3.  **Paragraph Requirements:**
    *   Separate paragraphs with two newline characters to ensure correct paragraph rendering in Markdown.

4.  **Text Recognition Requirements:**
    *   Do not omit any text.
    *   Maintain the original paragraph structure and general layout (e.g., indentation) as much as possible, but prioritize standard Markdown formatting.
    *   Technical terms and proper nouns must be accurately recognized.
    *   Do not automatically format paragraphs starting with numbers or symbols as ordered or unordered lists. Do not apply any Markdown list formatting unless explicitly indicated in the original text.

5.  **Identifying and Marking Uncertain Items:**
    *   For the following situations, **bold** marking must be used:
        - Characters with unclear outlines due to messy handwriting
        - Characters with broken strokes or interference from stains/smudges
        - Instances where similar characters are difficult to distinguish (e.g., "未" vs. "末")
        - Recognition results with a confidence score below 85%
    *   For sequences of 3 or more consecutive low-confidence characters, **bold the entire sequence**.
    *   For handwritten text, apply a more lenient marking strategy: mark any character with blurred or ambiguous strokes.

6.  **Output Requirements:**
    *   Directly output the processed content without adding any explanations, introductions, or summaries.
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
      model: "gemini-2.5-flash-preview-05-20",
      generationConfig: {
        temperature: 0.1,  // 提高温度值能增强纠错能力
        topP: 0.9,        // 采样严格度
        topK: 10,         // 候选词数量
        maxOutputTokens: 12288,  // 输出长度
        stopSequences: ["##END##"]  // 添加终止序列
      },
      systemInstruction: {
        role: "system",
        content: "You are a meticulous OCR proofreading expert, strictly adhering to all processing rules." 
      }
    };
    console.log('[LOG] 使用的模型配置:', JSON.stringify(modelConfig, null, 2)); 
    const model = genAI.getGenerativeModel(modelConfig);

    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      },
    };

    console.log('[LOG] 向Gemini发送提示词:', ADVANCED_PROMPT.slice(0, 38) + '...');

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
