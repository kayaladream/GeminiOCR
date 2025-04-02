import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'katex/dist/katex.min.css';
// import { InlineMath, BlockMath } from 'react-katex'; // 如果在其他地方需要，保留此行，否则删除
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import './App.css';

// --- (保留从 GoogleGenerativeAI 初始化到 preprocessText 函数的现有代码) ---
// 初始化 Gemini API
const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);

// 添加 generationConfig 配置
const generationConfig = {
  temperature: 0,  // 降低随机性
  topP: 1,
  topK: 1,
  maxOutputTokens: 8192,
};

// 预处理函数
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

  // 处理以 "数字 + 句点 + 空格" 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/(\d+)\.\s+/g, '$1.');

  // 处理以 "数字 + 右括号 + 空格" 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/(\d+)\)\s+/g, '$1)');

  // 处理以 "- " 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/-\s+/g, '-');

  // 处理以 "* " 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/\*\s+/g, '*');

  // 处理以 "+ " 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/\+\s+/g, '+');

  // 处理以 "> " 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/\>\s+/g, '>');

  // 处理以 "# " 开头的行，去掉空格，避免被解析为有序列表
  text = text.replace(/\#\s+/g, '#');

  // 处理段落之间的换行
  text = text.replace(/([^\n])\n([^\n])/g, '$1\n\n$2'); // 确保段落之间有两个换行符
  text = text.replace(/\n{3,}/g, '\n\n'); // 避免多余的空行

  // 还原表格内容
  text = text.replace(/__TABLE_(\d+)__/g, (match, index) => {
    return tables[parseInt(index)];
  });

  return text.trim();
};


