import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const _ = require('lodash');

// 配置常量
const CONFIDENCE_THRESHOLDS = {
  printed: process.env.CONFIDENCE_PRINTED || 85,
  handwritten: process.env.CONFIDENCE_HANDWRITE || 70
};
const DOMAIN_LEXICONS = ['medical', 'legal', 'technical'];
const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PROCESS_TIMEOUT = 55000;
const MIN_QUALITY_SCORE = process.env.MIN_QUALITY_SCORE || 0.65;

// 高级提示词模板
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

5.  **置信度标注规范：**
    * 手写体字符置信度<${CONFIDENCE_THRESHOLDS.handwritten}时用**加粗**标注
    * 印刷体字符置信度<${CONFIDENCE_THRESHOLDS.printed}时用**加粗**标注
    * 模糊/遮挡字符直接加粗
    * 对数学公式、表格内容禁用标注

6.  **智能纠错规范：**
    * 三级纠错流程：
        1) 单词语法检查（的/得/地等）
        2) 上下文语义验证（分析前后3句）
        3) 匹配专业术语库（${DOMAIN_LEXICONS.join('、')}）
    * 所有修正必须用*斜体*标注

7.  **输出要求：**
    *   直接输出处理后的内容，不要添加任何说明、前言或总结。
`;

// 质量评估器
class QualityEvaluator {
  static evaluate(text) {
    const errorPatterns = [
      /(\*\*){3,}/g,   // 连续加粗
      /(\*){3,}/g,      // 连续斜体
      /[ ]+/g,          // 乱码字符
      /^#{4,}/gm        // 错误标题格式
    ];
    
    const errorCount = errorPatterns
      .map(pattern => (text.match(pattern) || []).length)
      .reduce((a, b) => a + b, 0);

    const score = 1 - Math.min(errorCount * 0.1, 0.4);
    console.log(`[Quality] 评估得分: ${score.toFixed(2)} 错误数: ${errorCount}`);
    return score;
  }
}

// 后处理模块
function postProcess(text) {
  const contentParts = text.split(/(\$\$.*?\$\$|\$.*?\$|\\|.*?\\|)/g);
  
  return contentParts.map((part, index) => {
    if (index % 2 === 1 || /(\$\$|\$|\\|)/.test(part)) return part;
    
    return part.replace(/([\u4e00-\u9fa5]{5,})/g, match => {
      const nonChineseCount = match.split('')
        .filter(c => c.charCodeAt(0) > 0x9FA5 || c.charCodeAt(0) < 0x4E00)
        .length;
      return (nonChineseCount / match.length) > 0.2 ? `**${match}**` : match;
    });
  }).join('');
}

// 语义纠错引擎
const COMMON_ERRORS = [
  [/需(要|求)/g, '需要'],
  [/([^章])节/g, '$1章'],
  [/[吗嘛]烦/g, '麻烦'],
  [/(\S)(的地得)(\S)/g, (match, p1, p2, p3) => {
    const rules = { 的: 'adj', 地: 'adv', 得: 'verb' };
    const prevCharType = /[名形]/.test(p1) ? 'adj' : /[动]/.test(p1) ? 'verb' : 'adv';
    return p1 + Object.keys(rules).find(k => rules[k] === prevCharType) + p3;
  }]
];

async function semanticCorrection(text) {
  let corrected = text;
  for (const [pattern, replacement] of COMMON_ERRORS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected;
}

// 动态配置生成器
function getGenerationConfig(mimeType) {
  const baseConfig = {
    temperature: 0.1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192
  };

  if (mimeType === 'image/png') { // 假设PNG为手写图片
    return { ...baseConfig, temperature: 0.5, topP: 0.9 };
  }
  return baseConfig;
}

// 主处理逻辑
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('[ERROR] 非法请求方法:', req.method);
    return res.status(405).json({ error: '只支持POST请求' });
  }

  let responseEnded = false;
  req.on('close', () => {
    if (!responseEnded) {
      console.warn('[WARN] 客户端提前关闭连接');
      responseEnded = true;
    }
  });

  try {
    const { imageData, mimeType } = req.body;
    
    // 参数验证
    if (!imageData || !mimeType) {
      console.error('[ERROR] 缺少必要参数');
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

    // 模型配置
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelConfig = {
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: getGenerationConfig(mimeType),
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };

    const model = genAI.getGenerativeModel(modelConfig);
    const imagePart = { inlineData: { data: imageData, mimeType } };

    // 处理超时机制
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`处理超时（超过${PROCESS_TIMEOUT/1000}秒）`));
      }, PROCESS_TIMEOUT);
    });

    // 调用Gemini API
    const result = await Promise.race([
      model.generateContentStream([ADVANCED_PROMPT, imagePart]),
      timeoutPromise
    ]);

    // 流式响应设置
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 处理数据流
    let fullText = '';
    for await (const chunk of result.stream) {
      if (responseEnded) break;
      
      const chunkText = chunk.text();
      fullText += chunkText;
      
      // 实时传输原始识别结果
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    // 后处理阶段
    const processedText = postProcess(fullText);
    const correctedText = await semanticCorrection(processedText);
    const qualityScore = QualityEvaluator.evaluate(correctedText);

    // 发送最终结果
    if (!responseEnded) {
      res.write(`data: ${JSON.stringify({
        text: correctedText,
        markers: {
          bold: (correctedText.match(/\*\*/g) || []).length / 2,
          italic: (correctedText.match(/\*/g) || []).length / 2
        },
        quality: qualityScore.toFixed(2)
      })}\n\n`);
      
      if (qualityScore < MIN_QUALITY_SCORE) {
        console.warn(`[WARN] 低质量结果: ${qualityScore}`);
      }
    }

    responseEnded = true;
    res.end();
    console.log('[SUCCESS] 请求处理完成');

  } catch (error) {
    if (responseEnded) return;
    
    console.error('[ERROR] 处理失败:', error.stack);
    
    const errorMapping = {
      'API_KEY': { code: 503, msg: '服务器配置错误' },
      'image': { code: 415, msg: '图片格式错误' },
      'quota': { code: 429, msg: 'API配额不足' },
      'network': { code: 502, msg: '网络错误' },
      '超时': { code: 504, msg: '处理超时' }
    };

    const matchKey = Object.keys(errorMapping).find(k => error.message.includes(k));
    const { code, msg } = matchKey ? errorMapping[matchKey] : { code: 500, msg: '处理失败' };

    res.status(code).json({ 
      error: msg,
      ...(process.env.NODE_ENV === 'development' && {
        detail: error.message
      })
    });
    responseEnded = true;
  }
}
