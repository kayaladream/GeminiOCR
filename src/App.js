import React, { useState, useRef, useEffect, useCallback } from 'react'; // 引入基础 Hooks
import { GoogleGenerativeAI } from "@google/generative-ai"; // 引入 Gemini API
import 'katex/dist/katex.min.css'; // 引入 KaTeX 样式
import ReactMarkdown from 'react-markdown'; // 引入 Markdown 渲染组件
import remarkMath from 'remark-math'; // 引入 remark 插件以支持数学公式语法
import rehypeKatex from 'rehype-katex'; // 引入 rehype 插件以使用 KaTeX 渲染数学公式
import { marked } from 'marked'; // <-- 新增：引入 marked 用于 Markdown 转 HTML
import TurndownService from 'turndown'; // <-- 新增：引入 turndown 用于 HTML 转 Markdown
import DOMPurify from 'dompurify'; // <-- 新增：引入 DOMPurify 用于 HTML 清理，防止 XSS
import './App.css'; // 引入 CSS 样式

// --- Gemini API 初始化与配置 (保持不变) ---
const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
const generationConfig = {
  temperature: 0,
  topP: 1,
  topK: 1,
  maxOutputTokens: 8192,
};
// --- Gemini API 初始化与配置结束 ---

// --- 预处理函数 preprocessText (保持不变) ---
const preprocessText = (text) => {
  if (!text) return '';
  const tables = [];
  text = text.replace(/(\|[^\n]+\|\n\|[-|\s]+\|\n\|[^\n]+\|(\n|$))+/g, (match) => {
    tables.push(match);
    return `__TABLE_${tables.length - 1}__`;
  });
  text = text.replace(/\\\\\(/g, '$');
  text = text.replace(/\\\\\)/g, '$');
  text = text.replace(/\\\\\[/g, '$$');
  text = text.replace(/\\\\\]/g, '$$');
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    const content = match.slice(3, -3).trim();
    return content;
  });
  text = text.replace(/```\w*\n?/g, '');
  text = text.replace(/(\d+)\.\s*\n+/g, '$1. ');
  text = text.replace(/\n*\$\$\s*([\s\S]*?)\s*\$\$\n*/g, (match, formula) => {
    return `\n\n$$${formula.trim()}$$\n\n`;
  });
  text = text.replace(/\$\s*(.*?)\s*\$/g, (match, formula) => {
    return `$${formula.trim()}$`;
  });
  text = text.replace(/(\d+\.)\s*(\$\$[\s\S]*?\$\$)/g, '$1\n\n$2');
  text = text.replace(/(\d+)\.\s+/g, '$1.');
  text = text.replace(/(\d+)\)\s+/g, '$1)');
  text = text.replace(/-\s+/g, '-');
  text = text.replace(/\*\s+/g, '*');
  text = text.replace(/\+\s+/g, '+');
  text = text.replace(/>\s+/g, '>');
  text = text.replace(/#\s+/g, '#');
  text = text.replace(/([^\n])\n([^\n])/g, '$1\n\n$2');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/__TABLE_(\d+)__/g, (match, index) => {
    return tables[parseInt(index)];
  });
  return text.trim();
};
// --- 预处理函数 preprocessText 结束 ---

// --- 文件转 Base64 函数 fileToGenerativePart (保持不变) ---
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
// --- 文件转 Base64 函数 fileToGenerativePart 结束 ---

// --- 新增：初始化 Turndown 服务 (用于 HTML 转 Markdown) ---
const turndownService = new TurndownService({
    headingStyle: 'atx', // 标题样式使用 #
    hr: '---', // 水平线样式
    bulletListMarker: '*', // 无序列表标记
    codeBlockStyle: 'fenced', // 代码块样式使用 ```
    emDelimiter: '*', // 斜体标记使用 *
    strongDelimiter: '**', // 粗体标记使用 **
});
// --- 新增：添加 Turndown 规则以尝试保留表格结构 ---
turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
// --- 新增：添加 Turndown 规则以尝试转换 KaTeX 公式回 Markdown ---
// 注意：这个规则比较基础，可能无法完美处理所有复杂的 KaTeX 结构
turndownService.addRule('katex', {
    filter: function (node, options) {
      // 匹配 KaTeX 生成的 display 或 inline 的 span 元素
      return (
        (node.nodeName === 'SPAN' && node.classList.contains('katex-display')) ||
        (node.nodeName === 'SPAN' && node.classList.contains('katex'))
      );
    },
    replacement: function (content, node, options) {
      // 尝试从 KaTeX 的 annotation 中提取原始 LaTeX 公式
      const latexSource = node.querySelector('annotation[encoding="application/x-tex"]');
      if (latexSource) {
        const formula = latexSource.textContent;
        if (node.classList.contains('katex-display')) {
          // 块级公式
          return `\n\n$$${formula}$$\n\n`;
        } else {
          // 行内公式
          return `$${formula}$`;
        }
      }
      // 如果找不到 annotation，或者规则不匹配，返回原始 HTML 或空字符串
      // console.warn("无法从 Katex 转换回 Markdown:", node.outerHTML); // 调试信息
      return node.outerHTML; // 或者返回 '' 或 content
    }
});
// --- 新增：初始化 Turndown 服务结束 ---


