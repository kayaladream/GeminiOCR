import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import './App.css';

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
const generationConfig = {
  temperature: 0,
  topP: 1,
  topK: 1,
  maxOutputTokens: 8192,
};

const preprocessText = (text) => {
  if (!text) return '';
  
  const tables = [];
  text = text.replace(/\|[^\n]+\|\n\|[-|\s]+\|(?:\n\|[^\n]+\|)+/g, (match) => {
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
  text = text.replace(/(\d+)\.\s+/g, '$1');
  text = text.replace(/(\d+)\.\s+/g, '$1.');
  text = text.replace(/(\d+)\)\s+/g, '$1)');
  text = text.replace(/-\s+/g, '-'); 
  text = text.replace(/\*\s+/g, '*'); 
  text = text.replace(/\+\s+/g, '+'); 
  text = text.replace(/>\s+/g, '>'); 
  text = text.replace(/#\s+/g, '#');
  
  text = text.replace(/\n{2,}/g, '\n\n');

  text = text.replace(/__TABLE_(\d+)__/g, (match, index) => {
    return `\n\n${tables[parseInt(index)]}\n\n`;
  });

  return text.trim();
};

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

const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
});
turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
turndownService.addRule('katex', {
    filter: function (node, options) {
      return (
        (node.nodeName === 'SPAN' && node.classList.contains('katex-display')) ||
        (node.nodeName === 'SPAN' && node.classList.contains('katex'))
      );
    },
    replacement: function (content, node, options) {
      const latexSource = node.querySelector('annotation[encoding="application/x-tex"]');
      if (latexSource) {
        const formula = latexSource.textContent;
        if (node.classList.contains('katex-display')) {
          return `\n\n$$${formula}$$\n\n`;
        } else {
          return `$${formula}$`;
        }
      }
      return node.outerHTML;
    }
});


