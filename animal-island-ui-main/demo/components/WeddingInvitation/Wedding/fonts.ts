// 组件需要的字体文件 —— 不依赖外部 @fontsource CSS，
// 这样网页渲染、PNG 导出都可以用同一份资源稳定获取。
//
// ⚠️ 体积优化（P1）：这些中文 woff2 合计 ~3.4MB。过去用顶层静态 `?url` import，
// 会把字体 URL 模块固定进 WeddingInvitation 的静态依赖图 —— 在 CJS 单文件产物里
// 无法被摇除，消费者即使没用婚礼请柬也会被打包器拉入这些资源。
// 现改为「按需动态 import()」：字体 URL 只有在 injectWeddingFonts /
// prepareWeddingFontsForExport 真正执行时才被加载，彻底脱离静态依赖图。
//
// 注意：仅引入项目实际会用到的字重，且只覆盖以下 subset：
//   - Nunito       latin
//   - Noto Sans SC latin + chinese-simplified

interface FontDef {
    family: string;
    weight: number;
    /** 懒加载该字重 woff2，resolve 为最终发布产物里的 URL */
    load: () => Promise<string>;
}

const url = (m: { default: string }): string => m.default;

const WEDDING_FONTS: FontDef[] = [
    // ---------- Nunito (拉丁) ----------
    {
        family: 'Nunito',
        weight: 500,
        load: () => import('@fontsource/nunito/files/nunito-latin-500-normal.woff2?url').then(url),
    },
    {
        family: 'Nunito',
        weight: 700,
        load: () => import('@fontsource/nunito/files/nunito-latin-700-normal.woff2?url').then(url),
    },
    {
        family: 'Nunito',
        weight: 900,
        load: () => import('@fontsource/nunito/files/nunito-latin-900-normal.woff2?url').then(url),
    },
    // ---------- Noto Sans SC (拉丁) ----------
    {
        family: 'Noto Sans SC',
        weight: 400,
        load: () => import('@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff2?url').then(url),
    },
    {
        family: 'Noto Sans SC',
        weight: 500,
        load: () => import('@fontsource/noto-sans-sc/files/noto-sans-sc-latin-500-normal.woff2?url').then(url),
    },
    {
        family: 'Noto Sans SC',
        weight: 700,
        load: () => import('@fontsource/noto-sans-sc/files/noto-sans-sc-latin-700-normal.woff2?url').then(url),
    },
    // ---------- Noto Sans SC (简体中文 · 大文件) ----------
    {
        family: 'Noto Sans SC',
        weight: 400,
        load: () =>
            import('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2?url').then(url),
    },
    {
        family: 'Noto Sans SC',
        weight: 500,
        load: () =>
            import('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2?url').then(url),
    },
    {
        family: 'Noto Sans SC',
        weight: 700,
        load: () =>
            import('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff2?url').then(url),
    },
];

/** 组件统一字体栈 —— 所有 .envelope 内的 text 元素继承此值 */
export const WEDDING_FONT_FAMILY =
    "Nunito, 'Noto Sans SC', 'HarmonyOS Sans SC', 'MiSans', -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

const fontFaceRule = (family: string, weight: number, src: string): string =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('${src}') format('woff2');}`;

/** 并发解析全部字重的 woff2 URL */
const resolveFontUrls = (): Promise<Array<FontDef & { url: string }>> =>
    Promise.all(WEDDING_FONTS.map(async (f) => ({ ...f, url: await f.load() })));

// ---------- 网页用：首次调用时懒加载字体 URL，把 @font-face 注入 <head> ----------
let injected = false;
export const injectWeddingFonts = async (): Promise<void> => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const fonts = await resolveFontUrls();
    const style = document.createElement('style');
    style.setAttribute('data-wedding-fonts', '');
    style.textContent = fonts.map(({ family, weight, url }) => fontFaceRule(family, weight, url)).join('\n');
    document.head.appendChild(style);
};

// ---------- 导出 PNG 用：把所有 woff2 抓成 ArrayBuffer，
// 一次性完成「FontFace 注册到 document.fonts」+「拼出 data URL @font-face cssText」。
// 后者用于塞到截图根节点的 <style> 里 —— Chromium 在 SVG-as-image 渲染时
// 不读 document.fonts，必须把 @font-face 直接放进 foreignObject 的 HTML 里才会应用 ----------
let exportPrepPromise: Promise<string> | null = null;
export const prepareWeddingFontsForExport = (): Promise<string> => {
    if (exportPrepPromise) return exportPrepPromise;
    if (typeof document === 'undefined') {
        exportPrepPromise = Promise.resolve('');
        return exportPrepPromise;
    }
    exportPrepPromise = (async () => {
        const fonts = await resolveFontUrls();
        const rules: string[] = [];
        await Promise.all(
            fonts.map(async ({ family, weight, url }) => {
                try {
                    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
                    if (!r.ok) return;
                    const buf = await r.arrayBuffer();

                    // 1) 注册到 document.fonts —— 让网页本身也能立刻用上
                    if (typeof FontFace !== 'undefined' && document.fonts) {
                        try {
                            const ff = new FontFace(family, buf, {
                                weight: String(weight),
                                style: 'normal',
                                display: 'swap',
                            });
                            await ff.load();
                            document.fonts.add(ff);
                        } catch {
                            // FontFace 注册失败也不阻塞 data URL 生成
                        }
                    }

                    // 2) 转 data URL —— 给截图用
                    const blob = new Blob([buf], { type: 'font/woff2' });
                    const dataUrl: string = await new Promise((resolve) => {
                        const fr = new FileReader();
                        fr.onload = () => resolve(fr.result as string);
                        fr.readAsDataURL(blob);
                    });
                    rules.push(fontFaceRule(family, weight, dataUrl));
                } catch (err) {
                    console.warn('[WeddingInvitation] 字体抓取失败：', url, err);
                }
            })
        );
        try {
            await document.fonts?.ready;
        } catch {
            // 容错
        }
        console.warn(`[WeddingInvitation] 字体已就绪：${rules.length}/${WEDDING_FONTS.length}`);
        return rules.join('\n');
    })();
    return exportPrepPromise;
};
