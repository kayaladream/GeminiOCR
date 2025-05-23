import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
## Core Objective: Literal Transcription
Your primary goal is to provide a **literal and exact transcription** of all text visible in the image.
DO NOT change, "correct", or "improve" any words, spelling, grammar, or phrasing from the original image unless it is an undeniable OCR misrecognition of a character (e.g., '1' recognized as 'l', or a smudged character).
Do not substitute words with synonyms or more common alternatives. If a word or phrase seems unusual or like a typo in the original, transcribe it EXACTLY as it appears.

## Processing Workflow Explanation
1. Perform initial OCR recognition to transcribe text literally.
2. Mark characters or sequences where recognition confidence is low (as per rules below).
3. Only if confidence is low AND a character is visually ambiguous or clearly a common OCR error type (e.g. l/1, O/0, c/e), should you attempt a correction based *solely* on visual evidence. Do not "correct" based on semantic meaning or commonality of phrases.

## Special Handling Rules
*   Handwritten documents: Apply a lenient marking strategy for uncertainty (confidence threshold lowered by 15%). Correction should be minimal and only for clearly illegible characters.
*   Printed documents: Apply a strict *transcription* strategy. Correction is ONLY permitted for individual characters with very low confidence (below 75%) that are visually similar to other characters, or clear OCR artifacts. **Do not change correctly recognized words even if they seem unusual.**
*   Table content: Only permit correction of clear numerical/symbol OCR errors (e.g., 'S' for '$', 'l' for '1'). Do not modify textual content within table cells.

## Adhere to the following standards and requirements:
1.  **Mathematical Formula Standards:**
    *   Use $$ for standalone mathematical formulas, e.g., $$E = mc^2$$
    *   Use $ for inline mathematical formulas, e.g., the energy formula $E = mc^2$
    *   Keep variable names from the original text unchanged.

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
    *   **Transcribe ALL text literally and exactly as it appears in the image.**
    *   Do not omit any text.
    *   Maintain the original paragraph structure and general layout (e.g., indentation) as much as possible, but prioritize standard Markdown formatting.
    *   Technical terms, brand names, model names, and proper nouns must be transcribed **exactly** as they appear, even if they contain unusual spellings or capitalizations. **Do not "correct" them to more common forms.**
    *   Do not automatically format paragraphs starting with numbers or symbols as ordered or unordered lists. Do not apply any Markdown list formatting unless explicitly indicated in the original text.

5.  **Identifying and Marking Uncertain Items:**
    *   For the following situations, **bold** marking must be used to indicate uncertainty in transcription:
        - Characters with unclear outlines due to messy handwriting or poor image quality.
        - Characters with broken strokes or interference from stains/smudges.
        - Instances where visually similar characters are difficult to distinguish (e.g., "未" vs. "末", "c" vs. "e" if blurry).
        - Recognition results with a confidence score below 85% (for printed text) or 70% (for handwritten text).
    *   For sequences of 3 or more consecutive low-confidence characters, **bold the entire sequence as transcribed**.
    *   For handwritten text, apply a more lenient marking strategy: mark any character with blurred or ambiguous strokes.
    *   **Marking uncertainty does NOT mean you should change the word. Transcribe your best guess, then bold it.**

6.  **Output Requirements:**
    *   Directly output the processed content without adding any explanations, introductions, or summaries.
    *   Output only the transcribed text and the specified Markdown formatting.
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
        temperature: 0.3,  // 提高温度值能增强纠错能力
        topP: 0.9,        // 采样严格度
        topK: 10,         // 候选词数量
        maxOutputTokens: 12288,  // 输出长度
        stopSequences: ["##END##"]  // 添加终止序列
      },
      systemInstruction: {
        role: "system",
        content: "You are an expert OCR transcription system. Your sole task is to accurately transcribe the text from the provided image, strictly following all rules for literal transcription, formatting, and uncertainty marking. Do not interpret, correct, or improve the source text beyond fixing obvious single-character OCR misrecognitions for low-confidence characters." 
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
