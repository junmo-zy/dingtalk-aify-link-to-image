const {
  AuthorizationType,
  FieldExecuteCode,
  FieldType,
  FormItemComponent,
  fieldDecoratorKit,
}: typeof import('dingtalk-docs-cool-app') = require('dingtalk-docs-cool-app/dist-node/module/fields/index.js');
import { existsSync, readFileSync } from 'fs';

const { t } = fieldDecoratorKit;

const CHARGE_API = 'https://aivip.link/api/interface/plugin/invoke';
const AUTH_ID = 'aify_auth';

type DingTalkContext = {
  fetch: (url: string, options: any, authId?: string) => Promise<any>;
  baseId?: string;
  sheetId?: string;
  extensionId?: string;
  tenantId?: string;
  logID?: string;
  [key: string]: any;
};

type ChargeResult = {
  ok: boolean;
  msg: string;
  quotaExhausted?: boolean;
  cost?: number;
  remaining?: number;
};

type AttachmentResult = {
  fileName: string;
  type: string;
  url: string;
};

fieldDecoratorKit.setDomainList([
  'feishu.cn',
  'feishucdn.com',
  'larkoffice.com',
  'larkenterprise.com',
  'larksuitecdn.com',
  'larksuite.com',
  'dingtalk.com',
  'dingtalkapps.com',
  'alidocs.com',
  'aliyuncs.com',
  'alicdn.com',
  'cbu01.alicdn.com',
  'myqcloud.com',
  'aiquickdraw.com',
  '127.0.0.1',
  'aivip.link',
] as any);

const domainList = fieldDecoratorKit.getDomainList() as any[];
domainList.push(
  /(^|\.)dingtalk\.com$/i,
  /(^|\.)dingtalkapps\.com$/i,
  /(^|\.)alidocs\.com$/i,
  /(^|\.)aliyuncs\.com$/i,
  /(^|\.)alicdn\.com$/i,
  /(^|\.)myqcloud\.com$/i,
  /(^|\.)aiquickdraw\.com$/i,
);

function isLocalUrl(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function getLocalAuthToken(): string | undefined {
  try {
    const configPath = `${process.cwd()}\\config.json`;
    if (!existsSync(configPath)) return undefined;
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return typeof config.authorizations === 'string' ? config.authorizations : undefined;
  } catch (e: any) {
    console.error(`[localAuth] failed to read config.json: ${e?.message}`);
    return undefined;
  }
}

async function fetchWithLocalhostSupport(context: DingTalkContext, url: string, options: any, authId?: string): Promise<any> {
  if (!isLocalUrl(url)) {
    return context.fetch(url, options, authId);
  }

  const headers = { ...(options?.headers || {}) };
  const token = authId ? getLocalAuthToken() : undefined;
  if (token) headers.authorization = `Bearer ${token}`;

  const localFetchPackage = 'node-fetch';
  const localFetch = module.require(localFetchPackage);
  return localFetch(url, { ...options, headers });
}

function parseInputText(input: any): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) {
    return input
      .map((item: any) => {
        if (!item) return '';
        if (item.type === 'text') return item.text || '';
        if (item.type === 'url') return item.link || item.text || '';
        if (item.type === 'mention') return item.text || '';
        return item.text || item.value || '';
      })
      .join('')
      .trim();
  }
  return String(input).trim();
}

function extractUrlFromText(text: string): string {
  const mdRe = /\[([^\]]*)\]\(([^)\s]+)\)/;
  const match = mdRe.exec(text);
  if (match) return match[2].trim();

  const urlRe = /(https?:\/\/[^\s，。；;、)）\]]+)/i;
  const urlMatch = urlRe.exec(text);
  return urlMatch ? urlMatch[1].trim() : text.trim();
}

function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function safeFileBaseName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '_').replace(/\s+/g, '_');
  return cleaned.slice(0, 80) || 'image';
}

function buildAttachmentUrl(url: string, fileName: string): string {
  const host = getHost(url).toLowerCase();
  if (host === 'aivip.link') return url;
  return `https://aivip.link/api/upload/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(fileName)}`;
}

