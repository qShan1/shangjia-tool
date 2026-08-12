"""
AI回复引擎模块 - 统一意图识别与回复生成

【重构版本】
- 将意图判断和回复生成合并为一次AI调用
- AI根据完整上下文自行判断意图并生成回复
- 避免关键词误判导致的不当回复
- 支持多种API类型：OpenAI / OpenAI Responses / Gemini / Anthropic / Azure OpenAI / Ollama / DashScope
"""

import json
import time
import requests
import threading
from typing import List, Dict, Optional
from loguru import logger
from db_manager import db_manager


def _repair_mojibake(text: str) -> str:
    """Repair common UTF-8 text decoded as Latin-1 without touching normal text."""
    if not isinstance(text, str) or not text:
        return text

    markers = ('Ã', 'Â', 'â', 'ð', 'å', 'æ', 'ç', 'è', 'é', 'ï', '�')
    if not any(marker in text for marker in markers):
        return text

    try:
        repaired = text.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text

    def cjk_count(value: str) -> int:
        return sum('\u4e00' <= char <= '\u9fff' for char in value)

    if cjk_count(repaired) > cjk_count(text) or repaired.count('�') < text.count('�'):
        return repaired
    return text


class AIReplyEngine:
    """AI回复引擎 - 统一意图识别与回复生成"""
    
    def __init__(self):
        self._init_default_prompts()
        # 用于控制同一chat_id消息的串行处理
        self._chat_locks = {}
        self._chat_locks_lock = threading.Lock()
    
    def _init_default_prompts(self):
        """初始化默认提示词（用于构建统一提示词）"""
        self.default_prompts = {
            'price': '''【议价场景】
策略：根据议价次数递减优惠
- 第1次：可小幅优惠，表达诚意
- 第2次：中等优惠，强调已是优惠价
- 第3次及以后：最大优惠或坚持底线
语气友好但坚定，突出商品价值和优势。''',
            
            'tech': '''【技术/产品问题】
基于商品信息回答，不要自行发挥。
如果问题超出商品信息范围，简短说明当前商品主要服务范围，并请客户提供软件名称、版本和截图。
不要说“商品未说明”“我需要确认”“等等，我看一下”，不要暴露内部判断过程。''',
            
            'default': '''【一般咨询】
基于商品信息回答物流、售后等问题。
如果问题超出商品信息范围，简短说明当前商品主要服务范围并引导客户提供有效问题。
如果客户没有主动询问退款、议价或远程，不要主动提及这些词。
不要说“商品未说明”“我需要确认”“等等，我看一下”，不要暴露内部判断过程。'''
        }
    
    def _resolve_api_type(self, settings: dict) -> str:
        """根据设置解析实际的API类型（支持显式设置和自动检测）"""
        api_type = (settings.get('api_type') or '').strip()
        if api_type:
            return api_type

        # 向后兼容：自动检测
        if self._is_dashscope_app_api(settings):
            return 'dashscope'
        if self._is_gemini_api(settings):
            return 'gemini'
        return 'openai'

    def _is_dashscope_app_api(self, settings: dict) -> bool:
        """判断是否为DashScope应用API（/apps/模式）"""
        base_url = (settings.get('base_url') or '').strip().rstrip('/')
        return 'dashscope.aliyuncs.com' in base_url and '/apps/' in base_url

    def _is_gemini_api(self, settings: dict) -> bool:
        """判断是否为Gemini API"""
        model_name = settings.get('model_name', '').lower()
        return 'gemini' in model_name
    
    def _build_unified_system_prompt(self, custom_prompts: dict, settings: dict) -> str:
        """
        构建统一的系统提示词
        将意图判断和回复生成整合到一个提示词中
        """
        # 获取各场景的指导（优先使用用户自定义）
        price_guide = custom_prompts.get('price', self.default_prompts['price'])
        tech_guide = custom_prompts.get('tech', self.default_prompts['tech'])
        default_guide = custom_prompts.get('default', self.default_prompts['default'])
        
        # 获取议价设置
        max_bargain_rounds = settings.get('max_bargain_rounds', 3)
        max_discount_percent = settings.get('max_discount_percent', 10)
        max_discount_amount = settings.get('max_discount_amount', 100)
        
        unified_prompt = f"""你是一位专业的电商客服AI助手。请根据用户消息和上下文，直接生成合适的回复。

## 核心原则
1. **准确理解意图**：只根据用户实际说的内容判断，不要过度解读
2. **不要主动提及敏感话题**：用户没提到的（如退款、砍价）不要主动提
3. **基于商品信息回答**：只回答商品信息中有的内容
4. **避免重复**：结合对话历史，不要重复之前说过的话
5. **语言简洁友好**：回复要自然、简短，尽量控制在1-3句、60个中文字符以内

## 场景处理指南

### 当用户明确要求降价/优惠/砍价时
{price_guide}
- 议价限制：最多{max_bargain_rounds}轮，最大优惠{max_discount_percent}%或{max_discount_amount}元

### 当用户询问产品技术/功能/使用问题时
{tech_guide}

### 其他一般咨询（物流、售后、商品介绍等）
{default_guide}

## 商品类型边界
- 先判断商品是资料/软件服务/技术答疑还是实物，不要把技术答疑服务说成软件下载、安装包或文件交付。
- 客户问“怎么下载”时，如果商品资料没有明确提供下载内容，应说明这是答疑/诊断服务，不承诺提供软件本体；如果可能是安装问题，请让客户发版本和报错截图。
- 客户问价格时，只引用商品页面中的价格，不要编造“起价”、优惠或额外服务价格。

## 特别注意
- 用户只是问价格≠用户在砍价，正常回答价格即可
- 用户咨询售后≠用户要退款，正常解答即可
- 如果用户的问题超过你的回答范围，直接用一句自然的范围说明引导客户，不要使用“等等”或“我需要确认”。

请直接输出回复内容，不要输出分析过程。"""
        
        return unified_prompt

    def _call_dashscope_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """调用DashScope API"""
        base_url = settings['base_url']
        if '/apps/' in base_url:
            app_id = base_url.split('/apps/')[-1].split('/')[0]
        else:
            raise ValueError("DashScope API URL中未找到app_id")

        url = f"https://dashscope.aliyuncs.com/api/v1/apps/{app_id}/completion"

        system_content = ""
        user_content = ""
        for msg in messages:
            if msg['role'] == 'system':
                system_content = msg['content']
            elif msg['role'] == 'user':
                user_content = msg['content'] # 假设 user prompt 已在 generate_reply 中构建好

        if system_content and user_content:
            prompt = f"{system_content}\n\n用户问题：{user_content}\n\n请直接回答用户的问题："
        elif user_content:
            prompt = user_content
        else:
            prompt = "\n".join([f"{msg['role']}: {msg['content']}" for msg in messages])

        data = {
            "input": {"prompt": prompt},
            "parameters": {"max_tokens": max_tokens, "temperature": temperature},
            "debug": {}
        }
        headers = {
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json"
        }

        logger.info(f"DashScope API请求: {url}")
        logger.info(f"发送的prompt: {prompt[:100]}...") # 避免 prompt 过长
        logger.debug(f"请求数据: {json.dumps(data, ensure_ascii=False)}")

        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code != 200:
            logger.error(f"DashScope API请求失败: {response.status_code} - {response.text}")
            raise Exception(f"DashScope API请求失败: {response.status_code} - {response.text}")

        result = response.json()
        logger.debug(f"DashScope API响应: {json.dumps(result, ensure_ascii=False)}")

        if 'output' in result and 'text' in result['output']:
            return result['output']['text'].strip()
        else:
            raise Exception(f"DashScope API响应格式错误: {result}")

    def _call_gemini_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """
        调用Google Gemini REST API (v1beta)
        """
        api_key = settings['api_key']
        model_name = settings['model_name'] 
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

        headers = {"Content-Type": "application/json"}

        # --- 转换消息格式 (修复 P1-3: 增强健壮性) ---
        system_instruction = ""
        user_content_parts = []

        # 遍历消息，找到 system 和所有的 user parts
        for msg in messages:
            if msg['role'] == 'system':
                system_instruction = msg['content']
            elif msg['role'] == 'user':
                # 我们只关心 user content
                user_content_parts.append(msg['content'])
        
        # 将所有 user parts 合并为最后的 user_content
        # 在我们的使用场景中 (generate_reply)，只会有一个 user part，但这样更安全
        user_content = "\n".join(user_content_parts)

        if not user_content:
            logger.warning(f"Gemini API 调用: 未在消息中找到 'user' 角色内容。Messages: {messages}")
            raise ValueError("未在消息中找到用户内容 (user content)")
        # --- 消息格式转换结束 ---

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_content}]
                }
            ],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens
            }
        }
        
        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        logger.info(f"Calling Gemini REST API: {url.split('?')[0]}")
        logger.debug(f"Gemini Payload: {json.dumps(payload, ensure_ascii=False)}")
        
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code != 200:
            logger.error(f"Gemini API 请求失败: {response.status_code} - {response.text}")
            raise Exception(f"Gemini API 请求失败: {response.status_code} - {response.text}")
            
        result = response.json()
        logger.debug(f"Gemini API 响应: {json.dumps(result, ensure_ascii=False)}")

        try:
            reply_text = result['candidates'][0]['content']['parts'][0]['text']
            return reply_text.strip()
        except (KeyError, IndexError, TypeError) as e:
            logger.error(f"Gemini API 响应格式错误: {result} - {e}")
            raise Exception(f"Gemini API 响应格式错误: {result}")

    def _call_openai_chat_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """调用OpenAI Chat Completions API（兼容OpenAI / Ollama / 其他兼容服务）"""
        base_url = settings['base_url'].rstrip('/')
        if not base_url.endswith('/v1'):
            base_url = base_url + '/v1'
        url = f"{base_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        api_key = settings.get('api_key', '')
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        data = {
            "model": settings['model_name'],
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        logger.info(f"OpenAI Chat API请求: {url}")
        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code != 200:
            logger.error(f"OpenAI Chat API请求失败: {response.status_code} - {response.text}")
            raise Exception(f"OpenAI Chat API请求失败: {response.status_code} - {response.text}")

        result = response.json()
        return result['choices'][0]['message']['content'].strip()

    def _call_openai_responses_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """调用OpenAI Responses API"""
        base_url = settings['base_url'].rstrip('/')
        if not base_url.endswith('/v1'):
            base_url = base_url + '/v1'
        url = f"{base_url}/responses"

        headers = {
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json"
        }
        data = {
            "model": settings['model_name'],
            "input": messages,
            "max_output_tokens": max_tokens,
            "temperature": temperature
        }

        logger.info(f"OpenAI Responses API请求: {url}")
        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code != 200:
            logger.error(f"OpenAI Responses API请求失败: {response.status_code} - {response.text}")
            raise Exception(f"OpenAI Responses API请求失败: {response.status_code} - {response.text}")

        result = response.json()
        # Responses API 返回 output_text 字段
        if 'output_text' in result:
            return result['output_text'].strip()
        # 兼容解析 output 数组
        for item in result.get('output', []):
            if item.get('type') == 'message':
                for content in item.get('content', []):
                    if content.get('type') == 'output_text':
                        return content['text'].strip()
        raise Exception(f"OpenAI Responses API响应格式错误: {result}")

    def _call_anthropic_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """调用Anthropic Claude Messages API"""
        base_url = settings['base_url'].rstrip('/')
        if base_url.endswith('/v1'):
            url = f"{base_url}/messages"
        else:
            url = f"{base_url}/v1/messages"

        headers = {
            "x-api-key": settings['api_key'],
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

        # Anthropic 格式：system 单独提取，messages 只包含 user/assistant
        system_content = ""
        api_messages = []
        for msg in messages:
            if msg['role'] == 'system':
                system_content = msg['content']
            else:
                api_messages.append({"role": msg['role'], "content": msg['content']})

        data = {
            "model": settings['model_name'],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": api_messages
        }
        if system_content:
            data["system"] = system_content

        logger.info(f"Anthropic API请求: {url}")
        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code != 200:
            logger.error(f"Anthropic API请求失败: {response.status_code} - {response.text}")
            raise Exception(f"Anthropic API请求失败: {response.status_code} - {response.text}")

        result = response.json()
        return result['content'][0]['text'].strip()

    def _call_azure_openai_api(self, settings: dict, messages: list, max_tokens: int = 100, temperature: float = 0.7) -> str:
        """调用Azure OpenAI API"""
        base_url = settings['base_url'].rstrip('/')
        # Azure URL 格式: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=xxx
        # 用户应在 base_url 中填入完整的 deployment URL
        if '/chat/completions' in base_url:
            url = base_url
        else:
            url = f"{base_url}/chat/completions"

        if 'api-version' not in url:
            separator = '&' if '?' in url else '?'
            url = f"{url}{separator}api-version=2024-02-01"

        headers = {
            "api-key": settings['api_key'],
            "Content-Type": "application/json"
        }
        data = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        logger.info(f"Azure OpenAI API请求: {url.split('?')[0]}")
        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code != 200:
            logger.error(f"Azure OpenAI API请求失败: {response.status_code} - {response.text}")
            raise Exception(f"Azure OpenAI API请求失败: {response.status_code} - {response.text}")

        result = response.json()
        return result['choices'][0]['message']['content'].strip()

    def is_ai_enabled(self, cookie_id: str) -> bool:
        """检查指定账号是否启用AI回复"""
        settings = db_manager.get_ai_reply_settings(cookie_id)
        return settings['ai_enabled']
    
    def _get_chat_lock(self, chat_id: str) -> threading.Lock:
        """获取指定chat_id的锁，如果不存在则创建"""
        with self._chat_locks_lock:
            if chat_id not in self._chat_locks:
                self._chat_locks[chat_id] = threading.Lock()
            return self._chat_locks[chat_id]

    @staticmethod
    def _normalize_customer_reply(reply: str, item_info: dict) -> str:
        """屏蔽内部兜底话术，避免把模型的判断过程直接发给客户。"""
        text = str(reply or '').strip()
        if not text:
            return text
        scope = str(item_info.get('title') or item_info.get('item_title') or '当前商品').strip()
        if any(marker in text for marker in ('等等，这个我需要看一看', '等等，这个问题我需要看看', '商品未说明')):
            return f'{scope}主要提供问题答疑和排查；请发软件版本、报错截图和想实现的效果，我先帮你判断。'
        return text

    def generate_reply(self, message: str, item_info: dict, chat_id: str,
                      cookie_id: str, user_id: str, item_id: str,
                      skip_wait: bool = False, image_url: str = None,
                      dry_run: bool = False) -> Optional[str]:
        """
        生成AI回复 - 统一意图识别与回复生成
        AI会自动判断用户意图并生成合适的回复，避免关键词误判
        dry_run=True 时不写 ai_conversations（用于测试，避免污染真实会话）
        """
        if not self.is_ai_enabled(cookie_id):
            return None
        
        try:
            # 先保存用户消息到数据库（意图暂时设为None，后续可根据需要更新）
            # dry_run 测试不落库，避免污染真实会话
            message_created_at = None
            if not dry_run:
                message_created_at = self.save_conversation(
                    chat_id, cookie_id, user_id, item_id, "user", message, intent=None
                )
            
            # 消息去抖处理
            if not dry_run and not skip_wait:
                logger.info(f"【{cookie_id}】消息已保存，等待10秒收集后续消息: {message[:20]}...")
                time.sleep(10)
            elif dry_run:
                logger.info(f"【{cookie_id}】dry_run 测试模式（不写会话）: {message[:20]}...")
            else:
                logger.info(f"【{cookie_id}】消息已保存（外部防抖已启用）: {message[:20]}...")
            
            # 获取该chat_id的锁，确保同一对话的消息串行处理
            chat_lock = self._get_chat_lock(chat_id)
            
            with chat_lock:
                # 检查是否有更新的消息（dry_run 无历史，跳过）
                if not dry_run:
                    query_seconds = 6 if skip_wait else 25
                    recent_messages = self._get_recent_user_messages(chat_id, cookie_id, seconds=query_seconds)
                    
                    if recent_messages and len(recent_messages) > 0:
                        latest_message = recent_messages[-1]
                        if message_created_at != latest_message['created_at']:
                            logger.info(f"【{cookie_id}】检测到更新消息，跳过当前消息")
                            return None
                
                # 1. 获取AI设置
                settings = db_manager.get_ai_reply_settings(cookie_id)
                custom_prompts = json.loads(settings['custom_prompts']) if settings['custom_prompts'] else {}

                # 2. 获取对话历史
                context = self.get_conversation_context(chat_id, cookie_id)

                # 3. 获取对话轮数和议价设置（供AI参考）
                conversation_rounds = self.get_conversation_rounds(chat_id, cookie_id)
                max_bargain_rounds = settings.get('max_bargain_rounds', 3)
                max_discount_percent = settings.get('max_discount_percent', 10)
                max_discount_amount = settings.get('max_discount_amount', 100)
                # 可配置生成参数（温度/长度/历史条数），供后续步骤使用
                max_tokens = int(settings.get('max_tokens', 150) or 150)
                temperature = float(settings.get('temperature', 0.7) or 0.7)
                history_limit = int(settings.get('history_limit', 10) or 10)

                # 4. 构建统一的系统提示词（整合意图判断和回复生成）
                system_prompt = self._build_unified_system_prompt(custom_prompts, settings)

                # 5. 构建商品信息。数据库商品详情使用 item_* 字段，兼容旧调用方的简写字段。
                item_title = item_info.get('title') or item_info.get('item_title') or '未知'
                item_price = item_info.get('price') or item_info.get('item_price') or '未知'
                item_detail = item_info.get('desc') or item_info.get('item_detail') or '无'
                item_desc = f"商品标题: {item_title}\n"
                item_desc += f"商品价格: {item_price}元\n"
                item_desc += f"商品描述: {item_detail}"

                # 6. 构建对话历史字符串（按可配置历史条数 + token 上限截断）
                context_str = ""
                if context:
                    # 粗略 token 估算：中文/全角约 1 字 ≈ 1 token，英文按 4 字符 ≈ 1 token
                    max_ctx_tokens = max(400, int(max_tokens) * 4)
                    ctx_parts = []
                    ctx_tokens = 0
                    for msg in context[-history_limit:][::-1]:
                        role_label = '客户' if msg['role'] == 'user' else '客服'
                        line = f"{role_label}: {msg['content']}"
                        est = len(line) + sum(1 for ch in line if ord(ch) > 127)
                        if ctx_tokens + est > max_ctx_tokens:
                            break
                        ctx_parts.append(line)
                        ctx_tokens += est
                    context_str = "\n".join(ctx_parts[::-1])

                # 7. 构建用户消息（包含所有上下文）
                user_prompt = f"""## 商品信息
{item_desc}

## 对话历史
{context_str if context_str else '(新对话，暂无历史)'}

## 对话状态
- 当前对话轮数：第{conversation_rounds + 1}轮
- 议价限制：最多{max_bargain_rounds}轮议价后需坚持底价
- 最大可优惠：{max_discount_percent}%或{max_discount_amount}元

## 当前用户消息
{message}

请根据以上信息，直接回复用户："""

                # 8. 构建消息列表
                user_content = user_prompt
                # OpenAI-compatible vision models accept text and image parts in one user message.
                # Other providers keep the original text-only payload for compatibility.
                if image_url and self._resolve_api_type(settings) in ('openai', 'ollama', 'openai_responses', ''):
                    user_content = [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": image_url}}
                    ]

                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ]

                # 9. 根据API类型调用对应的AI接口（使用可配置的温度/长度）
                reply = None
                api_type = self._resolve_api_type(settings)
                logger.info(f"使用 {api_type} API生成回复 (temp={temperature}, max_tokens={max_tokens})")

                if api_type == 'dashscope':
                    # DashScope有两种模式：
                    # 1) /apps/{app_id} 应用模式 -> 走百炼应用API
                    # 2) compatible-mode/v1 兼容模式 -> 走OpenAI Chat Completions
                    if self._is_dashscope_app_api(settings):
                        reply = self._call_dashscope_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                    else:
                        logger.info("DashScope检测为兼容模式（非/apps/），改走OpenAI兼容Chat API")
                        reply = self._call_openai_chat_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                elif api_type == 'gemini':
                    reply = self._call_gemini_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                elif api_type == 'openai_responses':
                    reply = self._call_openai_responses_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                elif api_type == 'anthropic':
                    reply = self._call_anthropic_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                elif api_type == 'azure_openai':
                    reply = self._call_azure_openai_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                else:
                    # openai / ollama / 空值 均走 chat/completions
                    reply = self._call_openai_chat_api(settings, messages, max_tokens=max_tokens, temperature=temperature)

                reply = _repair_mojibake(reply)
                reply = self._normalize_customer_reply(reply, item_info)

                # 10. 保存AI回复到对话记录（dry_run 测试不落库）
                if not dry_run:
                    self.save_conversation(chat_id, cookie_id, user_id, item_id, "assistant", reply, intent=None)
                
                logger.info(f"AI回复生成成功 (账号: {cookie_id}): {reply}")
                return reply
                
        except Exception as e:
            logger.error(f"AI回复生成失败 {cookie_id}: {e}")
            if hasattr(e, 'response') and hasattr(e.response, 'url'):
                logger.error(f"请求URL: {e.response.url}")
            if hasattr(e, 'request') and hasattr(e.request, 'url'):
                logger.error(f"请求URL: {e.request.url}")
            return None

    async def generate_reply_async(self, message: str, item_info: dict, chat_id: str,
                                   cookie_id: str, user_id: str, item_id: str,
                                   skip_wait: bool = False, image_url: str = None) -> Optional[str]:
        """
        异步包装器：在独立线程池中执行同步的 `generate_reply`，并返回结果。
        这样可以在异步代码中直接 await，而不阻塞事件循环。
        """
        try:
            import asyncio as _asyncio
            return await _asyncio.to_thread(
                self.generate_reply, message, item_info, chat_id, cookie_id,
                user_id, item_id, skip_wait, image_url
            )
        except Exception as e:
            logger.error(f"异步生成回复失败: {e}")
            return None
    
    def get_conversation_context(self, chat_id: str, cookie_id: str, limit: int = 20) -> List[Dict]:
        """获取对话上下文"""
        try:
            with db_manager.lock:
                cursor = db_manager.conn.cursor()
                cursor.execute('''
                SELECT role, content FROM ai_conversations 
                WHERE chat_id = ? AND cookie_id = ? 
                ORDER BY created_at DESC LIMIT ?
                ''', (chat_id, cookie_id, limit))
                
                results = cursor.fetchall()
                context = [{"role": row[0], "content": row[1]} for row in reversed(results)]
                return context
        except Exception as e:
            logger.error(f"获取对话上下文失败: {e}")
            return []
    
    def save_conversation(self, chat_id: str, cookie_id: str, user_id: str, 
                         item_id: str, role: str, content: str, intent: str = None) -> Optional[str]:
        """保存对话记录，返回创建时间"""
        try:
            with db_manager.lock:
                cursor = db_manager.conn.cursor()
                cursor.execute('''
                INSERT INTO ai_conversations 
                (cookie_id, chat_id, user_id, item_id, role, content, intent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (cookie_id, chat_id, user_id, item_id, role, content, intent))
                db_manager.conn.commit()
                
                # 获取刚插入记录的created_at
                cursor.execute('''
                SELECT created_at FROM ai_conversations 
                WHERE rowid = last_insert_rowid()
                ''')
                result = cursor.fetchone()
                return result[0] if result else None
        except Exception as e:
            logger.error(f"保存对话记录失败: {e}")
            return None
    def get_conversation_rounds(self, chat_id: str, cookie_id: str) -> int:
        """获取对话轮数（用户消息数量）"""
        try:
            with db_manager.lock:
                cursor = db_manager.conn.cursor()
                cursor.execute('''
                SELECT COUNT(*) FROM ai_conversations 
                WHERE chat_id = ? AND cookie_id = ? AND role = 'user'
                ''', (chat_id, cookie_id))
                
                result = cursor.fetchone()
                return result[0] if result else 0
        except Exception as e:
            logger.error(f"获取对话轮数失败: {e}")
            return 0
    
    def _get_recent_user_messages(self, chat_id: str, cookie_id: str, seconds: int = 2) -> List[Dict]:
        """获取最近seconds秒内的所有用户消息（包含内容和时间戳）"""
        try:
            with db_manager.lock:
                cursor = db_manager.conn.cursor()
                # 先查询所有该chat的user消息，用于调试
                cursor.execute('''
                SELECT content, created_at, 
                       julianday('now') - julianday(created_at) as time_diff_days,
                       (julianday('now') - julianday(created_at)) * 86400.0 as time_diff_seconds
                FROM ai_conversations 
                WHERE chat_id = ? AND cookie_id = ? AND role = 'user' 
                ORDER BY created_at DESC LIMIT 10
                ''', (chat_id, cookie_id))
                
                all_messages = cursor.fetchall()
                logger.info(f"【调试】chat_id={chat_id} 最近10条user消息: {[(msg[0][:10], msg[1], f'{msg[3]:.2f}秒前') for msg in all_messages]}")
                
                # 正式查询
                cursor.execute('''
                SELECT content, created_at FROM ai_conversations 
                WHERE chat_id = ? AND cookie_id = ? AND role = 'user' 
                AND julianday('now') - julianday(created_at) < (? / 86400.0)
                ORDER BY created_at ASC
                ''', (chat_id, cookie_id, seconds))
                
                results = cursor.fetchall()
                return [{"content": row[0], "created_at": row[1]} for row in results]
        except Exception as e:
            logger.error(f"获取最近用户消息列表失败: {e}")
            return []
    


    def _chat_once(self, settings: dict, system_prompt: str, user_prompt: str,
                   max_tokens: int = 600, temperature: float = 0.6) -> Optional[str]:
        """一次性 AI 调用（不写会话、不去抖），供文案优化等独立任务复用"""
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
            api_type = self._resolve_api_type(settings)
            if api_type == 'dashscope':
                if self._is_dashscope_app_api(settings):
                    reply = self._call_dashscope_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
                else:
                    reply = self._call_openai_chat_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            elif api_type == 'gemini':
                reply = self._call_gemini_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            elif api_type == 'openai_responses':
                reply = self._call_openai_responses_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            elif api_type == 'anthropic':
                reply = self._call_anthropic_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            elif api_type == 'azure_openai':
                reply = self._call_azure_openai_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            else:
                reply = self._call_openai_chat_api(settings, messages, max_tokens=max_tokens, temperature=temperature)
            return _repair_mojibake(reply)
        except Exception as e:
            logger.error(f"AI 一次性调用失败: {e}")
            return None

    def optimize_item_copy(self, cookie_id: str, title: str, description: str, category: str = '',
                           mode: str = 'optimize', keywords: str = '') -> Optional[Dict]:
        """AI 处理商品文案。
        mode='optimize'：优化已有文案（去违禁词/绝对化表述）；
        mode='generate'：从零生成完整文案（按关键词/卖点）。
        仅做优化建议，不限制发布。返回 {'title','description','category'}；失败返回 None。"""
        settings = db_manager.get_ai_reply_settings(cookie_id)
        if not settings or not settings.get('api_key') or not settings.get('ai_enabled'):
            return None

        if mode == 'generate':
            system_prompt = (
                "你是一位资深的电商平台商品文案撰写专家。你的任务是：根据用户提供的关键词/卖点，"
                "从零创作一条完整、合规、有吸引力、可以直接发布的商品文案。\n"
                "要求：\n"
                "1. 不得使用违规/高风险词：如 破解、盗版、激活码、外挂、代充、刷单、加我微信、"
                "二维码、外链网址、绝对化用语（100%、绝对、保证、永久有效、稳赚）等。\n"
                "2. 标题简洁有吸引力（不超过 30 字），描述分段清晰、自然口语化、突出卖点与交付说明。\n"
                "3. 不虚构不夸大，如实描述。\n"
                "4. 根据卖点给出更规范的类目建议；信息不足时类目留空字符串。\n"
                "5. 结合商品类型给出合理的建议售价区间（数字，单位元）。\n"
                "只输出一个 JSON 对象，不要输出任何其他内容，格式：\n"
                '{"title": "生成的新标题", "description": "生成的新描述", "category": "建议类目", '
                '"price_min": 建议最低价数字, "price_max": 建议最高价数字}'
            )
            user_prompt = (
                f"## 关键词/卖点\n{keywords or title or '（未提供，请给出通用模板）'}\n\n"
                "请按系统要求输出生成的 JSON。"
            )
        else:
            system_prompt = (
                "你是一位资深的电商平台商品文案优化专家。你的任务是：把用户提供的商品文案优化成"
                "合规、自然、有吸引力且可以直接发布的版本。\n"
                "要求：\n"
                "1. 替换或删除违规/高风险词：如 破解、盗版、激活码、外挂、代充、刷单、加我微信、"
                "二维码、外链网址、绝对化用语（100%、绝对、保证、永久有效、稳赚）等。\n"
                "2. 保留商品核心信息、卖点和价格逻辑，不虚构不夸大。\n"
                "3. 标题保持简洁（不超过 30 字），描述分段清晰、自然口语化。\n"
                "4. 如果提供了类目，给出更规范的类目名；没有则保持原类目。\n"
                "只输出一个 JSON 对象，不要输出任何其他内容，格式：\n"
                '{"title": "优化后的标题", "description": "优化后的描述", "category": "优化后的类目"}'
            )
            user_prompt = (
                f"## 原商品标题\n{title or '（空）'}\n\n"
                f"## 原商品描述\n{description or '（空）'}\n\n"
                f"## 原类目\n{category or '（空）'}\n\n"
                "请按系统要求输出优化后的 JSON。"
            )

        reply = self._chat_once(settings, system_prompt, user_prompt, max_tokens=800, temperature=0.5)
        if not reply:
            return None
        try:
            start = reply.find('{')
            end = reply.rfind('}')
            if start == -1 or end == -1 or end <= start:
                return None
            data = json.loads(reply[start:end + 1])
            result = {
                'title': str(data.get('title') or '').strip() or title,
                'description': str(data.get('description') or '').strip() or description,
                'category': str(data.get('category') or '').strip() or category,
            }
            if mode == 'generate':
                price_min = data.get('price_min')
                price_max = data.get('price_max')
                try:
                    price_min_value = float(price_min) if price_min is not None and str(price_min).strip() != '' else None
                except (TypeError, ValueError):
                    price_min_value = None
                try:
                    price_max_value = float(price_max) if price_max is not None and str(price_max).strip() != '' else None
                except (TypeError, ValueError):
                    price_max_value = None
                if price_min_value is not None and price_min_value > 0:
                    result['price_min'] = price_min_value
                if price_max_value is not None and price_max_value > 0:
                    result['price_max'] = price_max_value
            return result
        except Exception as e:
            logger.error(f"解析 AI 文案处理结果失败: {e}")
            return None


# 全局AI回复引擎实例
ai_reply_engine = AIReplyEngine()
