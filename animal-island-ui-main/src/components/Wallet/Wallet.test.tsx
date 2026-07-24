import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wallet } from './Wallet';
import styles from './wallet.module.less';

describe('Wallet', () => {
    it('数字按千分位格式化', () => {
        render(<Wallet value={1234567} />);
        expect(screen.getByText('1,234,567')).toBeInTheDocument();
    });

    it('字符串原样展示', () => {
        render(<Wallet value="ABC" />);
        expect(screen.getByText('ABC')).toBeInTheDocument();
    });

    it('value 缺省时显示占位 00,000', () => {
        render(<Wallet />);
        expect(screen.getByText('00,000')).toBeInTheDocument();
    });

    it('thousandSeparator 为空时不插入分隔符', () => {
        render(<Wallet value={1234567} thousandSeparator="" />);
        expect(screen.getByText('1234567')).toBeInTheDocument();
    });

    it('size=small 应用对应类', () => {
        const { container } = render(<Wallet size="small" />);
        expect(container.firstChild).toHaveClass(styles['size-small']);
    });

    it('支持自定义 icon', () => {
        render(<Wallet icon={<span data-testid="custom-icon">$</span>} />);
        expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    });

    it('负数千分位前保留负号', () => {
        render(<Wallet value={-12345} />);
        expect(screen.getByText('-12,345')).toBeInTheDocument();
    });
});
