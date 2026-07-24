import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';

// 字体注入和导出在 jsdom 下没有意义；统一打桩
const prepareWeddingFontsForExport = vi.fn(() => Promise.resolve('/* mocked font css */'));
vi.mock('./fonts', () => ({
    injectWeddingFonts: vi.fn(),
    prepareWeddingFontsForExport: (...args: unknown[]) =>
        (prepareWeddingFontsForExport as unknown as (...a: unknown[]) => unknown)(...args),
    WEDDING_FONT_FAMILY: 'sans-serif',
}));

const domToCanvas = vi.fn();
vi.mock('modern-screenshot', () => ({
    domToCanvas: (...args: unknown[]) => (domToCanvas as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { WeddingInvitation, WeddingInvitationExportButton, type WeddingInvitationRef } from './WeddingInvitation';

const fakeCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
};

const makeFakeCanvas = () => {
    const canvas = {
        width: 800,
        height: 1200,
        getContext: vi.fn(() => fakeCtx),
        toDataURL: vi.fn(() => 'data:image/png;base64,AAA'),
    };
    return canvas;
};

beforeEach(() => {
    prepareWeddingFontsForExport.mockClear();
    domToCanvas.mockReset();
    domToCanvas.mockResolvedValue(makeFakeCanvas());
});

describe('WeddingInvitation', () => {
    describe('默认渲染', () => {
        it('使用默认字段渲染请柬', () => {
            render(<WeddingInvitation />);
            expect(screen.getByText('小狸')).toBeInTheDocument();
            expect(screen.getByText('小兔')).toBeInTheDocument();
            expect(screen.getByText('Wedding Invitation')).toBeInTheDocument();
            expect(screen.getByText('婚礼时间')).toBeInTheDocument();
        });

        it('subtitle 默认渲染内置合照标题图（alt="集合啦 婚礼森友会"）', () => {
            render(<WeddingInvitation />);
            const subImg = screen.getByAltText('集合啦 婚礼森友会') as HTMLImageElement;
            expect(subImg).toBeInTheDocument();
            expect(subImg.src).toMatch(/wedding\.(webp|png|jpg)$/);
        });

        it('custom subtitle 替换默认标题图', () => {
            render(<WeddingInvitation subtitle={<span data-testid="custom-sub">My Wedding</span>} />);
            expect(screen.getByTestId('custom-sub')).toBeInTheDocument();
            expect(screen.queryByAltText('集合啦 婚礼森友会')).not.toBeInTheDocument();
        });
    });

    describe('自定义字段', () => {
        it('所有文本字段都透传', () => {
            render(
                <WeddingInvitation
                    groomName="A"
                    brideName="B"
                    date="2030.01.01"
                    weekday="星期一"
                    time="11:00 AM"
                    venue="V"
                    address="Addr"
                    message="邀请你来玩"
                />
            );
            expect(screen.getByText('A')).toBeInTheDocument();
            expect(screen.getByText('B')).toBeInTheDocument();
            expect(screen.getByText('2030.01.01')).toBeInTheDocument();
            expect(screen.getByText('V')).toBeInTheDocument();
            expect(screen.getByText('邀请你来玩')).toBeInTheDocument();
        });

        it('lotteryLabel / lotteryHint 透传', () => {
            render(<WeddingInvitation lotteryLabel="抽奖啦" lotteryHint="保留票根" />);
            expect(screen.getByText('抽奖啦')).toBeInTheDocument();
            expect(screen.getByText('保留票根')).toBeInTheDocument();
        });
    });

    describe('brideAndGroomImage 可更换图片', () => {
        it('未传时使用内置默认图（src 包含 brideandgroom.webp）', () => {
            render(<WeddingInvitation />);
            const img = screen.getByAltText('bride and groom') as HTMLImageElement;
            expect(img).toBeInTheDocument();
            expect(img.src).toMatch(/brideandgroom\.webp$/);
        });

        it('传 URL 字符串时替换默认合照', () => {
            render(<WeddingInvitation brideAndGroomImage="https://example.com/custom.png" />);
            const img = screen.getByAltText('bride and groom') as HTMLImageElement;
            expect(img.src).toBe('https://example.com/custom.png');
        });

        it('传 data URL 也可', () => {
            const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
            render(<WeddingInvitation brideAndGroomImage={dataUrl} />);
            const img = screen.getByAltText('bride and groom') as HTMLImageElement;
            expect(img.src).toBe(dataUrl);
        });

        it('可与其它 props 一起组合使用', () => {
            render(
                <WeddingInvitation brideAndGroomImage="https://example.com/u.png" brideName="Alice" groomName="Bob" />
            );
            const img = screen.getByAltText('bride and groom') as HTMLImageElement;
            expect(img.src).toBe('https://example.com/u.png');
            expect(screen.getByText('Alice')).toBeInTheDocument();
            expect(screen.getByText('Bob')).toBeInTheDocument();
        });
    });

    describe('showLotteryNumber', () => {
        it('默认 true 时渲染抽奖区', () => {
            render(<WeddingInvitation />);
            expect(screen.getByText('婚礼抽奖券')).toBeInTheDocument();
            expect(screen.getByText('抽奖码')).toBeInTheDocument();
        });

        it('false 时不渲染抽奖区', () => {
            render(<WeddingInvitation showLotteryNumber={false} />);
            expect(screen.queryByText('婚礼抽奖券')).not.toBeInTheDocument();
            expect(screen.queryByText('抽奖码')).not.toBeInTheDocument();
        });
    });

    describe('className / style 透传', () => {
        it('className 拼到根节点', () => {
            const { container } = render(<WeddingInvitation className="my-card" />);
            const root = container.firstChild as HTMLElement;
            expect(root.className).toMatch(/my-card/);
        });

        it('style 透传到根节点', () => {
            const { container } = render(<WeddingInvitation style={{ marginTop: 10 }} />);
            const root = container.firstChild as HTMLElement;
            expect(root.style.marginTop).toBe('10px');
        });
    });

    describe('ref', () => {
        it('暴露 exportAsImage 与 getElement', () => {
            const ref = createRef<WeddingInvitationRef>();
            render(<WeddingInvitation ref={ref} />);
            expect(typeof ref.current?.exportAsImage).toBe('function');
            expect(ref.current?.getElement()).toBeInstanceOf(HTMLDivElement);
        });

        it('导出按钮：点击调用 ref.exportAsImage', async () => {
            const user = userEvent.setup();
            const ref = createRef<WeddingInvitationRef>();
            render(
                <>
                    <WeddingInvitation ref={ref} />
                    <WeddingInvitationExportButton targetRef={ref} />
                </>
            );
            const spy = vi.spyOn(ref.current!, 'exportAsImage').mockResolvedValue();
            await user.click(screen.getByRole('button', { name: /保存为图片/ }));
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('exportAsImage 行为', () => {
        it('成功导出时调用 domToCanvas + 触发 a.click() 下载', async () => {
            const ref = createRef<WeddingInvitationRef>();
            const { container } = render(<WeddingInvitation ref={ref} />);

            const clickSpy = vi.fn();
            const origCreate = document.createElement.bind(document);
            const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                const el = origCreate(tag);
                if (tag === 'a') {
                    el.click = clickSpy;
                }
                return el;
            });

            await act(async () => {
                await ref.current!.exportAsImage('test-card');
            });

            expect(prepareWeddingFontsForExport).toHaveBeenCalled();
            expect(domToCanvas).toHaveBeenCalled();
            expect(fakeCtx.arc).toHaveBeenCalledTimes(2);
            expect(fakeCtx.save).toHaveBeenCalled();
            expect(fakeCtx.restore).toHaveBeenCalled();
            expect(clickSpy).toHaveBeenCalled();

            createSpy.mockRestore();

            const style = container.querySelector('style[data-wedding-export-fonts]');
            expect(style).not.toBeInTheDocument();
        });

        it('默认 filename 不带 .png 时自动补 .png', async () => {
            const ref = createRef<WeddingInvitationRef>();
            render(<WeddingInvitation ref={ref} />);
            let capturedName = '';
            const origCreate = document.createElement.bind(document);
            const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                const el = origCreate(tag);
                if (tag === 'a') {
                    Object.defineProperty(el, 'download', {
                        set(v: string) {
                            capturedName = v;
                        },
                        get() {
                            return capturedName;
                        },
                    });
                    el.click = vi.fn();
                }
                return el;
            });

            await act(async () => {
                await ref.current!.exportAsImage('my-card');
            });
            expect(capturedName).toBe('my-card.png');

            await act(async () => {
                await ref.current!.exportAsImage('already.png');
            });
            expect(capturedName).toBe('already.png');

            createSpy.mockRestore();
        });

        it('modern-screenshot 返回空 dataURL 时抛错', async () => {
            const ref = createRef<WeddingInvitationRef>();
            const empty = makeFakeCanvas();
            empty.toDataURL = vi.fn(() => 'data:,');
            domToCanvas.mockResolvedValueOnce(empty);
            render(<WeddingInvitation ref={ref} />);

            await expect(ref.current!.exportAsImage('x')).rejects.toThrow(/modern-screenshot/);
        });

        it('缺失根节点时静默 no-op', async () => {
            const ref = createRef<WeddingInvitationRef>();
            const { unmount } = render(<WeddingInvitation ref={ref} />);
            const oldRef = ref.current!;
            unmount();
            await expect(oldRef.exportAsImage('x')).resolves.toBeUndefined();
        });

        it('导出后临时 mask / font 样式被恢复', async () => {
            const ref = createRef<WeddingInvitationRef>();
            const { container } = render(<WeddingInvitation ref={ref} />);
            const root = container.firstChild as HTMLElement;

            // 初始时不应有临时 style 子节点
            expect(root.querySelector('style[data-wedding-export-fonts]')).toBeNull();

            await act(async () => {
                await ref.current!.exportAsImage('x');
            });

            // 导出后临时 style 应被移除
            expect(root.querySelector('style[data-wedding-export-fonts]')).toBeNull();
        });
    });
});

describe('WeddingInvitationExportButton', () => {
    it('exportAsImage 抛错时弹 alert 并恢复按钮可点', async () => {
        const user = userEvent.setup();
        const fakeRef = {
            current: {
                exportAsImage: vi.fn(() => Promise.reject(new Error('boom'))),
                getElement: () => null,
            },
        } as unknown as React.MutableRefObject<WeddingInvitationRef | null>;
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<WeddingInvitationExportButton targetRef={fakeRef} />);

        const btn = screen.getByRole('button', { name: /保存为图片/ });
        await user.click(btn);

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
        });
        expect(errorSpy).toHaveBeenCalled();
        expect(btn).not.toBeDisabled();

        alertSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('导出中按钮文案变为"生成中…"且禁用', async () => {
        const fakeRef = {
            current: {
                exportAsImage: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50))),
                getElement: () => null,
            },
        } as unknown as React.MutableRefObject<WeddingInvitationRef | null>;
        const user = userEvent.setup();
        render(<WeddingInvitationExportButton targetRef={fakeRef} />);

        const btn = screen.getByRole('button', { name: /保存为图片/ });
        await user.click(btn);

        // 导出过程中按钮文案变更
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /生成中/ })).toBeDisabled();
        });
    });

    it('自定义 children 替换默认文案', () => {
        const fakeRef = {
            current: {
                exportAsImage: vi.fn(),
                getElement: () => null,
            },
        } as unknown as React.MutableRefObject<WeddingInvitationRef | null>;
        render(<WeddingInvitationExportButton targetRef={fakeRef}>下载请柬</WeddingInvitationExportButton>);
        expect(screen.getByRole('button', { name: '下载请柬' })).toBeInTheDocument();
    });
});