async function charge(context: DingTalkContext): Promise<ChargeResult> {
  try {
    const res = await fetchWithLocalhostSupport(
      context,
      CHARGE_API,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plugin_charge',
          pack_id: context.extensionId,
          base_id: context.baseId,
          amount: 10,
        }),
      },
      AUTH_ID,
    );

    const resText = await res.text();
    if (res.ok) {
      const body = JSON.parse(resText);
      console.log(JSON.stringify({
        tag: '===charge 计费返回',
        status: res.status,
        code: body?.code,
        cost: body?.data?.cost,
        remaining: body?.data?.remaining ?? body?.data?.balance,
        requestId: body?.data?.request_id,
      }), '\n');

      if (body.code === 0) {
        return {
          ok: true,
          msg: '',
          cost: Number(body?.data?.cost || 0),
          remaining: Number(body?.data?.remaining ?? body?.data?.balance ?? 0),
        };
      }
      if (body.code === 402) {
        return { ok: false, msg: '积分不足，请前往平台充值后再使用', quotaExhausted: true };
      }
    }

    let msg = '计费服务暂时不可用，请稍后重试';
    if (res.status === 402) {
      msg = '积分不足，请前往平台充值后再使用';
      return { ok: false, msg, quotaExhausted: true };
    }
    if (res.status === 401) msg = 'API Key 无效，请检查授权配置';
    console.error(`[charge] failed status=${res.status} msg=${msg}`);
    return { ok: false, msg };
  } catch (e: any) {
    const msg = '计费服务暂时不可用，请稍后重试';
    console.error(`[charge] exception: ${e?.message}`);
    return { ok: false, msg };
  }
}

