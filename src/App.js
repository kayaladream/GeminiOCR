import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'katex/dist/katex.min.css';
// import { InlineMath, BlockMath } from 'react-katex'; // Keep if needed elsewhere, otherwise remove
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import './App.css';

// --- (Keep existing code from GoogleGenerativeAI initialization to preprocessText function) ---
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
  const [isDragging, setIsDragging] = useState(false); // For drop zone
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false); // For global drop detection
  const resultRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // --- NEW STATE FOR MODAL ---
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 }); // Offset between click and top-left corner
  const [modalScale, setModalScale] = useState(1);
  // --- END NEW STATE ---

  // --- (Keep existing useEffect for paste handling) ---
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
  }, [images.length]); // Keep dependencies as they were

  // --- (Keep existing fileToGenerativePart function) ---
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

  // --- (Keep existing handleFile function) ---
   const handleFile = async (file, index) => {
    if (file.type.startsWith('image/')) {
      try {
        setIsStreaming(true);
        setStreamingText('');
        setResults(prev => {
          const newResults = [...prev];
          newResults[index] = '';
          return newResults;
        });

        let fullText = '';

        // 判断是开发环境还是生产环境
        if (process.env.NODE_ENV === 'development') {
          // 开发环境：直接调用 Gemini API
          const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
          const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash", // Updated model name
            generationConfig,
          });

          const imagePart = await fileToGenerativePart(file);

          // 识别规则
          const rulesPrompt = `
          请你识别图片中的文字内容并输出，需遵循以下规范和要求：

          1. 数学公式规范：
             - 独立的数学公式使用 $$，例如：$$E = mc^2$$
             - 行内数学公式使用 $，例如：能量公式 $E = mc^2$
             - 保持原文中的变量名称不变

          2. 表格规范：
             如果图片中存在类似"表格"的内容，请使用标准 Markdown 表格语法输出。例如：
             | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
             |---------------|---------|-------|----------|
             | Copy Writing  | $50/hr  | 4     | $200.00  |
             | Website Design| $50/hr  | 2     | $100.00  |   
             - 表头与单元格之间需使用"|-"分隔行，并保证每列至少有三个"-"进行对齐
             - 金额部分需包含货币符号以及小数点
             - 若识别到表格，也不能忽略表格外的文字

          3. 分段要求：
             - 每个分段之间用两个换行符分隔，确保 Markdown 中显示正确的分段效果

          4. 文字识别要求：
             - 保持原文的排版结构
             - 保持原文的段落结构
             - 专业术语和特定名词需要准确识别
             - 不要将所有以数字、符号开头的段落识别为有序列表，不要应用任何Markdown列表格式

          5. 错误纠正：
             - 如遇到模糊不清的单词或中文，根据上下文语境进行合理推测和修正
             - 原图中模糊不清与根据上下文纠正的文字，修正后需要用**加粗**格式显示

          6. 直接输出内容，不要添加任何说明
          `;


          // 将规则和图片部分一起发送
          const result = await model.generateContentStream([rulesPrompt, imagePart]);

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;

            // 确保每个分段之间有两个换行符
            const formattedText = preprocessText(fullText);

            setStreamingText(formattedText);
            setResults(prevResults => {
              const newResults = [...prevResults];
              newResults[index] = formattedText;
              return newResults;
            });
          }
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

           // Check if the response is OK and the body is readable
           if (!response.ok || !response.body) {
             const errorText = await response.text();
             throw new Error(`API request failed with status ${response.status}: ${errorText}`);
           }

           const streamReader = response.body.getReader();
           const decoder = new TextDecoder(); // Define decoder once

           while (true) {
             const { done, value } = await streamReader.read();
             if (done) break;

             const chunk = decoder.decode(value, { stream: true }); // Decode chunk
             const lines = chunk.split('\n');

             for (const line of lines) {
               if (line.startsWith('data: ')) {
                 try {
                   const rawData = line.slice(6);
                   // Check if rawData is empty before parsing
                   if (rawData.trim()) {
                     const data = JSON.parse(rawData);
                     if (data.text) { // Ensure text property exists
                       fullText += data.text;

                       // 确保每个分段之间有两个换行符
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
                   console.error('Error parsing chunk:', e, 'Raw data:', line);
                 }
               }
             }
           }
        }

        setIsStreaming(false);

      } catch (error) {
        console.error('Error details:', error);
        setResults(prevResults => {
          const newResults = [...prevResults];
          newResults[index] = `识别出错,请重试 (${error.message || error})`; // Show error message
          return newResults;
        });
        setIsStreaming(false); // Ensure loading stops on error
        setIsLoading(false);   // Ensure global loading stops on error
      }
    }
  };

  // --- (Keep existing concurrentProcess function) ---
  const concurrentProcess = async (items, processor, maxConcurrent = 5) => {
    const results = [];
    let activePromises = 0;
    const queue = [...items.entries()]; // Use entries to get index easily
    const executing = new Set();

    return new Promise((resolve) => {
      const processNext = () => {
        while (activePromises < maxConcurrent && queue.length > 0) {
          const [index, item] = queue.shift();
          activePromises++;
          const promise = processor(item, index).finally(() => {
            activePromises--;
            executing.delete(promise);
            processNext(); // Try to process next item
          });
          executing.add(promise);
        }

        if (queue.length === 0 && executing.size === 0) {
          resolve(); // Resolve when queue is empty and all promises finished
        }
      };

      processNext(); // Start processing
    });
  };

  // --- (Keep existing handleImageUpload function) ---
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return; // No files selected

    setIsLoading(true);

    try {
      const startIndex = images.length;  // 获取当前图片数量作为起始索引

      // 先一次性更新所有图片预览
      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);

      // 初始化结果数组
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);

      // 立即切换到第一张新图片
      setCurrentIndex(startIndex);

      // 使用并发控制处理文件，传递原始索引
      await concurrentProcess(
        files,
        (file, fileIndex) => handleFile(file, startIndex + fileIndex) // Pass correct global index
      );
    } catch (error) {
      console.error('Error processing files:', error);
      // Optionally show an error message to the user
    } finally {
      setIsLoading(false);
       // Clear the file input value so the same file can be uploaded again
       e.target.value = null;
    }
  };


  // --- (Keep existing image navigation functions) ---
  const handlePrevImage = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      setStreamingText(results[prevIndex] || ''); // Update streaming text for previous image
    }
  };

  const handleNextImage = () => {
    if (currentIndex < images.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setStreamingText(results[nextIndex] || ''); // Update streaming text for next image
    }
  };

  // --- (Keep existing global drag/drop useEffect and handlers) ---
  useEffect(() => {
    const handleGlobalDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only set dragging if dataTransfer contains files
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        if (!isDraggingGlobal) {
          setIsDraggingGlobal(true);
          setIsDragging(true); // Also indicate dragging on the drop zone
        }
      }
    };

    const handleGlobalDragOver = (e) => {
        e.preventDefault(); // Necessary to allow drop
        e.stopPropagation();
    };

    const handleGlobalDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Check if the mouse is leaving the window
      if (!e.relatedTarget || e.relatedTarget === null) {
         setIsDraggingGlobal(false);
         setIsDragging(false);
      }
    };

    const handleGlobalDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Check if the drop occurred outside the designated drop zone
      if (dropZoneRef.current && !dropZoneRef.current.contains(e.target)) {
          // Handle the drop here if it's outside the zone but still intended for the app
          // For now, just reset the dragging state
          setIsDraggingGlobal(false);
          setIsDragging(false);
          // If you want to allow dropping anywhere, move the handleDrop logic here
          // handleDrop(e); // Example: process drop anywhere
      } else {
          // If inside the drop zone, let its handleDrop manage states
          // The dropZone's handleDrop should set isDraggingGlobal and isDragging to false
      }
    };


    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragover', handleGlobalDragOver); // Add dragover listener
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);


    return () => {
      window.removeEventListener('dragenter', handleGlobalDragEnter);
      window.removeEventListener('dragover', handleGlobalDragOver);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [isDraggingGlobal]); // Dependency array

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true); // Set dragging only if files are being dragged
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // This is crucial to allow dropping
    e.stopPropagation();
  };


  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if leaving the drop zone element itself, not just child elements
    if (e.currentTarget.contains(e.relatedTarget)) {
      return; // Still inside the drop zone
    }
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false); // Reset drop zone specific dragging state
    setIsDraggingGlobal(false); // Reset global dragging state

    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));

    if (files.length === 0) {
        // Handle non-image files or links if needed, otherwise return
        // Example: Check for links
        const items = Array.from(e.dataTransfer.items);
        for (const item of items) {
            if (item.kind === 'string' && item.type === 'text/uri-list') {
                item.getAsString((url) => {
                    // Check if it looks like an image URL before setting
                    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                        setImageUrl(url);
                        setShowUrlInput(true);
                        // Optionally trigger submit immediately:
                        // handleUrlSubmit({ preventDefault: () => {} }); // Pass a mock event if needed
                    } else {
                        alert('Dropped link is not a recognized image URL.');
                    }
                });
                return; // Stop processing after handling the link
            }
        }
        // If no image files or valid links found
        alert('Please drop image files or image URLs.');
        return;
    }


    setIsLoading(true); // Start loading indicator

    try {
      const startIndex = images.length;

      const imageUrls = files.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...imageUrls]);
      setResults(prev => [...prev, ...new Array(files.length).fill('')]);
      setCurrentIndex(startIndex); // Go to the first dropped image

      // Process files concurrently
      await concurrentProcess(
        files,
        (file, fileIndex) => handleFile(file, startIndex + fileIndex) // Pass correct global index
      );
    } catch (error) {
      console.error('Error processing dropped files:', error);
      alert('An error occurred while processing the dropped files.');
    } finally {
      setIsLoading(false); // Stop loading indicator
    }
  };

  // --- (Keep existing handleUrlSubmit function) ---
  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!imageUrl) return;
    setIsLoading(true);
    setShowUrlInput(false); // Hide input immediately

    try {
      let imageBlob;
      let finalUrl = imageUrl;

      // 1. Try direct fetch first
      try {
        console.log("Attempting direct fetch for:", finalUrl);
        const response = await fetch(finalUrl);
        if (!response.ok) throw new Error(`Direct fetch failed: ${response.statusText}`);
        imageBlob = await response.blob();
        console.log("Direct fetch successful.");
      } catch (directError) {
        console.warn("Direct fetch failed:", directError);

        // 2. Try CORS proxies if direct fetch fails
        const proxyServices = [
           // Add more reliable proxies if needed
           (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`, // Generally reliable
           (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // Another option
        ];

        let proxySuccess = false;
        for (const getProxyUrl of proxyServices) {
          const proxyUrl = getProxyUrl(imageUrl);
          try {
            console.log("Attempting proxy fetch via:", proxyUrl);
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`Proxy fetch failed: ${response.statusText}`);
            imageBlob = await response.blob();
            console.log("Proxy fetch successful.");
            proxySuccess = true;
            break; // Exit loop on success
          } catch (proxyError) {
            console.warn("Proxy fetch failed:", proxyError);
            // Continue to the next proxy
          }
        }

        if (!proxySuccess) {
            // 3. If all else fails, inform the user
            throw new Error('Direct and proxy fetches failed. Unable to load image due to potential CORS restrictions or network issues.');
        }
      }


      // Ensure fetched content is an image
      if (!imageBlob || !imageBlob.type.startsWith('image/')) {
        throw new Error('The fetched content is not a valid image type.');
      }

      const file = new File([imageBlob], 'image_from_url.jpg', { type: imageBlob.type });
      const imageUrlObject = URL.createObjectURL(file);

      // Verify the object URL can be loaded (optional but good practice)
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load image from Object URL.'));
        img.src = imageUrlObject;
      });

      // Add image and process
      const newIndex = images.length;
      setImages(prev => [...prev, imageUrlObject]);
      setResults(prev => [...prev, '']);
      setCurrentIndex(newIndex);

      await handleFile(file, newIndex);

      setImageUrl(''); // Clear input field only on success

    } catch (error) {
      console.error('Error loading image from URL:', error);
      alert(`无法加载图片: ${error.message}\n\n您可以尝试：\n1. 右键图片另存为后上传\n2. 使用截图工具后粘贴\n3. 复制图片本身而不是链接`);
      // Do not clear imageUrl here, let user retry or change it
      setShowUrlInput(true); // Re-show input on error
    } finally {
      setIsLoading(false);
    }
  };

  // --- MODIFIED: handleImageClick ---
  const handleImageClick = () => {
    // Reset position and scale when opening modal
    setModalPosition({ x: 0, y: 0 });
    setModalScale(1);
    setShowModal(true);
  };

  // --- (Keep existing handleCloseModal function) ---
  const handleCloseModal = () => {
    setShowModal(false);
    // Optional: Clean up modal state if needed, though reset on open is usually sufficient
    // setIsDraggingModal(false);
  };

  // --- (Keep existing handleCopyText function) ---
  const handleCopyText = () => {
    if (results[currentIndex]) {
      // Create a temporary element to render Markdown
      const tempDiv = document.createElement('div');
      // Use ReactMarkdown potentially or a simpler markdown-to-text library if needed
      // For simplicity, let's just use the raw result text which might contain markdown
      tempDiv.innerHTML = results[currentIndex]
        .replace(/\$\$(.*?)\$\$/gs, (match, p1) => `\n${p1.trim()}\n`) // Handle block math
        .replace(/\$(.*?)\$/g, '$1'); // Handle inline math (basic)

      // Remove potential HTML tags if ReactMarkdown was used internally, or handle markdown conversion better
      let plainText = tempDiv.textContent || tempDiv.innerText || "";

      // Further specific cleaning if needed (like removing extra newlines from block math conversion)
      plainText = plainText
        .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
        .replace(/\*(.*?)\*/g, '$1')     // Italic
        .replace(/`(.*?)`/g, '$1')       // Inline code
        .replace(/~~(.*?)~~/g, '$1')     // Strikethrough
        .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links [text](url) -> text
        .replace(/^#+\s/gm, '')          // Headers
        .replace(/^\s*-\s+/gm, '')       // List items (basic)
        .replace(/^\s*\d+\.\s+/gm, '')   // Numbered list items (basic)
        .replace(/\n{3,}/g, '\n\n')      // Reduce multiple newlines
        .trim();                         // Trim start/end whitespace

      navigator.clipboard.writeText(plainText)
        .then(() => {
          const button = document.querySelector('.copy-button');
          if (button) {
            const originalText = button.textContent;
            button.textContent = '已复制';
            button.classList.add('copied');
            setTimeout(() => {
              button.textContent = originalText;
              button.classList.remove('copied');
            }, 1500);
          }
        })
        .catch(err => {
          console.error('复制失败:', err);
          alert('复制失败，请手动复制。');
        });
    }
  };

  // --- NEW: Event Handlers for Modal Dragging ---
  const handleModalMouseDown = (e) => {
    // Prevent dragging if clicking on the close button
    if (e.target.classList.contains('modal-close')) {
        return;
    }
    e.preventDefault(); // Prevent text selection during drag
    setIsDraggingModal(true);
    // Calculate the offset from the mouse click to the modal's current top-left
    // This considers the current translation
    setModalOffset({
      x: e.clientX - modalPosition.x,
      y: e.clientY - modalPosition.y,
    });
    // Add grabbing cursor in CSS via a class or directly is better
    e.currentTarget.style.cursor = 'grabbing';
    e.currentTarget.style.transition = 'none'; // Disable transition during drag
  };

  // --- NEW: Event Handler for Modal Zooming ---
  const handleModalWheel = (e) => {
    e.preventDefault(); // Prevent page scroll
    const zoomSensitivity = 0.005; // Adjust sensitivity as needed
    const minScale = 0.2;
    const maxScale = 5;

    setModalScale(prevScale => {
        let newScale = prevScale - e.deltaY * zoomSensitivity;
        newScale = Math.max(minScale, Math.min(newScale, maxScale)); // Clamp scale
        return newScale;
    });

    // Optional: Add a temporary smooth transition for zooming
    e.currentTarget.style.transition = 'transform 0.1s ease-out';
    // Remove the transition shortly after wheel stops if desired, or keep it
  };

  // --- NEW: useEffect for Global Mouse Move/Up Listeners during Modal Drag ---
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingModal) return;
      // Calculate new position based on mouse movement and initial offset
      setModalPosition({
        x: e.clientX - modalOffset.x,
        y: e.clientY - modalOffset.y,
      });
    };

    const handleMouseUp = (e) => {
      if (isDraggingModal) {
        setIsDraggingModal(false);
        // Reset cursor and re-enable transition via CSS is preferable
        // Find the element and reset its style if needed, or use CSS classes
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.cursor = 'grab';
             // Re-enable transition after drag ends
            modalContent.style.transition = 'transform 0.1s ease-out';
        }
      }
    };

    // Add listeners only when dragging
    if (isDraggingModal) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    // Cleanup function to remove listeners
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingModal, modalOffset]); // Dependencies for the effect


  // --- JSX Rendering ---
  return (
    <div className="app">
      {/* --- (Keep Header Section) --- */}
       <header>
        <a
          href="https://github.com/kayaladream/GeminiOCR"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          title="View source on GitHub" // Added title for accessibility
        >
          <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32">
            <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
        </a>
        <h1>高精度OCR识别</h1>
        <p>
            智能识别多国语言及手写字体、表格等。识别出的表格是 Markdown 格式，请到{' '}
            <a href="https://tableconvert.com/zh-cn/markdown-to-markdown" target="_blank" rel="noopener noreferrer">
                TableConvert
            </a>{' '}
            或其他 Markdown 表格工具在线转换。
        </p>
      </header>

      <main className={images.length > 0 ? 'has-content' : ''}>
        {/* --- (Keep Upload Section, update drag/drop handlers) --- */}
         <div className={`upload-section ${images.length > 0 ? 'with-image' : ''}`}>
          <div
            ref={dropZoneRef}
            className={`upload-zone ${isDragging ? 'dragging' : ''} ${isDraggingGlobal && !isDragging ? 'global-dragging' : ''}`} // Add global dragging indication
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver} // Make sure this is present
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="图片上传区域" // Accessibility
          >
            <div className="upload-container">
              <label className="upload-button" htmlFor="file-input">
                {images.length > 0 ? '添加/替换图片' : '上传图片'}
              </label>
              <input
                id="file-input"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                multiple
                hidden
                aria-hidden="true" // Hide from assistive tech as label handles it
              />
              <button
                type="button" // Specify type for buttons without form submission
                className="url-button"
                onClick={() => setShowUrlInput(!showUrlInput)}
                aria-expanded={showUrlInput} // Accessibility state
              >
                {showUrlInput ? '取消链接输入' : '使用链接上传'}
              </button>
            </div>

            {showUrlInput && (
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="粘贴图片链接 (URL)"
                  className="url-input"
                  required // Make URL required if form is shown
                  aria-label="图片链接输入框"
                />
                <button type="submit" className="url-submit">
                  确认
                </button>
              </form>
            )}

            {/* Show hint only when no images, not dragging, and URL input is hidden */}
            {!images.length && !isDragging && !showUrlInput && (
              <p className="upload-hint">或将图片拖放到此处 / 粘贴图片</p>
            )}
             {/* Show dragging overlay text */}
             {isDragging && (
                <div className="dragging-overlay-text">松开即可上传图片</div>
            )}
          </div>

          {/* --- (Keep Image Preview Section) --- */}
          {images.length > 0 && (
            <div className="images-preview">
               <div className="image-navigation">
                <button
                    onClick={handlePrevImage}
                    disabled={currentIndex === 0 || isLoading} // Disable nav during loading
                    className="nav-button"
                    aria-label="上一张图片"
                >
                    ←
                </button>
                <span className="image-counter" aria-live="polite"> {/* Announce changes */}
                    {currentIndex + 1} / {images.length}
                </span>
                <button
                    onClick={handleNextImage}
                    disabled={currentIndex === images.length - 1 || isLoading} // Disable nav during loading
                    className="nav-button"
                    aria-label="下一张图片"
                >
                    →
                </button>
               </div>
              {/* Apply loading class based on isLoading state */}
              <div className={`image-preview ${isLoading && !results[currentIndex] ? 'loading' : ''}`}>
                {/* Add key to img tag to force re-render on image change if needed */}
                <img
                  key={currentIndex} // Helps React differentiate images
                  src={images[currentIndex]}
                  alt={`预览 ${currentIndex + 1}`}
                  onClick={handleImageClick} // Open modal on click
                  style={{ cursor: 'zoom-in' }} // Indicate clickable for zoom
                  onError={(e) => { // Basic error handling for broken image links
                      console.error("Error loading image:", images[currentIndex]);
                      e.target.alt = '图片加载失败';
                      // Optionally set a placeholder image: e.target.src = '/path/to/placeholder.png';
                  }}
                />
                {/* Show loading overlay specifically when loading this image's result */}
                {isLoading && !isStreaming && !results[currentIndex] && <div className="loading-overlay">处理中...</div>}
                {/* Show streaming/recognizing indicator */}
                {isStreaming && <div className="loading-overlay streaming">识别中...</div>}
              </div>
            </div>
          )}
        </div>

        {/* --- (Keep Result Section, update contentEditable handlers if needed) --- */}
         {/* Show result section if there are images OR if it's currently loading */}
        {(images.length > 0 || isLoading) && (
          <div className="result-section">
            <div className="result-container" ref={resultRef}>
                {/* Loading indicator specific to results */}
                {isLoading && !isStreaming && !results[currentIndex] && <div className="loading result-loading">等待识别...</div>}

                {/* Show results area only if there's a result or streaming is happening */}
                 {(results[currentIndex] || isStreaming) && (
                    <div className="result-text">
                      <div className="result-header">
                        {/* Use aria-live to announce changes */}
                        <span aria-live="polite">
                            第 {currentIndex + 1} 张图片的识别结果 {isStreaming ? '(加载中...)' : ''}
                        </span>
                        {/* Only show copy button if there is non-empty result and not streaming */}
                        {results[currentIndex] && !isStreaming && (
                          <button
                            className="copy-button"
                            onClick={handleCopyText}
                          >
                            复制内容
                          </button>
                        )}
                      </div>
                       {/* Make div editable, handle state updates and paste */}
                       <div
                          className="gradient-text"
                          contentEditable={!isStreaming} // Allow editing only when not streaming
                          suppressContentEditableWarning={true}
                          onInput={(e) => {
                              // Update state only if not streaming
                              if (!isStreaming) {
                                  const newText = e.currentTarget.innerText; // Use innerText to get plain text
                                  setResults(prevResults => {
                                      const newResults = [...prevResults];
                                      newResults[currentIndex] = newText;
                                      return newResults;
                                  });
                                  // Update streamingText as well if it's the source of truth for display
                                  setStreamingText(newText);
                              }
                          }}
                          onPaste={(e) => {
                              if (!isStreaming) {
                                  e.preventDefault(); // Prevent default paste behavior
                                  const text = e.clipboardData.getData('text/plain');
                                  document.execCommand('insertText', false, text);
                                  // Trigger input event manually to update state
                                  const event = new Event('input', { bubbles: true });
                                  e.currentTarget.dispatchEvent(event);
                              } else {
                                  e.preventDefault(); // Prevent pasting while streaming
                              }
                          }}
                          // Add role for accessibility if needed, e.g., role="textbox"
                          aria-label={`识别结果 ${currentIndex + 1}`}
                        >
                         {/* Render Markdown using ReactMarkdown */}
                         <ReactMarkdown
                           remarkPlugins={[remarkMath]}
                           rehypePlugins={[rehypeKatex]}
                           components={{
                             // Customize table rendering if needed
                             table: ({ node, ...props }) => (
                               <div style={{ overflowX: 'auto', maxWidth: '100%' }}> {/* Make tables scrollable */}
                                 <table className="markdown-table" {...props} />
                               </div>
                             ),
                             th: ({ node, ...props }) => (
                               <th className="markdown-th" {...props} />
                             ),
                             td: ({ node, ...props }) => (
                               <td className="markdown-td" {...props} />
                             ),
                             // Render math using katex is handled by rehypeKatex
                           }}
                         >
                           {/* Display streaming text or the final result */}
                           {isStreaming ? streamingText : (results[currentIndex] || '')}
                         </ReactMarkdown>
                       </div>
                    </div>
                 )}
                {/* Placeholder when no result yet and not loading */}
                {!isLoading && !isStreaming && !results[currentIndex] && images.length > 0 && (
                    <div className="result-placeholder">请等待或触发识别。</div>
                )}
            </div>
          </div>
        )}

      </main>

      {/* --- MODIFIED: Modal Section --- */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          {/* Add event handlers and dynamic style */}
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()} // Prevent closing modal when clicking content
            onMouseDown={handleModalMouseDown}  // Start dragging
            onWheel={handleModalWheel}        // Handle zooming
            style={{
              transform: `translate(${modalPosition.x}px, ${modalPosition.y}px) scale(${modalScale})`,
              cursor: isDraggingModal ? 'grabbing' : 'grab', // Indicate draggability
              transition: isDraggingModal ? 'none' : 'transform 0.1s ease-out', // Smooth zoom/pan, disable during drag
              // Add touch-action: 'none' if supporting touch devices to prevent browser interference
              touchAction: 'none',
            }}
          >
            <img src={images[currentIndex]} alt="放大预览" />
             {/* Ensure close button is clickable even when transformed */}
             <button
                className="modal-close"
                onClick={handleCloseModal}
                // Optional: Add onMouseDown to prevent drag starting on button
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    // Adjust button style if needed so it remains easily clickable
                    // For example, ensure it stays visually in the corner relative to the *scaled* content
                    // This might require adjusting its position or transform origin if scale affects it undesirably
                }}
             >
                ×
             </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
