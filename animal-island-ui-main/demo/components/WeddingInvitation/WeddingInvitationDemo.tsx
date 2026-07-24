import React, { useRef, useState } from 'react';
import { WeddingInvitation, WeddingInvitationExportButton } from './Wedding';
import type { WeddingInvitationRef } from './Wedding';
import { Input, Switch } from '../../../src';
import {
    CodeBlock,
    ApiTable,
    ApiRow,
    sectionStyle,
    sectionTitleStyle,
    tagStyle,
    demoBodyStyle,
    labelStyle,
} from '../../tools';

interface FieldProps {
    label: string;
    children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: '#725d42', fontWeight: 600 }}>{label}</span>
        {children}
    </div>
);

const WeddingInvitationDemo: React.FC = () => {
    const [groomName, setGroomName] = useState('小狸');
    const [brideName, setBrideName] = useState('小兔');
    const [date, setDate] = useState('2026.06.15');
    const [weekday, setWeekday] = useState('星期六');
    const [time, setTime] = useState('10:00 AM');
    const [venue, setVenue] = useState('彩虹岛 · 樱花广场');
    const [address, setAddress] = useState('动物之森 · 无人岛 · K.K. 演奏台前');
    const [title, setTitle] = useState('Wedding Invitation');
    const [message, setMessage] = useState(
        '哎呀，恭喜恭喜！我们要在小岛上举办婚礼啦~ 诚挚邀请您一同前来见证这个被花瓣和音符包围的日子！'
    );
    const [showLotteryNumber, setShowLotteryNumber] = useState(true);
    const [lotteryNumber, setLotteryNumber] = useState('0001');
    const [lotteryLabel, setLotteryLabel] = useState('LUCKY NUMBER');
    const [lotteryHint, setLotteryHint] = useState('凭此号码参与现场抽奖 · Keep this stub for the lucky draw');
    const [brideAndGroomImage, setBrideAndGroomImage] = useState<string | undefined>(undefined);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setBrideAndGroomImage(reader.result as string);
        reader.readAsDataURL(file);
        // 重置 input.value 以便重复上传同一文件
        e.target.value = '';
    };

    const cardRef = useRef<WeddingInvitationRef>(null);

    return (
        <div style={sectionStyle}>
            <div style={sectionTitleStyle}>
                WeddingInvitation（仅展示，组件库暂不包含此组件） <span style={tagStyle}>婚礼请柬</span>
            </div>
            <div style={labelStyle}>
                动物主题婚礼请柬，定位为「设计 → 导出图片 → 分享 / 打印」。组件本身只渲染卡面，导出按钮通过 ref
                在外部触发。
            </div>

            <div
                style={{
                    ...demoBodyStyle,
                    padding: 32,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    gap: 45,
                    flexWrap: 'wrap',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 16,
                    }}
                >
                    <WeddingInvitation
                        ref={cardRef}
                        brideName={brideName}
                        groomName={groomName}
                        date={date}
                        weekday={weekday}
                        time={time}
                        venue={venue}
                        address={address}
                        title={title}
                        message={message}
                        showLotteryNumber={showLotteryNumber}
                        lotteryNumber={lotteryNumber}
                        lotteryLabel={lotteryLabel}
                        lotteryHint={lotteryHint}
                        brideAndGroomImage={brideAndGroomImage}
                    />
                </div>

                <div
                    style={{
                        maxWidth: 420,
                        minWidth: 300,
                        padding: 20,
                        borderRadius: 24,
                        background: '#F8F4E8',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}
                >
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#725d42' }}>编辑请柬</div>

                    <Field label="新郎新娘合照">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label
                                style={{
                                    flex: 1,
                                    padding: '6px 10px',
                                    borderRadius: 8,
                                    border: '2px solid #e9d6a8',
                                    background: '#fff',
                                    fontSize: 12,
                                    color: brideAndGroomImage ? '#5b4628' : '#a9967a',
                                    cursor: 'pointer',
                                    textAlign: 'center',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {brideAndGroomImage ? '✓ 已上传自定义图片（点击更换）' : '点击上传图片（默认内置合照）'}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                    style={{ display: 'none' }}
                                />
                            </label>
                            {brideAndGroomImage && (
                                <button
                                    type="button"
                                    onClick={() => setBrideAndGroomImage(undefined)}
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: 8,
                                        border: '2px solid #e9d6a8',
                                        background: '#fff',
                                        fontSize: 12,
                                        color: '#725d42',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    恢复默认
                                </button>
                            )}
                        </div>
                    </Field>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Field label="新娘">
                            <Input value={brideName} onChange={(e) => setBrideName(e.target.value)} />
                        </Field>
                        <Field label="新郎">
                            <Input value={groomName} onChange={(e) => setGroomName(e.target.value)} />
                        </Field>
                    </div>

                    <Field label="主标题">
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <Field label="日期">
                            <Input value={date} onChange={(e) => setDate(e.target.value)} />
                        </Field>
                        <Field label="星期">
                            <Input value={weekday} onChange={(e) => setWeekday(e.target.value)} />
                        </Field>
                        <Field label="时间">
                            <Input value={time} onChange={(e) => setTime(e.target.value)} />
                        </Field>
                    </div>

                    <Field label="地点">
                        <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
                    </Field>
                    <Field label="详细地址">
                        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                    </Field>

                    <Field label="邀请正文">
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={3}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: '2px solid #e9d6a8',
                                background: '#fff',
                                fontSize: 13,
                                color: '#5b4628',
                                resize: 'vertical',
                                fontFamily: 'inherit',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </Field>

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 0',
                        }}
                    >
                        <span style={{ fontSize: 12, color: '#725d42', fontWeight: 600 }}>显示抽奖券</span>
                        <Switch checked={showLotteryNumber} onChange={setShowLotteryNumber} />
                    </div>

                    {showLotteryNumber && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <Field label="抽奖号码">
                                    <Input value={lotteryNumber} onChange={(e) => setLotteryNumber(e.target.value)} />
                                </Field>
                                <Field label="抽奖区标题">
                                    <Input value={lotteryLabel} onChange={(e) => setLotteryLabel(e.target.value)} />
                                </Field>
                            </div>
                            <Field label="抽奖区说明">
                                <Input value={lotteryHint} onChange={(e) => setLotteryHint(e.target.value)} />
                            </Field>
                        </>
                    )}

                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center' }}>
                        <WeddingInvitationExportButton
                            targetRef={cardRef}
                            filename={`${brideName}-${groomName}-请柬`}
                        />
                    </div>
                </div>
            </div>

            <CodeBlock
                code={`import { useRef } from 'react';
import {
    WeddingInvitation,
    WeddingInvitationExportButton,
} from 'animal-island-ui';
import type { WeddingInvitationRef } from 'animal-island-ui';

const ref = useRef<WeddingInvitationRef>(null);

<div style={{ display: 'flex', gap: 45, alignItems: 'flex-start' }}>
    <WeddingInvitation
        ref={ref}
        brideName="小兔"
        groomName="小狸"
        date="2026.06.15"
        venue="彩虹岛 · 樱花广场"
    />
    <WeddingInvitationExportButton
        targetRef={ref}
        filename="我们的请柬"
    />
</div>

// 也可直接通过 ref 调用：
ref.current?.exportAsImage('wedding');`}
            />

            <ApiTable rows={WEDDING_API} />

            <div style={{ ...labelStyle, marginTop: 12 }}>WeddingInvitation Ref 方法</div>
            <ApiTable rows={WEDDING_REF_API} />

            <div style={{ ...labelStyle, marginTop: 12 }}>WeddingInvitationExportButton Props</div>
            <ApiTable rows={EXPORT_BTN_API} />
        </div>
    );
};

