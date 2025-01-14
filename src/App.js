import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Viewer } from '@bytemd/react';
import mathPlugin from '@bytemd/plugin-math';
import gfmPlugin from '@bytemd/plugin-gfm';
import highlightPlugin from '@bytemd/plugin-highlight';
import breaksPlugin from '@bytemd/plugin-breaks';
import frontmatterPlugin from '@bytemd/plugin-frontmatter';
import 'bytemd/dist/index.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './App.css';
import { Document, Page, pdfjs } from 'react-pdf';
import mammoth from 'mammoth';

// 配置 ByteMD 插件
const plugins = [
  mathPlugin({
    katexOptions: {
      throwOnError: false,
      output: 'html',
      strict: false,
      trust: true,
      macros: {
        '\\f': '#1f(#2)',
      },
    }
  }),
  gfmPlugin(),
  highlightPlugin(),
  breaksPlugin(),
  frontmatterPlugin()
];

// 初始化 Gemini API
const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);

// 添加 generationConfig 配置
const generationConfig = {
  temperature: 0,  // 降低随机性
  topP: 1,
  topK: 1,
  maxOutputTokens: 8192,
};

// 添加支持的文件类型配置
const SUPPORTED_FILE_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  PDF: ['application/pdf'],
  WORD: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
};

// 添加提示文本常量
const LATEX_EXAMPLES = {
  FRACTION: '\\\\frac{分子}{分母}',
  SQRT: '\\\\sqrt{被开方数}',
  SUPERSCRIPT: 'x^2',
  SUBSCRIPT: 'x_n',
  LIMIT: '\\\\lim\\\\limits_{x}',
};

const CHOICE_EXAMPLE = {
  QUESTION: '上3个无穷小量按照从低阶到高阶的排序是( )',
  OPTIONS: [
    '\\\\alpha_1, \\\\alpha_2, \\\\alpha_3',
    '\\\\alpha_2, \\\\alpha_1, \\\\alpha_3',
    '\\\\alpha_1, \\\\alpha_3, \\\\alpha_2',
    '\\\\alpha_2, \\\\alpha_3, \\\\alpha_1'
  ]
};

const COMPLEX_EXAMPLE = {
  PART1: '\\\\lim\\\\imits_{x \\\\to +\\\\infty} \\\\frac{\\\\arctan 2x - \\\\arctan x}{\\\\frac{\\\\pi}{2} - \\\\arctan x}',
  PART2: '\\\\lim\\\\imits_{x \\\\to +\\\\infty} x[1-f(x)]',
  PART3: '\\\\lim\\\\imits_{x \\\\to +\\\\infty} \\\\frac{\\\\arctan 2x + [b-1-bf(x)]\\\\arctan x}{\\\\frac{\\\\pi}{2} - \\\\arctan x}'
};

const OCR_PROMPT = `
请识别图片中的文字内容，注意以下要求：

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
   | DESCRIPTION    | RATE    | HOURS | AMOUNT   |
   |---------------|---------|-------|----------|
   | Copy Writing  | $50/hr  | 4     | $200.00  |
   | Website Design| $50/hr  | 2     | $100.00  |   
  5.1表头与单元格之间需使用"|-"分隔行，并保证每列至少有三个"-"进行对齐
  5.2 金额部分需包含货币符号以及小数点
  5.3 若识别到表格，也不能忽略表格外的文字
  5.4 以上要求须综合运用，完整输出图片中全部文本信息
请按照以上规范输出识别结果。
`;

