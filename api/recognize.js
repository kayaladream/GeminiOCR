import { GoogleGenerativeAI } from "@google/generative-ai";
import _ from 'lodash';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Segment = require('segment');

// 初始化中文分词器
const segment = new Segment();
segment.useDefault();

// 配置常量
const CONFIDENCE_THRESHOLDS = {
  printed: Number(process.env.CONFIDENCE_PRINTED) || 85,
  handwritten: Number(process.env.CONFIDENCE_HANDWRITE) || 70
};
const DYNAMIC_THRESHOLDS = {
  base: 0.6,
  factors: { imageQuality: 0.3, contentType: 0.2 }
};
const DOMAIN_LEXICONS = {
  medical: ['血氧饱和度', '冠状动脉', '血小板计数'],
  legal: ['不可抗力', '要约邀请', '不当得利'],
  general: []
};
const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PROCESS_TIMEOUT = 55000;
const MAX_STROKE_COMPLEXITY = Number(process.env.MAX_STROKE_COMPLEXITY) || 8;
const STRUCTURE_ANOMALY_WEIGHT = Number(process.env.STRUCTURE_ANOMALY_WEIGHT) || 0.7;

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
    * 单词语法检查（的/得/地等）
    * 上下文语义验证（分析前后3句）
    * 可用专业领域：${Object.keys(DOMAIN_LEXICONS).join('、')}
    * 示例医学术语：${DOMAIN_LEXICONS.medical.slice(0,3).join('、')}
    * 所有修正必须用*斜体*标注

7.  **输出要求：**
    *   直接输出处理后的内容，不要添加任何说明、前言或总结。
`;

// 质量评估器（增强版）
class QualityEvaluator {
  static evaluate(text) {
    const errorPatterns = [
      /(\*\*){3,}/g, /(\*){3,}/g, /[ ]+/g, /^#{4,}/gm
    ];
    const errorCount = errorPatterns.reduce((sum, pattern) => 
      sum + (text.match(pattern) || []).length, 0);
    return 1 - Math.min(errorCount * 0.1, 0.4);
  }
}

// 笔画复杂度数据（示例）
const STROKE_MAP = {
  '的': 8, '地': 6, '得': 11, '噐': 15, '䶮': 20
};

// 后处理模块（增强版）
function postProcess(text, imageMeta = {}) {
  const dynamicThreshold = getDynamicThreshold(imageMeta);
  
  return text.split(/(\$\$.*?\$\$|\$.*?\$|\\|.*?\\|)/g).map((part, index) => {
    if (index % 2 === 1 || /(\$\$|\$|\\|)/.test(part)) return part;

    return part.replace(/([\u4e00-\u9fa5]{3,})/g, match => {
      const features = {
        rareChar: /[龥鰲龖驫鬱]/.test(match),
        strokeCount: calculateStrokeComplexity(match),
        structureError: checkStructureAnomaly(match)
      };
      return _.sum(Object.values(features)) > dynamicThreshold ? `**${match}**` : match;
    });
  }).join('');
}

function calculateStrokeComplexity(char) {
  return char.split('').reduce((sum, c) => 
    sum + (STROKE_MAP[c] || 10), 0) / char.length / MAX_STROKE_COMPLEXITY;
}

function checkStructureAnomaly(char) {
  return /[⺌⺮⻌]/.test(char) ? STRUCTURE_ANOMALY_WEIGHT : 0;
}

function getDynamicThreshold(imageMeta) {
  const qualityFactor = imageMeta.quality < 0.5 ? DYNAMIC_THRESHOLDS.factors.imageQuality : 0;
  const contentFactor = imageMeta.isHandwritten ? DYNAMIC_THRESHOLDS.factors.contentType : 0;
  return DYNAMIC_THRESHOLDS.base + qualityFactor + contentFactor;
}

// 语义纠错引擎（专业版）
const COMMON_ERRORS = {
  '嘛烦': '麻烦', '需呀': '需要', '的的': '的'
};

async function semanticCorrection(text, domain = 'medical') {
  const terms = DOMAIN_LEXICONS[domain] || [];
  console.log(`当前领域 ${domain} 的术语: ${terms.join(', ')}`);
  const words = segment.doSegment(text, { simple: true });
  return words.map((word, index) => {
    // 专业术语优先
    if (lexicon.includes(word)) return word;

    // 常见错误校正
    if (COMMON_ERRORS[word]) return `*${COMMON_ERRORS[word]}*`;

    // 上下文相关纠错
    if (['的', '地', '得'].includes(word)) {
      const prevWord = words[index - 1] || '';
      return _correctDeDiDe(word, prevWord);
    }

    return word;
  }).join('');
}

function _correctDeDiDe(current, prevWord) {
  const rules = {
    '的': /(名|形|代)$/,
    '地': /(动|副)$/,
    '得': /(动|形)$/
  };
  const expected = Object.entries(rules).find(([_, regex]) => 
    regex.test(prevWord)
  )?.[0] || current;
  return expected !== current ? `*${expected}*` : current;
}

// 去重处理器
class Deduplicator {
  constructor() {
    this.seen = new Set();
  }

  process(text) {
    return text.split('\n').filter(line => {
      const hash = this._hash(line);
      return !this.seen.has(hash) && this.seen.add(hash);
    }).join('\n');
  }

  _hash(str) {
    return str.split('').reduce((a, b) => 
      ((a << 5) - a) + b.charCodeAt(0), 0);
  }
}

// 主处理逻辑（最终版）
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持POST请求' });
  }

  let responseEnded = false;
  req.on('close', () => responseEnded = true);

  try {
    const { imageData, mimeType, domain } = req.body;
    
    // 参数验证（保持原有严格校验）
    if (!VALID_MIME_TYPES.includes(mimeType)) {
      return res.status(415).json({ error: '不支持的图片类型' });
    }

    // 动态模型配置
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelConfig = {
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: mimeType === 'image/png' ? 0.5 : 0.1,
        topP: 0.9,
        maxOutputTokens: 8192
      },
      safetySettings: [{
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      }]
    };

    const model = genAI.getGenerativeModel(modelConfig);
    const imagePart = { inlineData: { data: imageData, mimeType } };

    // 处理超时机制
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('处理超时')), PROCESS_TIMEOUT));

    // API调用
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

    // 增强流处理
    const deduplicator = new Deduplicator();
    let buffer = '';
    
    for await (const chunk of result.stream) {
      if (responseEnded) break;
      
      buffer += chunk.text();
      
      // 智能分段处理
      if (buffer.length > 80 || /\n/.test(buffer)) {
        const processed = deduplicator.process(
          postProcess(buffer, { 
            quality: 0.8, 
            isHandwritten: mimeType === 'image/png' 
          })
        );
        res.write(`data: ${JSON.stringify({ text: processed })}\n\n`);
        buffer = '';
      }
    }

    // 最终处理
    if (buffer.length > 0) {
      const finalText = await semanticCorrection(
        postProcess(buffer), 
        domain || 'general'
      );
      res.write(`data: ${JSON.stringify({
        text: finalText,
        quality: QualityEvaluator.evaluate(finalText).toFixed(2)
      })}\n\n`);
    }

    res.end();

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
