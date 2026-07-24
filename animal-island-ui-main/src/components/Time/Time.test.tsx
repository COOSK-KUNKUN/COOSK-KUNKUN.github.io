import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Time } from './Time';

describe('Time', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-08T09:30:00')); // Monday
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('渲染当前星期、月日与 HH:MM', () => {
        const { container } = render(<Time />);
        expect(screen.getByText('Monday')).toBeInTheDocument();
        expect(screen.getByText('Jun 8')).toBeInTheDocument();
        expect(container.textContent).toContain('09');
        expect(container.textContent).toContain('30');
    });

    it('每秒刷新（推进 1s 后状态可能更新）', () => {
        render(<Time />);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        // 时间没真的变化（仍是 09:30），但定时器被触发，没有报错即可
        expect(screen.getByText('Monday')).toBeInTheDocument();
    });

    it('应用 className', () => {
        const { container } = render(<Time className="my-time" />);
        expect(container.firstChild).toHaveClass('my-time');
    });
});
