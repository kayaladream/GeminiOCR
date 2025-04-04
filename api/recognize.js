import { GoogleGenerativeAI } from "@google/generative-ai";

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
    *   将你**修正过**的文字或词语用*斜体* (*italic*) 标记出来，以清晰展示修改痕迹。

7.  **输出要求：**
    *   直接输出处理后的内容，不要添加任何说明、前言或总结。
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('[ERROR] 非法请求方法:', req.method);
    return res.status(405).json({ error: '只支持POST请求' });
  }

  try {
    const { imageData, mimeType } = req.body;
    if (!imageData || !mimeType) {
      console.error('[ERROR] 缺少参数:', { imageData: !!imageData, mimeType: !!mimeType });
      return res.status(400).json({ error: '缺少imageData或mimeType参数' });
    }

    console.log('[LOG] 收到请求，图片类型:', mimeType);

    // 初始化模型（模型信息日志）
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelConfig = {
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: 1,
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

    // 调用模型（模型名称日志）
    console.log('[LOG] 开始调用模型:', modelConfig.model); 
    const result = await model.generateContentStream([ADVANCED_PROMPT, imagePart]);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    res.end();
    console.log('[LOG] 请求处理完成');

  } catch (error) {
    console.error('[ERROR] 处理失败:', error.message);
    console.error(error.stack);
    
    let errorMessage = '处理图片时出错';
    if (error.message.includes('API_KEY')) {
      errorMessage = '服务器配置错误（API密钥无效）';
    } else if (error.message.includes('image')) {
      errorMessage = '图片格式不支持';
    }

    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
}
