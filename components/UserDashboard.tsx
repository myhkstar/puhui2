/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useState, useRef } from 'react';
import { User, GeneratedImage, UsageLog } from '../types';
import { userService } from '../services/userService';
import { History, User as UserIcon, Calendar, Download, Clock, Star, Shield, Activity, Coins, ChevronLeft, ChevronRight, Edit, Save, X, Camera } from 'lucide-react';

interface UserDashboardProps {
    user: User;
    onRestore: (img: GeneratedImage) => void;
    onUpdateUser: (user: Partial<User>) => void;
}

const UserDashboard: React.FC<UserDashboardProps> = ({ user, onRestore, onUpdateUser }) => {
    const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
    const [history, setHistory] = useState<GeneratedImage[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        displayName: user.displayName || '',
        contactEmail: user.contactEmail || '',
        mobile: user.mobile || '',
    });
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl || null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleEditToggle = () => {
        if (isEditing) {
            // Reset form data if canceling
            setFormData({
                displayName: user.displayName || '',
                contactEmail: user.contactEmail || '',
                mobile: user.mobile || '',
            });
            setAvatarFile(null);
            setAvatarPreview(user.avatarUrl || null);
        }
        setIsEditing(!isEditing);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setAvatarFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setAvatarPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        try {
            // Handle avatar upload first
            if (avatarFile) {
                const { uploadUrl } = await userService.getAvatarUploadUrl(avatarFile.name, avatarFile.type);
                await fetch(uploadUrl, {
                    method: 'PUT',
                    body: avatarFile,
                    headers: { 'Content-Type': avatarFile.type }
                });
            }

            // Handle profile data update
            await userService.updateUserProfile(formData);

            // Refetch user data to get all updates
            const updatedUser = await userService.checkSession();
            if (updatedUser) {
                onUpdateUser(updatedUser);
            }
            
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to save profile:", error);
            // You should show an error message to the user here
        }
    };

    const [view, setView] = useState<'week' | 'all'>('week');
    const [historyPage, setHistoryPage] = useState(1);
    const [usagePage, setUsagePage] = useState(1);

    const fetchHistory = async (page = 1) => {
        // This is a simplified fetch, assuming the service is updated
        // In a real scenario, you'd update userService to accept page/period
        // For now, we simulate with slice
        const allHistory = user.history || [];
        if (view === 'week') {
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            setHistory(allHistory.filter(h => h.timestamp >= oneWeekAgo));
        } else {
            const start = (page - 1) * 50;
            const end = start + 50;
            setHistory(allHistory.slice(start, end));
        }
    };

    const fetchUsage = async (page = 1) => {
        // This is a simplified fetch, assuming the service is updated
        const allLogs = await userService.getMyUsage(); // Assume this fetches all for now
        if (view === 'week') {
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            setUsageLogs(allLogs.filter(l => l.timestamp >= oneWeekAgo));
        } else {
            const start = (page - 1) * 50;
            const end = start + 50;
            setUsageLogs(allLogs.slice(start, end));
        }
    };
    
    useEffect(() => {
        fetchHistory(historyPage);
        fetchUsage(usagePage);
    }, [user, view, historyPage, usagePage]);

    const sortedUsage = [...usageLogs].sort((a, b) => b.timestamp - a.timestamp);

    return (
        <div className="max-w-6xl mx-auto mt-8 animate-in fade-in duration-500 p-4">
            
            {/* Profile Header */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8 mb-8 shadow-lg flex flex-col md:flex-row items-center gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 dark:bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                <div className="relative shrink-0">
                    <img 
                        src={avatarPreview || `https://api.dicebear.com/8.x/initials/svg?seed=${user.username}`} 
                        alt="Avatar" 
                        className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-lg"
                    />
                    {isEditing && (
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="absolute bottom-0 right-0 bg-cyan-500 text-white p-2 rounded-full hover:bg-cyan-600 transition-colors shadow-md"
                        >
                            <Camera className="w-4 h-4" />
                        </button>
                    )}
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleAvatarChange} 
                        className="hidden" 
                        accept="image/png, image/jpeg"
                    />
                </div>
                
                <div className="flex-1 text-center md:text-left space-y-2">
                    <div className="flex items-center justify-center md:justify-start gap-3">
                        {isEditing ? (
                            <input 
                                type="text"
                                name="displayName"
                                value={formData.displayName}
                                onChange={handleInputChange}
                                className="text-2xl md:text-3xl font-display font-bold text-slate-900 dark:text-white bg-transparent border-b-2 border-cyan-500 focus:outline-none"
                            />
                        ) : (
                            <h2 className="text-2xl md:text-3xl font-display font-bold text-slate-900 dark:text-white">
                                {user.displayName || user.username}
                            </h2>
                        )}
                        {user.role === 'vip' && (
                            <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 rounded text-xs font-bold border border-purple-200 dark:border-purple-800 flex items-center gap-1">
                                <Star className="w-3 h-3 fill-current" /> VIP
                            </span>
                        )}
                        {user.role === 'admin' && (
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 rounded text-xs font-bold border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                <Shield className="w-3 h-3 fill-current" /> Admin
                            </span>
                        )}
                    </div>

                    {isEditing ? (
                        <div className="flex flex-col md:flex-row items-center gap-3 md:gap-6 text-slate-500 dark:text-slate-400 text-sm">
                            <input type="email" name="contactEmail" value={formData.contactEmail} onChange={handleInputChange} placeholder="Email" className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-xs" />
                            <input type="text" name="mobile" value={formData.mobile} onChange={handleInputChange} placeholder="Phone" className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-xs" />
                        </div>
                    ) : (
                        <div className="flex flex-col md:flex-row items-center gap-3 md:gap-6 text-slate-500 dark:text-slate-400 text-sm">
                            <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-xs font-mono">@{user.username}</span>
                            <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> 加入於 {new Date(user.created_at).toLocaleDateString()}
                            </span>
                            
                            {user.expirationDate && (
                                 <span className={`flex items-center gap-1 font-medium ${Date.now() > user.expirationDate ? 'text-red-500' : 'text-slate-600 dark:text-slate-300'}`}>
                                    <Clock className="w-3 h-3" /> 有效期至：{new Date(user.expirationDate).toLocaleDateString()}
                                 </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    {isEditing ? (
                        <>
                            <button onClick={handleSave} className="px-4 py-2 bg-green-500 text-white rounded-lg flex items-center gap-2"><Save className="w-4 h-4" /> 保存</button>
                            <button onClick={handleEditToggle} className="px-4 py-2 bg-gray-500 text-white rounded-lg flex items-center gap-2"><X className="w-4 h-4" /> 取消</button>
                        </>
                    ) : (
                        <button onClick={handleEditToggle} className="px-4 py-2 bg-cyan-500 text-white rounded-lg flex items-center gap-2"><Edit className="w-4 h-4" /> 編輯個人資料</button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="text-center px-6 py-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-white/5">
                        <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{user.history?.length || 0}</div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">創作總數</div>
                    </div>
                    <div className="text-center px-6 py-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-white/5">
                        <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
                            <Coins className="w-5 h-5" />
                            <span>{user.tokens?.toLocaleString() || 0}</span>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">TOKEN 餘額</div>
                    </div>
                </div>
            </div>

            {/* Creation History */}
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                <History className="w-4 h-4" />
                創作歷史
            </h3>

            {!history || history.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <p className="text-slate-500">本週尚無創作記錄。</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {history.map((img) => (
                        <div key={img.id} className="group bg-white dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col">
                            <div className="relative aspect-video overflow-hidden cursor-pointer" onClick={() => onRestore(img)}>
                                <img src={img.data} alt={img.prompt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <span className="bg-white/90 text-slate-900 text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                                        載入到編輯器
                                    </span>
                                </div>
                            </div>
                            <div className="p-4 flex flex-col flex-1">
                                <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2" title={img.prompt}>
                                    {img.prompt}
                                </p>
                                <div className="mt-auto flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500">{new Date(img.timestamp).toLocaleDateString()}</span>
                                    <a 
                                        href={img.data} 
                                        download={`infogenius-${img.id}.png`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                                        title="下載 (在新分頁開啟)"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <Download className="w-4 h-4" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {view === 'all' && (
                <div className="flex justify-center gap-4 mt-8">
                    <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1} className="px-4 py-2 bg-slate-200 rounded disabled:opacity-50">上一頁</button>
                    <button onClick={() => setHistoryPage(p => p + 1)} className="px-4 py-2 bg-slate-200 rounded">下一頁</button>
                </div>
            )}
            <div className="text-center mt-4">
                <button onClick={() => setView(v => v === 'week' ? 'all' : 'week')} className="text-sm text-cyan-600 font-bold">{view === 'week' ? '顯示所有歷史記錄' : '僅顯示本週記錄'}</button>
            </div>

            {/* Usage Records */}
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] my-6 flex items-center gap-2">
                <Activity className="w-4 h-4" /> 使用記錄
            </h3>
            
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden mb-8">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 uppercase">
                        <tr>
                            <th className="px-6 py-3">時間</th>
                            <th className="px-6 py-3">項目</th>
                            <th className="px-6 py-3 text-right">Token 變化</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sortedUsage.length === 0 ? (
                            <tr><td colSpan={3} className="px-6 py-4 text-center text-slate-500">本週尚無使用記錄</td></tr>
                        ) : (
                            sortedUsage.map((log, i) => (
                                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400 font-mono">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td className="px-6 py-4 text-slate-900 dark:text-slate-300">{log.feature}</td>
                                    <td className={`px-6 py-4 text-right font-mono font-bold flex items-center justify-end gap-1 ${log.tokenCount && log.tokenCount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        <Coins className="w-3 h-3" />
                                        {log.tokenCount && log.tokenCount > 0 ? '+' : ''}{log.tokenCount?.toLocaleString() || 0}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            {view === 'all' && (
                <div className="flex justify-center gap-4 mt-8">
                    <button onClick={() => setUsagePage(p => Math.max(1, p - 1))} disabled={usagePage === 1} className="px-4 py-2 bg-slate-200 rounded disabled:opacity-50">上一頁</button>
                    <button onClick={() => setUsagePage(p => p + 1)} className="px-4 py-2 bg-slate-200 rounded">下一頁</button>
                </div>
            )}
        </div>
    );
};

export default UserDashboard;
