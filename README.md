# 基于Gemini的高精度OCR识别

一个基于 Google Gemini 2.0的高精度 OCR 文字识别应用，支持多国语言和手写字体识别。

## 功能特点

- 🚀 高精度文字识别
- 🌍 支持多国语言识别
- ✍️ 支持手写字体识别
- 🎨 优雅的渐变动画效果
- 📱 响应式设计，支持移动端
- 🖼️ 多种图片输入方式：
  - 文件上传
  - 拖拽上传
  - 粘贴板上传
  - 图片链接上传

## 演示网站
https://ocr.howen.ink/

## 部署说明

本项目使用 Vercel 进行部署。在部署时需要设置以下环境变量：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCiZaii%2Fgeminiocr&env=REACT_APP_OPENAI_API_URL,REACT_APP_OPENAI_API_KEY&envDescription=API%20相关配置&envLink=https%3A%2F%2Fgithub.com%2FCiZaii%2Fgeminiocr%23%E9%83%A8%E7%BD%B2%E8%AF%B4%E6%98%8E&project-name=geminiocr&repository-name=geminiocr&demo-title=Gemini%20OCR&demo-description=基于%20Gemini%202.0%20的高精度%20OCR%20文字识别应用&demo-url=https%3A%2F%2Focr.howen.ink&demo-image=https%3A%2F%2Focr.howen.ink%2Fpreview.png)

环境变量说明：
- `REACT_APP_OPENAI_API_URL`: 你的 API 地址（需支持 gemini-2.0-flash-exp 模型）
- `REACT_APP_OPENAI_API_KEY`: 你的 API 密钥

**注意事项:**
- **需要使用非香港、澳门、大陆地区的网络环境访问**


## 本地开发

### 环境要求

- Node.js 16.x 或更高版本
- npm 或 yarn

### 安装步骤

1. 克隆项目
```bash
git clone https://github.com/cokice/googleocr-app.git
cd ocr-app
```

2. 安装依赖
```bash
npm install
# 或
yarn install
```

3. 配置环境变量
创建 `.env.local` 文件并添加以下配置：
```
REACT_APP_GEMINI_API_KEY=your_api_key_here
```

4. 启动开发服务器
```bash
npm start
# 或
yarn start
```

访问 http://localhost:3000 即可看到应用。

## 技术栈

- React.js
- Google Gemini Vision API
- CSS3 动画
- React Markdown
- Vercel 部署

## 主要功能

### 图片上传
- 支持拖拽上传
- 支持粘贴上传（包括截图和图片文件）
- 支持图片链接上传
- 支持多图片批量上传

### 文字识别
- 实时流式输出
- 优雅的渐变动画效果
- 支持多国语言
- 支持手写体识别
- 自动优化排版格式

### 结果展示
- 支持 Markdown 格式
- 一键复制识别结果
- 图片预览功能
- 多图片导航切换


## 贡献

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT License
