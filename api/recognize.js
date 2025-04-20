import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const ADVANCED_PROMPT = `
## 处理流程说明
1. 执行首次OCR识别 → 标记低置信度字符
2. 进行语义分析 → 修正明显错误
3. 二次校验 → 确保标记和修正的准确性

## 特殊处理规则
* 手写体文档：采用宽松标记策略（置信度阈值降低15%）
* 印刷体文档：采用严格纠错策略（需要双重验证)
* 表格内容：仅允许修正数字/符号错误，不修改文本内容

1.  **数学公式规范：**
    * 独立的数学公式使用 $$，例如：$$E = mc^2$$
    * 行内数学公式使用 $，例如：能量公式 $E = mc^2$
    * 保持原文中的变量名称不变

2.  **表格规范：**
    * 如果图片中存在类似"表格"的内容，请使用标准 Markdown 表格语法输出。例如：
      | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
      |---------------|---------|-------|----------|
      | Copy Writing  | $50/hr  | 4     | $200.00  |
      | Website Design| $50/hr  | 2     | $100.00  |
    * 表头与单元格之间需使用"|-"分隔行，并保证每列至少有三个"-"进行对齐
    * 金额部分需包含货币符号以及小数点（如果原文有）
    * 若识别到表格，也不能忽略表格外的文字

3.  **分段要求：**
    *   每个分段之间用两个换行符分隔，确保 Markdown 中显示正确的分段效果

4.  **文字识别要求：**
    * 不能省略任何文字
    * 尽量保持原文的段落结构和大致排版（如缩进，但优先遵循Markdown标准格式）
    * 专业术语和特定名词需要准确识别
    * 不要将所有以数字、符号开头的段落识别为有序或无序列表，不要应用任何非原文指示的 Markdown 列表格式

5.  **识别与标记不确定项：**
    * 对以下情况必须使用**加粗**标记：
       - 字迹潦草导致轮廓不清晰的字符
       - 笔画断裂或存在污渍干扰的字符
       - 相似字符难以区分的场景（如"未"和"末"）
       - 置信度低于85%的识别结果
    * 对于连续3个及以上低置信度字符，采用**整体加粗**
    * 手写体采用更宽松的标记策略：只要存在笔画模糊即标记

6.  **上下文校对与纠错：**
    * 仅修正符合以下条件的错误：
       - 存在音近/形近替代（如"帐号"→*账号*）
       - 违反语法搭配（如"吃医院"→*去医院*）
       - 违反常识逻辑（如"太阳从*西*边升起"）
    * 必须确保修正后的内容在上下文中语义通顺
    * 当且仅当修正置信度>90%时进行修改
    * 将你*修正后*的文字或词语用*斜体* (*italic*) 标记出来，以清晰展示修改痕迹
    * 请大胆假设所有词语都可能存在拼写错误或语义错误，除非你确定100%无误
    * 对专业术语、专有名词不进行自动修正

7.  **输出要求：**
    * 直接输出处理后的内容，不要添加任何说明、前言或总结
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
        temperature: 0.3,  // 提高温度值能增强纠错能力
        topP: 0.9,        // 采样严格度
        topK: 20,         // 候选词数量
        maxOutputTokens: 12288,  // 输出长度
        stopSequences: ["##END##"]  // 添加终止序列
      },
      systemInstruction: {
        role: "system",
        content: "你是一个严谨的OCR校对专家，严格遵守所有处理规则" 
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
