# 第三方声明

## 发行包中的 esbuild 辅助代码

构建工具 esbuild 会向生成的 JavaScript 注入少量运行时辅助函数，例如模块导出和属性转换。虽然发行包不包含完整的 esbuild 工具，这些辅助函数仍来自 esbuild。

项目：https://github.com/evanw/esbuild

许可证：MIT。以下声明同时嵌入发行包的 `main.js`，便于仅安装插件文件时保留。BrainOS 自身的代码继续采用 Apache-2.0，第三方部分保留原许可。

```text
MIT License

Copyright (c) 2020 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Obsidian API 和开发依赖

`obsidian` 在构建中被设为 external，运行时由 Obsidian 宿主提供；SDK 类型声明不打入发行包。原生界面组件、图标与主题样式通过宿主 API 使用，不随插件复制分发。

TypeScript、类型声明及其余开发依赖用于开发和构建，当前构建输入未包含它们的库实现。它们分别遵循各自许可证，不因本项目的 Apache-2.0 许可而改变。若将来捆绑新的第三方代码或资源，应同步检查并补充其声明。
