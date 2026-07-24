import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import styles from './weddingInvitation.module.less';
import weddingTitleImg from './img/wedding.webp';
import brideAndGroomImg from './img/brideandgroom.webp';
import { injectWeddingFonts, prepareWeddingFontsForExport } from './fonts';
import { Icon } from '../../../../src';

export interface WeddingInvitationProps {
    /** 新郎名 */
    groomName?: string;
    /** 新娘名 */
    brideName?: string;
    /** 婚礼日期，例如 "2026.06.15" */
    date?: string;
    /** 星期，例如 "星期六" */
    weekday?: string;
    /** 时间，例如 "10:00 AM" */
    time?: string;
    /** 婚礼地点 */
    venue?: string;
    /** 地点详细地址 */
    address?: string;
    /** 标题 */
    title?: React.ReactNode;
    /** 副标题 */
    subtitle?: React.ReactNode;
    /** 主信息（动森风邀请语） */
    message?: React.ReactNode;
    /** 是否显示底部抽奖号码区，默认 true */
    showLotteryNumber?: boolean;
    /** 抽奖号码，默认 '0001' */
    lotteryNumber?: string;
    /** 抽奖号码区前缀文案，默认 'LUCKY NUMBER' */
    lotteryLabel?: React.ReactNode;
    /** 抽奖号码区底部说明文案 */
    lotteryHint?: React.ReactNode;
    /** 自定义新郎新娘合照图片，不传则使用内置默认图 */
    brideAndGroomImage?: string;
    /** 自定义类名 */
    className?: string;
    /** 自定义样式 */
    style?: React.CSSProperties;
}

/** 通过 ref 暴露的方法 */
export interface WeddingInvitationRef {
    /** 把请柬导出为 PNG 图片并触发浏览器下载 */
    exportAsImage: (filename?: string) => Promise<void>;
    /** 获取请柬 DOM 根节点 */
    getElement: () => HTMLDivElement | null;
}

// ---------- Decorative SVGs ----------
const Leaf: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 64 64" width="56" height="56" aria-hidden>
        <path
            d="M8 56 C 8 24, 32 4, 60 6 C 58 36, 38 58, 8 56 Z"
            fill="#8ac68a"
            stroke="#3d5a1a"
            strokeWidth="2.5"
            strokeLinejoin="round"
        />
        <path d="M14 50 C 26 40, 40 26, 56 12" stroke="#3d5a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M22 42 C 28 38, 32 34, 36 30" stroke="#3d5a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M30 48 C 34 44, 38 40, 42 36" stroke="#3d5a1a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
);

const Flower: React.FC<{ color?: string; center?: string; size?: number }> = ({
    color = '#f8a6b2',
    center = '#f7cd67',
    size = 28,
}) => (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        {[0, 72, 144, 216, 288].map((angle) => (
            <ellipse
                key={angle}
                cx="16"
                cy="8"
                rx="5"
                ry="7"
                fill={color}
                stroke="#725d42"
                strokeWidth="1.2"
                transform={`rotate(${angle} 16 16)`}
            />
        ))}
        <circle cx="16" cy="16" r="3.5" fill={center} stroke="#725d42" strokeWidth="1.2" />
    </svg>
);

const Heart: React.FC<{ size?: number }> = ({ size = 64 }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <path
            d="M32 56 C 8 40, 4 22, 16 14 C 24 9, 30 14, 32 20 C 34 14, 40 9, 48 14 C 60 22, 56 40, 32 56 Z"
            fill="#fc736d"
            stroke="#725d42"
            strokeWidth="2.5"
            strokeLinejoin="round"
        />
        <ellipse cx="22" cy="22" rx="3.5" ry="5" fill="#fff" opacity="0.7" transform="rotate(-25 22 22)" />
    </svg>
);

const Star: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = '#f7cd67' }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path
            d="M12 2 L14.5 9 L22 9.5 L16 14.5 L18 22 L12 17.5 L6 22 L8 14.5 L2 9.5 L9.5 9 Z"
            fill={color}
            stroke="#725d42"
            strokeWidth="1.4"
            strokeLinejoin="round"
        />
    </svg>
);

// 剪刀图标（撕开提示）
const ScissorsIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden>
        <g fill="none" stroke="#725d42" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2.4" />
            <circle cx="6" cy="18" r="2.4" />
            <path d="M8 7.5 L21 17 M8 16.5 L21 7" />
        </g>
    </svg>
);

// ============================================
// DOM → PNG（基于 modern-screenshot）
// 字体通过 ./fonts 模块统一管理：网页注入 url 版 @font-face；
// 导出时把同一批 woff2 转 data URL 塞进截图根节点 <style>，
// 解决 Chromium 在 SVG-as-image 渲染时不读 document.fonts 的问题。
// ============================================