function App() {
  const [images, setImages] = useState([]);
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false); // 用于拖放区域状态
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false); // 用于全局拖放检测
  const resultRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // --- 模态框新增状态 ---
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 }); // 鼠标点击位置相对于模态框左上角的偏移量
  const [modalScale, setModalScale] = useState(1);
  // --- 模态框新增状态结束 ---

  // --- (保留现有的粘贴处理 useEffect) ---
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
              console.error('处理粘贴的图片时出错:', error);
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
  }, [images.length]); // 保持原有的依赖项

  // --- (保留现有的 fileToGenerativePart 函数) ---
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

  // --- (保留现有的 handleFile 函数) ---
   const handleFile = async (file, index) => {
    if (file.type.startsWith('image/')) {
      try {
        setIsStreaming(true);
        setStreamingText('');
        setResults(prev => {
          const newResults = [...prev];
          newResults[index] = ''; // 清空当前索引的结果以显示加载状态
          return newResults;
        });

        let fullText = '';

        // 判断是开发环境还是生产环境
        if (process.env.NODE_ENV === 'development') {
          // 开发环境：直接调用 Gemini API
          const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
          const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash", // 更新的模型名称
            generationConfig,
          });

          const imagePart = await fileToGenerativePart(file);

          // 识别规则 (保持不变)
          const rulesPrompt = `
          Please identify the text content in the image and strictly follow these rules for output:

          1. Math Formula Specification:
             - Use $$ for standalone math formulas, without adding extra line breaks.
             - Use $ for inline math formulas, ensuring spaces around them if adjacent to text.
             - Keep original variable names.

          2. Formatting Requirements:
             - Each standalone formula should be on its own line.
             - Ensure line breaks between formulas.
             - Ensure spaces separate formulas from text.
             - Preserve the original paragraph structure.

          3. Example Format:
             This is an inline formula $x^2$ example.

             This is a standalone formula:
             $$f(x) = x^2 + 1$$

             This is the next paragraph...

          4. Special Attention:
             - Do not omit any formulas or text.
             - Maintain the original layout structure.
             - Ensure correct separation between formulas.
             - Ensure space between numbering and formulas.

          5. If the image contains table-like content, use standard Markdown table syntax. Example:
             | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
             |---------------|---------|-------|----------|
             | Copy Writing  | $50/hr  | 4     | $200.00  |
             | Website Design| $50/hr  | 2     | $100.00  |
             - Use "|-" separator row between header and cells, with at least three "-" per column for alignment.
             - Include currency symbols and decimal points in amounts.
             - Do not ignore text outside the table if a table is identified.

          6. Paragraph Requirements:
             - Separate paragraphs with two newline characters for correct Markdown rendering.

          7. Output content directly without any explanations.
          `;

          // 将规则和图片部分一起发送
          const result = await model.generateContentStream([rulesPrompt, imagePart]);

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;

            // 确保每个分段之间有两个换行符
            const formattedText = preprocessText(fullText);

            setStreamingText(formattedText); // 实时更新流式文本
            // 注意：这里可能不需要立即更新 results 数组，可以在流结束后一次性更新
            // 但如果希望在流式显示时也能看到部分结果，可以保留
             setResults(prevResults => {
               const newResults = [...prevResults];
               newResults[index] = formattedText; // 更新对应索引的结果
               return newResults;
             });
          }
          // 流结束后，确保最终结果被设置
          const finalFormattedText = preprocessText(fullText);
          setResults(prevResults => {
            const newResults = [...prevResults];
            newResults[index] = finalFormattedText;
            return newResults;
          });
          setStreamingText(finalFormattedText); // 确保 streamingText 也是最终结果


        } else {
          // 生产环境：通过 Vercel API 调用
          const fileReader = new FileReader();
          const imageData = await new Promise((resolve) => {
            fileReader.onloadend = () => {
              resolve(fileReader.result.split(',')[1]);
            };
            fileReader.readAsDataURL(file);
          });

          const response = await fetch('/api/recognize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imageData,
              mimeType: file.type
            }),
          });

           // 检查响应是否成功且响应体可读
           if (!response.ok || !response.body) {
             const errorText = await response.text();
             throw new Error(`API 请求失败，状态码 ${response.status}: ${errorText}`);
           }

           const streamReader = response.body.getReader();
           const decoder = new TextDecoder(); // 定义一次解码器

           while (true) {
             const { done, value } = await streamReader.read();
             if (done) break;

             const chunk = decoder.decode(value, { stream: true }); // 解码数据块
             const lines = chunk.split('\n');

             for (const line of lines) {
               if (line.startsWith('data: ')) {
                 try {
                   const rawData = line.slice(6);
                   // 解析前检查原始数据是否为空
                   if (rawData.trim()) {
                     const data = JSON.parse(rawData);
                     // 确保 text 属性存在
                     if (data.text) {
                       fullText += data.text;

                       // 确保每个分段之间有两个换行符
                       const formattedText = preprocessText(fullText);

                       setStreamingText(formattedText); // 实时更新流式文本
                       // 同样，根据需求决定是否实时更新 results
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
           // 流结束后，确保最终结果被设置
           const finalFormattedText = preprocessText(fullText);
           setResults(prevResults => {
               const newResults = [...prevResults];
               newResults[index] = finalFormattedText;
               return newResults;
           });
           setStreamingText(finalFormattedText); // 确保 streamingText 也是最终结果
        }

        setIsStreaming(false); // 流处理完成

      } catch (error) {
        console.error('文件处理或识别出错:', error);
        setResults(prevResults => {
          const newResults = [...prevResults];
          // 显示错误信息
          newResults[index] = `识别出错, 请重试 (${error.message || error})`;
          return newResults;
        });
        setIsStreaming(false); // 确保出错时停止流式加载
        setIsLoading(false);   // 确保出错时停止全局加载状态
      }
    }
  };

  // --- (保留现有的并发处理函数) ---
  const concurrentProcess = async (items, processor, maxConcurrent = 5) => {
    // const results = []; // 这个 results 似乎没有被使用，可以考虑移除
    let activePromises = 0;
    const queue = [...items.entries()]; // 使用 entries 轻松获取索引和项目
    const executing = new Set(); // 跟踪正在执行的 Promise

    return new Promise((resolve) => {
      const processNext = () => {
        // 当活跃的 Promise 少于最大并发数且队列中还有项目时，启动新的处理
        while (activePromises < maxConcurrent && queue.length > 0) {
          const [index, item] = queue.shift(); // 获取队列中的下一个项目及其原始索引
          activePromises++;
          const promise = processor(item, index) // 调用处理函数，传入项目和索引
            .catch(err => { // 添加错误处理，防止单个错误中断整个过程
              console.error(`处理项目 ${index} 时出错:`, err);
              // 可以选择在这里设置对应索引的错误状态
              // setResults(prev => { ... prev[index] = '处理失败'; ... });
            })
            .finally(() => {
              activePromises--; // 处理完成（无论成功或失败）
              executing.delete(promise); // 从执行集合中移除
              processNext(); // 尝试处理下一个项目
            });
          executing.add(promise); // 将新的 Promise 添加到执行集合中
        }

        // 当队列为空且没有正在执行的 Promise 时，表示所有处理已完成
        if (queue.length === 0 && executing.size === 0) {
          resolve(); // 解决 Promise
        }
      };

      processNext(); // 开始处理
    });
  };


  // --- (保留现有的 handleImageUpload 函数) ---
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return; // 没有选择文件

    setIsLoading(true); // 开始全局加载状态

    try {
      const startIndex = images.length;  // 获取当前图片数量作为新图片的起始索引

      // 先一次性更新所有图片预览 URL
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);

      // 初始化新图片的结果为空字符串
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);

      // 立即切换到上传的第一张新图片
      setCurrentIndex(startIndex);

      // 使用并发控制处理文件，传递文件和它在 *全局* 结果数组中的最终索引
      await concurrentProcess(
        files, // 要处理的文件数组
        (file, fileIndex) => handleFile(file, startIndex + fileIndex), // 处理函数，计算全局索引
        5 // 最大并发数
      );
    } catch (error) {
      console.error('处理上传的文件时出错:', error);
      // （可选）向用户显示错误消息
       alert('处理上传的文件时发生错误。');
    } finally {
      setIsLoading(false); // 结束全局加载状态
       // 清除文件输入框的值，以便可以再次上传同一个文件
       e.target.value = null;
    }
  };


  // --- (保留现有的图片导航函数) ---
  const handlePrevImage = () => {
    if (currentIndex > 0 && !isLoading) { // 增加 !isLoading 条件防止加载时切换
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      // 更新流式文本为上一张图片的已有结果（如果有的话）
      setStreamingText(results[prevIndex] || '');
    }
  };

  const handleNextImage = () => {
    if (currentIndex < images.length - 1 && !isLoading) { // 增加 !isLoading 条件
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
       // 更新流式文本为下一张图片的已有结果（如果有的话）
      setStreamingText(results[nextIndex] || '');
    }
  };

  // --- (保留现有的全局拖放 useEffect 和处理函数) ---
  useEffect(() => {
    const handleGlobalDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 仅当 dataTransfer 包含文件时才设置拖拽状态
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        if (!isDraggingGlobal) {
          setIsDraggingGlobal(true);
          setIsDragging(true); // 同时在放置区指示拖拽状态
        }
      }
    };

    const handleGlobalDragOver = (e) => {
        e.preventDefault(); // 必须阻止默认行为以允许放置
        e.stopPropagation();
    };

    const handleGlobalDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 检查鼠标是否离开窗口 (更可靠的方式是检查 relatedTarget)
      if (!e.relatedTarget || e.relatedTarget === null) {
         setIsDraggingGlobal(false);
         setIsDragging(false);
      }
    };

    const handleGlobalDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 检查放置是否发生在指定的放置区之外
      if (dropZoneRef.current && !dropZoneRef.current.contains(e.target)) {
          // 如果放置在区域外但仍打算用于应用程序，则在此处处理
          // 目前，仅重置拖拽状态
          setIsDraggingGlobal(false);
          setIsDragging(false);
          // 如果希望允许在任何地方放置，可以将 handleDrop 的逻辑移到这里处理
          // handleDrop(e); // 示例：在任何地方处理放置
      } else {
          // 如果在放置区内，让放置区的 handleDrop 管理状态
          // 放置区的 handleDrop 应将 isDraggingGlobal 和 isDragging 设置为 false
      }
    };

    // 添加全局监听器
    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragover', handleGlobalDragOver); // 添加 dragover 监听器
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);

    // 清理函数：移除监听器
    return () => {
      window.removeEventListener('dragenter', handleGlobalDragEnter);
      window.removeEventListener('dragover', handleGlobalDragOver);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [isDraggingGlobal]); // 依赖数组

  // 放置区特定的拖拽进入处理
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 仅当拖动的是文件时设置拖拽状态
    if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true);
    }
  };

  // 放置区特定的拖拽悬停处理
  const handleDragOver = (e) => {
    e.preventDefault(); // 这对于允许放置至关重要
    e.stopPropagation();
  };

  // 放置区特定的拖拽离开处理
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 检查是否离开放置区元素本身，而不仅仅是子元素
    if (e.currentTarget.contains(e.relatedTarget)) {
      return; // 仍然在放置区内
    }
    setIsDragging(false); // 离开放置区，取消拖拽状态
  };

  // 放置区特定的放置处理
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false); // 重置放置区特定的拖拽状态
    setIsDraggingGlobal(false); // 重置全局拖拽状态

    // 筛选出拖放的文件中的图片文件
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));

    // 如果没有图片文件，检查是否是链接
    if (files.length === 0) {
        const items = Array.from(e.dataTransfer.items);
        let linkFound = false;
        for (const item of items) {
            // 检查是否是 URI 列表（通常是链接）
            if (item.kind === 'string' && item.type === 'text/uri-list') {
                item.getAsString((url) => {
                    // 检查它是否像图片 URL
                    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                        setImageUrl(url); // 设置图片 URL 状态
                        setShowUrlInput(true); // 显示 URL 输入区域
                        linkFound = true;
                        // （可选）立即触发表单提交:
                        // handleUrlSubmit({ preventDefault: () => {} }); // 如果需要，传递一个模拟事件
                    } else {
                        alert('拖放的链接不是可识别的图片 URL。');
                    }
                });
                break; // 找到链接后停止检查
            }
        }
        // 如果既没有图片文件，也没有找到有效的图片链接
        if (!linkFound) {
             alert('请拖放图片文件或图片链接。');
        }
        return; // 停止处理
    }

    // 如果找到了图片文件
    setIsLoading(true); // 启动加载指示器

    try {
      const startIndex = images.length; // 获取新图片的起始索引

      // 创建对象 URL 用于预览
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]); // 添加新图片预览
      setResults(prev => [...prev, ...new Array(files.length).fill('')]); // 初始化结果
      setCurrentIndex(startIndex); // 转到第一个拖放的图片

      // 并发处理文件
      await concurrentProcess(
        files,
        (file, fileIndex) => handleFile(file, startIndex + fileIndex) // 传递正确的全局索引
      );
    } catch (error) {
      console.error('处理拖放的文件时出错:', error);
      alert('处理拖放的文件时发生错误。');
    } finally {
      setIsLoading(false); // 停止加载指示器
    }
  };

  // --- (保留现有的 handleUrlSubmit 函数) ---
  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!imageUrl) return;
    setIsLoading(true); // 开始加载
    setShowUrlInput(false); // 立即隐藏输入框

    try {
      let imageBlob;
      let finalUrl = imageUrl;

      // 1. 首先尝试直接获取
      try {
        console.log("尝试直接获取:", finalUrl);
        // 添加超时设置
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
        const response = await fetch(finalUrl, { signal: controller.signal });
        clearTimeout(timeoutId); // 清除超时
        if (!response.ok) throw new Error(`直接获取失败: ${response.statusText}`);
        imageBlob = await response.blob();
        console.log("直接获取成功。");
      } catch (directError) {
        console.warn("直接获取失败:", directError);

        // 2. 如果直接获取失败，尝试 CORS 代理
        const proxyServices = [
           // 如果需要，添加更可靠的代理
           (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`, // 通常可靠
           (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // 另一个选项
        ];

        let proxySuccess = false;
        for (const getProxyUrl of proxyServices) {
          const proxyUrl = getProxyUrl(imageUrl);
          try {
            console.log("尝试通过代理获取:", proxyUrl);
             // 添加超时设置
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 代理超时时间稍长
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`代理获取失败: ${response.statusText}`);
            imageBlob = await response.blob();
            console.log("代理获取成功。");
            proxySuccess = true;
            break; // 成功时退出循环
          } catch (proxyError) {
            console.warn("代理获取失败:", proxyError);
            // 继续尝试下一个代理
          }
        }

        // 3. 如果所有方法都失败了，通知用户
        if (!proxySuccess) {
            throw new Error('直接获取和代理获取均失败。由于潜在的 CORS 限制或网络问题，无法加载图片。');
        }
      }

      // 确保获取的内容是图片类型
      if (!imageBlob || !imageBlob.type.startsWith('image/')) {
        throw new Error('获取到的内容不是有效的图片类型。');
      }

      // 创建 File 对象
      const file = new File([imageBlob], 'image_from_url.jpg', { type: imageBlob.type });
      // 创建 Object URL 用于预览
      const imageUrlObject = URL.createObjectURL(file);

      // 验证对象 URL 可以加载（可选，但是个好习惯）
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = () => reject(new Error('无法从对象 URL 加载图片。'));
        img.src = imageUrlObject;
      });

      // 添加图片并处理
      const newIndex = images.length;
      setImages(prev => [...prev, imageUrlObject]);
      setResults(prev => [...prev, '']);
      setCurrentIndex(newIndex);

      await handleFile(file, newIndex);

      setImageUrl(''); // 仅在成功时清除输入字段

    } catch (error) {
      console.error('从 URL 加载图片时出错:', error);
      alert(`无法加载图片: ${error.message}\n\n您可以尝试：\n1. 右键图片另存为后上传\n2. 使用截图工具后粘贴\n3. 复制图片本身而不是链接`);
      // 此处不清空 imageUrl，让用户重试或更改
      setShowUrlInput(true); // 出错时重新显示输入框
    } finally {
      setIsLoading(false); // 结束加载
    }
  };

  // --- 修改: handleImageClick ---
  const handleImageClick = () => {
    // 打开模态框时重置位置和缩放比例
    setModalPosition({ x: 0, y: 0 });
    setModalScale(1);
    setShowModal(true);
  };

  // --- (保留现有的 handleCloseModal 函数) ---
  const handleCloseModal = () => {
    setShowModal(false);
    // 可选：如果需要，清理模态框状态，尽管在打开时重置通常就足够了
    // setIsDraggingModal(false);
  };

  // --- (保留现有的 handleCopyText 函数) ---
  const handleCopyText = () => {
    const currentResult = results[currentIndex];
    if (currentResult && !isStreaming) { // 确保有结果且不在流式加载
      // 创建一个临时 div 来辅助提取纯文本
      const tempDiv = document.createElement('div');
      // 尝试使用 ReactMarkdown 渲染到临时元素，但这比较复杂且可能不必要
      // 直接处理字符串可能更简单有效
      let plainText = currentResult;

      // 移除 Markdown 格式（可以根据需要调整这些规则）
      // 顺序很重要，例如先处理加粗再处理斜体
      plainText = plainText
        .replace(/\$\$(.*?)\$\$/gs, (match, p1) => `\n${p1.trim()}\n`) // 处理块级数学公式（保留内容，加换行）
        .replace(/\$(.*?)\$/g, '$1')        // 处理行内数学公式（仅保留内容）
        .replace(/```[\s\S]*?```/g, '')    // 移除代码块
        .replace(/`([^`]+)`/g, '$1')       // 移除行内代码标记
        .replace(/!\[(.*?)\]\(.*?\)/g, '$1') // 处理图片 ![alt](url) -> alt
        .replace(/\[(.*?)\]\(.*?\)/g, '$1') // 处理链接 [text](url) -> text
        .replace(/(\*\*|__)(.*?)\1/g, '$2') // 移除加粗 (**) (__)
        .replace(/(\*|_)(.*?)\1/g, '$2')   // 移除斜体 (*) (_)
        .replace(/~~(.*?)~~/g, '$1')       // 移除删除线 (~~)
        .replace(/^#+\s+/gm, '')           // 移除标题标记 (#, ##, ...)
        .replace(/^\s*>\s+/gm, '')         // 移除引用标记 (>)
        .replace(/^\s*([-*+])\s+/gm, '')   // 移除无序列表标记 (-, *, +)
        .replace(/^\s*\d+\.\s+/gm, '')    // 移除有序列表标记 (1., 2., ...)
        .replace(/\|.*?\|\n\|[-| :]+\|\n(\|.*?\|\n?)+/g, '') // 尝试移除 Markdown 表格
        .replace(/\n{3,}/g, '\n\n')        // 将三个以上连续换行符合并为两个
        .trim();                           // 去除首尾空格

      navigator.clipboard.writeText(plainText)
        .then(() => {
          const button = document.querySelector('.copy-button');
          if (button) {
            const originalText = button.textContent;
            button.textContent = '已复制';
            button.classList.add('copied');
            // 一段时间后恢复按钮文本
            setTimeout(() => {
              // 再次检查按钮是否存在且文本是“已复制”
              if (button && button.textContent === '已复制') {
                  button.textContent = originalText;
                  button.classList.remove('copied');
              }
            }, 1500); // 1.5秒后恢复
          }
        })
        .catch(err => {
          console.error('复制失败:', err);
          alert('复制失败，您的浏览器可能不支持或权限不足，请尝试手动复制。');
        });
    }
  };

  // --- 新增: 模态框拖拽事件处理函数 ---
  const handleModalMouseDown = (e) => {
    // 如果点击的是关闭按钮，则阻止拖动
    if (e.target.classList.contains('modal-close')) {
        return;
    }
    e.preventDefault(); // 拖动时阻止选择文本
    setIsDraggingModal(true); // 开始拖动状态
    // 计算鼠标点击位置相对于模态框当前左上角的偏移量
    // 这里考虑了当前的平移 (transform: translate)
    setModalOffset({
      x: e.clientX - modalPosition.x,
      y: e.clientY - modalPosition.y,
    });
    // 通过 CSS 类或直接设置来添加抓取光标更好
    e.currentTarget.style.cursor = 'grabbing';
    e.currentTarget.style.transition = 'none'; // 拖动时禁用过渡效果以提高响应性
  };

  // --- 新增: 模态框缩放事件处理函数 ---
  const handleModalWheel = (e) => {
    e.preventDefault(); // 阻止页面滚动
    // 调整灵敏度 - 数值越小，缩放越精细
    const zoomSensitivity = 0.001; // <--- 减小了这个值
    const minScale = 0.1; // 最小缩放比例
    const maxScale = 10; // 最大缩放比例

    setModalScale(prevScale => {
        // e.deltaY < 0 表示向上滚动 (放大), e.deltaY > 0 表示向下滚动 (缩小)
        let newScale = prevScale - e.deltaY * zoomSensitivity;
        // 限制缩放范围
        newScale = Math.max(minScale, Math.min(newScale, maxScale));
        return newScale;
    });

    // 可选：为缩放添加临时的平滑过渡，使其看起来不那么突兀
    e.currentTarget.style.transition = 'transform 0.1s ease-out';
    // 如果需要，在滚轮停止后不久移除过渡，或者保留它
    // 可以使用 debounce 或 setTimeout 来实现
  };

  // --- 新增: 用于模态框拖动期间全局鼠标移动/抬起监听器的 useEffect ---
  useEffect(() => {
    // 全局鼠标移动处理
    const handleMouseMove = (e) => {
      if (!isDraggingModal) return; // 如果没在拖动模态框，则不做任何事
      // 根据鼠标移动和初始偏移量计算新位置
      setModalPosition({
        x: e.clientX - modalOffset.x,
        y: e.clientY - modalOffset.y,
      });
    };

    // 全局鼠标抬起处理
    const handleMouseUp = (e) => {
      if (isDraggingModal) {
        setIsDraggingModal(false); // 结束拖动状态
        // 最好通过 CSS 重置光标并重新启用过渡
        // 如果需要，找到元素并重置其样式，或使用 CSS 类
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.cursor = 'grab'; // 恢复抓取手势光标
             // 拖动结束后重新启用过渡
            modalContent.style.transition = 'transform 0.1s ease-out';
        }
      }
    };

    // 仅在拖动模态框时添加全局监听器
    if (isDraggingModal) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
       // 添加 touchmove 和 touchend 监听器以支持触摸设备
      window.addEventListener('touchmove', handleMouseMove); // 可以复用 mousemove 的逻辑
      window.addEventListener('touchend', handleMouseUp);   // 可以复用 mouseup 的逻辑
    }

    // 清理函数，用于移除监听器
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDraggingModal, modalOffset]); // Effect 的依赖项


  // --- JSX 渲染 ---
  return (
    <div className="app">
      {/* --- (保留 Header 部分) --- */}
       <header>
        <a
          href="https://github.com/kayaladream/GeminiOCR"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          title="在 GitHub 上查看源码" // 为可访问性添加了 title 属性
        >
          {/* SVG 图标代码 */}
           <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32">
             <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
           </svg>
        </a>
        <h1>高精度OCR识别</h1>
        <p>
            智能识别多国语言及手写字体、表格等。识别出的表格是 Markdown 格式，请到{' '}
            <a href="https://tableconvert.com/zh-cn/markdown-to-markdown" target="_blank" rel="noopener noreferrer">
                这里
            </a>{' '}
            在线转换。
        </p>
      </header>

      <main className={images.length > 0 ? 'has-content' : ''}>
        {/* --- (保留上传区域, 更新拖放处理函数) --- */}
         <div className={`upload-section ${images.length > 0 ? 'with-image' : ''}`}>
          <div
            ref={dropZoneRef}
             // 添加全局拖拽指示，区分仅悬停在全局和悬停在特定区域
            className={`upload-zone ${isDragging ? 'dragging' : ''} ${isDraggingGlobal && !isDragging ? 'global-dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver} // 确保此处理函数存在
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="图片上传区域" // 可访问性
          >
            <div className="upload-container">
              <label className="upload-button" htmlFor="file-input">
                 {/* 根据是否有图片显示不同文本 */}
                {images.length > 0 ? '添加<br>图片' : '上传图片'}
              </label>
              <input
                id="file-input"
                type="file"
                accept="image/*" // 限制只能选择图片
                onChange={handleImageUpload}
                multiple // 允许选择多个文件
                hidden // 视觉上隐藏 input，由 label 触发
                aria-hidden="true" // 对辅助技术隐藏，因为 label 会处理它
              />
              <button
                type="button" // 指定 type 为 button 防止触发表单提交（如果它在 form 内）
                className="url-button"
                onClick={() => setShowUrlInput(!showUrlInput)} // 点击切换 URL 输入框的显示
                aria-expanded={showUrlInput} // 可访问性状态，指示区域是否展开
              >
                 {/* 根据状态显示不同文本 */}
                {showUrlInput ? '取消链接输入' : '使用链接上传'}
              </button>
            </div>

            {/* 条件渲染 URL 输入表单 */}
            {showUrlInput && (
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                  type="url" // 使用 url 类型输入框
                  value={imageUrl} // 绑定状态
                  onChange={(e) => setImageUrl(e.target.value)} // 更新状态
                  placeholder="粘贴图片链接 (URL)"
                  className="url-input"
                  required // 如果表单显示，则使 URL 必填
                  aria-label="图片链接输入框" // 可访问性
                />
                <button type="submit" className="url-submit">
                  确认
                </button>
              </form>
            )}

            {/* 仅在没有图片、未拖拽且 URL 输入框隐藏时显示提示 */}
            {!images.length && !isDragging && !showUrlInput && (
              <p className="upload-hint">或将图片拖放到此处 / 粘贴图片</p>
            )}
             {/* 显示拖拽覆盖文本 */}
             {isDragging && (
                <div className="dragging-overlay-text">松开即可上传图片</div>
            )}
          </div>

          {/* --- (保留图片预览区域) --- */}
          {images.length > 0 && (
            <div className="images-preview">
               <div className="image-navigation">
                <button
                    onClick={handlePrevImage}
                    // 加载中或已经是第一张时禁用
                    disabled={currentIndex === 0 || isLoading}
                    className="nav-button"
                    aria-label="上一张图片"
                >
                    ←
                </button>
                 {/* 使用 aria-live 宣告变化（用于屏幕阅读器） */}
                <span className="image-counter" aria-live="polite">
                    {currentIndex + 1} / {images.length}
                </span>
                <button
                    onClick={handleNextImage}
                     // 加载中或已经是最后一张时禁用
                    disabled={currentIndex === images.length - 1 || isLoading}
                    className="nav-button"
                    aria-label="下一张图片"
                >
                    →
                </button>
               </div>
              {/* 根据 isLoading 和当前图片结果是否已加载来决定是否显示加载状态 */}
              <div className={`image-preview ${(isLoading || isStreaming) && !results[currentIndex] ? 'loading' : ''}`}>
                {/* 给 img 标签添加 key，以便在图片改变时强制重新渲染（如果需要） */}
                <img
                  key={images[currentIndex]} // 使用图片 URL 作为 key，确保图片切换时 img 元素更新
                  src={images[currentIndex]}
                  alt={`预览 ${currentIndex + 1}`}
                  onClick={handleImageClick} // 点击打开模态框
                  style={{ cursor: 'zoom-in' }} // 指示可点击以进行缩放
                   // 对损坏图片链接的基础错误处理
                  onError={(e) => {
                      console.error("加载图片失败:", images[currentIndex]);
                      e.target.alt = '图片加载失败';
                      // 可选地设置占位图片: e.target.src = '/path/to/placeholder.png';
                  }}
                />
                {/* 仅在处理当前图片且结果未出来时显示加载覆盖层 */}
                {(isLoading || isStreaming) && !results[currentIndex] && <div className="loading-overlay">{isStreaming ? '识别中...' : '处理中...'}</div>}
                {/* 可以移除下面的 streaming overlay，因为它被上面合并了 */}
                {/* {isStreaming && <div className="loading-overlay streaming">识别中...</div>} */}
              </div>
            </div>
          )}
        </div>

        {/* --- (保留结果区域, 如果需要则更新 contentEditable 处理函数) --- */}
         {/* 如果有图片或正在加载，则显示结果区域 */}
        {(images.length > 0 || isLoading || isStreaming) && (
          <div className="result-section">
            <div className="result-container" ref={resultRef}>
                {/* 特定于结果的加载指示器：当在加载/流式处理且当前索引无结果时显示 */}
                {(isLoading || isStreaming) && !results[currentIndex] && <div className="loading result-loading">等待识别...</div>}

                {/* 仅当有结果或正在进行流式加载时显示结果文本区域 */}
                 {(results[currentIndex] || isStreaming) && (
                    <div className="result-text">
                      <div className="result-header">
                        {/* 使用 aria-live 来宣告变化 */}
                        <span aria-live="polite">
                            第 {currentIndex + 1} 张图片的识别结果 {isStreaming ? '(识别中...)' : ''}
                        </span>
                        {/* 仅当存在非空结果且未进行流式加载时显示复制按钮 */}
                        {results[currentIndex] && !isStreaming && (
                          <button
                            className="copy-button"
                            onClick={handleCopyText}
                          >
                            复制内容
                          </button>
                        )}
                      </div>
                       {/* 使 div 可编辑，处理状态更新和粘贴 */}
                       <div
                          className="gradient-text"
                          // 仅在非流式加载时允许编辑
                          contentEditable={!isStreaming}
                          suppressContentEditableWarning={true} // 阻止 React 对 contentEditable 的警告
                          // 输入事件处理：用户编辑时更新状态
                          onInput={(e) => {
                              // 仅在非流式加载时更新状态
                              if (!isStreaming) {
                                  // 使用 innerText 获取纯文本内容（可能丢失格式）
                                  // 如果需要保留 HTML 结构，使用 innerHTML，但要小心 XSS 风险
                                  const newText = e.currentTarget.innerText;
                                  setResults(prevResults => {
                                      const newResults = [...prevResults];
                                      newResults[currentIndex] = newText; // 更新当前索引的结果
                                      return newResults;
                                  });
                                  // 如果 streamingText 是显示的唯一来源，也更新它
                                  setStreamingText(newText);
                              }
                          }}
                          // 粘贴事件处理：阻止默认粘贴，插入纯文本
                          onPaste={(e) => {
                              if (!isStreaming) {
                                  e.preventDefault(); // 阻止默认粘贴行为
                                  const text = e.clipboardData.getData('text/plain'); // 获取剪贴板纯文本
                                  document.execCommand('insertText', false, text); // 插入纯文本
                                  // 手动触发 input 事件以调用 onInput 更新状态
                                  const event = new Event('input', { bubbles: true });
                                  e.currentTarget.dispatchEvent(event);
                              } else {
                                  e.preventDefault(); // 流式加载时阻止粘贴
                              }
                          }}
                          // 如果需要，为可访问性添加 role，例如 role="textbox"
                          aria-label={`识别结果 ${currentIndex + 1}`}
                        >
                         {/* 使用 ReactMarkdown 渲染 Markdown */}
                         <ReactMarkdown
                           remarkPlugins={[remarkMath]} // 支持数学公式语法
                           rehypePlugins={[rehypeKatex]} // 将数学公式渲染为 KaTeX
                           components={{
                             // 如果需要，自定义表格渲染
                             table: ({ node, ...props }) => (
                               // 使表格在小屏幕上可水平滚动
                               <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                                 <table className="markdown-table" {...props} />
                               </div>
                             ),
                             th: ({ node, ...props }) => (
                               <th className="markdown-th" {...props} />
                             ),
                             td: ({ node, ...props }) => (
                               <td className="markdown-td" {...props} />
                             ),
                             // 使用 katex 渲染数学公式由 rehypeKatex 处理
                           }}
                         >
                           {/* 显示流式文本或最终结果 */}
                           {isStreaming ? streamingText : (results[currentIndex] || '')}
                         </ReactMarkdown>
                       </div>
                    </div>
                 )}
                {/* 在还没有结果且未加载时的占位符 */}
                {!isLoading && !isStreaming && !results[currentIndex] && images.length > 0 && (
                    <div className="result-placeholder">当前图片无识别结果。</div>
                )}
            </div>
          </div>
        )}

      </main>

      {/* --- 修改: 模态框部分 --- */}
      {showModal && (
        // 模态框遮罩层，点击它会关闭模态框
        <div className="modal-overlay" onClick={handleCloseModal}>
          {/* 模态框内容区域 */}
          <div
            className="modal-content"
             // 点击内容区域时阻止事件冒泡，防止关闭模态框
            onClick={e => e.stopPropagation()}
            // 鼠标按下时开始拖动
            onMouseDown={handleModalMouseDown}
            // 鼠标滚轮滚动时处理缩放
            onWheel={handleModalWheel}
            // 添加触摸事件监听器以支持移动设备
            onTouchStart={handleModalMouseDown} // 复用 mouse down 逻辑
            style={{
              // 应用平移和缩放变换
              transform: `translate(${modalPosition.x}px, ${modalPosition.y}px) scale(${modalScale})`,
               // 根据是否在拖动状态显示不同光标
              cursor: isDraggingModal ? 'grabbing' : 'grab',
              // 平滑缩放/平移，拖动时禁用以提高性能
              transition: isDraggingModal ? 'none' : 'transform 0.1s ease-out',
              // 如果支持触摸设备，添加 touch-action: 'none' 以防止浏览器默认的触摸行为（如页面滚动）干扰拖动
              touchAction: 'none',
              // 确保图片不会阻止容器上拖动/滚轮所需的指针事件
               userSelect: 'none', // 拖动时阻止选择图片
            }}
          >
            {/* 显示当前索引的图片 */}
            <img src={images[currentIndex]} alt="放大预览"
                // 确保图片本身不接收指针事件，让事件传递到父容器 div
                style={{ pointerEvents: 'none', userSelect: 'none' }}
            />
             {/* 关闭按钮 */}
             <button
                className="modal-close"
                onClick={handleCloseModal} // 点击关闭模态框
                // 可选：在按钮上添加 onMouseDown 以阻止拖动开始
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    // 如果需要，调整按钮样式使其保持易于点击
                    // 例如，确保它在视觉上相对于 *缩放后* 的内容保持在角落
                    // 如果缩放对其产生不良影响，这可能需要调整其位置或变换原点
                }}
             >
                × {/* 关闭图标 */}
             </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
