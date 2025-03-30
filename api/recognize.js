import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData, mimeType } = req.body;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro-exp-03-25",
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      },
    };

    const result = await model.generateContentStream([
      请识别图片中的文字内容，严格按照以下规则输出：

      1. 数学公式规范：
         - 独立的数学公式使用 $$，不要添加额外的换行符
         - 行内数学公式使用 $，与文字之间需要空格
         - 保持原文中的变量名称不变

      2. 格式要求：
         - 每个独立公式单独成行
         - 公式与公式之间要有换行分隔
         - 公式与文字之间要有空格分隔
         - 保持原文的段落结构

      3. 示例格式：
         这是一个行内公式 $x^2$ 的例子

         这是一个独立公式：
         $$f(x) = x^2 + 1$$

         这是下一段文字...

      4. 特别注意：
         - 不要省略任何公式或文字
         - 保持原文的排版结构
         - 确保公式之间有正确的分隔
         - 序号和公式之间要有空格

      5. 如果图片中存在类似"表格"的内容，请使用标准 Markdown 表格语法输出。例如：
         | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
         |---------------|---------|-------|----------|
         | Copy Writing  | $50/hr  | 4     | $200.00  |
         | Website Design| $50/hr  | 2     | $100.00  |   
         - 表头与单元格之间需使用"|-"分隔行，并保证每列至少有三个"-"进行对齐
         - 金额部分需包含货币符号以及小数点
         - 若识别到表格，也不能忽略表格外的文字

      6. 分段要求：
         - 每个分段之间用两个换行符分隔，确保 Markdown 中显示正确的分段效果

      7. 直接输出内容，不要添加任何说明
      `;
      imagePart
    ]);

    // 设置响应头以支持流式传输
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 流式传输结果
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
} 
