import React, { useState, useContext } from 'react';
import { Upload, Sparkles, Loader2 } from 'lucide-react';
import { beautifyImage } from '../../services/geminiService';
import { AuthContext } from '../../App';

const styles = [
  {
    name: '标准专业正装照',
    description: '适用于简历、公司官网、LinkedIn头像（最基础、最通用的专业形象）。',
    prompt: `将上传的人脸转化为一张高信任度、标准、专业的职业正装照。保持人脸五官的一致性，\n- **背景**: 纯色、中性背景，推荐柔和的浅灰色、米白色或淡蓝色，背景干净、无杂物。\n- **服装**: 深色定制西装、内搭白色或浅色衬衫，系领带（可选），服装整洁、领口端正。\n- **打光**: 柔和箱式影棚光 (Softbox Studio Lighting)，均匀打亮面部，无强烈阴影。\n- **表情/姿势**: 正面或微微侧身，表情自信、嘴角略微上扬（含蓄微笑），眼神直视镜头。\n- **风格/画质**: 高分辨率 (High Resolution)，真实感 (Photorealistic)，着重突出专业度。`,
  },
  {
    name: '现代商务休闲风',
    description: '适用于科技、互联网、创业公司、更强调亲和力的行业（如咨询、教育）。',
    prompt: `生成一张现代、亲切、充满活力的商务休闲风格肖像。保持人脸五官的一致性，\n- **背景**: 浅景深 (Shallow Depth of Field / Bokeh) 效果，背景可以是模糊的现代办公室、落地窗或城市景观。\n- **服装**: 商务休闲装 (Business Casual)，如有质感的针织衫、休闲西装夹克，无领带。\n- **打光**: 自然光 (Natural Light) 或柔和窗户光，明亮、通透。\n- **表情/姿势**: 保持自信且放松的笑容，可以有微微侧头或略微靠前、动态感的姿势。\n- **风格/画质**: 高清、明亮、现代感强，色彩饱和度适中。`,
  },
  {
    name: '高级行政人像',
    description: '适用于金融、法律、高管、需要体现权威和严肃性的场合（强调质感和地位）。',
    prompt: `创作一张低调、高级、有深度的行政高管风格肖像。保持人脸五官的一致性，\n- **背景**: 深色、纹理背景，如深木色墙面、深蓝色或黑色的暗调背景。\n- **服装**: 剪裁精良的深色高级定制西装或套装，彰显身份感。\n- **打光**: 伦勃朗式打光 (Rembrandt Lighting) 或低调打光 (Low-Key Lighting)，高对比度，营造阴影和质感。\n- **表情/姿势**: 严肃、沉稳、目光坚定，体现思考和决策力，可以拍摄胸部以上特写。\n- **风格/画质**: 电影感 (Cinematic)，高对比度、高光泽度，注重材质细节。`,
  },
  {
    name: '职场环境品牌照',
    description: '适用于个人品牌宣传、社交媒体内容、需要展示工作环境或专业工具的场景。',
    prompt: `生成一张在工作环境中、具有叙事性和品牌性的职场照片。保持人脸五官的一致性，\n- **背景**: 与职业相关的环境，例如：图书馆书架前、咨询会议室、对着电脑工作台、俯瞰城市的落地窗前。\n- **服装**: 贴合职业特点的专业服装，展现个人风格。\n- **打光**: 环境光 (Ambient Light) 和柔和补光 的结合，自然且专业。\n- **表情/姿势**: 侧面、斜侧面，可以是正在工作（看向笔记本电脑或文件）的专注状态，或与环境互动。\n- **风格/画质**: 全景或半身环境肖像，真实感强，突出人物与其专业领域的关联。`,
  }
];

const AIStylist: React.FC = () => {
    const { currentUser } = useContext(AuthContext);
    const [selectedStyle, setSelectedStyle] = useState(styles[0]);
    const [image, setImage] = useState<string | null>(null);
    const [styledImage, setStyledImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result as string);
                setStyledImage(null);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleGenerate = async () => {
        if (!image || !currentUser?.token) return;
        setIsLoading(true);
        try {
            const result = await beautifyImage(image, selectedStyle.prompt, currentUser.token);
            setStyledImage(result.content);
        } catch (error) {
            console.error("Failed to generate styled image:", error);
            alert("生成风格化图片失败，请稍后再试。");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-8">
            <h2 className="text-2xl font-bold mb-6">AI造型师</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1">
                    <h3 className="text-lg font-semibold mb-4">选择风格</h3>
                    <div className="space-y-2">
                        {styles.map(style => (
                            <button
                                key={style.name}
                                onClick={() => setSelectedStyle(style)}
                                className={`w-full text-left p-3 rounded-lg border ${selectedStyle.name === style.name ? 'bg-cyan-100 border-cyan-500' : 'hover:bg-gray-100'}`}
                            >
                                <p className="font-bold">{style.name}</p>
                                <p className="text-xs text-gray-500">{style.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="md:col-span-2">
                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg mb-6">
                        {!image ? (
                            <div className="text-center">
                                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-2 text-sm font-medium">上传你的照片</h3>
                                <input type="file" accept="image/*" onChange={handleImageUpload} className="mt-2" />
                            </div>
                        ) : (
                            <div className="relative">
                                <img src={styledImage || image} alt="Upload preview" className="max-w-full h-auto rounded-lg" />
                                <button onClick={() => {
                                    setImage(null);
                                    setStyledImage(null);
                                }} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1">X</button>
                            </div>
                        )}
                    </div>
                    {image && (
                        <button
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400"
                        >
                            {isLoading ? <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" /> : <Sparkles className="-ml-1 mr-2 h-5 w-5" />}
                            {isLoading ? '生成中...' : `生成${selectedStyle.name}`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AIStylist;
