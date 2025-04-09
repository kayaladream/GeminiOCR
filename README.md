# 基于Gemini的智能OCR系统

## 项目概述

一款依托Google Gemini视觉API构建的智能OCR文字识别解决方案，具备卓越的识别精度与多语言支持能力，可精准识别印刷体与手写体文字。

## 核心特性

- 超高精度文字提取技术
- 多语种智能识别引擎
- 手写体文字解析功能
- 流畅优雅的视觉动效
- 自适应多端响应式布局
- 低置信度字符突出显示
- 智能语义纠错与标注
- Markdown编辑器即时修订
- 多元化图像输入方式：
  - 文件选择上传
  - 拖放区域上传
  - 剪贴板粘贴上传
  - 远程URL导入

## 部署指南

本项目采用Vercel平台进行云端部署，部署前需配置以下环境变量：
`GEMINI_API_KEY`

[![Vercel部署按钮](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkayaladream%2FGeminiOCR&env=GEMINI_API_KEY&envDescription=您的Google%20Gemini%20API密钥&project-name=GeminiOCR&repository-name=GeminiOCR)

## Gemini API密钥获取流程

1. 访问Google AI Studio开发者平台 (https://aistudio.google.com/)
2. 导航至控制台左上角"获取API密钥"按钮
3. 根据向导完成API密钥创建流程

## 本地开发环境

### 运行要求

- Node.js 16.x及以上版本
- npm或yarn包管理器

### 环境配置

1. 克隆代码仓库
```bash
git clone https://github.com/kayaladream/GeminiOCR.git
cd GeminiOCR
```

2. 安装项目依赖
```bash
npm install
# 或
yarn install
```

3. 配置环境变量
创建`.env.local`配置文件并添加以下参数：
```
REACT_APP_GEMINI_API_KEY=您的API密钥
```

4. 启动开发服务器
```bash
npm start
# 或
yarn start
```

应用将运行于 http://localhost:3000

## 技术架构

- React.js前端框架
- Google Gemini视觉API
- CSS3动态效果
- React Markdown组件
- Vercel云部署平台

## 功能模块

### 图像输入
- 拖放交互式上传
- 剪贴板内容即时解析
- 远程图片URL导入
- 批量文件上传处理

### 文字识别
- 流式实时输出
- 平滑渐变动效
- 多语言智能解析
- 手写笔迹识别
- 智能版式优化
- 置信度可视化标注
- 语义智能校正

### 结果呈现
- Markdown格式渲染
- 实时编辑预览
- 一键内容复制
- 图像缩略预览
- 多文档导航切换

## 使用建议

- 请确保Gemini API密钥具有充足调用额度
- 远程图片需启用跨域访问权限
- 建议提供高清晰度源图像
- 数学公式应保持结构清晰

## 开源贡献

诚挚欢迎提交Issue与Pull Request参与项目改进。

## 授权许可

MIT开源协议
