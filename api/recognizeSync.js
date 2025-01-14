import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData, mimeType } = req.body;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
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

    const result = await model.generateContent([
      "请你识别图片中的文字内容并输出，如果有格式不规整可以根据内容排版，或者单词错误中文词汇错误可以纠正，不要有任何开场白、解释、描述、总结或结束语。",
      imagePart
    ]);

    const response = await result.response;
    const text = response.text();

    res.status(200).json({ text });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
} 