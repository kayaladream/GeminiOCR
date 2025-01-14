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
`GEMINI_API_KEY`

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcokice%2Fgoogleocr-app&env=GEMINI_API_KEY&envDescription=Your%20Google%20Gemini%20API&project-name=geminiocr&repository-name=geminiocr)
## Gemini API 密钥获取
1. 访问 Google AI Studio (https://aistudio.google.com/)
2. 点击左上角的 "Get API key" 按钮
3. 按照提示完成 API key 的创建

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


## 注意事项

- 请确保您的 Google Gemini API 密钥有足够的配额
- 图片链接需要允许跨域访问
- 建议上传清晰的图片以获得最佳识别效果
- 数学公式应有清晰的结构

## 贡献

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT License