function App() {
  // --- 状态 State (大部分保持不变) ---
  const [images, setImages] = useState([]); // 存储图片预览 URL
  const [results, setResults] = useState([]); // 存储每张图片的识别结果 (Markdown 格式)
  const [currentIndex, setCurrentIndex] = useState(0); // 当前显示的图片/结果索引
  const [isLoading, setIsLoading] = useState(false); // 全局加载状态 (上传、URL 处理)
  const [isDragging, setIsDragging] = useState(false); // 拖放区悬停状态
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false); // 全局拖放检测状态
  const resultRef = useRef(null); // 结果区域引用
  const dropZoneRef = useRef(null); // 拖放区域引用
  const [showUrlInput, setShowUrlInput] = useState(false); // 是否显示 URL 输入框
  const [imageUrl, setImageUrl] = useState(''); // URL 输入框内容
  const [showModal, setShowModal] = useState(false); // 是否显示图片放大模态框
  const [streamingText, setStreamingText] = useState(''); // 当前流式传输的文本 (用于实时显示)
  const [isStreaming, setIsStreaming] = useState(false); // 是否正在流式接收识别结果

  // --- 模态框状态 (保持不变) ---
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const [modalScale, setModalScale] = useState(1);

  // --- 编辑模式状态 (修改) ---
  const [isEditing, setIsEditing] = useState(false); // 是否处于编辑模式
  const [editText, setEditText] = useState(''); // 编辑时的 *原始 Markdown* 文本状态
  // const editTextAreaRef = useRef(null); // 旧的: Textarea 引用
  const editDivRef = useRef(null); // <-- 修改：使用 div 的引用来实现富文本编辑

  // --- 文件处理函数 handleFile (保持不变, 内部逻辑未修改) ---
  const handleFile = useCallback(async (file, index) => {
    // ... (内部逻辑完全保持不变，包括调用 API、流式处理、调用 preprocessText) ...
    if (file.type.startsWith('image/')) {
      try {
        setIsStreaming(true);
        setStreamingText('');
        setIsEditing(false);
        setResults(prev => {
          const newResults = [...prev];
          newResults[index] = ''; // 清空当前结果以显示加载
          return newResults;
        });

        let fullText = '';

        if (process.env.NODE_ENV === 'development') {
          const model = genAI.getGenerativeModel({
            model: "gemini-pro-vision",
            generationConfig,
          });
          const imagePart = await fileToGenerativePart(file);
          const rulesPrompt = `
          请你识别图片中的文字内容并输出，需遵循以下规范和要求：

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
          const result = await model.generateContentStream([rulesPrompt, imagePart]);

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;
            const formattedText = preprocessText(fullText);
            setStreamingText(formattedText);
             setResults(prevResults => {
               const newResults = [...prevResults];
               newResults[index] = formattedText;
               return newResults;
             });
          }
          const finalFormattedText = preprocessText(fullText);
          setResults(prevResults => {
            const newResults = [...prevResults];
            newResults[index] = finalFormattedText;
            return newResults;
          });
          setStreamingText(finalFormattedText);

        } else {
          // 生产环境 Vercel API 调用 (保持不变)
          const fileReader = new FileReader();
          const imageData = await new Promise((resolve) => {
            fileReader.onloadend = () => {
              resolve(fileReader.result.split(',')[1]);
            };
            fileReader.readAsDataURL(file);
          });
          const response = await fetch('/api/recognize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData, mimeType: file.type }),
          });

           if (!response.ok || !response.body) {
             const errorText = await response.text();
             throw new Error(`API 请求失败，状态码 ${response.status}: ${errorText || '无详细错误信息'}`);
           }

           const streamReader = response.body.getReader();
           const decoder = new TextDecoder();

           while (true) {
             const { done, value } = await streamReader.read();
             if (done) break;
             const chunk = decoder.decode(value, { stream: true });
             const lines = chunk.split('\n');
             for (const line of lines) {
               if (line.startsWith('data: ')) {
                 try {
                   const rawData = line.slice(6);
                   if (rawData.trim()) {
                     const data = JSON.parse(rawData);
                     if (data.text) {
                       fullText += data.text;
                       const formattedText = preprocessText(fullText);
                       setStreamingText(formattedText);
                        setResults(prevResults => {
                           const newResults = [...prevResults];
                           newResults[index] = formattedText;
                           return newResults;
                         });
                     }
                   }
                 } catch (e) {
                   console.error('解析数据块时出错:', e, '原始数据:', line);
                 }
               }
             }
           }
           const finalFormattedText = preprocessText(fullText);
           setResults(prevResults => {
               const newResults = [...prevResults];
               newResults[index] = finalFormattedText;
               return newResults;
           });
           setStreamingText(finalFormattedText);
        }
        setIsStreaming(false);
      } catch (error) {
        console.error('文件处理或识别出错:', error);
        setResults(prevResults => {
          const newResults = [...prevResults];
          newResults[index] = `识别出错, 请重试 (${error.message || error})`;
          return newResults;
        });
        setIsStreaming(false);
        setIsLoading(false);
      }
    }
  }, []); // 依赖为空，因为它不依赖组件内部可变状态

  // --- 粘贴处理 useEffect (逻辑保持不变, 注意 isEditing 依赖) ---
  useEffect(() => {
    const handlePaste = async (e) => {
      // <-- 修改：检查焦点是否在 contentEditable div 内 -->
      if (isEditing && editDivRef.current && editDivRef.current.contains(e.target)) {
        // 允许在 contentEditable div 内部进行默认粘贴
        // 注意：默认粘贴会插入 HTML，可能需要额外处理或依赖 contentEditable 的行为
        // 如果想完全控制粘贴内容为纯文本，需要在这里阻止默认行为并处理 item.getAsString
        return;
      }
       if (showModal) {
           return;
       }

      e.preventDefault();
      const items = Array.from(e.clipboardData.items);

      for (const item of items) {
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
              setIsEditing(false); // 粘贴新图片时退出编辑模式
              await handleFile(file, newIndex);
            } catch (error) {
              console.error('处理粘贴的图片时出错:', error);
              alert('处理粘贴的图片时发生错误。');
            } finally {
              setIsLoading(false);
            }
          }
        }
        else if (item.type === 'text/plain') {
          item.getAsString(async (text) => {
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
    // 依赖中包含 isEditing，因为粘贴行为在编辑模式下不同
  }, [images.length, handleFile, isEditing, showModal]);

  // --- 并发处理函数 concurrentProcess (保持不变) ---
  const concurrentProcess = async (items, processor, maxConcurrent = 5) => {
    let activePromises = 0;
    const queue = [...items.entries()];
    const executing = new Set();

    return new Promise((resolve) => {
      const processNext = () => {
        while (activePromises < maxConcurrent && queue.length > 0) {
          const [originalIndex, item] = queue.shift();
          activePromises++;
          const promise = processor(item, originalIndex)
            .catch(err => {
              console.error(`处理项目 ${originalIndex} 时出错:`, err);
            })
            .finally(() => {
              activePromises--;
              executing.delete(promise);
              processNext();
            });
          executing.add(promise);
        }
        if (queue.length === 0 && executing.size === 0) {
          resolve();
        }
      };
      processNext();
    });
  };

  // --- 图片上传处理函数 handleImageUpload (保持不变) ---
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsLoading(true);
    try {
      const startIndex = images.length;
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);
      setCurrentIndex(startIndex);
      setIsEditing(false); // 上传新图片退出编辑模式
      await concurrentProcess(
        files,
        (file, fileIndex) => handleFile(file, startIndex + fileIndex),
        5
      );
    } catch (error) {
      console.error('处理上传的文件时出错:', error);
       alert('处理上传的文件时发生错误。请检查文件或稍后重试。');
    } finally {
      setIsLoading(false);
       if(e && e.target) {
            e.target.value = null;
       }
    }
  };

  // --- 图片导航函数 (保持不变) ---
  const handlePrevImage = () => {
    if (currentIndex > 0 && !isLoading && !isStreaming) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      // isEditing 状态会在下面的 currentIndex effect 中被重置
    }
  };
  const handleNextImage = () => {
    if (currentIndex < images.length - 1 && !isLoading && !isStreaming) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      // isEditing 状态会在下面的 currentIndex effect 中被重置
    }
  };

  // --- 全局拖放 useEffect 和处理函数 (保持不变) ---
  useEffect(() => {
    const handleGlobalDragEnter = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { if (!isDraggingGlobal) { setIsDraggingGlobal(true); } } };
    const handleGlobalDragOver = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); };
    const handleGlobalDragLeave = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); if (!e.relatedTarget || e.relatedTarget === null || e.relatedTarget === document.documentElement) { setIsDraggingGlobal(false); setIsDragging(false); } };
    const handleGlobalDrop = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); if (dropZoneRef.current && !dropZoneRef.current.contains(e.target)) { setIsDraggingGlobal(false); setIsDragging(false); } };
    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragover', handleGlobalDragOver);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);
    return () => { /* ... remove listeners ... */ window.removeEventListener('dragenter', handleGlobalDragEnter); window.removeEventListener('dragover', handleGlobalDragOver); window.removeEventListener('dragleave', handleGlobalDragLeave); window.removeEventListener('drop', handleGlobalDrop); };
  }, [isDraggingGlobal]);
  const handleDragEnter = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) { setIsDragging(true); } };
  const handleDragOver = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); };
  const handleDragLeave = (e) => { /* ... */ e.preventDefault(); e.stopPropagation(); if (!dropZoneRef.current.contains(e.relatedTarget)) { setIsDragging(false); } };
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setIsDraggingGlobal(false);
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));

    if (files.length === 0) {
        const items = Array.from(e.dataTransfer.items);
        const linkPromises = items
          .filter(item => item.kind === 'string' && (item.type === 'text/uri-list' || item.type === 'text/plain'))
          .map(item => new Promise(resolve => item.getAsString(resolve)));
        Promise.all(linkPromises).then(urls => {
            const firstImageUrl = urls.find(url => url && url.match(/https?:\/\//i) && url.match(/\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)(\?.*)?$/i));
            if (firstImageUrl) {
                setImageUrl(firstImageUrl);
                setShowUrlInput(true);
            } else if (urls.some(url => url && url.match(/https?:\/\//i))) {
                alert('拖放的链接不是可识别的图片 URL。');
            }
        }).catch(err => {
            console.error("处理拖放的链接时出错:", err);
            alert('处理拖放内容时出错。');
        });
        return;
    }

    setIsLoading(true);
    try {
      const startIndex = images.length;
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);
      setCurrentIndex(startIndex);
      setIsEditing(false); // 拖放上传退出编辑模式
      await concurrentProcess(
        files,
        (file, fileIndex) => handleFile(file, startIndex + fileIndex),
        5
      );
    } catch (error) {
      console.error('处理拖放的文件时出错:', error);
      alert('处理拖放的文件时发生错误。');
    } finally {
      setIsLoading(false);
    }
  };

  // --- URL 提交处理函数 handleUrlSubmit (保持不变) ---
  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!imageUrl) return;
    setIsLoading(true);
    setShowUrlInput(false);
    try {
      let imageBlob;
      let finalUrl = imageUrl;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(finalUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`直接获取失败: ${response.status} ${response.statusText}`);
        imageBlob = await response.blob();
      } catch (directError) {
        console.warn("直接获取失败:", directError);
        const proxyServices = [
           (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        ];
        let proxySuccess = false;
        for (const getProxyUrl of proxyServices) {
          const proxyUrl = getProxyUrl(imageUrl);
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`代理获取失败: ${response.status} ${response.statusText}`);
            imageBlob = await response.blob();
            if (!imageBlob.type || !imageBlob.type.startsWith('image/')) {
                throw new Error(`代理返回的不是有效的图片类型: ${imageBlob.type || '未知类型'}`);
            }
            proxySuccess = true;
            break;
          } catch (proxyError) {
            console.warn(`代理获取失败 (${proxyUrl}):`, proxyError);
          }
        }
        if (!proxySuccess) {
            throw new Error('直接获取和通过代理获取均失败。可能由于 CORS 限制、网络问题或无效链接导致无法加载图片。');
        }
      }

      if (!imageBlob || !imageBlob.type.startsWith('image/')) {
        throw new Error(`获取到的内容不是有效的图片类型: ${imageBlob.type || '未知类型'}`);
      }
      const filename = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0] || 'image_from_url.jpg';
      const file = new File([imageBlob], filename, { type: imageBlob.type });
      const imageUrlObject = URL.createObjectURL(file);

      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = (errEvent) => {
          URL.revokeObjectURL(imageUrlObject);
          console.error("Image load error from Object URL:", errEvent);
          reject(new Error('无法从对象 URL 加载图片，可能是无效的图片数据。'));
        };
        img.src = imageUrlObject;
      });

      const newIndex = images.length;
      setImages(prev => [...prev, imageUrlObject]);
      setResults(prev => [...prev, '']);
      setCurrentIndex(newIndex);
      setIsEditing(false); // URL 上传退出编辑模式
      await handleFile(file, newIndex);
      setImageUrl('');

    } catch (error) {
      console.error('从 URL 加载图片时出错:', error);
      alert(`无法加载图片: ${error.message}\n\n请检查链接是否正确且指向公开可访问的图片文件。\n\n您也可以尝试：\n1. 右键图片另存为后上传\n2. 使用截图工具后粘贴`);
      setShowUrlInput(true);
    } finally {
      setIsLoading(false);
    }
  };

  // --- 图片点击放大、关闭模态框处理函数 (保持不变) ---
  const handleImageClick = () => {
    if (!images[currentIndex]) return;
    setModalPosition({ x: 0, y: 0 });
    setModalScale(1);
    setShowModal(true);
  };
  const handleCloseModal = () => {
    setShowModal(false);
  };

  // --- 复制文本处理函数 handleCopyText (逻辑不变: 编辑模式复制 editText, 否则复制 results[currentIndex]) ---
  const handleCopyText = () => {
    // <-- 修改：现在 editText 在编辑模式下也是原始 Markdown -->
    const textToCopy = isEditing ? editText : results[currentIndex];
    if (textToCopy != null && !isStreaming) {
        // 移除 Markdown 获取纯文本 (保持不变)
        const plainText = textToCopy
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`(.*?)`/g, '$1')
            .replace(/~~(.*?)~~/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/\n{2,}/g, '\n');

        navigator.clipboard.writeText(plainText.trim())
            .then(() => {
                const button = document.querySelector('.copy-button.copied') || document.querySelector('.copy-button'); // 查找当前活动的复制按钮
                 if (button) {
                     const originalText = button.dataset.originalText || button.textContent; // 优先从 data 属性获取，或从文本内容获取
                     button.dataset.originalText = originalText; // 存储原始文本
                     button.textContent = '已复制';
                     button.classList.add('copied');
                     setTimeout(() => {
                         const currentButton = document.querySelector('.copy-button.copied');
                         if (currentButton && currentButton.textContent === '已复制') {
                             currentButton.textContent = currentButton.dataset.originalText || '复制内容'; // 恢复
                             currentButton.classList.remove('copied');
                             delete currentButton.dataset.originalText; // 清理
                         }
                     }, 1500);
                 }
            })
            .catch(err => {
                console.error('复制失败:', err);
                alert('复制失败，您的浏览器可能不支持或权限不足，请尝试手动复制。');
            });
    }
};


  // --- 模态框拖拽、滚轮、全局事件监听 (保持不变) ---
  const handleModalMouseDown = (e) => { /* ... */ if (e.target.classList.contains('modal-close') || e.button !== 0) { return; } const isTouchEvent = e.touches && e.touches.length > 0; const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX; const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY; e.preventDefault(); setIsDraggingModal(true); setModalOffset({ x: clientX - modalPosition.x, y: clientY - modalPosition.y, }); const modalContent = e.currentTarget; if (modalContent) { modalContent.style.cursor = 'grabbing'; modalContent.style.transition = 'none'; } };
  const handleModalWheel = (e) => { /* ... */ e.preventDefault(); const zoomSensitivity = 0.001; const minScale = 0.1; const maxScale = 10; const scaleChange = -e.deltaY * zoomSensitivity * modalScale; setModalScale(prevScale => { let newScale = prevScale + scaleChange; newScale = Math.max(minScale, Math.min(newScale, maxScale)); return newScale; }); if (e.currentTarget) { e.currentTarget.style.transition = 'transform 0.1s ease-out'; } };
  useEffect(() => {
    const handleMove = (e) => { /* ... */ const isTouchEvent = e.touches && e.touches.length > 0; const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX; const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY; setModalPosition({ x: clientX - modalOffset.x, y: clientY - modalOffset.y, }); };
    const handleEnd = () => { /* ... */ setIsDraggingModal(false); const modalContent = document.querySelector('.modal-content'); if (modalContent) { modalContent.style.cursor = 'grab'; modalContent.style.transition = 'transform 0.1s ease-out'; } };
    if (isDraggingModal) { /* ... add listeners ... */ window.addEventListener('mousemove', handleMove, { capture: true }); window.addEventListener('mouseup', handleEnd, { capture: true }); window.addEventListener('touchmove', handleMove, { passive: false }); window.addEventListener('touchend', handleEnd); }
    return () => { /* ... remove listeners ... */ window.removeEventListener('mousemove', handleMove, { capture: true }); window.removeEventListener('mouseup', handleEnd, { capture: true }); window.removeEventListener('touchmove', handleMove); window.removeEventListener('touchend', handleEnd); };
  }, [isDraggingModal, modalOffset]);


  // --- 编辑模式处理函数 (修改) ---

  // 点击“编辑”按钮
  const handleEditClick = () => {
      if (!isStreaming && results[currentIndex] != null) {
          const currentMarkdown = results[currentIndex];
          setEditText(currentMarkdown); // <-- 修改：将当前结果的 *原始 Markdown* 存入 editText 状态
          setIsEditing(true); // 进入编辑模式
          // 注意：实际的 HTML 渲染和聚焦操作将在下面的 useEffect 中完成
      }
  };

  // --- 新增：useEffect 用于处理进入编辑模式时的内容渲染和聚焦 ---
  useEffect(() => {
      if (isEditing && editDivRef.current) {
          // 1. 将存储的 Markdown (editText) 转换为 HTML
          // 使用 marked.parse (新版本用法)
          const rawHtml = marked.parse(editText || '', { breaks: true }); // 启用 GFM 换行符

          // 2. 清理 HTML (安全起见)
          const safeHtml = DOMPurify.sanitize(rawHtml);

          // 3. 将清理后的 HTML 设置为 contentEditable div 的内容
          editDivRef.current.innerHTML = safeHtml;

          // 4. 聚焦并将光标移到末尾 (使用 setTimeout 确保 DOM 更新完成)
           setTimeout(() => {
              if (editDivRef.current) {
                  editDivRef.current.focus();
                  // 尝试将光标移到末尾 (兼容性可能略有差异)
                  const range = document.createRange();
                  const sel = window.getSelection();
                  if(sel && editDivRef.current.childNodes.length > 0) { // 检查是否有子节点
                       // 选择最后一个子节点的末尾
                       range.setStart(editDivRef.current.childNodes[editDivRef.current.childNodes.length - 1], editDivRef.current.childNodes[editDivRef.current.childNodes.length - 1].textContent?.length ?? 0);
                       range.collapse(true); // 折叠到起始点 (即末尾)
                       sel.removeAllRanges();
                       sel.addRange(range);
                  } else if (sel) { // 如果没有子节点，直接聚焦
                       range.selectNodeContents(editDivRef.current);
                       range.collapse(false); // 折叠到容器末尾
                       sel.removeAllRanges();
                       sel.addRange(range);
                  }
              }
           }, 50); // 短暂延迟
      } else if (!isEditing && editDivRef.current) {
          // 如果退出编辑模式，清空编辑区内容 (可选)
          // editDivRef.current.innerHTML = '';
      }
    // 依赖 isEditing。当 isEditing 变化时触发此 effect。
    // 注意：不依赖 editText，因为 editText 的变化应该由用户输入触发，并通过 onInput 处理。
    // 如果依赖 editText，会导致每次输入都重新渲染整个 HTML，光标会跳动。
  }, [isEditing]);

  // --- 新增：处理 contentEditable div 的输入事件 ---
  const handleInput = (e) => {
      // 1. 获取当前编辑器的 HTML 内容
      const currentHtml = e.currentTarget.innerHTML;

      // 2. 将 HTML 转换回 Markdown
      const newMarkdown = turndownService.turndown(currentHtml);

      // 3. 更新存储 *原始 Markdown* 的状态 (editText)
      // ！！非常重要：这里只更新 state，不修改 e.currentTarget.innerHTML
      // 否则会覆盖用户的输入，导致无法正常编辑
      setEditText(newMarkdown);
  };


  // 点击“保存”按钮
  const handleSaveEdit = () => {
      // <-- 修改：editText 已经是 handleInput 更新后的最新 Markdown -->
      setResults(prevResults => {
          const newResults = [...prevResults];
          // 直接使用 editText 中最新的 Markdown 更新结果数组
          newResults[currentIndex] = editText;
          return newResults;
      });
      setIsEditing(false); // 退出编辑模式
      // streamingText 不需要显式设置，视图模式会读取更新后的 results
  };

  // 点击“取消”按钮
  const handleCancelEdit = () => {
      setIsEditing(false); // 退出编辑模式
      setEditText(''); // 清空临时 Markdown 状态
      // editDivRef 的内容会在 isEditing 变化的 useEffect 中被处理 (如果需要清空的话)
  };

  // // 编辑区域文本变化 (这个函数不再需要，因为我们使用 onInput)
  // const handleEditTextChange = (e) => {
  //     setEditText(e.target.value);
  // };

  // --- useEffect: 切换图片时退出编辑模式 (逻辑微调) ---
  useEffect(() => {
      // 当 currentIndex 变化时（切换图片）
      setIsEditing(false); // 退出编辑模式
      setEditText('');     // 清空临时编辑 Markdown 状态

      // 更新流式文本/显示文本状态以反映新选中的图片的结果
      // 如果新图片有结果，则显示结果；否则显示空字符串（或加载提示，如果适用）
      // 这里的 results[currentIndex] 已经是处理过的 Markdown
      setStreamingText(results[currentIndex] || '');

    // 依赖于 currentIndex 和 results 数组 (当 results 更新时，例如识别完成，也需要更新显示)
  }, [currentIndex, results]);


  // --- JSX 渲染 ---
  return (
    <div className="app">
       <header>
         {/* GitHub 链接 (保持不变) */}
        <a
          href="https://github.com/kayaladream/GeminiOCR"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          title="在 GitHub 上查看源码"
        >
           <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32">
             <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
           </svg>
        </a>
         {/* 标题和描述 (保持不变) */}
        <h1>GeminiOCR - 高精度OCR识别</h1>
        <p>
            智能识别多国语言及手写字体、表格等。识别出的表格是 Markdown 格式，请到{' '}
            <a href="https://tableconvert.com/zh-cn/markdown-to-markdown" target="_blank" rel="noopener noreferrer">
                这里
            </a>{' '}
            在线转换。
        </p>
      </header>

      {/* 主内容区 */}
      <main className={images.length > 0 ? 'has-content' : ''}>
         {/* 上传区域 (保持不变) */}
         <div className={`upload-section ${images.length > 0 ? 'with-image' : ''}`}>
          <div
            ref={dropZoneRef}
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="图片上传区域"
          >
            <div className="upload-container">
              <label className="upload-button" htmlFor="file-input">
                {images.length > 0 ? '添加新的图片' : '上传图片'}
              </label>
              <input
                id="file-input" type="file" accept="image/*" onChange={handleImageUpload} multiple hidden aria-hidden="true"
              />
              <button
                type="button" className="url-button" onClick={() => setShowUrlInput(!showUrlInput)} aria-expanded={showUrlInput}
              >
                {showUrlInput ? '取消链接输入' : '使用链接上传'}
              </button>
            </div>
            {showUrlInput && (
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                  type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="粘贴图片链接 (URL)" className="url-input" required aria-label="图片链接输入框"
                />
                <button type="submit" className="url-submit">确认</button>
              </form>
            )}
            {!images.length && !isDragging && !showUrlInput && (
              <p className="upload-hint">或将图片拖放到此处 / 粘贴图片</p>
            )}
             {isDragging && (
                <div className="dragging-overlay-text">松开即可上传图片</div>
            )}
          </div>
          {isDraggingGlobal && (
              <div className="drag-overlay active"></div>
          )}
          {images.length > 0 && (
            <div className="images-preview">
               <div className="image-navigation">
                <button onClick={handlePrevImage} disabled={currentIndex === 0 || isLoading || isStreaming} className="nav-button" aria-label="上一张图片">←</button>
                <span className="image-counter" aria-live="polite">{currentIndex + 1} / {images.length}</span>
                <button onClick={handleNextImage} disabled={currentIndex === images.length - 1 || isLoading || isStreaming} className="nav-button" aria-label="下一张图片">→</button>
               </div>
              <div className={`image-preview ${(isLoading || isStreaming) && !results[currentIndex] && !isEditing ? 'loading' : ''}`}>
                <img
                  key={images[currentIndex]} src={images[currentIndex]} alt={`预览 ${currentIndex + 1}`} onClick={handleImageClick} style={{ cursor: images[currentIndex] ? 'zoom-in' : 'default' }}
                  onError={(e) => { console.error("加载图片失败:", images[currentIndex]); e.target.alt = '图片加载失败'; e.target.style.display = 'none'; e.target.closest('.image-preview')?.classList.add('load-error'); }}
                />
                {(isLoading || isStreaming) && !results[currentIndex] && !isEditing &&
                    <div className="loading-overlay">
                        {isStreaming ? '识别中...' : (isLoading ? '处理中...' : '')}
                    </div>
                }
              </div>
            </div>
          )}
        </div>

        {/* 结果显示区域 */}
        {(images.length > 0 || isLoading || isStreaming) && (
          <div className="result-section">
            <div className="result-container" ref={resultRef}>
                {/* 初始加载提示 (保持不变) */}
                {isLoading && !isStreaming && results[currentIndex] == null && !isEditing &&
                    <div className="loading result-loading">等待识别...</div>
                }

                 {/* --- 显示 视图模式 或 编辑模式 --- */}

                 {/* 视图模式 (逻辑不变) */}
                 {((results[currentIndex] != null && !isEditing) || isStreaming) && ! (isLoading && !isStreaming && results[currentIndex] == null && !isEditing) && (
                    <div className="result-text">
                      <div className="result-header">
                        <span aria-live="polite">
                            第 {currentIndex + 1} 张图片的识别结果 {isStreaming ? '(识别中...)' : ''}
                        </span>
                         {results[currentIndex] != null && !isStreaming && !isEditing && (
                            <div style={{ display: 'flex', gap: '8px'}}>
                                <button className="edit-button" onClick={handleEditClick}>编辑</button>
                                {/* <-- 修改：确保复制按钮有唯一的 class 或 ID --> */}
                                <button className="copy-button view-copy-button" onClick={handleCopyText}>复制内容</button>
                            </div>
                         )}
                      </div>
                       <div className="gradient-text">
                         <ReactMarkdown
                           remarkPlugins={[remarkMath]}
                           rehypePlugins={[rehypeKatex]}
                           components={{
                             table: ({ node, ...props }) => (<div style={{ overflowX: 'auto', maxWidth: '100%' }}><table className="markdown-table" {...props} /></div>),
                             th: ({ node, ...props }) => (<th className="markdown-th" {...props} />),
                             td: ({ node, ...props }) => (<td className="markdown-td" {...props} />),
                           }}
                         >
                           {isStreaming ? streamingText : (results[currentIndex] || '')}
                         </ReactMarkdown>
                       </div>
                    </div>
                 )}

                {/* --- 编辑模式 (修改：使用 contentEditable div) --- */}
                {isEditing && (
                    <div className="result-text editing-area">
                         <div className="result-header">
                            <span>编辑第 {currentIndex + 1} 张图片的结果</span>
                            <div>
                                <button className="save-button" onClick={handleSaveEdit}>保存</button>
                                <button className="cancel-button" onClick={handleCancelEdit}>取消</button>
                                 {/* <-- 修改：确保复制按钮有唯一的 class 或 ID --> */}
                                 <button className="copy-button edit-copy-button" onClick={handleCopyText}>复制编辑内容</button>
                            </div>
                        </div>
                        {/* --- 修改：用 div 替换 textarea --- */}
                        <div
                            ref={editDivRef} // 使用新的 ref
                            contentEditable={true} // 开启内容编辑功能
                            className="edit-content-editable" // 应用新的 CSS 类
                            onInput={handleInput} // 绑定输入事件处理器 (HTML -> Markdown)
                            // 阻止 React 关于 contentEditable 的警告
                            suppressContentEditableWarning={true}
                            aria-label={`编辑识别结果 ${currentIndex + 1}`}
                            spellCheck="false" // 可选：禁用浏览器拼写检查
                            // 注意：不再需要 value 和 onChange
                        />
                        {/* <textarea
                            ref={editTextAreaRef} // 旧的 ref
                            value={editText} // 旧的 value 绑定
                            onChange={handleEditTextChange} // 旧的 change handler
                            className="edit-textarea"
                            aria-label={`编辑识别结果 ${currentIndex + 1}`}
                        /> */}
                        {/* --- 修改结束 --- */}
                    </div>
                )}

                {/* 无结果占位符 (保持不变) */}
                {!isLoading && !isStreaming && results[currentIndex] == null && !isEditing && images.length > 0 && (
                    <div className="result-placeholder">当前图片无识别结果或识别失败。</div>
                )}
            </div>
          </div>
        )}
      </main>

      {showModal && images[currentIndex] && (
        // modal-overlay 保持原样 (包括 pointer-events: none)
        <div className="modal-overlay">
          <div
            className="modal-content"
            // onClick 不需要，因为 overlay 是 pointer-events: none
            onMouseDown={handleModalMouseDown}
            onWheel={handleModalWheel}
            onTouchStart={handleModalMouseDown}
            style={{
              transform: `translate(${modalPosition.x}px, ${modalPosition.y}px) scale(${modalScale})`,
              cursor: isDraggingModal ? 'grabbing' : 'grab',
              transition: isDraggingModal ? 'none' : 'transform 0.1s ease-out',
              touchAction: 'none',
              userSelect: 'none',
              // 确保 modal-content 有 relative 定位，以便内部 absolute 定位的按钮正确参考
              // 如果 CSS 中没有，可以在这里加，但最好在 CSS 文件中处理
              // position: 'relative',
            }}
          >
            <img src={images[currentIndex]} alt="放大预览" draggable="false" style={{ pointerEvents: 'none', userSelect: 'none' }} />
            {/* 关闭按钮作为 modal-content 的子元素 */}
            <button
              className="modal-close" aria-label="关闭预览" onClick={handleCloseModal}
              // 阻止点击按钮时触发 mousedown/touchstart 导致图片拖动
              onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
            >×</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
