import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
## Processing Workflow Explanation
1. Perform initial OCR recognition → Mark low-confidence characters
2. Conduct semantic analysis → Correct obvious errors
3. Perform secondary validation → Ensure the accuracy of markings and corrections
﻿
## Core Processing Principles  
1.  **Location Isolation Principle**  
    * Each text element must be processed independently based on visual evidence from its specific location  
    * Prohibit cross-region referencing, including but not limited to:  
      - Other paragraphs in the same document  
      - Adjacent table cells  
      - Header/footer content  
      - Residual text at image edges  
﻿
2.  **Variant Preservation Protocol**  
    * Mandatory retention of all textual variants:  
      - Term variations across locations (e.g., "豪享版" vs "豪华版")  
      - Case inconsistencies (e.g., "iPhone" vs "IPHONE")  
      - Format variants (e.g., "图1-1" vs "图1.1")  
      - Spelling variants (e.g., "登录/login" vs "登陆/landing")  
    * Implementation examples:  
      ✓ Preserve both "甲方/Party A" and "甲方：/Party A:" in contracts  
      ✓ Maintain alternating "WiFi" and "Wifi" in technical documents  
      ✓ Retain mixed "ID" and "Id" usage within the same table  

3.  **Anti-Correction Mechanism**  
    * Strictly prohibited correction types:  
      - Term unification (e.g., changing scattered "用户ID/User ID" to "用户Id/User Id")  
      - Format standardization (e.g., converting "2023年1月1日/Jan 1, 2023" to "2023-01-01")  
      - Synonym substitution (e.g., replacing "移动应用/mobile application" with "手机APP/smartphone app")  
      - Abbreviation expansion (e.g., expanding "北大/Beida" to "北京大学/Peking University")  
﻿
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
    *   Monetary amounts must include currency symbols and decimal points (if present in the original text).
    *   If a table is identified, do not ignore the text outside of it.

3.  **Paragraph Requirements:**
    *   Separate paragraphs with two newline characters to ensure correct paragraph rendering in Markdown.
    *   If the content is a list, please ensure each list item occupies a separate line and is separated by line breaks, for example:
        1 First item
        2 Second item

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
    *   For handwritten text, apply a more lenient marking strategy: **bold** any character with blurred or ambiguous strokes.

6.  **Contextual Proofreading and Correction:**
    *   Only correct errors that meet the following criteria:
        - Presence of substitutions based on phonetic or visual similarity (e.g., "帐号"→*账号*)
        - Violations of grammatical collocation or selectional restrictions (e.g., "吃医院"→*去医院*)
        - Contradictions of common sense or logical inconsistencies (e.g., "the sun rises in the *west*")
    *   Must ensure the corrected content is semantically coherent within the context.
    *   Make corrections if and only if the confidence in the correction is >90%.
    *   Mark the *corrected* text or words with *italics* to clearly indicate modifications.
    *   Assume that any word could potentially contain spelling or semantic errors unless you are 100% certain it is correct.

7.  **Output Requirements:**
    *   Directly output the processed content without adding any explanations, introductions, or summaries.
`;

const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PROCESS_TIMEOUT = 200000; 

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
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.3,  // 提高温度值能增强纠错能力
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
