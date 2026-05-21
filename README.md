# AIFY链接转图片

钉钉 AI 表格字段模板（FaaS 版）。将公网图片链接转换为附件图片字段。

## 功能

- 支持纯 URL、Markdown 链接、带编号的图片链接
- 单次最多转换 5 张图片
- 图片链接通过 AIFY 代理返回，提升钉钉附件校验兼容性
- 返回附件字段结果

## 本地开发

```bash
npm install
npm run start
```

## 打包

```bash
npm run build
```
