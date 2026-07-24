import React, { useState, useEffect } from 'react';
import styles from './phone.module.less';
import { Icon, IconName } from '../Icon';

export interface PhoneProps {
    className?: string;
}

interface App {
    id: string;
    iconName: IconName;
    color: string;
    offset?: boolean;
    hasNewMessage?: boolean;
    iconStyle?: React.CSSProperties;
}

const apps: App[] = [
    { id: 'camera', iconName: 'icon-camera', color: '#B77DEE', hasNewMessage: true },
    { id: 'app', iconName: 'icon-miles', color: '#889DF0', offset: true },
    { id: 'critterpedia', iconName: 'icon-critterpedia', color: '#F7CD67', iconStyle: { width: '105px' } },
    { id: 'diy', iconName: 'icon-diy', color: '#E59266' },
    { id: 'shopping', iconName: 'icon-design', color: '#F8A6B2' },
    { id: 'variant', iconName: 'icon-map', color: '#82D5BB', hasNewMessage: true, iconStyle: { width: '90px' } },
    { id: 'design', iconName: 'icon-variant', color: '#8AC68A', iconStyle: { width: '80px' } },
    { id: 'map', iconName: 'icon-helicopter', color: '#FC736D' },
    { id: 'chat', iconName: 'icon-chat', color: '#D1DA49' },
];

export const Phone: React.FC<PhoneProps> = ({ className }) => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const hours = time.getHours();
    const minutes = time.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');

    return (
        <div className={`${styles.phoneContainer} ${className || ''}`}>
            <div className={styles.phone}>
                <div className={styles.screenContent}>
                    <div className={styles.homeScreen}>
                        <div className={styles.dateDisplay}>
                            <div className={styles.dateDisplayHeader}>
                                <span className={styles.iconWifi} />
                                <div>
                                    {displayHours}
                                    <span className={styles.blink}>:</span>
                                    {displayMinutes}
                                    {ampm}
                                </div>
                                <span className={styles.iconLocation} />
                            </div>
                            <div className={styles.dayText}>Welcome!</div>
                        </div>
                        <div className={styles.appsGrid}>
                            {apps.map((app) => (
                                <div
                                    key={app.id}
                                    className={`${styles.appItem} ${app.offset ? styles.appItemOffset : ''}`}
                                    style={{ backgroundColor: app.color }}
                                >
                                    {app.hasNewMessage && <span className={styles.badge} />}
                                    <Icon
                                        name={app.iconName}
                                        size="100%"
                                        className={`${styles.appIcon} ${app.offset ? styles.appIconOffset : ''}`}
                                        style={{ backgroundSize: '70% auto', ...app.iconStyle }}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className={styles.pageIndicator}>
                            <span className={styles.iconPage} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
