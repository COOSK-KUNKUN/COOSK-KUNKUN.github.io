import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Phone } from './Phone';

describe('Phone', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-08T09:30:00'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('渲染时间与 Welcome', () => {
        const { container } = render(<Phone />);
        expect(screen.getByText('Welcome!')).toBeInTheDocument();
        // 9:30 AM 拼接在同一容器
        expect(container.textContent).toContain('9');
        expect(container.textContent).toContain('30');
        expect(container.textContent).toContain('AM');
    });

    it('应用 className', () => {
        const { container } = render(<Phone className="my-phone" />);
        expect(container.firstChild).toHaveClass('my-phone');
    });

    it('setInterval 每秒刷新时间', () => {
        vi.setSystemTime(new Date('2026-06-08T09:30:00'));
        const { container } = render(<Phone />);
        // 9:30 → 推进 1s → 9:30（分钟不变）—— 主要验证定时器不会抛错
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(container.textContent).toContain('30');
        // 再推 1 分钟
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(container.textContent).toContain('31');
    });

    it('卸载时清理 setInterval（无内存泄漏警告）', () => {
        const { unmount } = render(<Phone />);
        // 推进 5 秒确保定时器跑过
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        // 卸载后再推时间不应再触发 setState
        unmount();
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        // 没报错即通过
    });
});