const WEDDING_API: ApiRow[] = [
    { prop: 'brideName', desc: '新娘名字', type: 'string', defaultVal: '小兔' },
    { prop: 'groomName', desc: '新郎名字', type: 'string', defaultVal: '小狸' },
    { prop: 'date', desc: '婚礼日期', type: 'string', defaultVal: '2026.06.15' },
    { prop: 'weekday', desc: '星期', type: 'string', defaultVal: '星期六' },
    { prop: 'time', desc: '时间', type: 'string', defaultVal: '10:00 AM' },
    { prop: 'venue', desc: '婚礼地点', type: 'string', defaultVal: '彩虹岛 · 樱花广场' },
    { prop: 'address', desc: '详细地址', type: 'string', defaultVal: '-' },
    { prop: 'title', desc: '英文主标题', type: 'ReactNode', defaultVal: 'Wedding Invitation' },
    {
        prop: 'subtitle',
        desc: '中文副标题（默认渲染 wedding.PNG 标题图）',
        type: 'ReactNode',
        defaultVal: '<img src={wedding.PNG} />',
    },
    { prop: 'message', desc: '邀请正文', type: 'ReactNode', defaultVal: '-' },
    { prop: 'showLotteryNumber', desc: '是否显示底部抽奖号码区', type: 'boolean', defaultVal: 'true' },
    { prop: 'lotteryNumber', desc: '抽奖号码', type: 'string', defaultVal: '0001' },
    { prop: 'lotteryLabel', desc: '抽奖区标题', type: 'ReactNode', defaultVal: 'LUCKY NUMBER' },
    { prop: 'lotteryHint', desc: '抽奖区底部说明', type: 'ReactNode', defaultVal: '凭此号码参与现场抽奖…' },
    {
        prop: 'brideAndGroomImage',
        desc: '新郎新娘合照图片（不传则使用内置默认图）',
        type: 'string',
        defaultVal: '-',
    },
    { prop: 'className', desc: '自定义类名', type: 'string', defaultVal: '-' },
    { prop: 'style', desc: '自定义样式', type: 'CSSProperties', defaultVal: '-' },
];

const WEDDING_REF_API: ApiRow[] = [
    {
        prop: 'exportAsImage',
        desc: '导出为 PNG 并触发下载',
        type: '(filename?: string) => Promise<void>',
        defaultVal: '-',
    },
    { prop: 'getElement', desc: '获取请柬根 DOM', type: '() => HTMLDivElement | null', defaultVal: '-' },
];

const EXPORT_BTN_API: ApiRow[] = [
    {
        prop: 'targetRef',
        desc: '关联的 WeddingInvitation ref',
        type: 'RefObject<WeddingInvitationRef>',
        defaultVal: '-',
    },
    { prop: 'filename', desc: '文件名（不含扩展名）', type: 'string', defaultVal: 'wedding-invitation' },
    { prop: 'children', desc: '按钮文案', type: 'ReactNode', defaultVal: '保存为图片' },
    { prop: 'className', desc: '自定义类名', type: 'string', defaultVal: '-' },
    { prop: 'style', desc: '自定义样式', type: 'CSSProperties', defaultVal: '-' },
];

export default WeddingInvitationDemo;