// 修改预处理函数
const preprocessText = (text) => {
  if (!text) return '';
  
  // 临时保存表格内容
  const tables = [];
  text = text.replace(/(\|[^\n]+\|\n\|[-|\s]+\|\n\|[^\n]+\|(\n|$))+/g, (match) => {
    tables.push(match);
    return `__TABLE_${tables.length - 1}__`;
  });
  
  // 标准化数学公式分隔符
  text = text.replace(/\\\\\(/g, '$');
  text = text.replace(/\\\\\)/g, '$');
  text = text.replace(/\\\\\[/g, '$$');
  text = text.replace(/\\\\\]/g, '$$');
  
  // 移除所有的 ``` 标记
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    const content = match.slice(3, -3).trim();
    return content;
  });
  
  // 移除单独的 ``` 标记和语言标识
  text = text.replace(/```\w*\n?/g, '');
  
  // 处理数字序号后的换行问题
  text = text.replace(/(\d+)\.\s*\n+/g, '$1. ');
  
  // 处理块级公式的格式
  text = text.replace(/\n*\$\$\s*([\s\S]*?)\s*\$\$\n*/g, (match, formula) => {
    return `\n\n$$${formula.trim()}$$\n\n`;
  });
  
  // 处理行内公式的格式
  text = text.replace(/\$\s*(.*?)\s*\$/g, (match, formula) => {
    return `$${formula.trim()}$`;
  });
  
  // 处理数字序号和公式之间的格式
  text = text.replace(/(\d+\.)\s*(\$\$[\s\S]*?\$\$)/g, '$1\n\n$2');
  
  // 处理多余的空行
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // 还原表格内容
  text = text.replace(/__TABLE_(\d+)__/g, (match, index) => {
    return tables[parseInt(index)];
  });
  
  return text.trim();
};

// 添加纠错提示模板
const CORRECTION_PROMPT = `请检查并纠正以下数学公式和文本内容中的错误，特别注意：
1. LaTeX 公式语法
2. 数学符号的正确性
3. 格式排版的规范性
5. 不要添加任何解释，直接输出修正后的内容
6. 修正之后的数据一定是要可以正确解析的

以下是需要检查的内容：
{content}
`;

// 添加处理 LaTeX 文本的函数
const processLatex = (text) => {
  if (!text) return '';
  
  // 分离块级公式和行内公式
  return text.split('\n').map(line => {
    // 处理块级公式
    if (line.includes('$$')) {
      return line.replace(/\$\$(.*?)\$\$/g, (match, formula) => {
        try {
          return `<div class="math-block"><BlockMath>${formula.trim()}</BlockMath></div>`;
        } catch (error) {
          console.error('块级公式渲染错误:', error);
          return `<pre><code>${formula}</code></pre>`;
        }
      });
    }
    // 处理行内公式
    if (line.includes('$')) {
      return line.replace(/\$(.*?)\$/g, (match, formula) => {
        try {
          return `<InlineMath>${formula.trim()}</InlineMath>`;
        } catch (error) {
          console.error('行内公式渲染错误:', error);
          return `<code>${formula}</code>`;
        }
      });
    }
    return line;
  }).join('\n');
};

// 添加处理公式的函数
const processFormula = (formula) => {
  try {
    return formula
      .replace(/\\tag{\d+}/g, '') // 移除 tag
      .replace(/\\left\\/g, '\\left') // 修复 left
      .replace(/\\right\\/g, '\\right') // 修复 right
      .replace(/\\\s+/g, '\\') // 移除反斜杠后的空格
      .trim();
  } catch (error) {
    console.error('处理公式错误:', error);
    return formula;
  }
};

// 添加 Markdown 组件配置
const MarkdownComponents = {
  // 自定义表格渲染
  table: ({ node, ...props }) => (
    <table className="markdown-table" {...props} />
  ),
  // 自定义表格头部渲染
  th: ({ node, ...props }) => (
    <th className="markdown-th" {...props} />
  ),
  // 自定义表格单元格渲染
  td: ({ node, ...props }) => (
    <td className="markdown-td" {...props} />
  ),
  // 自定义代码块渲染
  code: ({ node, inline, className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <pre className={`language-${match[1]}`}>
        <code className={`language-${match[1]}`} {...props}>
          {children}
        </code>
      </pre>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // 自定义图片渲染
  img: ({ node, ...props }) => (
    <img className="markdown-img" {...props} alt={props.alt || ''} />
  ),
  // 自定义链接渲染
  a: ({ node, ...props }) => (
    <a className="markdown-link" target="_blank" rel="noopener noreferrer" {...props} />
  )
};

function App() {
  const [images, setImages] = useState([]);
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const [streamingStates, setStreamingStates] = useState({});
  const [streamingTexts, setStreamingTexts] = useState({});
  const resultRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [isNewResult, setIsNewResult] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animatedText, setAnimatedText] = useState('');
  const [isTextReady, setIsTextReady] = useState(false);
  const [animationText, setAnimationText] = useState('');
  const [showAnimation, setShowAnimation] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [modelType, setModelType] = useState('openai');
  const [isCorrectingText, setIsCorrectingText] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 添加检测移动设备的 useEffect
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 修改粘贴事件处理函数
  useEffect(() => {
    const handlePaste = async (e) => {
      e.preventDefault();
      const items = Array.from(e.clipboardData.items);
      
      for (const item of items) {
        // 处理图片
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            setIsLoading(true);
            try {
              const imageUrl = URL.createObjectURL(file);
              const newIndex = images.length;
              
              setImages(prev => [...prev, imageUrl]);
              setResults(prev => [...prev, '']);
              setCurrentIndex(newIndex);
              
              await handleFile(file, newIndex);
            } catch (error) {
              console.error('Error processing pasted image:', error);
            } finally {
              setIsLoading(false);
            }
          }
        }
        // 处理文本（可能是链接）
        else if (item.type === 'text/plain') {
          item.getAsString(async (text) => {
            // 如果文本包含 http 或 https，就认为是链接
            if (text.match(/https?:\/\//i)) {
              setImageUrl(text);
              setShowUrlInput(true);
            }
          });
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [images.length]);

  // 将文件转换为Base641111
  const fileToGenerativePart = async (file) => {
    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onloadend = () => {
        resolve({
          inlineData: {
            data: reader.result.split(',')[1],
            mimeType: file.type
          },
        });
      };
      reader.readAsDataURL(file);
    });
  };

  // 修改文件处理逻辑
  const handleFile = async (file, index) => {
    try {
      setIsStreaming(true);
      setStreamingText('');
      
      let content = '';
      
      // 根据文件类型选择处理方法
      if (file.type === 'application/pdf') {
        content = await handlePdfFile(file, index);
      } else if (file.type.startsWith('image/')) {
        content = await handleImageFile(file, index);
      } else {
        throw new Error('不支持的文件类型');
      }

      if (index >= 0 && !file.type.startsWith('application/pdf')) {
        setResults(prev => {
          const newResults = [...prev];
          newResults[index] = content;
          return newResults;
        });
        setStreamingText(content);
      }

    } catch (error) {
      console.error('处理文件时出错:', error);
      if (index >= 0) {
        setResults(prev => {
          const newResults = [...prev];
          newResults[index] = `处理出错: ${error.message}`;
          return newResults;
        });
      }
    } finally {
      setIsStreaming(false);
    }
  };

  // 处理图片文件
  const handleImageFile = async (file, index) => {
    if (file && file.type.startsWith('image/')) {
      try {
        let fullText = '';
        
        setStreamingStates(prev => ({ ...prev, [index]: true }));
        setStreamingTexts(prev => ({ ...prev, [index]: '' }));
        
        {
          const fileReader = new FileReader();
          const imageData = await new Promise((resolve) => {
            fileReader.onloadend = () => {
              resolve(fileReader.result);
            };
            fileReader.readAsDataURL(file);
          });

          if (modelType === 'openai') {
            // OpenAI API调用
            const response = await fetch(process.env.REACT_APP_OPENAI_API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`
              },
              body: JSON.stringify({
                model: "gemini-2.0-flash-exp",
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: OCR_PROMPT
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: imageData
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 8000,
                stream: true
              })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    const content = data.choices?.[0]?.delta?.content || '';
                    if (content) {
                      fullText += content;
                      
                      // 更新这一页的streaming文本
                      setStreamingTexts(prev => ({ ...prev, [index]: fullText }));
                      
                      // 更新结果数组
                      setResults(prevResults => {
                        const newResults = [...prevResults];
                        newResults[index] = fullText;
                        return newResults;
                      });
                    }
                  } catch (e) {
                    console.error('Error parsing chunk:', e);
                  }
                }
              }
            }
          } else {
            // Gemini API调用
            const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
              model: "gemini-2.0-flash-exp",
              generationConfig,
            });

            const imagePart = {
              inlineData: {
                data: imageData.split(',')[1],
                mimeType: file.type
              },
            };

            const result = await model.generateContentStream([
              "请识别图片中的文字内容，严格按照以下规则输出：" +
              "1. 数学公式规范：" +
              "   - 独立成行的公式使用 $$...$$" +
              "   - 行内变量和表达式使用 $...$ 包裹" +
              "   - 保持原文中的变量名称不变" +           
              "2. 示例：" +
              "   - 原文：'当 n 为偶数时'" +
              "   - 正确输出：'当 $n$ 为偶数时'" +
              "   - 错误输出：'当 Tn 为偶数时' 或 '当 @n@ 为偶数时'" +
              "3. 文字识别要求：" +
              "   - 如遇到模糊不清的单词或中文，根据上下文语境进行合理推测和修正" +
              "   - 保持语句通顺和语义连贯性" +
              "   - 专业术语和特定名词需要准确识别" +
              "4. 直接输出内容，不要添加任何说明",
              imagePart
            ]);

            for await (const chunk of result.stream) {
              const chunkText = chunk.text();
              fullText += chunkText;
              
              // 更新这一页的streaming文本
              setStreamingTexts(prev => ({ ...prev, [index]: fullText }));
              
              // 更新结果数组
              setResults(prevResults => {
                const newResults = [...prevResults];
                newResults[index] = fullText;
                return newResults;
              });
            }
          }
        }

        // 在设置结果之前预处理文本
        fullText = preprocessText(fullText);
        
        setStreamingTexts(prev => ({ ...prev, [index]: fullText }));
        setResults(prevResults => {
          const newResults = [...prevResults];
          newResults[index] = fullText;
          return newResults;
        });
        
        return fullText;

      } catch (error) {
        console.error('Error details:', error);
        const errorMessage = `识别出错,请重试 (${error.message})`;
        
        setStreamingStates(prev => ({ ...prev, [index]: false }));
        setStreamingTexts(prev => ({ ...prev, [index]: errorMessage }));
        
        setResults(prevResults => {
          const newResults = [...prevResults];
          newResults[index] = errorMessage;
          return newResults;
        });
        
        throw error;
      }
    }
  };

  // 修改PDF文件处理函数
  const handlePdfFile = async (file, startIndex) => {
    try {
      // 加载 PDF.js worker
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
      
      const fileReader = new FileReader();
      const pdfData = await new Promise((resolve) => {
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.readAsArrayBuffer(file);
      });

      const pdf = await pdfjs.getDocument({ data: pdfData }).promise;
      const totalPages = pdf.numPages;
      const pdfImages = [];

      // 第一步：先将所有PDF页面转换为图片
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
          console.log('正在转换第', pageNum, '页为图片');
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 });
          
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;

          const imageData = canvas.toDataURL('image/jpeg', 1.0);
          pdfImages.push(imageData);
        } catch (pageError) {
          console.error(`处理第 ${pageNum} 页时出错:`, pageError);
          continue; // 继续处理下一页
        }
      }

      // 更新图片预览
      setImages(prev => {
        const newImages = [...prev];
        newImages.splice(startIndex, 1, ...pdfImages);
        return newImages;
      });

      // 初始化结果数组
      setResults(prev => {
        const newResults = [...prev];
        newResults.splice(startIndex, 1, ...new Array(pdfImages.length).fill('正在识别中...'));
        return newResults;
      });

      // 使用 Promise.all 并行处理所有页面，但限制并发数
      const batchSize = 6; // 每批处理的页面数
      const results = [];
      
      for (let i = 0; i < pdfImages.length; i += batchSize) {
        try {
          const batch = pdfImages.slice(i, i + batchSize);
          const batchPromises = batch.map(async (imageData, batchIndex) => {
            const pageIndex = i + batchIndex;
            try {
              const imageBlob = await fetch(imageData).then(res => res.blob());
              const imageFile = new File([imageBlob], `page_${pageIndex + 1}.jpg`, { type: 'image/jpeg' });
              return handleImageFile(imageFile, startIndex + pageIndex);
            } catch (error) {
              console.error(`处理PDF第 ${pageIndex + 1} 页图片时出错:`, error);
              return `第 ${pageIndex + 1} 页处理失败: ${error.message}`;
            }
          });

          // 等待当前批次完成
          const batchResults = await Promise.allSettled(batchPromises);
          results.push(...batchResults.map(result => 
            result.status === 'fulfilled' ? result.value : `处理失败: ${result.reason}`
          ));
        } catch (batchError) {
          console.error('处理PDF批次时出错:', batchError);
        }
      }

      return results.filter(Boolean).join('\n\n---\n\n');
    } catch (error) {
      console.error('PDF处理错误:', error);
      throw new Error(`PDF处理失败: ${error.message}`);
    }
  };

  // 处理 Word 文件
  const handleWordFile = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  // 添加并发控制函数
  const concurrentProcess = async (items, processor, maxConcurrent = 5) => {
    const results = [];
    for (let i = 0; i < items.length; i += maxConcurrent) {
      const chunk = items.slice(i, i + maxConcurrent);
      const chunkPromises = chunk.map((item, index) => processor(item, i + index));
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }
    return results;
  };

  // 修改文件上传处理
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    setIsLoading(true);
    
    try {
      const startIndex = images.length;
      
      // 处理所有支持的文件类型
      const validFiles = files.filter(file => 
        file.type.startsWith('image/') || file.type === 'application/pdf'
      );

      // 生成预览
      const previews = await Promise.all(validFiles.map(async file => {
        if (file.type.startsWith('image/')) {
          return URL.createObjectURL(file);
        } else if (file.type === 'application/pdf') {
          // 为PDF创建临时预览
          return '/pdf-icon.png';
        }
      }));

      setImages(prev => [...prev, ...previews]);
      setResults(prev => [...prev, ...new Array(validFiles.length).fill('')]);
      setCurrentIndex(startIndex);

      // 逐个处理文件
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        await handleFile(file, startIndex + i);
      }
    } catch (error) {
      console.error('处理文件时出错:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 修改图片切换函数
  const handlePrevImage = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleNextImage = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  // 添加全局拖拽事件监听
  useEffect(() => {
    const handleGlobalDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDraggingGlobal) {
        setIsDraggingGlobal(true);
        setIsDragging(true);
      }
    };

    const handleGlobalDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = document.body.getBoundingClientRect();
      if (
        e.clientX <= rect.left ||
        e.clientX >= rect.right ||
        e.clientY <= rect.top ||
        e.clientY >= rect.bottom
      ) {
        setIsDraggingGlobal(false);
        setIsDragging(false);
      }
    };

    const handleGlobalDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingGlobal(false);
      setIsDragging(false);
    };

    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);
    window.addEventListener('dragover', (e) => e.preventDefault());

    return () => {
      window.removeEventListener('dragenter', handleGlobalDragEnter);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
      window.removeEventListener('dragover', (e) => e.preventDefault());
    };
  }, [isDraggingGlobal]);

  // 修改原有的拖拽处理函数
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = dropZoneRef.current.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setIsDraggingGlobal(false);
    setIsLoading(true);
    
    try {
      const items = Array.from(e.dataTransfer.items);
      const filePromises = items.map(async (item) => {
        if (item.kind === 'string') {
          const url = await new Promise(resolve => item.getAsString(resolve));
          if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            const response = await fetch(url);
            const blob = await response.blob();
            return new File([blob], 'image.jpg', { type: blob.type });
          }
        } else if (item.kind === 'file') {
          return item.getAsFile();
        }
        return null;
      });

      const files = (await Promise.all(filePromises)).filter(file => file !== null);
      const startIndex = images.length;
      
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);
      setCurrentIndex(startIndex);
      
      await concurrentProcess(
        files,
        (file, index) => handleFile(file, startIndex + index)
      );
    } catch (error) {
      console.error('Error processing dropped files:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 修改处理图片 URL 的函数
  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!imageUrl) return;
    setIsLoading(true);
    
    try {
      let imageBlob;
      
      // 处理 base64 图片
      if (imageUrl.startsWith('data:image/')) {
        const base64Data = imageUrl.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteArrays = [];
        
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArrays.push(byteCharacters.charCodeAt(i));
        }
        
        imageBlob = new Blob([new Uint8Array(byteArrays)], { type: 'image/png' });
      } else {
        // 使用多个代理服务，如果一个失败就尝试下一个
        const proxyServices = [
          (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          (url) => `https://cors-anywhere.herokuapp.com/${url}`,
          (url) => `https://proxy.cors.sh/${url}`,
          (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
        ];

        let error;
        for (const getProxyUrl of proxyServices) {
          try {
            const proxyUrl = getProxyUrl(imageUrl);
            const response = await fetch(proxyUrl, {
              headers: {
                'x-requested-with': 'XMLHttpRequest',
                'origin': window.location.origin
              }
            });
            
            if (!response.ok) throw new Error('Proxy fetch failed');
            imageBlob = await response.blob();
            // 如果成功获取图片，跳出循环
            break;
          } catch (e) {
            error = e;
            // 如果当前代理失败，继续尝试下一个
            continue;
          }
        }

        // 如果所有代理都失败了，尝试直接获取
        if (!imageBlob) {
          try {
            const response = await fetch(imageUrl, {
              mode: 'no-cors'
            });
            imageBlob = await response.blob();
          } catch (e) {
            // 如果直接获取也失败，抛出最后的错误
            throw error || e;
          }
        }
      }
      
      // 确保获取到的是图片
      if (!imageBlob.type.startsWith('image/')) {
        // 如果 MIME 类型不是图片，尝试强制设置为图片
        imageBlob = new Blob([imageBlob], { type: 'image/jpeg' });
      }
      
      const file = new File([imageBlob], 'image.jpg', { type: imageBlob.type });
      const imageUrlObject = URL.createObjectURL(file);
      
      // 验证图片是否可用
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrlObject;
      });
      
      const newIndex = images.length;
      setImages(prev => [...prev, imageUrlObject]);
      setResults(prev => [...prev, '']);
      setCurrentIndex(newIndex);
      
      await handleFile(file, newIndex);
      
      setShowUrlInput(false);
      setImageUrl('');
    } catch (error) {
      console.error('Error loading image:', error);
      
      // 提供更详细的错误信息
      let errorMessage = '无法加载图片，';
      if (error.message.includes('CORS')) {
        errorMessage += '该图片可能有访问限制。';
      } else if (error.message.includes('network')) {
        errorMessage += '网络连接出现问题。';
      } else {
        errorMessage += '请检查链接是否正确。';
      }
      errorMessage += '\n您可以尝试：\n1. 右键图片另存为后上传\n2. 使用截图工具后粘贴\n3. 复制图片本身而不是链接';
      
      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // 添加处理图片点击的函数
  const handleImageClick = () => {
    setShowModal(true);
  };

  // 添加关闭模态框的函数
  const handleCloseModal = () => {
    setShowModal(false);
  };

  // 在 App 组件中添加复制函数
  const handleCopyText = () => {
    if (results[currentIndex]) {
      navigator.clipboard.writeText(results[currentIndex])
        .then(() => {
          // 可以添加一个临时的成功提示
          const button = document.querySelector('.copy-button');
          const originalText = button.textContent;
          button.textContent = '已复制';
          button.classList.add('copied');
          
          setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
          }, 2000);
        })
        .catch(err => {
          console.error('复制失败:', err);
        });
    }
  };

  // 添加纠错处理函数
  const handleCorrectText = async () => {
    if (!results[currentIndex] || isCorrectingText) return;
    
    setIsCorrectingText(true);
    try {
      const prompt = CORRECTION_PROMPT.replace('{content}', results[currentIndex]);
      
      if (modelType === 'openai') {
        const response = await fetch('https://zangaaa-g2api.hf.space/hf/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer 26e72514-58a7-47fd-b40d-12daef4aec32'
          },
          body: JSON.stringify({
            model: "gemini-1.5-flash-latest",
            messages: [
              {
                role: "user",
                content: prompt
              }
            ],
            max_tokens: 8000,
            stream: true
          })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let correctedText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) {
                  correctedText += content;
                  setResults(prev => {
                    const newResults = [...prev];
                    newResults[currentIndex] = correctedText;
                    return newResults;
                  });
                }
              } catch (e) {
                console.error('Error parsing chunk:', e);
              }
            }
          }
        }
      } else {
        // Gemini API 调用
        const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash-exp",
          generationConfig,
        });

        const result = await model.generateContentStream([prompt]);
        let correctedText = '';

        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          correctedText += chunkText;
          setResults(prev => {
            const newResults = [...prev];
            newResults[currentIndex] = correctedText;
            return newResults;
          });
        }
      }
    } catch (error) {
      console.error('纠错过程出错:', error);
    } finally {
      setIsCorrectingText(false);
    }
  };

  return (
    <div className="app">
      <header>
        <a 
          href="https://github.com/CiZaii" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="github-link"
          style={{ display: isMobile ? 'none' : 'block' }}
        >
          <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32">
            <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
        </a>
        <h1>高精度OCR识别</h1>
        <p>
          {isMobile ? '上传图片、PDF即刻识别文字内容' : (
            <>
              智能识别多国语言及手写体、表格、结构化抽取、数学公式，上传或拖拽图片、pdf即刻识别文字内容，使用的gala佬的api，便宜够快 {' '}
              <a 
                href="https://gala.chataiapi.com" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#1890ff', textDecoration: 'underline' }}
              >
                https://gala.chataiapi.com
              </a>
            </>
          )}
        </p>
      </header>

      <main className={images.length > 0 ? 'has-content' : ''}>
        <div className={`upload-section ${images.length > 0 ? 'with-image' : ''}`}>
          <div
            ref={dropZoneRef}
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onDragEnter={!isMobile ? handleDragEnter : undefined}
            onDragOver={!isMobile ? handleDragOver : undefined}
            onDragLeave={!isMobile ? handleDragLeave : undefined}
            onDrop={!isMobile ? handleDrop : undefined}
          >
            <div className="upload-container">
              <label className="upload-button" htmlFor="file-input">
                {images.length > 0 ? '重新上传' : '上传文件'}
              </label>
              <p className="supported-types">
                支持的格式：PNG、JPG、PDF
              </p>
              <input
                id="file-input"
                type="file"
                accept="image/*,application/pdf"
                onChange={handleImageUpload}
                multiple
                hidden
              />
              {!isMobile && (
                <button 
                  className="url-button" 
                  onClick={() => setShowUrlInput(!showUrlInput)}
                >
                  {showUrlInput ? '取消' : '使用链接'}
                </button>
              )}
            </div>
            
            {showUrlInput && !isMobile && (
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="请输入图片链接"
                  className="url-input"
                />
                <button type="submit" className="url-submit">
                  确认
                </button>
              </form>
            )}
            
            {!images.length > 0 && !showUrlInput && !isMobile && (
              <p className="upload-hint">或将图片拖放到此处</p>
            )}
          </div>
          
          {images.length > 0 && (
            <div className="images-preview">
              <div className="image-navigation">
                <button 
                  onClick={handlePrevImage} 
                  disabled={currentIndex === 0}
                  className="nav-button"
                >
                  ←
                </button>
                <span className="image-counter">
                  {currentIndex + 1} / {images.length}
                </span>
                <button 
                  onClick={handleNextImage}
                  disabled={currentIndex === images.length - 1}
                  className="nav-button"
                >
                  →
                </button>
              </div>
              <div className={`image-preview ${isLoading ? 'loading' : ''}`}>
                <img 
                  src={images[currentIndex]} 
                  alt="预览" 
                  onClick={handleImageClick}
                  style={{ cursor: 'pointer' }}
                />
                {isLoading && <div className="loading-overlay" />}
              </div>
            </div>
          )}
        </div>

        {(results.length > 0 || isLoading) && (
          <div className="result-section">
            <div className="result-container" ref={resultRef}>
              {isLoading && <div className="loading">识别中...</div>}
              {results[currentIndex] && (
                <div className="result-text">
                  <div className="result-header">
                    <span>第 {currentIndex + 1} 张图片的识别结果</span>
                    <div className="result-actions">

                      <button className="copy-button" onClick={handleCopyText}>
                        复制内容
                      </button>
                    </div>
                  </div>
                  <div className="markdown-body">
                    <Viewer 
                      value={results[currentIndex] || ''} 
                      plugins={plugins}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <img src={images[currentIndex]} alt="放大预览" />
            <button className="modal-close" onClick={handleCloseModal}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