// 与 LESS 中 --notch-r / --lottery-h 保持一致 —— 用于在导出 canvas 上手动「打孔」两侧半圆缺口
const NOTCH_RADIUS = 14;
const LOTTERY_HEIGHT = 160;

const exportNodeAsPng = async (node: HTMLElement, filename: string, scale = 2): Promise<void> => {
    // 字体抓取 + FontFace 注册 + 生成内嵌 cssText（首次会慢，结果缓存）
    const [fontCssText, { domToCanvas }] = await Promise.all([
        prepareWeddingFontsForExport(),
        // 懒加载 modern-screenshot —— 仅在用户触发导出时才拉取
        import('modern-screenshot'),
    ]);

    // 临时关掉 mask-image —— 用动态 calc 定位的 mask 在导出管线里位置会偏，
    // 改成下面用 canvas globalCompositeOperation 手动打孔
    // CSSStyleDeclaration 的 webkit* 前缀属性不在标准 lib 类型里，需扩展
    const styleExt = node.style as CSSStyleDeclaration & {
        webkitMaskImage?: string;
    };
    const prevMask = node.style.maskImage;
    const prevWebkitMask = styleExt.webkitMaskImage;
    node.style.maskImage = 'none';
    styleExt.webkitMaskImage = 'none';

    // Chromium 在 SVG-as-image 渲染时不读 document.fonts，
    // 必须把带 data URL 的 @font-face 作为 <style> 子节点塞进截图节点
    const fontStyleEl = document.createElement('style');
    fontStyleEl.setAttribute('data-wedding-export-fonts', '');
    fontStyleEl.textContent = fontCssText;
    node.insertBefore(fontStyleEl, node.firstChild);

    try {
        const canvas = await domToCanvas(node, {
            scale,
            backgroundColor: undefined, // 透明背景，保留圆角的透明区域
            font: { cssText: fontCssText }, // 双保险：modern-screenshot 也内嵌一份
        });

        // 在导出图上手动「打孔」两侧半圆缺口
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const r = NOTCH_RADIUS * scale;
            const y = canvas.height - LOTTERY_HEIGHT * scale;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            for (const x of [0, canvas.width]) {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,') {
            throw new Error('modern-screenshot 返回空 dataURL');
        }

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        fontStyleEl.remove();
        node.style.maskImage = prevMask;
        styleExt.webkitMaskImage = prevWebkitMask;
    }
};

// ---------- 内置下载图标 ----------
const DownloadIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path
            d="M12 3v12m0 0l-5-5m5 5l5-5M4 17v3a1 1 0 001 1h14a1 1 0 001-1v-3"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
        />
    </svg>
);