function App() {
  const [images, setImages] = useState([]);
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const resultRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const [modalScale, setModalScale] = useState(1);

  const [editText, setEditText] = useState('');
  const editDivRef = useRef(null);

  const handleFile = useCallback(async (file, index) => {
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

        if (process.env.NODE_ENV === 'development') {
          const model = genAI.getGenerativeModel({
            model: "gemini-pro-vision",
            generationConfig,
          });
          const imagePart = await fileToGenerativePart(file);
          const rulesPrompt = `
          ## Processing Workflow Explanation
          1. Perform initial OCR recognition → Mark low-confidence characters
          2. Conduct semantic analysis → Correct obvious errors
          3. Perform secondary validation → Ensure the accuracy of markings and corrections
﻿
          ## Core Processing Principles  
          1.  **Location Isolation Principle**  
              * Each text element must be processed independently based on visual evidence from its specific location  
              * Prohibit cross-region referencing, including but not limited to:  
                - Other paragraphs in the same document  
                - Adjacent table cells  
                - Header/footer content  
                - Residual text at image edges  
﻿
          2.  **Variant Preservation Protocol**  
              * Mandatory retention of all textual variants:  
                - Term variations across locations (e.g., "豪享版" vs "豪华版")  
                - Case inconsistencies (e.g., "iPhone" vs "IPHONE")  
                - Format variants (e.g., "图1-1" vs "图1.1")  
                - Spelling variants (e.g., "登录/login" vs "登陆/landing")  
              * Implementation examples:  
                ✓ Preserve both "甲方/Party A" and "甲方：/Party A:" in contracts  
                ✓ Maintain alternating "WiFi" and "Wifi" in technical documents  
                ✓ Retain mixed "ID" and "Id" usage within the same table  

          3.  **Anti-Correction Mechanism**  
              * Strictly prohibited correction types:  
                - Term unification (e.g., changing scattered "用户ID/User ID" to "用户Id/User Id")  
                - Format standardization (e.g., converting "2023年1月1日/Jan 1, 2023" to "2023-01-01")  
                - Synonym substitution (e.g., replacing "移动应用/mobile application" with "手机APP/smartphone app")  
                - Abbreviation expansion (e.g., expanding "北大/Beida" to "北京大学/Peking University")  
﻿
          ## Adhere to the following standards and requirements:
          1.  **Mathematical Formula Standards:**
              *   Use $$ for standalone mathematical formulas, e.g., $$E = mc^2$$
              *   Use $ for inline mathematical formulas, e.g., the energy formula $E = mc^2$
              *   Keep variable names from the original text unchanged

          2.  **Table Standards:**
              *   If the image contains table-like content, use standard Markdown table syntax for output. For example:
                | DESCRIPTION   | RATE    | HOURS | AMOUNT   |
                |---------------|---------|-------|----------|
                | Copy Writing  | $50/hr  | 4     | $200.00  |
                | Website Design| $50/hr  | 2     | $100.00  |
              *   Separate headers and cells with "|-" lines, with at least three "-" per column for alignment.
              *   Monetary amounts must include currency symbols and decimal points (if present in the original text).
              *   If a table is identified, do not ignore the text outside of it.

          3.  **Text Recognition Requirements:**
              *   Do not omit any text.
              *   Maintain the original paragraph structure and general layout (e.g., indentation) as much as possible, but prioritize standard Markdown formatting.
              *   Technical terms and proper nouns must be accurately recognized.
              *   Do not automatically format paragraphs starting with numbers or symbols as ordered or unordered lists. Do not apply any Markdown list formatting unless explicitly indicated in the original text.

          4.  **Identifying and Marking Uncertain Items:**
              *   For the following situations, **bold** marking must be used:
                  - Characters with unclear outlines due to messy handwriting
                  - Characters with broken strokes or interference from stains/smudges
                  - Instances where similar characters are difficult to distinguish (e.g., "未" vs. "末")
                  - Recognition results with a confidence score below 85%
              *   For sequences of 3 or more consecutive low-confidence characters, **bold the entire sequence**.
              *   For handwritten text, apply a more lenient marking strategy: **bold** any character with blurred or ambiguous strokes.

          5.  **Contextual Proofreading and Correction:**
              *   Only correct errors that meet the following criteria:
                  - Presence of substitutions based on phonetic or visual similarity (e.g., "帐号"→*账号*)
                  - Violations of grammatical collocation or selectional restrictions (e.g., "吃医院"→*去医院*)
                  - Contradictions of common sense or logical inconsistencies (e.g., "the sun rises in the *west*")
              *   Must ensure the corrected content is semantically coherent within the context.
              *   Make corrections if and only if the confidence in the correction is >90%.
              *   Mark the *corrected* text or words with *italics* to clearly indicate modifications.
              *   Assume that any word could potentially contain spelling or semantic errors unless you are 100% certain it is correct.

          6.  **Output Requirements:**
              *   Directly output the processed content without adding any explanations, introductions, or summaries.
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
  }, []);

  useEffect(() => {
    const handlePaste = async (e) => {
      if (editDivRef.current && editDivRef.current.contains(e.target)) {
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
  }, [images.length, handleFile, showModal]);

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

  const handlePrevImage = () => {
    if (currentIndex > 0 && !isLoading && !isStreaming) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
    }
  };
  const handleNextImage = () => {
    if (currentIndex < images.length - 1 && !isLoading && !isStreaming) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
    }
  };

  useEffect(() => {
    const handleGlobalDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { if (!isDraggingGlobal) { setIsDraggingGlobal(true); } } };
    const handleGlobalDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const handleGlobalDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (!e.relatedTarget || e.relatedTarget === null || e.relatedTarget === document.documentElement) { setIsDraggingGlobal(false); setIsDragging(false); } };
    const handleGlobalDrop = (e) => { e.preventDefault(); e.stopPropagation(); if (dropZoneRef.current && !dropZoneRef.current.contains(e.target)) { setIsDraggingGlobal(false); setIsDragging(false); } };
    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragover', handleGlobalDragOver);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);
    return () => { window.removeEventListener('dragenter', handleGlobalDragEnter); window.removeEventListener('dragover', handleGlobalDragOver); window.removeEventListener('dragleave', handleGlobalDragLeave); window.removeEventListener('drop', handleGlobalDrop); };
  }, [isDraggingGlobal]);
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) { setIsDragging(true); } };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (!dropZoneRef.current.contains(e.relatedTarget)) { setIsDragging(false); } };
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

  const handleImageClick = () => {
    if (!images[currentIndex]) return;
    setModalPosition({ x: 0, y: 0 });
    setModalScale(1);
    setShowModal(true);
  };
  const handleCloseModal = () => {
    setShowModal(false);
  };

  const stripFormatting = (htmlString) => {
    if (!htmlString) return '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    tempDiv.querySelectorAll('strong, b, em, i').forEach(el => {
        el.outerHTML = el.innerHTML;
    });
    return tempDiv.innerHTML;
  };

  const handleCopy = (e) => {
    e.preventDefault();
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const fragment = selection.getRangeAt(0).cloneContents();
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment);

    const cleanHtml = stripFormatting(tempDiv.innerHTML);
    
    const plainTextDiv = document.createElement('div');
    plainTextDiv.innerHTML = cleanHtml;
    const plainText = plainTextDiv.innerText;

    e.clipboardData.setData('text/html', cleanHtml);
    e.clipboardData.setData('text/plain', plainText);
  };

  const handleCopyText = async () => {
    if (editDivRef.current && !isStreaming) {
      try {
        const rawHtml = editDivRef.current.innerHTML;
        const cleanHtml = stripFormatting(rawHtml);
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanHtml;
        let plainText = tempDiv.innerText;
        plainText = plainText.replace(/\n{2,}/g, '\n').trim();

        const clipboardItem = new ClipboardItem({
          'text/html': new Blob([cleanHtml], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        });

        await navigator.clipboard.write([clipboardItem]);

        const button = document.querySelector('.copy-button.copied') || document.querySelector('.copy-button');
        if (button) {
          const originalText = button.dataset.originalText || button.textContent;
          button.dataset.originalText = originalText;
          button.textContent = '已复制';
          button.classList.add('copied');
          setTimeout(() => {
            const currentButton = document.querySelector('.copy-button.copied');
            if (currentButton && currentButton.textContent === '已复制') {
              currentButton.textContent = currentButton.dataset.originalText || '复制内容';
              currentButton.classList.remove('copied');
              delete currentButton.dataset.originalText;
            }
          }, 1500);
        }
      } catch (err) {
        console.error('使用 Clipboard API 复制失败:', err);
        alert('复制失败，您的浏览器可能不支持或权限不足。');
      }
    }
  };

  const handleModalMouseDown = (e) => { if (e.target.classList.contains('modal-close') || e.button !== 0) { return; } const isTouchEvent = e.touches && e.touches.length > 0; const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX; const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY; e.preventDefault(); setIsDraggingModal(true); setModalOffset({ x: clientX - modalPosition.x, y: clientY - modalPosition.y, }); const modalContent = e.currentTarget; if (modalContent) { modalContent.style.cursor = 'grabbing'; modalContent.style.transition = 'none'; } };
  const handleModalWheel = (e) => { e.preventDefault(); const zoomSensitivity = 0.0005; const minScale = 0.1; const maxScale = 10; const scaleChange = -e.deltaY * zoomSensitivity * modalScale; setModalScale(prevScale => { let newScale = prevScale + scaleChange; newScale = Math.max(minScale, Math.min(newScale, maxScale)); return newScale; }); if (e.currentTarget) { e.currentTarget.style.transition = 'transform 0.1s ease-out'; } };
  useEffect(() => {
    const handleMove = (e) => { const isTouchEvent = e.touches && e.touches.length > 0; const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX; const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY; setModalPosition({ x: clientX - modalOffset.x, y: clientY - modalOffset.y, }); };
    const handleEnd = () => { setIsDraggingModal(false); const modalContent = document.querySelector('.modal-content'); if (modalContent) { modalContent.style.cursor = 'grab'; modalContent.style.transition = 'transform 0.1s ease-out'; } };
    if (isDraggingModal) { window.addEventListener('mousemove', handleMove, { capture: true }); window.addEventListener('mouseup', handleEnd, { capture: true }); window.addEventListener('touchmove', handleMove, { passive: false }); window.addEventListener('touchend', handleEnd); }
    return () => { window.removeEventListener('mousemove', handleMove, { capture: true }); window.removeEventListener('mouseup', handleEnd, { capture: true }); window.removeEventListener('touchmove', handleMove); window.removeEventListener('touchend', handleEnd); };
  }, [isDraggingModal, modalOffset]);

  const handleInput = (e) => {
      const currentHtml = e.currentTarget.innerHTML;
      const newMarkdown = turndownService.turndown(currentHtml);
      setEditText(newMarkdown);
      setResults(prevResults => {
          const newResults = [...prevResults];
          if (currentIndex < newResults.length) {
              newResults[currentIndex] = newMarkdown;
          }
          return newResults;
      });
  };

  useEffect(() => {
      if (isStreaming) {
          return;
      }
  
      const currentMarkdown = results[currentIndex] || '';
      setEditText(currentMarkdown);
  
      if (editDivRef.current) {
          const editorMarkdown = turndownService.turndown(editDivRef.current.innerHTML);
          
          if (editorMarkdown !== currentMarkdown) {
              const rawHtml = marked.parse(currentMarkdown, { breaks: true });
              const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td"], ADD_ATTR: [] });
              editDivRef.current.innerHTML = safeHtml;
          }
      }
  }, [currentIndex, results, isStreaming]);


  return (
    <div className="app">
       <header>
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
        <h1>GeminiOCR - 高精度OCR系统</h1>
        <p>
            <b>基于Gemini视觉API的智能文字识别解决方案，可精准识别多语言印刷体、手写体文字、表格等。</b>
            <br />
            识别出的表格需在编辑框内手动复制，粘贴至 Excel 即可保留格式使用。
        </p>
      </header>

      <main className={images.length > 0 ? 'has-content' : ''}>
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
              <div className={`image-preview ${isLoading && !results[currentIndex] ? 'loading' : ''}`}>
                <img
                  key={images[currentIndex]} src={images[currentIndex]} alt={`预览 ${currentIndex + 1}`} onClick={handleImageClick} style={{ cursor: images[currentIndex] ? 'zoom-in' : 'default' }}
                  onError={(e) => { console.error("加载图片失败:", images[currentIndex]); e.target.alt = '图片加载失败'; e.target.style.display = 'none'; e.target.closest('.image-preview')?.classList.add('load-error'); }}
                />
                {isLoading && !results[currentIndex] &&
                    <div className="loading-overlay">
                        {isStreaming ? '识别中...' : (isLoading ? '处理中...' : '')}
                    </div>
                }
              </div>
            </div>
          )}
        </div>

        {(images.length > 0 || isLoading || isStreaming) && (
          <div className="result-section">
            <div className="result-container" ref={resultRef}>
                {isLoading && !isStreaming && results[currentIndex] == null &&
                    <div className="loading result-loading">等待识别...</div>
                }

                {isStreaming && (
                    <div className="result-text">
                      <div className="result-header">
                        <span aria-live="polite">
                            第 {currentIndex + 1} 张图片的识别结果 (识别中...)
                        </span>
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
                           {streamingText}
                         </ReactMarkdown>
                       </div>
                    </div>
                )}

                {!isStreaming && results[currentIndex] != null && (
                    <div className="result-text editing-area">
                         <div className="result-header">
                            <span>编辑第 {currentIndex + 1} 张图片的结果</span>
                            <div>
                                <button className="copy-button" onClick={handleCopyText}>复制内容</button>
                            </div>
                        </div>
                        <div
                            ref={editDivRef}
                            contentEditable={true}
                            className="edit-content-editable"
                            onInput={handleInput}
                            onCopy={handleCopy}
                            suppressContentEditableWarning={true}
                            aria-label={`编辑识别结果 ${currentIndex + 1}`}
                            spellCheck="false"
                        />
                    </div>
                )}

                {!isLoading && !isStreaming && results[currentIndex] == null && images.length > 0 && (
                    <div className="result-placeholder">当前图片无识别结果或识别失败。</div>
                )}
            </div>
          </div>
        )}
      </main>

      {showModal && images[currentIndex] && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            onMouseDown={handleModalMouseDown}
            onWheel={handleModalWheel}
            onTouchStart={handleModalMouseDown}
            style={{
              transform: `translate(${modalPosition.x}px, ${modalPosition.y}px) scale(${modalScale})`,
              cursor: isDraggingModal ? 'grabbing' : 'grab',
              transition: isDraggingModal ? 'none' : 'transform 0.1s ease-out',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <img src={images[currentIndex]} alt="放大预览" draggable="false" style={{ pointerEvents: 'none', userSelect: 'none' }} />
            <button
              className="modal-close" aria-label="关闭预览" onClick={handleCloseModal}
              onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
            >×</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
