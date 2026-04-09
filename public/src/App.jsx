import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, Image as ImageIcon, Sparkles, Download, RotateCcw, 
  AlertCircle, Loader2, Wand2, Lightbulb, Zap, ShieldCheck, 
  Fingerprint, Layers, X, CheckCircle, Maximize, Search, Eye,
  LayoutGrid, RefreshCw, Settings, Key, Network, CopyPlus,
  Palette, PenTool, Copy
} from 'lucide-react';

/**
 * 预览环境会自动注入 API Key 到作用域中
 */
const apiKey = ""; 

/**
 * 配置常量
 */
const DEFAULT_API_KEY = apiKey; 
const ANALYSIS_MODEL = "gemini-2.5-flash-preview-09-2025"; 
const IMAGE_MODEL = "gemini-2.5-flash-image-preview"; // 默认支持的图像生成模型

/**
 * 图像压缩工具：防止大图导致 OOM 崩溃
 */
const compressImage = (file, maxWidth = 2048, quality = 0.8) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve({ sourceUrl: dataUrl, base64: dataUrl.split(',')[1], mimeType });
      };
    };
  });
};

/**
 * 指数退避请求封装
 */
const fetchWithRetry = async (url, options, retries = 5, delay = 1000) => {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      if (response.status === 401) throw new Error("401: 权限注入失败。请点击右上角设置图标手动输入 Key。");
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `请求失败: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (retries > 0 && !error.message.includes("401")) {
      const jitter = Math.random() * 1000;
      await new Promise(res => setTimeout(res, delay + jitter));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
};

export default function App() {
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);
  
  // 风格参考图（垫图）状态
  const [referenceImage, setReferenceImage] = useState(null);

  // 方案与排重历史记录
  const [analysis, setAnalysis] = useState({ subject: "", details: "", suggestions: [] });
  const [historySuggestions, setHistorySuggestions] = useState([]); 

  // ★ 新增功能状态：魔法扩写 & 营销文案
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [copyModal, setCopyModal] = useState({ isOpen: false, loading: false, text: "", imgUrl: null });

  // 电商环境预设
  const [selectedEnv, setSelectedEnv] = useState("");
  const ENV_OPTIONS = [
    { label: "自由发挥", value: "" },
    { label: "白底免抠", value: "纯净的白色背景，无杂物，适合基础款主图" },
    { label: "简约木桌", value: "平铺在干净的浅色原木桌面上，日常接地气" },
    { label: "办公一角", value: "办公桌面边缘，带有一点虚化的键盘或笔记本" },
    { label: "文艺生活", value: "旁边有小资感的马克杯或杂志边角点缀，温馨自然" },
    { label: "窗边阳光", value: "明亮的自然光，有一点点窗格或树叶的清爽投影" }
  ];

  const [showSettings, setShowSettings] = useState(false);
  const [userKey, setUserKey] = useState("");
  const activeKey = userKey || DEFAULT_API_KEY;

  // 处理风格参考图上传
  const handleReferenceUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setReferenceImage(compressed);
    e.target.value = null; 
  };

  // --- ★ 新增功能 1：基于 Gemini LLM 的魔法提示词扩写 ---
  const handleEnhancePrompt = async () => {
    if (!prompt.trim()) return alert("请先在输入框写下简单的构思，例如'木桌上的杯子'");
    setIsEnhancingPrompt(true);

    const enhanceInstruction = "你是一位专业的商业摄影AI提示词工程师。你的任务是将用户提供的简短描述，扩写为一段极其详尽、专业的电商产品摄影描述词。必须包含：画面主体状态、场景布景细节、材质纹理、光影方向（如侧逆光、柔和自然光）以及镜头感。直接返回扩写后的一段话，不要任何前缀、解释或Markdown格式。";
    const userText = `请扩写以下简短想法：${prompt}`;

    try {
      const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: enhanceInstruction }] },
          generationConfig: { temperature: 0.9 }
        })
      });
      const generatedText = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (generatedText) {
        setPrompt(generatedText.trim());
      }
    } catch (e) {
      alert("魔法扩写失败: " + e.message);
    } finally {
      setIsEnhancingPrompt(false);
    }
  };

  // --- ★ 新增功能 2：基于 Gemini Vision 的爆款营销文案生成 ---
  const generateMarketingCopy = async (id) => {
    const item = images.find(i => i.id === id);
    if (!item || !item.resultUrl) return;

    setCopyModal({ isOpen: true, loading: true, text: "", imgUrl: item.resultUrl });
    const b64Data = item.resultUrl.split(',')[1];
    
    const copyInstruction = "你是一位深谙各大社交平台流量密码的资深爆款文案操盘手。";
    const userText = "请观察这张生成的电商商品图，为它写一篇吸睛的【小红书种草文案】。要求：1. 具有煽动性和吸引力的惊艳标题。 2. 描述图片中的核心卖点或绝美氛围。 3. 恰到好处地使用Emoji表情。 4. 结尾带上互动引导和3-5个相关的热门Hashtag。直接输出文案即可。";

    try {
      const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: userText },
            { inlineData: { mimeType: "image/png", data: b64Data } }
          ] }],
          systemInstruction: { parts: [{ text: copyInstruction }] },
          generationConfig: { temperature: 0.8 }
        })
      });
      const generatedText = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (generatedText) {
        setCopyModal({ isOpen: true, loading: false, text: generatedText, imgUrl: item.resultUrl });
      } else {
        throw new Error("文案生成为空");
      }
    } catch (e) {
      setCopyModal(prev => ({ ...prev, loading: false, text: "文案生成失败: " + e.message }));
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(copyModal.text).then(() => {
      alert("已复制到剪贴板！");
    }).catch(err => {
      // 降级处理
      const textArea = document.createElement("textarea");
      textArea.value = copyModal.text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        alert("已复制到剪贴板！");
      } catch (err) {
        alert("复制失败，请手动选择复制。");
      }
      document.body.removeChild(textArea);
    });
  };

  // --- 1. 场景裂变实验室 ---
  const [fissionSource, setFissionSource] = useState(null);
  const [fissionResults, setFissionResults] = useState([]); 
  const [isFissionLoading, setIsFissionLoading] = useState(false);
  const [fissionProgress, setFissionProgress] = useState("");

  const handleFissionUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setFissionSource(compressed);
    setFissionResults([]); 
  };

  const runFission = async () => {
    if (!fissionSource) return;
    setIsFissionLoading(true);
    setFissionProgress("分析原图特征并生成策略...");

    try {
      const analysisPrompt = `作为资深电商视觉总监，请深度分析这张商品图。
      提取它的核心商品特征、材质和当前环境调性。基于它现有的风格，裂变出 4 个风格相似但在细节上（如打光角度、背景底材纹理、边缘点缀小道具）略有不同的高级电商场景提示词。
      要求返回纯JSON格式：{"variations": ["长提示词1", "长提示词2", "长提示词3", "长提示词4"]}
      每条提示词不少于 50 字，必须包含材质、光线和镜头描述。绝对禁止Markdown格式。`;

      const analysisRes = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analysisPrompt }, { inlineData: { mimeType: fissionSource.mimeType, data: fissionSource.base64 } }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const text = analysisRes.candidates?.[0]?.content?.parts?.[0]?.text;
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
      } catch (e) {
        throw new Error("AI 返回的裂变策略解析失败");
      }
      
      const variations = parsed.variations || [];
      if (variations.length === 0) throw new Error("提示词生成失败");

      setFissionProgress("并发裂变 4 张场景图...");

      const newItems = variations.slice(0, 4).map((v, i) => ({
        id: `fission-${Date.now()}-${i}`,
        status: 'generating',
        resultUrl: null,
        errorMsg: null,
        fissionPrompt: String(v)
      }));

      setFissionResults(newItems);

      const promises = newItems.map(async (item) => {
        const p = strictMode 
          ? `【最高优先级指令：主体锁定】1. 保持图片中心主体100%完全不变。2. 保护原始材质细节。3. 仅将背景重绘为：${item.fissionPrompt}。4. 确保光影物理级契合，阴影柔和自然。`
          : `将背景替换为：${item.fissionPrompt}。真实的电商白底/生活场景风格。`;

        try {
          const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${activeKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: p }, { inlineData: { mimeType: fissionSource.mimeType, data: fissionSource.base64 } }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
            })
          });
          const b64 = res.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data;
          if (b64) {
            setFissionResults(prev => prev.map(img => img.id === item.id ? { ...img, resultUrl: `data:image/png;base64,${b64}`, status: 'success' } : img));
          } else {
            throw new Error("重绘结果为空");
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setFissionResults(prev => prev.map(img => img.id === item.id ? { ...img, status: 'error', errorMsg: errorMessage } : img));
        }
      });

      await Promise.all(promises);
      setFissionProgress("");
    } catch (err) {
      alert("裂变失败: " + err.message);
      setFissionProgress("");
      setFissionResults([]); 
    } finally {
      setIsFissionLoading(false);
    }
  };

  const downloadSingleImage = (url, name) => {
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = name; 
    a.click();
  };

  // --- 2. 深度分析：真实电商场景提示词引擎 ---
  const runDeepAnalysis = async (img, isRegenerate = false) => {
    setAnalyzing(true);
    
    if (!isRegenerate) {
      setHistorySuggestions([]);
      setAnalysis({ subject: "", details: "", suggestions: [] });
    }

    const systemPrompt = "你是一位资深的淘宝/天猫电商视觉设计师，非常了解日常快消品的商品图需求。";
    
    const envConstraint = selectedEnv 
      ? `\n【指定环境】：请强制将这 3 套方案放置在"${selectedEnv}"环境中进行构思，符合电商主图标准。` 
      : `\n【环境倾向】：自由发挥，选择最适合该商品的日常真实生活场景。`;

    let userPrompt = `
      请分析这张商品图片，并构思 3 套适合作为【日常电商主图/详情页、小红书种草图】的真实场景摄影方案。
      【核心要求】：风格必须真实、接地气、干净、实用。**绝对不要高大上、不要浮夸的光影（如霓虹灯、赛博朋克、奢华大理石等）、不要过度艺术化的表达**。如果是大众消费品，场景要贴近真实生活。
      
      要求返回纯 JSON 格式：{"subject": "商品名称", "details": "材质说明", "suggestions": ["长方案1", "长方案2", "长方案3"]}
      ${envConstraint}
      
      每条 suggestion 必须是一段详尽的摄影指导（不少于 50 字），包含：
      1. 常见且真实的置景（如：普通的木桌、纯净的白纸底、书桌一角、简约的亚麻餐布）。
      2. 明亮清晰的日常布光（如：明亮的窗边自然光、干净的电商平光，拒绝夸张的明暗对比）。
      3. 真实的日常道具点缀（如：一杯咖啡、一本书籍的一角、简单的绿植，道具必须被适度虚化且绝不能抢镜）。
      4. 明确要求"画风清新自然，像真实的买家秀或精致的日常分享"。
      
      绝对禁止 Markdown 格式，仅返回 JSON。
    `;

    if (isRegenerate && historySuggestions.length > 0) {
      userPrompt += `
      
      【排重指令：严禁重复】
      请**绝对避开**以下已经生成过的构图和元素，提供全新的接地气场景：
      ${JSON.stringify(historySuggestions)}
      `;
    }

    try {
      const data = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }, { inlineData: { mimeType: img.mimeType || "image/png", data: img.base64 } }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json", temperature: 0.8 } 
        })
      });
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        
        const newSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(s => {
          if (typeof s === 'string') return s;
          if (typeof s === 'object') return s.text || s.description || s.content || JSON.stringify(s);
          return String(s);
        }) : [];
        
        setAnalysis({
          subject: String(parsed.subject || ""),
          details: String(parsed.details || ""),
          suggestions: newSuggestions
        });

        setHistorySuggestions(prev => [...prev, ...newSuggestions]);
      }
    } catch (e) {
      const fallbackSuggestions = [
        "干净明亮的电商白底图风格。商品平正地放置在纯白色的背景纸上，使用均匀柔和的棚光照明，消除明显的阴影。画面没有任何多余的道具，完全突出商品的色彩和材质，画风清爽自然，适合直接作为商品主图。",
        "日常温馨的办公桌面场景。商品平铺在浅色的原木桌面上，背景处有轻微虚化的白色键盘边缘或一本打开的笔记本角。光线像是上午明亮的自然光，画面真实接地气，带有一点生活气息，像是一张好看的买家秀。",
        "文艺清新的生活记录风。商品放在一块米白色的棉麻餐布上，旁边放着一杯咖啡的边缘（道具做适度虚化处理以突出商品）。窗外的柔和阳光斜射进来，画面整体色调温暖舒适，非常适合小红书等社交平台的种草展示。"
      ];
      setAnalysis({ 
        subject: "电商商品", 
        details: "清晰展示日常材质", 
        suggestions: fallbackSuggestions
      });
      setHistorySuggestions(prev => [...prev, ...fallbackSuggestions]);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleBatchUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const newItems = await Promise.all(files.map(async (file) => {
      const compressed = await compressImage(file);
      return { id: Math.random().toString(36).substring(7), ...compressed, resultUrl: null, status: 'idle', errorMsg: null, isUpscaled: false };
    }));
    setImages(prev => {
      const updated = [...prev, ...newItems];
      if (prev.length === 0 && newItems.length > 0) {
        setTimeout(() => runDeepAnalysis(newItems[0], false), 100);
      }
      return updated;
    });
    e.target.value = null;
  };

  // --- 3. 批量与单图重绘执行逻辑 (集成垫图) ---
  const startBatchRedraw = async () => {
    if (!prompt && !referenceImage) return alert("请先选择场景描述方案，或上传一张风格垫图！");
    if (loading) return;
    
    setLoading(true);
    const queue = [...images];
    
    setImages(prev => prev.map(img => 
      queue.some(q => q.id === img.id) 
        ? { ...img, status: 'generating', errorMsg: null, resultUrl: null, isUpscaled: false } 
        : img
    ));

    const promises = queue.map(async (item) => {
      const appliedPrompt = item.fissionPrompt || prompt || "提取并完美应用第二张风格垫图的完整场景氛围、光影色调和背景材质";
      let pText = "";

      if (referenceImage) {
        pText = `【构图主导与场景融合指令】这是一项商品植入任务：
1. **场景锁定**：以第二张垫图的构图、空间比例和环境为【绝对主导】。绝对不能让商品图放大取代或遮挡过多的背景！必须保留垫图周围的广阔环境、道具（如电脑边缘）和空间纵深。
2. **合理缩放**：提取第一张图的商品（保持颜色图案不变），将其【适当缩小并合理放置】在垫图场景的视觉中心。
3. **光影重构**：根据垫图的光源，为缩小后的商品添加真实的底部接触阴影和环境光反射，彻底消除拼接感。
4. 场景参考描述：${appliedPrompt}`;
      } else {
        pText = strictMode 
          ? `【背景重绘指令】保留主体，替换背景：
1. 严格锁定原图商品的主体形状、图案和所有边框颜色，保持 100% 不变。
2. 将背景重绘为：${appliedPrompt}。
3. 必须为商品底部添加符合新场景光源的自然接触阴影（Contact Shadows），使其完美融入背景，切忌悬浮感。`
          : `将背景替换为：${appliedPrompt}。真实的电商场景风格，光影自然融合。`;
      }

      const partsArr = [
        { text: pText },
        { inlineData: { mimeType: item.mimeType || "image/png", data: item.base64 } }
      ];

      if (referenceImage) {
        partsArr.push(
          { text: "必须严格 1:1 模仿以下垫图的透视、光影与背景环境：" },
          { inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.base64 } }
        );
      }
        
      try {
        const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${activeKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: partsArr }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
          })
        });
        const b64 = res.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data;
        if (b64) {
          setImages(prev => prev.map(img => img.id === item.id ? { ...img, resultUrl: `data:image/png;base64,${b64}`, status: 'success' } : img));
        } else {
          throw new Error("API 重绘结果为空");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'error', errorMsg: errorMessage } : img));
      }
    });

    await Promise.all(promises);
    setLoading(false);
  };

  const regenerateImage = async (id) => {
    const item = images.find(i => i.id === id);
    if (!item) return;
    
    const appliedPrompt = item.fissionPrompt || prompt;
    if (!appliedPrompt && !referenceImage) return alert("请先输入场景描述指令，或上传一张风格垫图！");

    setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'generating', errorMsg: null, resultUrl: null, isUpscaled: false } : i));

    const activePrompt = appliedPrompt || "提取并完美应用第二张风格垫图的完整场景氛围、光影色调和背景材质";

    let pText = "";

    if (referenceImage) {
      pText = `【构图主导与场景融合指令】这是一项商品植入任务：
1. **场景锁定**：以第二张垫图的构图、空间比例和环境为【绝对主导】。绝对不能让商品图放大取代或遮挡过多的背景！必须保留垫图周围的广阔环境、道具（如电脑边缘）和空间纵深。
2. **合理缩放**：提取第一张图的商品（保持颜色图案不变），将其【适当缩小并合理放置】在垫图场景的视觉中心。
3. **光影重构**：根据垫图的光源，为缩小后的商品添加真实的底部接触阴影和环境光反射，彻底消除拼接感。
4. 场景参考描述：${activePrompt}`;
    } else {
      pText = strictMode 
        ? `【背景重绘指令】保留主体，替换背景：
1. 严格锁定原图商品的主体形状、图案和所有边框颜色，保持 100% 不变。
2. 将背景重绘为：${activePrompt}。
3. 必须为商品底部添加符合新场景光源的自然接触阴影（Contact Shadows），使其完美融入背景，切忌悬浮感。`
        : `将背景替换为：${activePrompt}。真实的电商场景风格，光影自然融合。`;
    }

    const partsArr = [
      { text: pText },
      { inlineData: { mimeType: item.mimeType || "image/png", data: item.base64 } }
    ];

    if (referenceImage) {
      partsArr.push(
        { text: "必须严格 1:1 模仿以下垫图的透视、光影与背景环境：" },
        { inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.base64 } }
      );
    }

    try {
      const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: partsArr }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      });
      const b64 = res.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data;
      if (b64) {
        setImages(prev => prev.map(i => i.id === id ? { ...i, resultUrl: `data:image/png;base64,${b64}`, status: 'success' } : i));
      } else {
        throw new Error("API 重绘结果为空");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', errorMsg: errorMessage } : i));
    }
  };

  // --- 4. 本地 HD 放大逻辑 ---
  const handleUpscale = async (id) => {
    const target = images.find(i => i.id === id);
    if (!target?.resultUrl) return;
    
    setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'upscaling' } : i));
    
    try {
      const img = new Image();
      img.src = target.resultUrl;
      await new Promise((r, reject) => {
        img.onload = r;
        img.onerror = () => reject(new Error("图片加载失败"));
      });
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2; 
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png', 1.0);
      
      setImages(prev => prev.map(i => i.id === id ? { ...i, resultUrl: data, status: 'success', isUpscaled: true } : i));
    } catch (e) {
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', errorMsg: "HD 放大失败" } : i));
    }
  };

  return (
    <div className="min-h-screen bg-[#060608] text-slate-100 p-4 xl:p-8 font-sans selection:bg-blue-500/30 relative">
      <div className="max-w-[1700px] mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 border-b border-white/5 pb-8">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="bg-indigo-600/20 text-indigo-400 text-[10px] font-black px-2 py-0.5 rounded border border-indigo-500/30 tracking-widest uppercase">E-Commerce Flow</span>
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-white">
              Gemini <span className="bg-gradient-to-tr from-blue-400 via-emerald-400 to-purple-400 bg-clip-text text-transparent italic">Studio</span>
            </h1>
          </div>
          
          <div className="flex flex-col items-end gap-3">
            <div className="flex gap-3">
              <button onClick={() => setShowSettings(!showSettings)} className={`p-2.5 rounded-xl border border-white/5 bg-white/5 transition-all ${showSettings ? 'text-indigo-400 ring-1 ring-indigo-500/50' : 'text-slate-500'}`}><Settings size={20} /></button>
              <button onClick={() => setStrictMode(!strictMode)} className={`px-5 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${strictMode ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'}`}><Fingerprint size={16} /> {strictMode ? '锁定主体: 开启' : '锁定主体: 关闭'}</button>
              <button onClick={() => {setImages([]); setFissionSource(null); setFissionResults([]); setReferenceImage(null);}} className="px-5 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">清空重置</button>
            </div>
            {showSettings && (
              <div className="flex items-center gap-2 bg-[#111114] p-3 rounded-xl border border-white/10 animate-in fade-in slide-in-from-top-2">
                <Key size={14} className="text-slate-500" />
                <input type="password" placeholder="API Key (仅本地运行需填入)" className="bg-transparent border-none outline-none text-xs w-48 placeholder:text-slate-700" value={userKey} onChange={(e) => setUserKey(e.target.value)} />
              </div>
            )}
          </div>
        </header>

        <main className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          
          {/* 左侧控制区 */}
          <div className="xl:col-span-4 space-y-6">
            
            {/* 场景裂变实验室 */}
            <section className="bg-gradient-to-br from-indigo-900/20 to-slate-900/40 p-6 rounded-[2.5rem] border border-indigo-500/10 backdrop-blur-xl space-y-4 shadow-2xl relative overflow-hidden group">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-black uppercase tracking-widest text-indigo-400 flex items-center gap-2"><Network size={16} /> Fission Lab / 场景裂变</h2>
                {fissionResults.length > 0 && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">4 Variations</span>}
              </div>

              {!fissionSource ? (
                <label className="block border-2 border-dashed border-indigo-500/20 rounded-[1.8rem] p-8 hover:border-indigo-500/50 transition-all cursor-pointer bg-indigo-500/5 text-center group/lab">
                  <CopyPlus size={32} className="mx-auto text-indigo-800 group-hover/lab:text-indigo-400 mb-2 transition-colors" />
                  <span className="text-[11px] font-black text-slate-500 block">上传单图，裂变 4 张相似场景</span>
                  <input type="file" className="hidden" accept="image/*" onChange={handleFissionUpload} />
                </label>
              ) : (
                <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                  <div className={`relative ${fissionResults.length > 0 ? 'aspect-video w-1/2 mx-auto rounded-xl' : 'aspect-video rounded-2xl'} border border-white/5 bg-slate-900 overflow-hidden flex items-center justify-center transition-all`}>
                    <img src={fissionSource.sourceUrl} className={`max-h-full object-contain ${isFissionLoading ? 'opacity-30 blur-sm scale-95' : 'scale-100'} transition-all`} alt="fission_src" />
                    {isFissionLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-sm px-6 text-center">
                        <Loader2 size={32} className="animate-spin text-indigo-400" />
                        <p className="text-[10px] font-black tracking-widest text-indigo-400 uppercase">{fissionProgress}</p>
                      </div>
                    )}
                  </div>
                  
                  {fissionResults.length === 0 && !isFissionLoading && (
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={runFission} className="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/20">
                        一键裂变 4 张
                      </button>
                      <button onClick={() => setFissionSource(null)} className="py-3 rounded-xl bg-red-950/20 border border-red-500/20 text-red-400 text-[10px] font-black transition-all">
                        取消重选
                      </button>
                    </div>
                  )}

                  {fissionResults.length > 0 && (
                    <div className="mt-4 border-t border-white/5 pt-4">
                      <h3 className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">Fission Results / 裂变结果</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {fissionResults.map((item, idx) => (
                          <div key={item.id} className="relative aspect-square bg-[#111114] rounded-xl border border-white/10 overflow-hidden group">
                            {item.status === 'generating' && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                <Loader2 size={24} className="animate-spin text-indigo-500/50" />
                              </div>
                            )}
                            {item.status === 'error' && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center bg-red-950/20">
                                <AlertCircle size={20} className="text-red-500/50" />
                                <span className="text-[8px] text-red-400">{item.errorMsg}</span>
                              </div>
                            )}
                            {item.status === 'success' && (
                              <>
                                <img src={item.resultUrl} className="w-full h-full object-contain p-2 cursor-zoom-in hover:scale-105 transition-transform" onClick={() => setPreviewImage(item.resultUrl)} alt="var" />
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity bg-black/40 backdrop-blur-sm">
                                  <button onClick={() => setPreviewImage(item.resultUrl)} className="text-white hover:text-indigo-400 p-2 bg-black/60 hover:bg-black/80 rounded-full shadow-lg transition-all"><Search size={14}/></button>
                                  <button onClick={() => downloadSingleImage(item.resultUrl, `Fission-Var-${idx+1}.png`)} className="text-white hover:text-emerald-400 p-2 bg-black/60 hover:bg-black/80 rounded-full shadow-lg transition-all"><Download size={14}/></button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      <div className="flex gap-3 mt-4">
                        <button onClick={runFission} disabled={isFissionLoading} className="flex-1 py-3 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded-xl text-[10px] font-bold transition-all border border-indigo-500/20 flex justify-center items-center gap-2">
                          <RefreshCw size={14} />
                          重新裂变
                        </button>
                        <button onClick={() => {setFissionSource(null); setFissionResults([]);}} className="flex-1 py-3 bg-slate-800/50 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-bold transition-all flex justify-center items-center gap-2">
                          <Upload size={14} />
                          重新上传
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 待处理队列 */}
            <section className="bg-slate-900/40 p-6 rounded-[2.5rem] border border-white/5 backdrop-blur-xl space-y-4 shadow-xl">
              <div className="flex justify-between items-center text-white"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Layers size={14} className="text-blue-500" /> Matrix Queue / 待处理</h2><span className="text-[10px] font-mono text-slate-500 bg-black/40 px-2 py-0.5 rounded-md">{images.length}</span></div>
              <label className="block border-2 border-dashed border-slate-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all cursor-pointer bg-black/20 text-center group">
                <Upload size={24} className="mx-auto text-slate-700 group-hover:text-blue-500 mb-1" />
                <span className="text-[10px] font-bold text-slate-500 block text-center">批量导入原图</span>
                <input type="file" multiple className="hidden" accept="image/*" onChange={handleBatchUpload} />
              </label>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">{images.map(img => (<div key={img.id} className="relative w-10 h-10 rounded-lg border border-white/10 overflow-hidden group shadow-md"><img src={img.sourceUrl} className="w-full h-full object-cover" alt="t" /><button onClick={() => setImages(prev => prev.filter(i => i.id !== img.id))} className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-red-400 transition-opacity"><X size={14}/></button></div>))}</div>
              )}
            </section>

            {/* AI 电商方案面板 */}
            <section className="bg-slate-900/40 p-6 rounded-[2.5rem] border border-white/5 backdrop-blur-xl space-y-4 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-black uppercase tracking-widest text-amber-400 flex items-center gap-2">
                  <Sparkles size={16} /> E-Commerce Scenarios / 电商方案推荐
                </h2>
                {images.length > 0 && (
                  <button 
                    onClick={() => runDeepAnalysis(images[0], true)} 
                    disabled={analyzing} 
                    className="text-[10px] font-bold text-slate-500 hover:text-amber-400 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={analyzing ? "animate-spin" : ""} />
                    {analyzing ? '推算中...' : '换一批 (智能排重)'}
                  </button>
                )}
              </div>

              {/* 环境预设选项组 */}
              <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
                {ENV_OPTIONS.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedEnv(opt.value)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all ${
                      selectedEnv === opt.value
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 shadow-[0_0_10px_-2px_rgba(245,158,11,0.3)]'
                        : 'bg-black/40 border-slate-800 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              
              {analysis.suggestions && analysis.suggestions.length > 0 && (
                <div className="space-y-2">{analysis.suggestions.map((s, idx) => (<button key={idx} onClick={() => setPrompt(String(s))} className={`w-full p-3.5 rounded-xl border text-left text-[11px] leading-relaxed transition-all ${prompt === s ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 shadow-[0_0_15px_-5px_rgba(59,130,246,0.5)]' : 'bg-black/40 border-slate-800 text-slate-500 hover:text-slate-300'}`}>{String(s)}</button>))}</div>
              )}
              
              {/* ★ 文本框与魔法扩写按钮 */}
              <div className="relative">
                <textarea 
                  placeholder="描述电商主图/详情页的真实背景，或输入短句点击右下角魔法棒自动扩写..." 
                  className="w-full h-32 p-4 pr-12 bg-black/50 border border-slate-800 rounded-2xl text-sm outline-none focus:border-blue-500 transition-all resize-none text-white font-medium placeholder:text-slate-700" 
                  value={prompt} 
                  onChange={(e) => setPrompt(e.target.value)} 
                />
                <button 
                  onClick={handleEnhancePrompt} 
                  disabled={isEnhancingPrompt}
                  title="✨ Gemini 魔法扩写提示词"
                  className={`absolute bottom-4 right-4 p-2 rounded-xl border transition-all flex items-center justify-center ${isEnhancingPrompt ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-black/60 border-slate-700 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50'}`}
                >
                  {isEnhancingPrompt ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                </button>
              </div>
              
              {/* 风格垫图上传入口 */}
              <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                 <div className="flex justify-between items-center">
                   <h3 className="text-[10px] font-bold text-slate-400 flex items-center gap-2"><Palette size={14} className="text-pink-400"/> Style Reference / 风格垫图 (可选)</h3>
                   {referenceImage && <button onClick={() => setReferenceImage(null)} className="text-[9px] text-red-400 hover:text-red-300 transition-colors">清除垫图</button>}
                 </div>
                 
                 {!referenceImage ? (
                   <label className="block border-2 border-dashed border-pink-500/20 rounded-xl p-4 hover:border-pink-500/50 transition-all cursor-pointer bg-pink-500/5 text-center group/sref">
                     <span className="text-[10px] font-bold text-slate-500 group-hover/sref:text-pink-400 transition-colors flex items-center justify-center gap-2">
                       <Upload size={14} /> 上传一张作为氛围光影参考的图片
                     </span>
                     <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} />
                   </label>
                 ) : (
                   <div className="flex items-center gap-4 bg-black/30 p-3 rounded-xl border border-white/5">
                     <img src={referenceImage.sourceUrl} className="w-12 h-12 object-cover rounded-lg border border-pink-500/30" alt="sref" />
                     <div className="flex-1">
                        <p className="text-[10px] text-pink-400 font-bold">参考图已就绪</p>
                        <p className="text-[9px] text-slate-500">AI 将尝试吸取该图的色调与光影氛围</p>
                     </div>
                     <label className="text-[9px] font-bold text-slate-300 bg-white/5 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                        更换
                        <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} />
                     </label>
                   </div>
                 )}
              </div>

              <button onClick={startBatchRedraw} disabled={loading || images.length === 0 || (!prompt && !referenceImage)} className={`w-full mt-4 py-5 rounded-[1.2rem] font-black tracking-widest text-xs flex items-center justify-center gap-3 transition-all ${loading || images.length === 0 || (!prompt && !referenceImage) ? 'bg-slate-800 text-slate-600' : 'bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-900/40 text-white active:scale-95'}`}>{loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}{loading ? 'Batch Rendering...' : '开始执行流水线'}</button>
            </section>
          </div>

          {/* 右侧主画布 */}
          <div className="xl:col-span-8 bg-black/40 rounded-[3.5rem] border border-white/5 p-8 min-h-[750px] flex flex-col space-y-8 shadow-inner relative overflow-hidden">
            <div className="flex justify-between items-center px-4 relative z-10 text-white font-black uppercase tracking-tighter"><h3 className="text-sm flex items-center gap-3"><LayoutGrid size={18} /> Matrix / 渲染矩阵</h3>{images.some(i => i.status === 'success') && (<button onClick={() => images.filter(i => i.status === 'success').forEach((img, idx) => { const a = document.createElement('a'); a.href = img.resultUrl; a.download = `Studio-Result-${idx+1}.png`; a.click(); })} className="bg-white text-black px-6 py-2.5 rounded-full text-[10px] font-black hover:bg-slate-200 transition-all shadow-xl active:scale-95">导出全部成品</button>)}</div>
            <div className="flex-1 bg-black/40 rounded-[2.8rem] p-10 overflow-y-auto custom-scrollbar border border-white/5 shadow-inner">
              {images.length === 0 ? (<div className="h-full flex flex-col items-center justify-center opacity-10 space-y-6 text-white"><ImageIcon size={100} strokeWidth={1} /><p className="font-black tracking-[0.5em] uppercase text-xs">Waiting for Payload</p></div>) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                  {images.map((img, idx) => (
                    <div key={img.id} className="relative aspect-square bg-[#111114] rounded-[3rem] border border-white/5 overflow-hidden group shadow-2xl transition-all hover:scale-[1.01] hover:border-blue-500/30">
                      
                      <div className="absolute top-6 left-6 z-20 flex gap-2">
                        <span className={`text-[9px] font-black uppercase px-4 py-1.5 rounded-full shadow-2xl flex items-center gap-2 ${img.status === 'success' ? 'bg-emerald-500 text-white' : img.status === 'generating' || img.status === 'upscaling' ? 'bg-blue-600 text-white animate-pulse' : img.status === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-500'}`}>{img.status === 'idle' ? 'Ready' : img.status}</span>
                      </div>
                      
                      <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_center,_#1a1a20_0%,_#000_100%)] relative">
                         {img.status === 'idle' && (<div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10" />)}
                        {img.status === 'success' ? (<img src={img.resultUrl} className="w-full h-full object-contain p-6 cursor-zoom-in animate-in fade-in" onClick={() => setPreviewImage(img.resultUrl)} alt="r" />) 
                        : img.status === 'generating' || img.status === 'upscaling' ? (<div className="flex flex-col items-center gap-4 text-white"><Loader2 size={40} className="animate-spin text-blue-500/40" /><p className="text-[10px] font-black tracking-widest uppercase">Rendering...</p></div>) 
                        : img.status === 'error' ? (<div className="px-10 text-center space-y-3"><AlertCircle size={32} className="mx-auto text-red-500/60" /><p className="text-[10px] text-red-400 font-bold leading-relaxed">{img.errorMsg}</p><button onClick={() => regenerateImage(img.id)} className="text-[10px] bg-white/5 text-white hover:bg-white/10 px-6 py-2.5 rounded-full font-black tracking-widest transition-all">RETRY</button></div>) 
                        : (<img src={img.sourceUrl} className="w-full h-full object-contain opacity-40 grayscale scale-95" alt="s" />)}
                      </div>
                      
                      {img.status === 'success' && (
                        <div className="absolute inset-x-0 bottom-0 h-14 bg-black/80 backdrop-blur-2xl border-t border-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 flex items-center justify-around px-2 sm:px-6 text-white">
                          <button onClick={() => setPreviewImage(img.resultUrl)} className="text-[9px] font-black uppercase flex flex-col items-center gap-1 hover:text-blue-400 transition-colors"><Search size={14}/>预览</button>
                          <button onClick={() => handleUpscale(img.id)} disabled={img.isUpscaled} className={`text-[9px] font-black uppercase flex flex-col items-center gap-1 ${img.isUpscaled ? 'text-emerald-400' : 'hover:text-purple-400'}`}>{img.isUpscaled ? <CheckCircle size={14}/> : <Maximize size={14}/>} HD+</button>
                          
                          {/* ★ 新增：AI 文案生成按钮 */}
                          <button onClick={() => generateMarketingCopy(img.id)} className="text-[9px] font-black uppercase flex flex-col items-center gap-1 text-pink-400 hover:text-pink-300 transition-colors"><PenTool size={14}/> ✨写文案</button>
                          
                          <button onClick={() => { const a = document.createElement('a'); a.href = img.resultUrl; a.download = `Result-${idx+1}.png`; a.click(); }} className="text-[9px] font-black uppercase flex flex-col items-center gap-1 hover:text-emerald-400 transition-colors"><Download size={14}/>导出</button>
                          <button onClick={() => regenerateImage(img.id)} className="text-[9px] font-black uppercase flex flex-col items-center gap-1 hover:text-amber-400 transition-colors"><RotateCcw size={14}/>重绘</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* 预览全图 Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-3xl flex items-center justify-center p-8 animate-in fade-in duration-500" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={e => e.stopPropagation()}><button onClick={() => setPreviewImage(null)} className="absolute -top-14 right-0 bg-white/5 hover:bg-red-500 rounded-full p-3 transition-all"><X size={28} className="text-white" /></button><img src={previewImage} className="max-w-full max-h-[90vh] object-contain rounded-3xl shadow-2xl animate-in zoom-in" alt="preview" /></div>
        </div>
      )}

      {/* ★ 新增：文案展示 Modal */}
      {copyModal.isOpen && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-[#111114] border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col sm:flex-row relative">
            <button onClick={() => setCopyModal({isOpen: false, text: "", imgUrl: null, loading: false})} className="absolute top-4 right-4 text-slate-400 hover:text-white bg-black/50 p-1.5 rounded-full z-10 transition-colors"><X size={20} /></button>
            <div className="w-full sm:w-2/5 bg-black p-6 flex items-center justify-center border-b sm:border-b-0 sm:border-r border-white/5">
               {copyModal.imgUrl && <img src={copyModal.imgUrl} className="max-w-full max-h-48 sm:max-h-[300px] object-contain rounded-xl shadow-lg" alt="商品" />}
            </div>
            <div className="w-full sm:w-3/5 p-8 flex flex-col h-[400px]">
               <h3 className="text-sm font-black text-pink-400 flex items-center gap-2 mb-4"><Sparkles size={16} /> AI 爆款营销文案</h3>
               <div className="flex-1 bg-black/40 border border-white/5 rounded-2xl p-4 overflow-y-auto custom-scrollbar text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {copyModal.loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 text-pink-500/50">
                      <Loader2 size={32} className="animate-spin" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">Generating Copy...</p>
                    </div>
                  ) : (
                    copyModal.text
                  )}
               </div>
               {!copyModal.loading && copyModal.text && (
                 <button onClick={copyToClipboard} className="mt-4 w-full py-3.5 bg-pink-600 hover:bg-pink-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors active:scale-[0.98]">
                   <Copy size={16} /> 一键复制文案
                 </button>
               )}
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #26262e; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3d3d4a; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoomIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation: fadeIn 0.4s ease-out forwards; }
        .zoom-in { animation: zoomIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}} />
    </div>
  );
}
