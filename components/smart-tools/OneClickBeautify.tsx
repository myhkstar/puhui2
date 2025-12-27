import React, { useState, useRef, useContext } from 'react';
import { Camera, Upload, Wand2, Loader2 } from 'lucide-react';
import { beautifyImage } from '../../services/geminiService';
import { AuthContext } from '../../App';

const prompt1 = `这是一张手机拍的人像照片，请进行专业人像后期（保持真实人像摄影风格，不要卡通或油画化）：
- 显著提升面部和眼睛的清晰度与细节，锐化眼睛但自然；不要擅自给人物眼睛添加双眼皮，除非图片中人物眼睛本身就是双眼皮
- 磨皮但保留真实皮肤纹理，绝不塑料感
- 优化肤色，纠正偏黄/偏红的光线，还原健康自然肤色
- 背景轻微虚化，提升主体突出感，但不要过度
  保持图片人物面部特征保持一致。`;

const prompt2 = `手机拍摄的[具体物体，比如手办/美食/产品]，请大幅提升细节与质感：
- 极致锐化主体，纹理清晰可见（毛发/食材纹理/布料纤维等）
- 增强微观细节和反光高光
- 优化光影层次，增加立体感
- 校正手机镜头常见的枕形畸变和暗角
- 提高局部对比度（微对比），让材质感爆棚
- 整体色调自然高级，像单反+神灯拍摄
不要过度饱和，不要滤镜感`;

const prompt3 = `这是一张用手机拍摄的照片，请帮我专业后期修复：
- 显著提升主体清晰度和细节，锐化但不过度
- 纠正手抖或轻微失焦造成的模糊
- 优化曝光和对比度，让光线自然柔和，像自然光下拍摄的效果
- 智能降噪，保留皮肤/物体真实质感
- 校正白平衡，去除手机常见的偏黄/偏蓝色温
- 轻微提升饱和度和动态范围，但保持真实感，不要像滤镜
风格参考：iPhone原生相机「摄影风格-鲜艳」或专业摄影师用Lightroom调出的自然通透感`;

const OneClickBeautify: React.FC = () => {
    const { currentUser } = useContext(AuthContext);
    const [image, setImage] = useState<string | null>(null);
    const [beautifiedImage, setBeautifiedImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result as string);
                setBeautifiedImage(null);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleBeautify = async () => {
        if (!image || !currentUser?.token) return;
        setIsLoading(true);
        
        // Simulate image analysis to choose a prompt
        const analysisResult = 'person'; // In a real app, this would be an API call
        let prompt = prompt3;
        if (analysisResult === 'person') {
            prompt = prompt1;
        } else if (analysisResult === 'object') {
            prompt = prompt2;
        }

        try {
            const result = await beautifyImage(image, prompt, currentUser.token);
            setBeautifiedImage(result.content);
        } catch (error) {
            console.error("Failed to beautify image:", error);
            alert("美化图片失败，请稍后再试。");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-8">
            <h2 className="text-2xl font-bold mb-6">一键美图</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg">
                    {!image ? (
                        <div className="text-center">
                            <button onClick={() => fileInputRef.current?.click()} className="w-full">
                                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-2 text-sm font-medium">上传图片</h3>
                            </button>
                            <p className="mt-1 text-sm text-gray-500">或</p>
                            <button
                                type="button"
                                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 mt-2"
                                onClick={() => alert('相机功能待开发')}
                            >
                                <Camera className="-ml-1 mr-2 h-5 w-5" />
                                使用相机
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>
                    ) : (
                        <div className="relative">
                            <img src={beautifiedImage || image} alt="Preview" className="max-w-full h-auto rounded-lg" />
                            <button
                                onClick={() => {
                                    setImage(null);
                                    setBeautifiedImage(null);
                                }}
                                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"
                            >
                                X
                            </button>
                        </div>
                    )}
                </div>
                <div>
                    {image && (
                        <button
                            onClick={handleBeautify}
                            disabled={isLoading}
                            className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                                    处理中...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="-ml-1 mr-2 h-5 w-5" />
                                    一键美化
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OneClickBeautify;