export const WeddingInvitation = forwardRef<WeddingInvitationRef, WeddingInvitationProps>(
    (
        {
            groomName = '小狸',
            brideName = '小兔',
            date = '2026.06.15',
            weekday = '星期六',
            time = '10:00 AM',
            venue = '彩虹岛 · 樱花广场',
            address = '动物之森 · 无人岛 · K.K. 演奏台前',
            title = 'Wedding Invitation',
            subtitle = <img src={weddingTitleImg} alt="集合啦 婚礼森友会" />,
            message = '哎呀，恭喜恭喜！我们要在小岛上举办婚礼啦~ 诚挚邀请您一同前来见证这个被花瓣和音符包围的日子！',
            showLotteryNumber = true,
            lotteryNumber = '0001',
            lotteryLabel = 'LUCKY NUMBER',
            lotteryHint = '凭此号码参与现场抽奖 · Keep this stub for the lucky draw',
            brideAndGroomImage,
            className,
            style,
        },
        ref
    ) => {
        const rootRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            void injectWeddingFonts();
        }, []);

        const exportAsImage = React.useCallback(async (filename = 'wedding-invitation') => {
            if (!rootRef.current) return;
            await exportNodeAsPng(rootRef.current, filename);
        }, []);

        useImperativeHandle(
            ref,
            () => ({
                exportAsImage,
                getElement: () => rootRef.current,
            }),
            [exportAsImage]
        );

        const cls = [styles.envelope, !showLotteryNumber && styles.noLottery, className].filter(Boolean).join(' ');

        return (
            <div ref={rootRef} className={cls} style={style}>
                {/* 边角装饰 */}
                <Leaf className={`${styles.cornerLeaf} ${styles.tl}`} />
                <Leaf className={`${styles.cornerLeaf} ${styles.tr}`} />
                <Leaf className={`${styles.cornerLeaf} ${styles.bl}`} />
                <Leaf className={`${styles.cornerLeaf} ${styles.br}`} />

                {/* 飘散的花瓣 / 星星 */}
                <span className={`${styles.floatItem} ${styles.f1}`}>
                    <Flower color="#f8a6b2" />
                </span>
                <span className={`${styles.floatItem} ${styles.f2}`}>
                    <Flower color="#ecdf52" center="#e59266" size={22} />
                </span>
                <span className={`${styles.floatItem} ${styles.f3}`}>
                    <Flower color="#b77dee" size={20} />
                </span>
                <span className={`${styles.floatItem} ${styles.s1}`}>
                    <Star color="#f7cd67" />
                </span>
                <span className={`${styles.floatItem} ${styles.s2}`}>
                    <Star color="#82d5bb" size={14} />
                </span>

                <div className={styles.banner}>
                    <span className={styles.bannerLine} />
                    <Star size={16} color="#f7cd67" />
                    <span className={styles.bannerLine} />
                </div>

                <div className={styles.titleEn}>{title}</div>
                <div className={styles.titleZh}>{subtitle}</div>

                <div className={styles.brideAndGroom}>
                    <img src={brideAndGroomImage ?? brideAndGroomImg} alt="bride and groom" />
                </div>

                <div className={styles.coupleRow}>
                    <div className={styles.mascot}>
                        <div className={styles.name}>{brideName}</div>
                    </div>
                    <div className={styles.heartCol}>
                        <Heart size={30} />
                    </div>
                    <div className={styles.mascot}>
                        <div className={styles.name}>{groomName}</div>
                    </div>
                </div>

                <div className={styles.dateCard}>
                    <div className={styles.dateLabel}>婚礼时间</div>
                    <div className={styles.dateValue}>{date}</div>
                    <div className={styles.dateMeta}>
                        <span>{weekday}</span>
                        <span className={styles.dot}>·</span>
                        <span>{time}</span>
                    </div>
                </div>

                <div className={styles.venueCard}>
                    <span className={styles.venueIcon}>
                        <Icon name="icon-map" size={26} />
                    </span>
                    <div className={styles.venueText}>
                        <div className={styles.venueName}>{venue}</div>
                        <div className={styles.venueAddr}>{address}</div>
                    </div>
                </div>

                <div className={styles.message}>{message}</div>

                {showLotteryNumber && (
                    <div className={styles.signatureLottery}>
                        <span>抽奖码</span>
                        <span className={styles.signatureLotteryNo}>
                            <span className={styles.lotteryHash}>NO.</span>
                            {lotteryNumber}
                        </span>
                    </div>
                )}

                {showLotteryNumber && (
                    <div className={styles.lottery}>
                        <span className={styles.tearHint}>
                            <ScissorsIcon />
                            <span>沿虚线剪开</span>
                            <ScissorsIcon />
                        </span>
                        <div className={styles.lotteryTitle}>婚礼抽奖券</div>
                        <div className={styles.lotteryLabel}>
                            <Star size={12} color="#f7cd67" />
                            <span>{lotteryLabel}</span>
                            <Star size={12} color="#f7cd67" />
                        </div>
                        <div className={styles.lotteryNumber}>
                            <span className={styles.lotteryHash}>NO.</span>
                            {lotteryNumber}
                        </div>
                        {lotteryHint && <div className={styles.lotteryHint}>{lotteryHint}</div>}
                    </div>
                )}
            </div>
        );
    }
);

WeddingInvitation.displayName = 'WeddingInvitation';

// ---------- 独立的导出按钮组件（放在请柬旁边） ----------
export interface WeddingInvitationExportButtonProps {
    /** 关联的请柬 ref */
    targetRef: React.RefObject<WeddingInvitationRef>;
    /** 文件名（不含扩展名） */
    filename?: string;
    /** 自定义文案，默认「保存为图片」 */
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const WeddingInvitationExportButton: React.FC<WeddingInvitationExportButtonProps> = ({
    targetRef,
    filename = 'wedding-invitation',
    children = '保存为图片',
    className,
    style,
}) => {
    const [exporting, setExporting] = React.useState(false);
    const handleClick = async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await targetRef.current?.exportAsImage(filename);
        } catch (err) {
            console.error('[WeddingInvitation] 导出图片失败：', err);
            alert(`导出失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setExporting(false);
        }
    };
    return (
        <button
            type="button"
            className={[styles.exportBtn, className].filter(Boolean).join(' ')}
            style={style}
            onClick={handleClick}
            disabled={exporting}
        >
            <DownloadIcon />
            {exporting ? '生成中…' : children}
        </button>
    );
};

WeddingInvitationExportButton.displayName = 'WeddingInvitationExportButton';
