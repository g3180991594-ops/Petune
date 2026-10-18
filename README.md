# PetSound Studio（宠物声谱）MVP

把鸟叫、猫叫、狗叫、兔兔等宠物声音转化为音乐灵感，并生成趣味弹幕。首版采用 FastAPI + 原生 HTML/CSS/JavaScript；声音预处理和四项基础特征提取在浏览器本地完成。

## 已实现功能

- **P0**：浏览器录音、上传本地音频；浏览器端统一重采样为 44.1 kHz WAV；提取音频时长、平均音量（RMS/dBFS）、主频率估计、节奏密度；根据特征构造音乐提示词；生成 10/15/20/30 秒音乐；按宠物类型和能量区间匹配趣味弹幕；音乐播放、下载和分享。
- **P1**：鸟、兔、猫、狗、其他五种宠物文案；同一录音再生成；服务端历史记录；主动发布到社区并浏览公开作品。
- **P2**：智能匹配、治愈轻柔、欢快活泼、神秘氛围四种风格；社区公开作品列表。
- **娱乐边界**：不对宠物的真实情绪、行为或健康状态做判断。

## 技术实现

- 前端：原生 JavaScript + Web Audio API。音频在浏览器中解码、重采样到 44.1 kHz、导出 WAV，并提取声学特征。
- 后端：FastAPI。保管 API Token、调用模型、持久化作品元数据及生成音频。
- 真实音乐生成：通过 Replicate 托管的 `meta/musicgen` 模型调用 MusicGen Melody，传入音频和文本提示词。`input_audio` 用作旋律/声音轮廓参考，不保证原样保留动物叫声。
- 未配置 Token：自动启用**本地演示模式**，合成一段简单的示例音乐以测试完整界面流程；这不是 AI 模型生成结果，界面会明确标注。

## 本地运行

建议 Python 3.10 或 3.11。

### 1. 创建虚拟环境并安装依赖

```bash
python -m venv .venv
```

macOS / Linux：

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. （可选）配置真实 MusicGen API

先在 Replicate 创建 API Token，然后在**启动服务的终端环境**中配置。不要把 Token 写进前端 JavaScript，也不要提交到 Git。

macOS / Linux：

```bash
export REPLICATE_API_TOKEN="你的_REPLICATE_API_TOKEN"
```

Windows PowerShell：

```powershell
$env:REPLICATE_API_TOKEN="你的_REPLICATE_API_TOKEN"
```

如果跳过此步骤，应用仍可在本地演示模式下运行。

### 3. 启动

在项目目录执行：

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

浏览器打开 <http://127.0.0.1:8000>。

## 目录结构

```text
petsound-studio/
├── app.py
├── requirements.txt
├── .env.example
├── README.md
├── static/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── data/
    ├── history.json       # 首次运行后生成
    ├── uploads/           # 原始录音的 WAV 预处理版本
    └── generated/         # 生成音乐
```

## 当前原型的边界与上线前工作

1. **MusicGen 费用与许可**：Replicate 是第三方托管服务，实际费用以其当前价格页和用量为准。Meta AudioCraft 官方仓库说明，代码采用 MIT 许可，但模型权重采用 CC-BY-NC 4.0；如果计划商业化、收费或用于商业产品，需要先核对模型许可及托管服务条款，必要时更换具有合适商业许可的模型。
2. **音频特征是基础信号处理结果**：主频率通过自相关做估计，复杂噪声或非周期性的鸟叫可能没有可靠基频；节奏密度是基于短时能量峰的启发式估计，不是动物情绪分类器。
3. **文件存储是本地 JSON 原型**：没有用户账号、权限隔离、云对象存储、自动过期清理或内容审核。不要直接将此原型无保护地部署到公网；公开部署前应增加认证、每位用户的数据隔离、请求限流、文件清理、社区审核和数据库。
4. **社区可见范围**：点击“发布到社区”后，生成音乐和弹幕会出现在当前应用服务的公共列表中；原始录音不会公开，但会保留在服务端供历史记录再生成使用。
5. **录音隐私**：录音经过浏览器处理后发送到本项目后端；配置真实 MusicGen 时，输入音频还会被发送到 Replicate 进行推理。正式产品需要提供清晰的隐私告知和删除机制。
6. **分享**：支持浏览器原生文件分享时会直接分享音频文件；否则会尝试复制音频地址。公网链接分享需要把应用部署到可访问的 HTTPS 域名。

## API 路由概览

- `GET /api/config`：当前是演示模式还是 MusicGen 模式
- `POST /api/generate`：上传 WAV、特征和创作参数并生成作品
- `POST /api/regenerate/{id}`：使用同一段录音重新生成
- `GET /api/history`：历史作品
- `DELETE /api/history/{id}`：删除作品
- `POST /api/publish/{id}`：主动发布到社区
- `GET /api/community`：公开作品列表
- `GET /media/{id}`：播放或下载生成音频

## 重要说明

MusicGen 不会可靠地“识别宠物情绪”。本项目仅将音量、主频率、节奏密度和时长映射为音乐生成提示词，并用固定句子库生成娱乐性弹幕。弹幕是创意文案，不是对宠物真实状态的判断。
