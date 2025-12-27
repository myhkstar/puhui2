import React, { useState, useEffect, useRef, useContext } from 'react';
import { userService } from '../services/userService';
import { chatWithGemini, generateTitleForText } from '../services/geminiService';
import { ChatMessage, ChatSession, User } from '../types';
import { Send, Trash2, Plus, MessageSquare, Paperclip, Loader2, Bot, User as UserIcon, Menu, Cpu, Zap, BrainCircuit, Lock, Edit2, Check, Copy } from 'lucide-react';
import { AuthContext } from '../App';

interface AIAssistantProps {
    user: User | null;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ user: currentUser }) => {
    const { updateCurrentUser } = useContext(AuthContext);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState<{ name: string, data: string, mimeType: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [chatMode, setChatMode] = useState<'light' | 'deep'>('light');
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const handleCopy = (content: string, id: string) => {
        navigator.clipboard.writeText(content).then(() => {
            setCopiedMessageId(id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        });
    };

    useEffect(() => {
        loadSessions();
        // Log usage on mount (without tokens, just access log)
        userService.logUsage('深聊浅谈', 0);
    }, []);

    useEffect(() => {
        if (currentSessionId) {
            loadMessages(currentSessionId);
        } else {
            setMessages([]);
        }
    }, [currentSessionId]);

    // Force scroll to bottom whenever messages change or loading state changes
    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadSessions = async () => {
        const data = await userService.getChatSessions();
        setSessions(data);
        if (data.length > 0 && !currentSessionId) {
            setCurrentSessionId(data[0].id);
        }
    };

    const loadMessages = async (id: string) => {
        const data = await userService.getChatMessages(id);
        setMessages(data);
    };

    const createNewSession = async () => {
        const id = Date.now().toString();
        // Title will be generated after the first message
        await userService.createChatSession(id, "新對話");
        await loadSessions();
        setCurrentSessionId(id);
    };

    const deleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (window.confirm("確定要刪除此對話紀錄嗎？")) {
            await userService.deleteChatSession(id);
            await loadSessions();
            if (currentSessionId === id) {
                setCurrentSessionId(null);
            }
        }
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            const maxFiles = (currentUser?.role === 'vip' || currentUser?.role === 'admin') ? 3 : 1;

            if (files.length + attachments.length > maxFiles) {
                alert(`您最多只能上傳 ${maxFiles} 個附件。`);
                return;
            }

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result as string;
                    const data = base64.split(',')[1];
                    setAttachments(prev => [...prev, {
                        name: file.name,
                        data: data,
                        mimeType: file.type
                    }]);
                };
                reader.readAsDataURL(file);
            });
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const startEditingTitle = (e: React.MouseEvent, session: ChatSession) => {
        e.stopPropagation();
        setEditingSessionId(session.id);
        setEditingTitle(session.title);
    };

    const saveTitle = async (sessionId: string) => {
        await userService.updateChatSessionTitle(sessionId, editingTitle);
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: editingTitle } : s));
        setEditingSessionId(null);
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!input.trim() && attachments.length === 0) || loading) return;

        setLoading(true); 

        let sessionId = currentSessionId;
        let isNew = false;
        
        // If no session, create one first
        if (!sessionId) {
            isNew = true;
            sessionId = Date.now().toString();
            try {
                // Create with a temporary title
                await userService.createChatSession(sessionId, "...");
                setSessions(prev => [{ id: sessionId!, title: "...", timestamp: Date.now() }, ...prev]);
            } catch (err) {
                console.error("Failed to create session:", err);
                setLoading(false);
                return;
            }
        }

        const userMsg = input;
        const attachmentNames = attachments.map(f => f.name).join(', ');
        const promptText = attachments.length > 0 
            ? `${input}\n\n請結合我上傳的檔案 (${attachmentNames}) 進行分析。`
            : input;

        // Optimistic UI update
        const tempMsg: ChatMessage = {
            role: 'user',
            content: input + (attachments.length > 0 ? ` [附件: ${attachmentNames}]` : ''),
            timestamp: Date.now()
        };
        
        setMessages(prev => [...prev, tempMsg]);
        const currentAttachments = [...attachments];
        setInput('');
        setAttachments([]);
        
        // Fix: Save user message BEFORE setting session ID to state
        // This ensures when useEffect fires loadMessages, the user message is in DB
        try {
            await userService.saveChatMessage(sessionId, 'user', tempMsg.content);
            
            // If new session, NOW we set the ID, triggering loadMessages (which will now find the user msg in DB)
            if (isNew) {
                setCurrentSessionId(sessionId);
                if (currentUser?.token) {
                    // Generate a title based on the first message
                    generateTitleForText(userMsg, currentUser.token).then(newTitle => {
                        userService.updateChatSessionTitle(sessionId!, newTitle);
                        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
                    });
                }
            }

            // Call AI
            // We pass pure text history for context (simplified)
            const context = messages.map(m => ({
                role: m.role,
                content: m.content
            }));
            
            const modelName = chatMode === 'light' ? 'gemini-2.5-flash' : 'gemini-3-pro';
            if (!currentUser?.token) throw new Error("Authentication token is missing.");
            const aiResponse = await chatWithGemini(
                context, 
                promptText, 
                modelName,
                currentUser.token,
                currentAttachments
            );

            await userService.saveChatMessage(sessionId, 'model', aiResponse.content);
            const usageResult = await userService.logUsage('深聊浅谈', aiResponse.usage);
            if (usageResult.remainingTokens !== undefined) {
                updateCurrentUser({ tokens: usageResult.remainingTokens });
            }

            // Append model response to UI
            setMessages(prev => [...prev, { role: 'model', content: aiResponse.content, timestamp: Date.now() }]);
        } catch (err) {
            console.error(err);
            setMessages(prev => [...prev, { role: 'model', content: "抱歉，普普遇到了一點問題，請稍後再試試！", timestamp: Date.now() }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-100px)] max-w-7xl mx-auto mt-4 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900">
            {/* Sidebar */}
            <div className={`${sidebarOpen ? 'w-64' : 'w-0'} bg-slate-50 dark:bg-slate-950 transition-all duration-300 border-r border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden`}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                    <button 
                        onClick={createNewSession}
                        className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all"
                    >
                        <Plus className="w-4 h-4" /> 新對話
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {sessions.map(session => (
                        <div 
                            key={session.id}
                            onClick={() => setCurrentSessionId(session.id)}
                            className={`p-3 rounded-xl cursor-pointer flex items-center justify-between group transition-colors ${currentSessionId === session.id ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-900 dark:text-cyan-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                        >
                            <div className="flex items-center gap-2 truncate flex-1">
                                <MessageSquare className="w-4 h-4 shrink-0" />
                                {editingSessionId === session.id ? (
                                    <input
                                        type="text"
                                        value={editingTitle}
                                        onChange={(e) => setEditingTitle(e.target.value)}
                                        onBlur={() => saveTitle(session.id)}
                                        onKeyDown={(e) => e.key === 'Enter' && saveTitle(session.id)}
                                        className="w-full bg-transparent focus:bg-white dark:focus:bg-slate-700 rounded px-1 text-sm"
                                        autoFocus
                                    />
                                ) : (
                                    <span className="text-sm truncate font-medium">{session.title}</span>
                                )}
                            </div>
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                {editingSessionId === session.id ? (
                                    <button onClick={() => saveTitle(session.id)} className="p-1 hover:bg-green-100 hover:text-green-600 rounded"><Check className="w-3 h-3" /></button>
                                ) : (
                                    <button onClick={(e) => startEditingTitle(e, session)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><Edit2 className="w-3 h-3" /></button>
                                )}
                                <button 
                                    onClick={(e) => deleteSession(e, session.id)}
                                    className="p-1 hover:bg-red-100 hover:text-red-600 rounded"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col relative">
                {/* Header */}
                <div className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 justify-between bg-white dark:bg-slate-900/50 backdrop-blur z-20">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                            <Menu className="w-5 h-5 text-slate-500" />
                        </button>
                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                            {sessions.find(s => s.id === currentSessionId)?.title || "深聊浅谈 - 普普"}
                        </span>
                    </div>

                    {/* Mode Selector */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                        <button 
                            onClick={() => setChatMode('light')}
                            className={`px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${chatMode === 'light' ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-sm' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/50'}`}
                        >
                            <Zap className="w-3 h-3" /> 輕聊
                        </button>
                        <button
                            onClick={() => currentUser?.role !== 'user' && setChatMode('deep')}
                            disabled={currentUser?.role === 'user'}
                            className={`px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${chatMode === 'deep' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                            title={currentUser?.role === 'user' ? '此功能僅限 VIP 和管理員使用' : ''}
                        >
                            {currentUser?.role === 'user' && <Lock className="w-3 h-3" />}
                            {chatMode !== 'deep' && currentUser?.role !== 'user' && <BrainCircuit className="w-3 h-3" />}
                            {chatMode === 'deep' && <BrainCircuit className="w-3 h-3" />}
                            深研
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-100/50 dark:bg-black/20">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                            <div className="w-20 h-20 bg-cyan-100 dark:bg-cyan-900/20 rounded-full flex items-center justify-center">
                                <Bot className="w-10 h-10 text-cyan-600 dark:text-cyan-400" />
                            </div>
                            <p>你好！我是普普，當前處於 <span className="font-bold text-cyan-500">{chatMode === 'light' ? '輕聊模式' : '深研模式'}</span> 為您服務。</p>
                        </div>
                    ) : (
                        messages.map((msg, idx) => {
                            const messageId = `${idx}-${msg.timestamp}`;
                            return (
                                <div key={idx} className={`group flex items-start gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-cyan-100 dark:bg-cyan-900/50'}`}>
                                        {msg.role === 'user' ? <UserIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" /> : <Bot className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />}
                                    </div>
                                    <div className={`relative max-w-[80%] p-4 rounded-2xl ${
                                        msg.role === 'user' 
                                        ? 'bg-cyan-600 text-white rounded-tr-none' 
                                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm rounded-tl-none border border-slate-200 dark:border-slate-700'
                                    }`}>
                                        <div className="whitespace-pre-wrap leading-relaxed text-sm">
                                            {msg.content}
                                        </div>
                                    </div>
                                    <div className="self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleCopy(msg.content, messageId)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg">
                                            {copiedMessageId === messageId ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    {loading && (
                         <div className="flex gap-4 animate-pulse">
                            <div className="w-8 h-8 rounded-full bg-cyan-100 dark:bg-cyan-900/50 flex items-center justify-center shrink-0">
                                <Bot className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                            </div>
                            <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2 border border-slate-200 dark:border-slate-700">
                                <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                                <span className="text-sm text-slate-500 font-medium">普普正在思考...</span>
                            </div>
                         </div>
                    )}
                    <div ref={messagesEndRef} className="h-4" />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map((file, index) => (
                                <div key={index} className="flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit text-sm">
                                    <Paperclip className="w-4 h-4 text-slate-500" />
                                    <span className="truncate max-w-[150px] dark:text-white">{file.name}</span>
                                    <button onClick={() => removeAttachment(index)} className="ml-2 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    <form onSubmit={handleSend} className="flex gap-2">
                        <label className={`p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors text-slate-500 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <Paperclip className="w-5 h-5" />
                            <input type="file" onChange={handleFile} className="hidden" accept="image/*,.pdf,.txt,.doc,.docx" disabled={loading} multiple />
                        </label>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={loading ? "請稍候..." : "輸入訊息..."}
                            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 focus:ring-2 focus:ring-cyan-500 outline-none dark:text-white disabled:opacity-70 disabled:bg-slate-100 dark:disabled:bg-slate-900"
                            disabled={loading}
                        />
                        <button 
                            type="submit" 
                            disabled={(!input.trim() && attachments.length === 0) || loading}
                            className="p-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl disabled:opacity-50 transition-colors shadow-lg shadow-cyan-500/20 flex items-center justify-center min-w-[48px]"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AIAssistant;
