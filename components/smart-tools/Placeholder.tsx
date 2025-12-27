import React from 'react';
import { Cpu } from 'lucide-react';

interface PlaceholderProps {
    title: string;
}

const Placeholder: React.FC<PlaceholderProps> = ({ title }) => {
    return (
        <div className="p-8">
            <h2 className="text-2xl font-bold mb-6">{title}</h2>
            <div className="max-w-2xl mx-auto mt-20 flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-500">
                <div className="relative">
                    <div className="absolute inset-0 bg-cyan-500/20 blur-3xl rounded-full"></div>
                    <div className="relative p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl">
                        <Cpu className="w-20 h-20 text-cyan-500" />
                    </div>
                </div>
                
                <div className="space-y-4">
                    <h2 className="text-4xl font-display font-bold text-slate-900 dark:text-white">{title}</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto text-lg">
                        本區域正在建設中……
                    </p>
                </div>
             </div>
        </div>
    );
};

export default Placeholder;
