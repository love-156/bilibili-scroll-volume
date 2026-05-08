// ==UserScript==
// @name         Bilibili 滚轮音量控制
// @namespace    https://github.com/love-156/bilibili-scroll-volume
// @version      1.2.0
// @description  按住自定义按键 + 鼠标滚轮调节B站视频音量，支持全页面触发和自定义设置
// @author       love_156
// @match        *://*.bilibili.com/video/*
// @match        *://bilibili.com/video/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /**
     * ============================================
     * Bilibili 滚轮音量控制插件 v1.1.0
     * ============================================
     * 功能：按住指定按键 + 鼠标滚轮调节视频音量
     * 默认快捷键：空格键 (Space)
     * 支持自定义按键设置
     * ============================================
     */

    // ============ 工具函数 ============
    /** 按键代码转显示名称 */
    function keyCodeToName(code) {
        const keyMap = {
            'Space': '空格',
            'ShiftLeft': '左Shift',
            'ShiftRight': '右Shift',
            'ControlLeft': '左Ctrl',
            'ControlRight': '右Ctrl',
            'AltLeft': '左Alt',
            'AltRight': '右Alt',
            'MetaLeft': '左Meta',
            'MetaRight': '右Meta',
            'Tab': 'Tab',
            'CapsLock': 'CapsLock',
            'Enter': '回车',
            'Backspace': '退格',
            'Escape': 'Esc',
        };
        if (keyMap[code]) return keyMap[code];
        // 字母和数字键
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Numpad')) return '小键盘' + code.slice(6);
        return code;
    }

    /** 获取当前存储的触发键，默认空格 */
    function getStoredTriggerKey() {
        return GM_getValue('triggerKey', 'Space');
    }

    /** 保存触发键 */
    function setStoredTriggerKey(key) {
        GM_setValue('triggerKey', key);
    }

    /** 获取是否需要鼠标在视频中（默认 true） */
    function getRequireHoverOnVideo() {
        return GM_getValue('requireHoverOnVideo', true);
    }

    /** 保存是否需要鼠标在视频中 */
    function setRequireHoverOnVideo(value) {
        GM_setValue('requireHoverOnVideo', value);
    }

    // ============ 全局状态 ============
    let isListeningForKey = false;
    let settingsPanel = null;
    let listeningOverlay = null;

    // ============ 配置区 ============
    const CONFIG = {
        /** 每次滚轮音量变化量 (0-1 范围) */
        volumeStep: 0.05,
        /** 是否启用音量提示UI */
        showVolumeIndicator: true,
        /** 音量提示显示时长(ms) */
        indicatorDuration: 1500,
        /** 是否启用超过100%音量增益 */
        enableVolumeBoost: true,
        /** 最大音量增益倍数 */
        maxVolumeBoost: 2.0,
        /** 是否需要鼠标在视频中才触发（默认true） */
        requireHoverOnVideo: true,
    };

    // ============ 核心类 ============
    class ScrollVolumeController {
        constructor() {
            this.video = null;
            this.isTriggerKeyPressed = false;
            this.volumeIndicator = null;
            this.audioContext = null;
            this.gainNode = null;
            this.lastVolume = 0;
            this.boostMultiplier = 1.0;
            this.rafId = null;
            this.triggerKey = getStoredTriggerKey();
            this.requireHoverOnVideo = getRequireHoverOnVideo();

            this.init();
        }

        /** 重新加载触发键 */
        reloadTriggerKey() {
            this.triggerKey = getStoredTriggerKey();
            console.log('[滚轮音量] 触发键已更新为:', this.triggerKey, keyCodeToName(this.triggerKey));
        }

        /** 重新加载配置 */
        reloadConfig() {
            this.triggerKey = getStoredTriggerKey();
            this.requireHoverOnVideo = getRequireHoverOnVideo();
        }

        /** 初始化 */
        init() {
            this.waitForVideoReady();
            this.setupKeyboardListeners();
            this.createVolumeIndicator();
        }

        /** 等待视频元素加载 */
        waitForVideoReady() {
            const findVideo = () => {
                const selectors = [
                    'video',
                    '.bilibili-player-video video',
                    '.bpx-player-video-area video',
                    '#bilibili-player video',
                    '.player-container video'
                ];
                for (const selector of selectors) {
                    const video = document.querySelector(selector);
                    if (video && video.duration > 0) return video;
                }
                return null;
            };

            const tryInit = () => {
                this.video = findVideo();
                if (this.video) {
                    this.setupVolumeBoost();
                    this.setupWheelListener();
                } else {
                    setTimeout(tryInit, 500);
                }
            };

            tryInit();
        }

        /** 设置音量增益 (Web Audio API) */
        setupVolumeBoost() {
            if (!CONFIG.enableVolumeBoost) return;
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.audioContext.createMediaElementSource(this.video);
                this.gainNode = this.audioContext.createGain();
                source.connect(this.gainNode);
                this.gainNode.connect(this.audioContext.destination);
                this.gainNode.gain.value = 1.0;
            } catch (e) {
                CONFIG.enableVolumeBoost = false;
            }
        }

        /** 设置键盘监听 */
        setupKeyboardListeners() {
            document.addEventListener('keydown', (e) => {
                // 如果正在监听按键设置
                if (isListeningForKey) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.code === 'Escape') {
                        // Esc 取消，不修改
                        exitKeyListening();
                        showToast('已取消修改');
                    } else {
                        // 设置新按键
                        const newKey = e.code;
                        setStoredTriggerKey(newKey);
                        this.reloadTriggerKey();
                        updateSettingsUI();
                        exitKeyListening();
                        showToast(`触发键已修改为: ${keyCodeToName(newKey)}`);
                    }
                    return;
                }

                // 正常音量调节逻辑
                if (e.code === this.triggerKey && !e.repeat) {
                    this.isTriggerKeyPressed = true;
                    document.body.classList.add('scroll-volume-active');
                    this.pauseOtherActions(e);
                }
            });

            document.addEventListener('keyup', (e) => {
                if (isListeningForKey) return;
                if (e.code === this.triggerKey) {
                    this.isTriggerKeyPressed = false;
                    document.body.classList.remove('scroll-volume-active');
                }
            });

            window.addEventListener('blur', () => {
                this.isTriggerKeyPressed = false;
                document.body.classList.remove('scroll-volume-active');
            });
        }

        /** 阻止触发键的默认行为 */
        pauseOtherActions(e) {
            if (e.code === 'Space') {
                e.preventDefault();
            }
        }

        /** 设置滚轮监听 */
        setupWheelListener() {
            this.video.addEventListener('wheel', (e) => {
                if (!this.isTriggerKeyPressed) return;
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -1 : 1;
                this.adjustVolume(delta);
            }, { passive: false });

            document.addEventListener('wheel', (e) => {
                if (!this.isTriggerKeyPressed) return;
                if (e.target.closest('video')) return;
                // 根据配置决定是否需要鼠标在视频上
                if (this.requireHoverOnVideo) {
                    if (this.video && this.video.matches(':hover')) {
                        const delta = e.deltaY > 0 ? -1 : 1;
                        this.adjustVolume(delta);
                    }
                } else {
                    // 不需要鼠标在视频上，任意位置都触发
                    const delta = e.deltaY > 0 ? -1 : 1;
                    this.adjustVolume(delta);
                }
            }, { passive: true });
        }

        /** 调节音量 */
        adjustVolume(direction) {
            if (!this.video) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);

            const currentVolume = this.video.volume;
            let newVolume = currentVolume + (direction * CONFIG.volumeStep);
            let displayVolume = newVolume;

            if (newVolume <= 1) {
                newVolume = Math.max(0, Math.min(1, newVolume));
                this.video.volume = newVolume;
                if (CONFIG.enableVolumeBoost && this.gainNode) {
                    this.boostMultiplier = 1.0;
                    this.gainNode.gain.value = 1.0;
                }
                displayVolume = newVolume;
            } else if (CONFIG.enableVolumeBoost && this.gainNode) {
                this.video.volume = 1.0;
                const newBoost = this.boostMultiplier + (direction * 0.1);
                this.boostMultiplier = Math.max(1.0, Math.min(CONFIG.maxVolumeBoost, newBoost));
                this.gainNode.gain.value = this.boostMultiplier;
                displayVolume = this.boostMultiplier;
            }

            this.lastVolume = displayVolume;
            this.updateVolumeIndicator(displayVolume);
            this.triggerVolumeChange();
        }

        triggerVolumeChange() {
            this.rafId = requestAnimationFrame(() => {
                const event = new Event('volumechange', { bubbles: true });
                this.video.dispatchEvent(event);
            });
        }

        /** 创建音量提示UI */
        createVolumeIndicator() {
            if (!CONFIG.showVolumeIndicator) return;

            const style = document.createElement('style');
            style.textContent = `
                #scroll-volume-indicator {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px 24px;
                    background: rgba(0, 0, 0, 0.85);
                    border-radius: 12px;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 14px;
                    z-index: 999999;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                }
                #scroll-volume-indicator.show { opacity: 1; }
                .scroll-volume-icon { display: flex; color: #00d9ff; }
                .scroll-volume-bar-container { position: relative; width: 120px; height: 6px; }
                .scroll-volume-bar {
                    position: absolute; top: 0; left: 0; height: 100%;
                    background: linear-gradient(90deg, #00d9ff, #00ff88);
                    border-radius: 3px; transition: width 0.1s ease; z-index: 1;
                }
                .scroll-volume-bar-bg {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(255, 255, 255, 0.2); border-radius: 3px;
                }
                .scroll-volume-value {
                    min-width: 50px; text-align: right; font-weight: 600;
                    font-variant-numeric: tabular-nums;
                }
                .scroll-volume-value.boosted { color: #ff6b6b; }
                body.scroll-volume-active { cursor: crosshair !important; }

                /* 设置面板样式 */
                .bilibili-scroll-volume-settings {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 320px;
                    background: #fff;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                    z-index: 999998;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    overflow: hidden;
                    display: none;
                }
                .bilibili-scroll-volume-settings.show { display: block; }
                .sv-settings-header {
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #00d9ff, #00ff88);
                    color: #fff;
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .sv-settings-close {
                    background: none;
                    border: none;
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                }
                .sv-settings-body { padding: 20px; }
                .sv-setting-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 0;
                    border-bottom: 1px solid #eee;
                }
                .sv-setting-item:last-child { border-bottom: none; }
                .sv-setting-label { color: #333; font-size: 14px; }
                .sv-setting-btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .sv-key-btn {
                    background: #f0f0f0;
                    color: #333;
                    min-width: 80px;
                }
                .sv-key-btn:hover { background: #e0e0e0; }
                .sv-key-btn.listening {
                    background: #ff6b6b;
                    color: #fff;
                    animation: pulse 1s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                .sv-setting-desc {
                    font-size: 12px;
                    color: #999;
                    margin-top: 4px;
                }

                /* 按键监听提示 */
                .bilibili-key-listening-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.7);
                    display: none;
                    justify-content: center;
                    align-items: center;
                    z-index: 999999;
                }
                .bilibili-key-listening-overlay.show { display: flex; }
                .bilibili-key-listening-box {
                    background: #fff;
                    border-radius: 16px;
                    padding: 40px 60px;
                    text-align: center;
                }
                .bilibili-key-listening-title {
                    font-size: 20px;
                    color: #333;
                    margin-bottom: 12px;
                }
                .bilibili-key-listening-hint {
                    font-size: 14px;
                    color: #999;
                }
                .bilibili-key-listening-key {
                    font-size: 32px;
                    color: #00d9ff;
                    font-weight: bold;
                    margin: 16px 0;
                }

                /* Toast 提示 */
                .bilibili-scroll-volume-toast {
                    position: fixed;
                    bottom: 100px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0,0,0,0.8);
                    color: #fff;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    z-index: 999999;
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .bilibili-scroll-volume-toast.show { opacity: 1; }

                /* 开关样式 */
                .sv-toggle-switch {
                    position: relative;
                    width: 44px;
                    height: 24px;
                }
                .sv-toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .sv-toggle-slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: #ccc;
                    transition: 0.3s;
                    border-radius: 24px;
                }
                .sv-toggle-slider:before {
                    position: absolute;
                    content: "";
                    height: 18px;
                    width: 18px;
                    left: 3px;
                    bottom: 3px;
                    background-color: white;
                    transition: 0.3s;
                    border-radius: 50%;
                }
                .sv-toggle-switch input:checked + .sv-toggle-slider {
                    background-color: #00d9ff;
                }
                .sv-toggle-switch input:checked + .sv-toggle-slider:before {
                    transform: translateX(20px);
                }
            `;
            document.head.appendChild(style);

            // 音量指示器
            const indicator = document.createElement('div');
            indicator.id = 'scroll-volume-indicator';
            indicator.innerHTML = `
                <div class="scroll-volume-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                    </svg>
                </div>
                <div class="scroll-volume-bar-container">
                    <div class="scroll-volume-bar"></div>
                    <div class="scroll-volume-bar-bg"></div>
                </div>
                <div class="scroll-volume-value">100%</div>
            `;
            document.body.appendChild(indicator);

            // 设置面板
            settingsPanel = document.createElement('div');
            settingsPanel.className = 'bilibili-scroll-volume-settings';
            settingsPanel.innerHTML = `
                <div class="sv-settings-header">
                    <span>滚轮音量设置</span>
                    <button class="sv-settings-close">&times;</button>
                </div>
                <div class="sv-settings-body">
                    <div class="sv-setting-item">
                        <div>
                            <div class="sv-setting-label">触发按键</div>
                            <div class="sv-setting-desc">按住此键 + 滚轮调节音量</div>
                        </div>
                        <button class="sv-setting-btn sv-key-btn" id="sv-trigger-key-btn">空格</button>
                    </div>
                    <div class="sv-setting-item">
                        <div>
                            <div class="sv-setting-label">必须鼠标在视频上</div>
                            <div class="sv-setting-desc">关闭后，页面任意位置均可触发</div>
                        </div>
                        <label class="sv-toggle-switch">
                            <input type="checkbox" id="sv-require-hover-toggle" checked>
                            <span class="sv-toggle-slider"></span>
                        </label>
                    </div>
                </div>
            `;
            document.body.appendChild(settingsPanel);

            // 按键监听遮罩
            listeningOverlay = document.createElement('div');
            listeningOverlay.className = 'bilibili-key-listening-overlay';
            listeningOverlay.innerHTML = `
                <div class="bilibili-key-listening-box">
                    <div class="bilibili-key-listening-title">请按下新的触发按键</div>
                    <div class="bilibili-key-listening-key">...</div>
                    <div class="bilibili-key-listening-hint">按 Esc 取消</div>
                </div>
            `;
            document.body.appendChild(listeningOverlay);

            // Toast
            const toast = document.createElement('div');
            toast.className = 'bilibili-scroll-volume-toast';
            toast.id = 'sv-toast';
            document.body.appendChild(toast);

            this.volumeIndicator = indicator;

            // 绑定设置面板事件
            this.bindSettingsEvents();
        }

        /** 绑定设置面板事件 */
        bindSettingsEvents() {
            const closeBtn = settingsPanel.querySelector('.sv-settings-close');
            closeBtn.addEventListener('click', () => {
                settingsPanel.classList.remove('show');
            });

            const keyBtn = document.getElementById('sv-trigger-key-btn');
            keyBtn.addEventListener('click', () => {
                enterKeyListening();
            });

            // 绑定开关事件
            const hoverToggle = document.getElementById('sv-require-hover-toggle');
            hoverToggle.addEventListener('change', (e) => {
                const requireHover = e.target.checked;
                setRequireHoverOnVideo(requireHover);
                this.requireHoverOnVideo = requireHover;
                showToast(requireHover ? '已开启：需鼠标在视频上' : '已关闭：页面任意位置均可触发');
            });
        }

        updateVolumeIndicator(volume) {
            if (!this.volumeIndicator || !CONFIG.showVolumeIndicator) return;

            const percentage = Math.round(volume * 100);
            const bar = this.volumeIndicator.querySelector('.scroll-volume-bar');
            const value = this.volumeIndicator.querySelector('.scroll-volume-value');

            bar.style.width = `${Math.min(100, percentage)}%`;
            value.textContent = `${percentage}%`;

            if (percentage > 100) {
                value.classList.add('boosted');
                bar.style.background = 'linear-gradient(90deg, #ff6b6b, #ff4757)';
            } else {
                value.classList.remove('boosted');
                bar.style.background = 'linear-gradient(90deg, #00d9ff, #00ff88)';
            }

            this.volumeIndicator.classList.add('show');
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.volumeIndicator.classList.remove('show');
            }, CONFIG.indicatorDuration);
        }
    }

    // ============ 全局函数 ============

    /** 进入按键监听模式 */
    function enterKeyListening() {
        isListeningForKey = true;
        listeningOverlay.classList.add('show');
        document.getElementById('sv-trigger-key-btn').classList.add('listening');
        document.getElementById('sv-trigger-key-btn').textContent = '监听中...';
    }

    /** 退出按键监听模式 */
    function exitKeyListening() {
        isListeningForKey = false;
        listeningOverlay.classList.remove('show');
        const btn = document.getElementById('sv-trigger-key-btn');
        if (btn) {
            btn.classList.remove('listening');
        }
    }

    /** 更新设置UI */
    function updateSettingsUI() {
        const key = getStoredTriggerKey();
        const requireHover = getRequireHoverOnVideo();
        const btn = document.getElementById('sv-trigger-key-btn');
        const toggle = document.getElementById('sv-require-hover-toggle');
        if (btn) {
            btn.textContent = keyCodeToName(key);
        }
        if (toggle) {
            toggle.checked = requireHover;
        }
    }

    /** 显示Toast提示 */
    function showToast(message) {
        const toast = document.getElementById('sv-toast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }
    }

    /** 打开设置面板 */
    function openSettingsPanel() {
        updateSettingsUI();
        settingsPanel.classList.add('show');
    }

    // ============ 启动 ============
    let controller = null;

    function init() {
        controller = new ScrollVolumeController();

        // 注册油猴菜单
        GM_registerMenuCommand('🎵 滚轮音量设置', openSettingsPanel);

        // 监听设置面板内的按键监听退出
        listeningOverlay.addEventListener('click', (e) => {
            if (e.target === listeningOverlay) {
                exitKeyListening();
                showToast('已取消修改');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露全局方法供外部调用
    window.BilibiliScrollVolume = {
        openSettings: openSettingsPanel,
        reloadKey: () => controller && controller.reloadTriggerKey(),
        reloadConfig: () => controller && controller.reloadConfig()
    };

})();