fieldDecoratorKit.setDecorator({
  name: 'AIFY链接转图片',
  i18nMap: {
    'zh-CN': {
      urlLabel: '图片链接',
      urlPlaceholder: '请输入图片URL地址，一行一个',
      urlTooltip: '支持常见图片格式：jpg、png、gif、webp等，一行一个链接，最多一次性五个链接转图片',
      customNameLabel: '自定义名称',
      customNamePlaceholder: '留空则使用默认名称',
      customNameTooltip: '自定义附件显示名称，留空则自动生成',
      authorizationName: 'AIFY API 授权',
      authorizationTooltip: '请访问 https://aivip.link/dashboard/apikey 查看或生成您的 API Key。',
    },
    'en-US': {
      urlLabel: 'Image URL',
      urlPlaceholder: 'Enter image URL, one per line',
      urlTooltip: 'Supports jpg, png, gif, webp, etc., one per line, up to 5 images at a time',
      customNameLabel: 'Custom Name',
      customNamePlaceholder: 'Leave blank to use default name',
      customNameTooltip: 'Custom attachment display name',
      authorizationName: 'AIFY API Authorization',
      authorizationTooltip: 'Visit https://aivip.link/dashboard/apikey to get your API Key.',
    },
    'ja-JP': {
      urlLabel: '画像URL',
      urlPlaceholder: '画像URLを1行に1つ入力してください',
      urlTooltip: 'jpg、png、gif、webpなどに対応。最大5枚まで一度に変換できます',
      customNameLabel: 'カスタム名',
      customNamePlaceholder: '空欄の場合は既定名を使用',
      customNameTooltip: '添付ファイルの表示名',
      authorizationName: 'AIFY API 認証',
      authorizationTooltip: 'https://aivip.link/dashboard/apikey で API Key を取得してください。',
    },
  },
  authorizations: {
    id: AUTH_ID,
    label: t('authorizationName'),
    type: AuthorizationType.HeaderBearerToken,
    platform: 'AUTH_93D75519438D',
    required: true,
    instructionsUrl: 'https://aivip.link/dashboard/apikey',
    tooltips: t('authorizationTooltip'),
    icon: {
      light: 'https://youke.xn--y7xa690gmna.cn/s1/2026/02/10/698acaf10b0f7.webp',
      dark: 'https://youke.xn--y7xa690gmna.cn/s1/2026/02/10/698acaf10b0f7.webp',
    },
  },
  formItems: [
    {
      key: 'imageUrl',
      label: t('urlLabel'),
      component: FormItemComponent.Textarea,
      props: {
        placeholder: t('urlPlaceholder'),
        enableFieldReference: true,
      },
      tooltips: { title: t('urlTooltip') },
      validator: { required: true },
    },
    {
      key: 'customName',
      label: t('customNameLabel'),
      component: FormItemComponent.Textarea,
      props: {
        placeholder: t('customNamePlaceholder'),
        enableFieldReference: true,
      },
      tooltips: { title: t('customNameTooltip') },
      validator: { required: false },
    },
  ],
  resultType: {
    type: FieldType.Attachment,
  },
  execute: async (context: DingTalkContext, formData: Record<string, any>) => {
    const { imageUrl, customName } = formData;

    function debugLog(arg: any) {
      console.log(JSON.stringify({ arg, logID: context.logID }), '\n');
    }

    try {
      debugLog({
        '===1 插件启动': {
          baseId: context.baseId,
          sheetId: context.sheetId,
          extensionId: context.extensionId,
          tenantId: context.tenantId,
        },
      });

      const rawText = parseInputText(imageUrl);
      const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const urls = lines.map((line) => extractUrlFromText(line)).filter(Boolean);
      const customNameText = parseInputText(customName);

      if (urls.length === 0) {
        debugLog({ '===2 配置错误': '图片链接为空' });
        return { code: FieldExecuteCode.ConfigError, msg: '配置错误: 图片链接为空' };
      }
      if (urls.length > 5) {
        debugLog({ '===2 配置错误': { urlCount: urls.length, max: 5 } });
        return { code: FieldExecuteCode.ConfigError, msg: '配置错误: 只能一次性五个链接转图片' };
      }

      debugLog({ '===2 链接已解析': { count: urls.length, hosts: urls.map(getHost) } });

      const MAX_SIZE = 20 * 1024 * 1024;
      const mimeExtMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
      };
      const supportedMimes = new Set(Object.keys(mimeExtMap));
      const attachments: AttachmentResult[] = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        let parsed: URL;
        try {
          parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { code: FieldExecuteCode.ConfigError, msg: '配置错误: 仅支持 http/https 协议' };
          }
        } catch {
          return { code: FieldExecuteCode.ConfigError, msg: '配置错误: URL 格式无效' };
        }

        debugLog({ [`===3.${i + 1} 开始校验图片`]: { host: parsed.hostname } });

        const headRes = await fetchWithLocalhostSupport(context, url, { method: 'HEAD' });
        if (!headRes.ok) {
          debugLog({ [`===3.${i + 1} 图片无法访问`]: { status: headRes.status, host: parsed.hostname } });
          return { code: FieldExecuteCode.Error, msg: `图片 ${i + 1} 无法访问: HTTP ${headRes.status}` };
        }

        const contentType = (headRes.headers.get('content-type') || '').toLowerCase();
        const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_SIZE) {
          return { code: FieldExecuteCode.Error, msg: `图片 ${i + 1} 超过 20M (${contentLength} bytes)` };
        }

        const matchedMime = [...supportedMimes].find((mime) => contentType.includes(mime));
        if (!matchedMime) {
          return { code: FieldExecuteCode.Error, msg: `图片 ${i + 1} 格式不支持: ${contentType || '未知'}` };
        }

        const ext = mimeExtMap[matchedMime];
        const baseName = customNameText
          ? `${safeFileBaseName(customNameText)}${urls.length > 1 ? `_${i + 1}` : ''}`
          : `image_${urls.length > 1 ? i + 1 : Date.now()}`;

        const fileName = `${baseName}.${ext}`;
        const attachmentUrl = buildAttachmentUrl(url, fileName);
        attachments.push({
          fileName,
          type: 'image',
          url: attachmentUrl,
        });

        debugLog({ [`===3.${i + 1} 图片校验通过`]: { contentType, contentLength, ext, returnHost: getHost(attachmentUrl) } });
      }

      const chargeResult = await charge(context);
      if (!chargeResult.ok) {
        debugLog({ '===4 扣费失败': chargeResult.msg });
        if (chargeResult.quotaExhausted) return { code: FieldExecuteCode.QuotaExhausted };
        return { code: FieldExecuteCode.Error, msg: chargeResult.msg };
      }
      debugLog({ '===4 扣费成功': { cost: chargeResult.cost, remaining: chargeResult.remaining } });

      debugLog({ '===5 附件生成完成': { count: attachments.length, fileNames: attachments.map((item) => item.fileName), hosts: attachments.map((item) => getHost(item.url)) } });
      return { code: FieldExecuteCode.Success, data: attachments };
    } catch (e: any) {
      debugLog({ '===99 未捕获异常': { message: e?.message, stack: e?.stack ? e.stack.slice(0, 500) : undefined } });
      return { code: FieldExecuteCode.Error, msg: `捷径执行异常: ${e?.message || String(e)}` };
    }
  },
});

export default fieldDecoratorKit;
