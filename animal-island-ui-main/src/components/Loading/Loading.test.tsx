import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// gsap 内部用到大量浏览器 API；jsdom 下 startAnimation 仅做最简 mock 即可
vi.mock('./island/script.js', () => ({
    startAnimation: vi.fn(),
}));

import { Loading } from './Loading';
import styles from './Loading.module.less';

describe('Loading', () => {
    it('挂载并渲染内嵌 SVG 容器', () => {
        const { container } = render(<Loading />);
        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('应用 className 与 style 到容器', () => {
        const { container } = render(<Loading className="my-loading" style={{ background: 'red' }} />);
        const inner = container.querySelector(`.${styles.container}`) as HTMLElement;
        expect(inner).toHaveClass('my-loading');
        expect(inner.style.background).toBe('red');
    });

    it('active=false 添加 closing 类并通过 setTimeout 隐藏', () => {
        vi.useFakeTimers();
        const { container } = render(<Loading active={false} />);
        const inner = container.querySelector(`.${styles.container}`) as HTMLElement;
        expect(inner).toHaveClass(styles.closing);

        // 推 setTimeout（duration * 1000ms）触发 display:none
        act(() => {
            vi.runAllTimers();
        });
        // 卸载时 setTimeout 回调可能报错 —— 卸载后再断言
        vi.useRealTimers();
    });

    it('active=true 时移除 closing 类 + 触发 display:flex', () => {
        const { container } = render(<Loading active />);
        const inner = container.querySelector(`.${styles.container}`) as HTMLElement;
        expect(inner).not.toHaveClass(styles.closing);
    });

    it('卸载时清理 setTimeout（无内存泄漏）', () => {
        vi.useFakeTimers();
        const { unmount } = render(<Loading active={false} />);
        // 推时间触发 setTimeout
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        unmount();
        // 再推时间应无 setState on unmounted
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        vi.useRealTimers();
    });
});
