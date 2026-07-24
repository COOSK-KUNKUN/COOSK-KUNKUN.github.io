import React from 'react';
import styles from './wallet.module.less';
import { Icon } from '../Icon';
import bagIcon from '../../assets/img/icons/items/item-022.png';

export type WalletSize = 'small' | 'medium' | 'large';

export interface WalletProps {
    /** 金额数值，数字会按千分位格式化；字符串则原样展示 */
    value?: number | string;
    /** 自定义货币图标，默认使用动物主题钱袋 */
    icon?: React.ReactNode;
    /** 尺寸预设 */
    size?: WalletSize;
    /** 千分位分隔符，默认 ","，传 "" 可关闭 */
    thousandSeparator?: string;
    className?: string;
    style?: React.CSSProperties;
}

/** 数值格式化：仅对 number 类型按千分位插入分隔符 */
const formatValue = (value: WalletProps['value'], sep: string): string => {
    if (value === undefined || value === null) return '00,000';
    if (typeof value !== 'number') return String(value);
    if (!sep) return String(value);
    const sign = value < 0 ? '-' : '';
    const [int, frac] = Math.abs(value).toString().split('.');
    const intWithSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return frac ? `${sign}${intWithSep}.${frac}` : `${sign}${intWithSep}`;
};

const SIZE_CLASS: Record<WalletSize, string> = {
    small: styles['size-small'],
    medium: '',
    large: styles['size-large'],
};

export const Wallet: React.FC<WalletProps> = ({
    value = '00,000',
    icon,
    size = 'medium',
    thousandSeparator = ',',
    className,
    style,
}) => {
    const cls = [styles.wallet, SIZE_CLASS[size], className].filter(Boolean).join(' ');
    return (
        <div className={cls} style={style}>
            {icon ? (
                <div className={styles.bagSlot} aria-hidden="true">
                    {icon}
                </div>
            ) : (
                <div className={styles.bagSlot} aria-hidden="true">
                    <Icon src={bagIcon} size="80%" />
                </div>
            )}
            <div className={styles.pill}>
                <span className={styles.value}>{formatValue(value, thousandSeparator)}</span>
            </div>
        </div>
    );
};

Wallet.displayName = 'Wallet';
