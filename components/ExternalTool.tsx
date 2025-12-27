import React, { useState } from 'react';
import HDImageGenerator from './smart-tools/HDImageGenerator';
import OneClickBeautify from './smart-tools/OneClickBeautify';
import AIStylist from './smart-tools/AIStylist';
import Placeholder from './smart-tools/Placeholder';
import { User } from '../types';

interface SmartToolsProps {
    user: User | null;
    onUpdateUser: (updates: Partial<User>) => void;
}

const tools = [
    { name: '高清图片生成', component: 'HDImageGenerator' },
    { name: '一键美图', component: 'OneClickBeautify' },
    { name: 'AI造型师', component: 'AIStylist' },
    { name: 'PDF处理', component: 'PDFTool' },
    { name: 'PPT初稿', component: 'PPTGenerator' },
    { name: '录音整理', component: 'AudioTranscription' },
    { name: '会议记录', component: 'MeetingNotes' },
];

const SmartTools: React.FC<SmartToolsProps> = ({ user, onUpdateUser }) => {
    const [activeTool, setActiveTool] = useState(tools[0].component);

    const renderTool = () => {
        switch (activeTool) {
            case 'HDImageGenerator':
                return <HDImageGenerator user={user} onUpdateUser={onUpdateUser} />;
            case 'OneClickBeautify':
                return <OneClickBeautify />;
            case 'AIStylist':
                return <AIStylist />;
            case 'PDFTool':
                return <Placeholder title="PDF处理" />;
            case 'PPTGenerator':
                return <Placeholder title="PPT初稿" />;
            case 'AudioTranscription':
                return <Placeholder title="录音整理" />;
            case 'MeetingNotes':
                return <Placeholder title="会议记录" />;
            default:
                return <HDImageGenerator user={user} onUpdateUser={onUpdateUser} />;
        }
    };

    return (
        <div className="flex h-[calc(100vh-100px)] max-w-7xl mx-auto mt-4 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900">
            <div className="w-64 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-4">
                <h2 className="text-lg font-bold mb-4">智能工具</h2>
                <nav className="space-y-2">
                    {tools.map(tool => (
                        <button
                            key={tool.name}
                            onClick={() => setActiveTool(tool.component)}
                            className={`w-full text-left px-4 py-2 rounded-lg ${activeTool === tool.component ? 'bg-cyan-100 text-cyan-800' : 'hover:bg-slate-100'}`}
                        >
                            {tool.name}
                        </button>
                    ))}
                </nav>
            </div>
            <div className="flex-1 overflow-y-auto">
                {renderTool()}
            </div>
        </div>
    );
};

export default SmartTools;
