import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
## Core Processing Principles
1. **Absolute Context Independence**
   * Each text element must be processed based solely on its visual evidence
   * Strictly prohibit cross-referencing between:
     - Different document sections
     - Adjacent table cells
     - Header/footer content
     - Edge artifacts
   * Example enforcement: 
     ✓ "豪享版" and "豪华版" must both be preserved exactly as visually present
     ✓ "WiFi" vs "Wifi" variants maintain original forms

2. **Visual Fidelity Hierarchy**
   Processing priority:
   1. Pixel-level character features (stroke morphology/smudging)
   2. Immediate 3-character visual context
   3. Semantic plausibility (ONLY for sub-70% confidence characters)

## Enhanced Processing Workflow
1. Initial OCR Pass
   * Literal transcription with confidence tagging
   * Isolation protocol: Each character's confidence calculated from 5x5 pixel neighborhood

2. Context-Free Validation
   * Error correction ONLY when:
     - Single-character OCR artifacts detected (l→1, O→0)
     - Confidence <70% AND visual ambiguity confirmed
   * Correction marking: *italics* for modified characters

3. Variant Preservation Check
   * Automated logging of all term variants
   * Anti-normalization protection for:
     - Terminology inconsistencies
     - Format variations
     - Case alternations

## Special Handling Rules (Enhanced)
*   **Handwritten Documents**
    - Confidence threshold: 70%
    - Bold marking for:
      • Unclear character outlines
      • Broken strokes
      • Visually similar pairs (未/末)
    - No semantic corrections permitted

*   **Printed Documents**
    - Dual-validation required for ANY correction
    - Strict prohibitions:
      1. Term unification
      2. Format standardization 
      3. Synonym substitution
    - No bold marking allowed (clean output only)

*   **Table Content**
    - Numerical/symbol correction ONLY
    - Text cells: Absolute verbatim policy
    - Variant protection example:
      ✓ Preserve mixed "ID"/"Id" in same column

## Standards & Requirements (Integrated)
1. **Mathematical Formulas**
   * Standalone: $$E=mc^2$$
   * Inline: $E=mc^2$ 
   * Variable preservation: Original forms maintained

2. **Table Standards**
   | 项目       | 单价      | 数量 | 小计      |
   |------------|-----------|------|-----------|
   | 文案撰写   | ¥500/小时 | 4    | ¥2000.00  |
   * Currency symbols: Strictly as original
   * No text normalization in cells

3. **Text Requirements**
   * Paragraph separation: Double newline
   * Layout preservation:
     - Original indentation
     - Line breaks
     - Spacing anomalies
   * Prohibited actions:
     1. Automatic list formatting
     2. Markdown inference
     3. Whitespace normalization

4. **Correction Protocol**
   * Allowed ONLY when:
     - Phonetic/visual errors (帐号→*账号*)
     - Grammatical violations (吃医院→*去医院*)
     - Logical contradictions (sun rises in *west*)
   * Threshold: >90% correction confidence
   * Brand/technical terms: NEVER corrected

5. **Output Specifications**
   * Raw text + formatting only
   * No explanatory content
   * Machine-readable format
   * Variant audit trail embedded

### Key Integration Points:
1. **Workflow Restructuring**
   - Added isolation protocol in initial OCR pass
   - Introduced variant preservation checkpoint
   - Embedded anti-normalization checks

2. **Enhanced Correction Logic**
   - Added pixel-neighborhood confidence calculation
   - Strictly limited correction triggers
   - Clearer marking protocol (*italics* only)

3. **Context Independence**
   - Built into all processing stages
   - Added real-world examples
   - Machine-enforceable rules

4. **Backward Compatibility**
   - Maintained all original standards
   - Preserved your marking system
   - Kept existing table/math formats

The integrated version maintains your original requirements while adding:
- Stronger protection against contextual interference
- More robust variant preservation
- Clearer correction boundaries
- Better machine-enforceable rules
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
