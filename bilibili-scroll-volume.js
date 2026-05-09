// ==UserScript==
// @name         Bilibili 滚轮音量控制
// @namespace    https://github.com/love-156/bilibili-scroll-volume
// @version      1.7.2
// @description  按住V键 + 鼠标滚轮调节B站视频音量，支持手动输入音量调节值，支持全屏模式三挡开关，支持指定区域触发
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
     * 功能：按住指定按键 + 鼠标滚轮调节视频音量
     * 默认快捷键：V键 (KeyV)
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

    /** 获取当前存储的触发键，默认V键 */
    function getStoredTriggerKey() {
        return GM_getValue('triggerKey', 'KeyV');
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

    /** 获取全屏模式（1=禁用，2=启用，3=直接触发，默认3） */
    function getFullscreenMode() {
        return GM_getValue('fullscreenMode', 3);
    }

    /** 保存全屏模式 */
    function setFullscreenMode(value) {
        GM_setValue('fullscreenMode', value);
    }

    /** 获取音量步进值（百分比 1-100，默认 5） */
    function getVolumeStepPercent() {
        return GM_getValue('volumeStepPercent', 5);
    }

    /** 保存音量步进值 */
    function setVolumeStepPercent(value) {
        GM_setValue('volumeStepPercent', value);
    }

    /** 获取是否启用区域触发（默认 false） */
    function getTriggerZoneEnabled() {
        return GM_getValue('triggerZoneEnabled', false);
    }

    /** 保存区域触发开关 */
    function setTriggerZoneEnabled(value) {
        GM_setValue('triggerZoneEnabled', value);
    }

    /** 获取区域矩形（百分比形式：{x, y, width, height}） */
    function getTriggerZoneRect() {
        return GM_getValue('triggerZoneRect', null);
    }

    /** 保存区域矩形（百分比形式） */
    function setTriggerZoneRect(rect) {
        GM_setValue('triggerZoneRect', rect);
    }

    /** 获取显示区域开关 */
    function getShowTriggerZone() {
        return GM_getValue('showTriggerZone', true);
    }

    /** 保存显示区域开关 */
    function setShowTriggerZone(value) {
        GM_setValue('showTriggerZone', value);
    }

    // ============ 全局状态 ============
    let isListeningForKey = false;
    let settingsPanel = null;
    let listeningOverlay = null;

    // ============ 配置区 ============
    const CONFIG = {
        /** 每次滚轮音量变化量 (0-1 范围，会根据百分比计算) */
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
            this.volumeIndicatorFull = null;
            this.audioContext = null;
            this.gainNode = null;
            this.lastVolume = 0;
            this.boostMultiplier = 1.0;
            this.rafId = null;
            this.triggerKey = getStoredTriggerKey();
            this.requireHoverOnVideo = getRequireHoverOnVideo();
            this.volumeStepPercent = getVolumeStepPercent();
            this.fullscreenMode = getFullscreenMode();
            this.indicatorTimeout = null;
            this.triggerZoneEnabled = getTriggerZoneEnabled();
            this.showTriggerZone = getShowTriggerZone();
            this.triggerZoneRect = getTriggerZoneRect();
            this.triggerZoneElement = null;
            this.isInTriggerZone = false;
            this.isEditingZone = false;
            this.zoneWheelBlockHandler = null;

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
            this.volumeStepPercent = getVolumeStepPercent();
            this.fullscreenMode = getFullscreenMode();
            this.triggerZoneEnabled = getTriggerZoneEnabled();
            this.showTriggerZone = getShowTriggerZone();
            this.triggerZoneRect = getTriggerZoneRect();
            this.updateTriggerZoneElement();
        }

        /** 创建区域触发元素 */
        createTriggerZoneElement() {
            const zone = document.createElement('div');
            zone.id = 'sv-trigger-zone';
            zone.className = 'sv-trigger-zone';
            document.body.appendChild(zone);
            this.triggerZoneElement = zone;
            this.updateTriggerZoneElement();
        }

        /** 更新触发区域位置 */
        updateTriggerZoneElement() {
            if (!this.triggerZoneElement) return;
            
            if (this.triggerZoneEnabled && this.triggerZoneRect) {
                const rect = this.triggerZoneRect;
                const zone = this.triggerZoneElement;
                
                zone.style.left = rect.x + '%';
                zone.style.top = rect.y + '%';
                zone.style.width = rect.width + '%';
                zone.style.height = rect.height + '%';
                zone.style.display = 'block';
                // 控制透明度
                zone.style.opacity = this.showTriggerZone ? '' : '0';
            } else {
                this.triggerZoneElement.style.display = 'none';
                this.triggerZoneElement.style.pointerEvents = 'none';
            }
        }

        /** 检测鼠标是否在触发区域内 */
        checkTriggerZone(e) {
            if (!this.triggerZoneEnabled || !this.triggerZoneRect) {
                return false;
            }
            
            const x = (e.clientX / window.innerWidth) * 100;
            const y = (e.clientY / window.innerHeight) * 100;
            const rect = this.triggerZoneRect;
            
            return x >= rect.x && x <= rect.x + rect.width &&
                   y >= rect.y && y <= rect.y + rect.height;
        }

        /** 开始编辑触发区域 */
        startZoneEditing() {
            this.isEditingZone = true;
            
            // 隐藏设置面板
            settingsPanel.classList.remove('show');
            
            // 获取或创建编辑遮罩
            let overlay = document.getElementById('sv-zone-editor-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'sv-zone-editor-overlay';
                overlay.className = 'sv-zone-editor-overlay';
                document.body.appendChild(overlay);
            }
            
            // 获取或创建编辑框
            let box = document.getElementById('sv-zone-editor-box');
            if (!box) {
                box = document.createElement('div');
                box.id = 'sv-zone-editor-box';
                box.className = 'sv-zone-editor-box';
                overlay.appendChild(box);
                
                // 添加四个角拖拽手柄
                ['nw', 'ne', 'sw', 'se'].forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = 'sv-zone-editor-handle ' + pos;
                    box.appendChild(handle);
                });
                
                // 添加四条边拖拽手柄
                ['n', 's', 'e', 'w'].forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = 'sv-zone-editor-handle edge ' + pos;
                    box.appendChild(handle);
                });
                
                // 添加底部按钮栏
                const buttonBar = document.createElement('div');
                buttonBar.className = 'sv-zone-editor-buttons';
                buttonBar.innerHTML = `
                    <button class="sv-zone-btn sv-zone-btn-cancel">取消</button>
                    <button class="sv-zone-btn sv-zone-btn-save">保存</button>
                `;
                overlay.appendChild(buttonBar);
            }
            
            // 设置初始区域
            const rect = this.triggerZoneRect || { x: 10, y: 10, width: 80, height: 80 };
            box.style.left = rect.x + '%';
            box.style.top = rect.y + '%';
            box.style.width = rect.width + '%';
            box.style.height = rect.height + '%';
            
            overlay.classList.add('show');
            
            // 编辑模式下隐藏原有的触发区域元素
            if (this.triggerZoneElement) {
                this.triggerZoneElement.style.display = 'none';
            }
            
            // 设置拖拽状态
            this.zoneEditorState = {
                isDragging: false,
                isResizing: false,
                resizeCorner: null,
                startX: 0,
                startY: 0,
                startRect: { ...rect }
            };
            
            this.setupZoneEditorEvents(box, overlay);
        }

        /** 设置区域编辑事件 */
        setupZoneEditorEvents(box, overlay) {
            const handleMouseMove = (e) => {
                const state = this.zoneEditorState;
                
                // 最小尺寸：100px x 100px
                const minWidthPx = 100;
                const minHeightPx = 100;
                
                if (state.isResizing) {
                    const rect = state.startRect;
                    const corner = state.resizeCorner;
                    
                    // 转换为像素
                    const boxWidthPx = (rect.width / 100) * window.innerWidth;
                    const boxHeightPx = (rect.height / 100) * window.innerHeight;
                    
                    // 上边拖动（只增大，不减小）
                    if (corner === 'n') {
                        const dy =  e.clientY - state.startY; // 向上拖dy>0，向上缩小
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx - dy);
                        const heightChangePx = boxHeightPx - newHeightPx;
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                        box.style.top = (rect.y + heightChangePx / window.innerHeight * 100) + '%';
                    }
                    // 下边拖动
                    else if (corner === 's') {
                        const dy = e.clientY - state.startY; // 向下拖dy>0
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx + dy);
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                    }
                    // 左边拖动
                    else if (corner === 'w') {
                        const dx = e.clientX - state.startX; // 向左拖dx>0
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx - dx);
                        const widthChangePx = boxWidthPx - newWidthPx;
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                        box.style.left = (rect.x + widthChangePx / window.innerWidth * 100) + '%';
                    }
                    // 右边拖动
                    else if (corner === 'e') {
                        const dx = e.clientX - state.startX; // 向右拖dx>0
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx + dx);
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                    }
                    // 四角拖动（nw, ne, sw, se）
                    else if (corner === 'nw') {
                        const dy = e.clientY - state.startY;
                        const dx = e.clientX - state.startX;
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx - dy);
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx - dx);
                        const heightChangePx = boxHeightPx - newHeightPx;
                        const widthChangePx = boxWidthPx - newWidthPx;
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                        box.style.top = (rect.y + heightChangePx / window.innerHeight * 100) + '%';
                        box.style.left = (rect.x + widthChangePx / window.innerWidth * 100) + '%';
                    }
                    else if (corner === 'ne') {
                        const dy = e.clientY - state.startY;
                        const dx = e.clientX - state.startX;
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx - dy);
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx + dx);
                        const heightChangePx = boxHeightPx - newHeightPx;
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                        box.style.top = (rect.y + heightChangePx / window.innerHeight * 100) + '%';
                    }
                    else if (corner === 'sw') {
                        const dy = e.clientY - state.startY;
                        const dx = e.clientX - state.startX;
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx + dy);
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx - dx);
                        const widthChangePx = boxWidthPx - newWidthPx;
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                        box.style.left = (rect.x + widthChangePx / window.innerWidth * 100) + '%';
                    }
                    else if (corner === 'se') {
                        const dy = e.clientY - state.startY;
                        const dx = e.clientX - state.startX;
                        const newHeightPx = Math.max(minHeightPx, boxHeightPx + dy);
                        const newWidthPx = Math.max(minWidthPx, boxWidthPx + dx);
                        box.style.height = (newHeightPx / window.innerHeight * 100) + '%';
                        box.style.width = (newWidthPx / window.innerWidth * 100) + '%';
                    }
                } else if (state.isDragging) {
                    const rect = state.startRect;
                    const dx = ((e.clientX - state.startX) / window.innerWidth) * 100;
                    const dy = ((e.clientY - state.startY) / window.innerHeight) * 100;
                    box.style.left = Math.max(0, Math.min(100 - rect.width, rect.x + dx)) + '%';
                    box.style.top = Math.max(0, Math.min(100 - rect.height, rect.y + dy)) + '%';
                }
            };
            
            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                // 更新startRect为当前位置，下次拖动以当前位置为起点
                if (this.zoneEditorState) {
                    this.zoneEditorState.startRect = {
                        x: parseFloat(box.style.left),
                        y: parseFloat(box.style.top),
                        width: parseFloat(box.style.width),
                        height: parseFloat(box.style.height)
                    };
                }
            };
            
            // 绑定取消按钮
            const cancelBtn = overlay.querySelector('.sv-zone-btn-cancel');
            cancelBtn.addEventListener('click', () => {
                this.finishZoneEditing(false);
                showToast('已取消编辑');
            });
            
            // 绑定保存按钮
            const saveBtn = overlay.querySelector('.sv-zone-btn-save');
            saveBtn.addEventListener('click', () => {
                this.finishZoneEditing(true);
            });
            
            // 处理框拖拽
            box.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('sv-zone-editor-handle')) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                // 更新状态
                this.zoneEditorState.isDragging = true;
                this.zoneEditorState.isResizing = false;
                this.zoneEditorState.resizeCorner = null;
                this.zoneEditorState.startX = e.clientX;
                this.zoneEditorState.startY = e.clientY;
                // 使用当前框体位置作为起点
                this.zoneEditorState.startRect = {
                    x: parseFloat(box.style.left),
                    y: parseFloat(box.style.top),
                    width: parseFloat(box.style.width),
                    height: parseFloat(box.style.height)
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp, { once: true });
            });
            
            // 处理角和边拖拽
            box.querySelectorAll('.sv-zone-editor-handle').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // 获取是哪个角或哪条边
                    const classes = handle.classList;
                    const isCorner = ['nw', 'ne', 'sw', 'se'].some(c => classes.contains(c));
                    
                    let resizeCorner = null;
                    if (isCorner) {
                        resizeCorner = ['nw', 'ne', 'sw', 'se'].find(c => classes.contains(c));
                    } else if (classes.contains('n')) {
                        resizeCorner = 'n';
                    } else if (classes.contains('s')) {
                        resizeCorner = 's';
                    } else if (classes.contains('e')) {
                        resizeCorner = 'e';
                    } else if (classes.contains('w')) {
                        resizeCorner = 'w';
                    }
                    
                    // 更新状态
                    this.zoneEditorState.isDragging = false;
                    this.zoneEditorState.isResizing = true;
                    this.zoneEditorState.resizeCorner = resizeCorner;
                    this.zoneEditorState.startX = e.clientX;
                    this.zoneEditorState.startY = e.clientY;
                    // 使用当前框体位置作为起点
                    this.zoneEditorState.startRect = {
                        x: parseFloat(box.style.left),
                        y: parseFloat(box.style.top),
                        width: parseFloat(box.style.width),
                        height: parseFloat(box.style.height)
                    };
                    
                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp, { once: true });
                });
            });
            
        }

        /** 完成区域编辑 */
        finishZoneEditing(save) {
            this.isEditingZone = false;
            const overlay = document.getElementById('sv-zone-editor-overlay');
            const box = document.getElementById('sv-zone-editor-box');
            
            if (overlay) {
                overlay.classList.remove('show');
            }
            
            // 恢复原有触发区域的显示
            if (this.triggerZoneElement) {
                this.updateTriggerZoneElement();
            }
            
            if (save && box) {
                // 保存区域
                const newRect = {
                    x: parseFloat(box.style.left),
                    y: parseFloat(box.style.top),
                    width: parseFloat(box.style.width),
                    height: parseFloat(box.style.height)
                };
                setTriggerZoneRect(newRect);
                this.triggerZoneRect = newRect;
                this.updateTriggerZoneElement();
                showToast('触发区域已保存');
            }
            
            this.zoneEditorState = null;
        }

        /** 检测是否处于视频全屏或网页全屏状态 */
        checkFullscreenState() {
            // 通过 bpx-player-container 的 data-screen 属性判断
            const playerContainer = document.querySelector('.bpx-player-container');
            if (playerContainer) {
                const screen = playerContainer.getAttribute('data-screen');
                // data-screen="web" 表示网页全屏
                // data-screen="full" 表示视频全屏
                if (screen === 'web' || screen === 'full') {
                    return true;
                }
            }
            return false;
        }

        /** 尝试将全屏指示器添加到播放器容器 */
        tryAppendIndicatorToPlayer() {
            const playerContainer = document.querySelector('.bpx-player-container');
            if (playerContainer && this.volumeIndicatorFull) {
                // 检查是否已经添加过
                if (!playerContainer.contains(this.volumeIndicatorFull)) {
                    playerContainer.appendChild(this.volumeIndicatorFull);
                }
            } else {
                // 播放器还没加载，稍后重试
                setTimeout(() => this.tryAppendIndicatorToPlayer(), 500);
            }
        }

        /** 获取当前音量步进值（0-1范围） */
        getVolumeStep() {
            return this.volumeStepPercent / 100;
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
                    this.createTriggerZoneElement();
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

        /** 检测鼠标是否在触发区域内 */
        checkTriggerZone(e) {
            if (!this.triggerZoneEnabled || !this.triggerZoneRect) {
                return false;
            }
            
            const x = (e.clientX / window.innerWidth) * 100;
            const y = (e.clientY / window.innerHeight) * 100;
            const rect = this.triggerZoneRect;
            
            return x >= rect.x && x <= rect.x + rect.width &&
                   y >= rect.y && y <= rect.y + rect.height;
        }

        /** 设置滚轮监听 */
        setupWheelListener() {
            // 设置鼠标移动监听以检测是否在触发区域内
            document.addEventListener('mousemove', (e) => {
                const wasInZone = this.isInTriggerZone;
                this.isInTriggerZone = this.checkTriggerZone(e);
                
                if (this.triggerZoneElement) {
                    if (this.isInTriggerZone) {
                        this.triggerZoneElement.classList.add('highlight');
                    } else {
                        this.triggerZoneElement.classList.remove('highlight');
                    }
                }
                
                // 更新视觉反馈
                if (wasInZone !== this.isInTriggerZone) {
                    if (this.isInTriggerZone) {
                        document.body.classList.add('scroll-volume-active');
                    } else if (!this.isTriggerKeyPressed) {
                        document.body.classList.remove('scroll-volume-active');
                    }
                }
            });
            
            this.video.addEventListener('wheel', (e) => {
                const inFullscreen = this.checkFullscreenState();
                const inZone = this.isInTriggerZone;

                // 非全屏状态
                if (!inFullscreen) {
                    // 区域触发或按键触发即可
                    if (!inZone && !this.isTriggerKeyPressed) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY > 0 ? -1 : 1;
                    this.adjustVolume(delta);
                    return;
                }

                // 全屏状态：根据模式决定
                // 模式1：禁用
                if (this.fullscreenMode === 1) return;

                // 模式3：直接触发（无需按键），但区域触发也有效
                if (this.fullscreenMode === 3 || inZone) {
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY > 0 ? -1 : 1;
                    this.adjustVolume(delta);
                    return;
                }

                // 模式2：需要按键触发
                if (!this.isTriggerKeyPressed) return;
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -1 : 1;
                this.adjustVolume(delta);
            }, { passive: false });

            document.addEventListener('wheel', (e) => {
                const inFullscreen = this.checkFullscreenState();
                const inZone = this.isInTriggerZone;

                // 非全屏状态
                if (!inFullscreen) {
                    // 区域触发或按键触发即可
                    if (!inZone && !this.isTriggerKeyPressed) return;
                    if (e.target.closest('video')) return;
                    
                    // 阻止页面滚动
                    e.preventDefault();
                    
                    if (this.requireHoverOnVideo) {
                        if (this.video && this.video.matches(':hover')) {
                            const delta = e.deltaY > 0 ? -1 : 1;
                            this.adjustVolume(delta);
                        }
                    } else {
                        const delta = e.deltaY > 0 ? -1 : 1;
                        this.adjustVolume(delta);
                    }
                    return;
                }

                // 全屏状态：根据模式决定
                // 模式1：禁用
                if (this.fullscreenMode === 1) return;

                // 模式3：直接触发（无需按键），但区域触发也有效
                if (this.fullscreenMode === 3 || inZone) {
                    // 阻止页面滚动
                    e.preventDefault();
                    
                    if (this.video && this.video.matches(':hover')) {
                        const delta = e.deltaY > 0 ? -1 : 1;
                        this.adjustVolume(delta);
                    }
                    return;
                }

                // 模式2：需要按键触发
                if (!this.isTriggerKeyPressed) return;
                if (e.target.closest('video')) return;
                
                // 阻止页面滚动
                e.preventDefault();
                
                if (this.requireHoverOnVideo) {
                    if (this.video && this.video.matches(':hover')) {
                        const delta = e.deltaY > 0 ? -1 : 1;
                        this.adjustVolume(delta);
                    }
                } else {
                    const delta = e.deltaY > 0 ? -1 : 1;
                    this.adjustVolume(delta);
                }
            }, { passive: false });
        }

        /** 调节音量 */
        adjustVolume(direction) {
            if (!this.video) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);

            const step = this.getVolumeStep();
            // 使用当前的 displayVolume 作为基准（包含增益）
            // 如果 lastVolume 无效（0），使用 video.volume
            const currentDisplayVolume = (this.lastVolume > 0) ? this.lastVolume : this.video.volume;
            let newDisplayVolume = currentDisplayVolume + (direction * step);
            let displayVolume = newDisplayVolume;

            if (newDisplayVolume <= 1) {
                // 回到普通音量范围，确保不小于0
                const finalVolume = Math.max(0, newDisplayVolume);
                this.video.volume = finalVolume;
                if (CONFIG.enableVolumeBoost && this.gainNode) {
                    this.boostMultiplier = 1.0;
                    this.gainNode.gain.value = 1.0;
                }
                displayVolume = finalVolume;
            } else if (CONFIG.enableVolumeBoost && this.gainNode) {
                // 超过100%，使用增益
                this.video.volume = 1.0;
                const newBoost = this.boostMultiplier + (direction * step);
                
                if (newBoost < 1.0) {
                    // 增益已到最小值，继续减小则进入普通音量模式（不能小于0）
                    displayVolume = Math.max(0, newBoost);
                    this.video.volume = displayVolume;
                    this.boostMultiplier = 1.0;
                    this.gainNode.gain.value = 1.0;
                } else {
                    this.boostMultiplier = Math.max(1.0, Math.min(CONFIG.maxVolumeBoost, newBoost));
                    this.gainNode.gain.value = this.boostMultiplier;
                    displayVolume = this.boostMultiplier;
                }
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
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    display: flex !important;
                    align-items: center;
                    gap: 12px;
                    padding: 16px 24px;
                    background: rgba(0, 0, 0, 0.85) !important;
                    border-radius: 12px;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 14px;
                    z-index: 2147483647 !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transition: opacity 0.2s ease;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    /* 隔离 stacking context，确保全屏模式下 z-index 生效 */
                    isolation: isolate !important;
                }
                #scroll-volume-indicator.show {
                    opacity: 1 !important;
                }
                /* 全屏音量指示器（放在播放器容器内） */
                #scroll-volume-indicator-full {
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    display: flex !important;
                    align-items: center;
                    gap: 12px;
                    padding: 16px 24px;
                    background: rgba(0, 0, 0, 0.85) !important;
                    border-radius: 12px;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 14px;
                    z-index: 2147483647 !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transition: opacity 0.2s ease;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                }
                #scroll-volume-indicator-full.show {
                    opacity: 1 !important;
                }
                .scroll-volume-icon { display: flex !important; color: #00d9ff; }
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
                    z-index: 2147483646 !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    overflow: hidden;
                    display: none;
                    flex-direction: column;
                    max-height: calc(100vh - 100px);
                }
                .bilibili-scroll-volume-settings.show { display: flex; }
                .sv-settings-header {
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #00d9ff, #00ff88);
                    color: #fff;
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    user-select: none;
                    flex-shrink: 0;
                }
                .sv-settings-close {
                    background: none;
                    border: none;
                    color: #fff;
                    font-size: 22px;
                    cursor: pointer;
                    padding: 6px 10px;
                    line-height: 1;
                    border-radius: 6px;
                    transition: background-color 0.3s ease;
                }
                .sv-settings-close:hover {
                    background: rgba(255, 80, 80, 0.8);
                }
                .sv-settings-body { padding: 20px; overflow-y: auto; flex: 1; }
                .sv-settings-footer {
                    padding: 12px 20px;
                    border-top: 1px solid #eee;
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    flex-shrink: 0;
                    background: #fff;
                }
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
                    color: #333;
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
                    z-index: 2147483645 !important;
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
                    color: #333;
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

                /* 滑块样式 */
                .sv-slider-container {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .sv-number-input {
                    width: 50px;
                    padding: 8px 12px;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    text-align: center;
                    outline: none;
                    transition: border-color 0.2s;
                    background: #f0f0f0;
                    color: #333;
                }
                .sv-number-input:focus {
                    border: none;
                    background: #e0e0e0;
                }
                .sv-number-input::-webkit-inner-spin-button,
                .sv-number-input::-webkit-outer-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
                .sv-number-input[type=number] {
                    -moz-appearance: textfield;
                }
                .sv-unit {
                    color: #333;
                    font-size: 13px;
                }
                .sv-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 100%;
                    height: 6px;
                    border-radius: 3px;
                    background: linear-gradient(to right, #00d9ff 0%, #00d9ff var(--progress, 50%), #4a4a4a var(--progress, 50%), #4a4a4a 100%);
                    outline: none;
                }
                .sv-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #00d9ff;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .sv-slider::-webkit-slider-thumb:hover {
                    transform: scale(1.2);
                }
                .sv-slider::-moz-range-thumb {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #00d9ff;
                    cursor: pointer;
                    border: none;
                }
                .sv-slider::-moz-range-progress {
                    background: #00d9ff;
                    height: 6px;
                    border-radius: 3px;
                }
                .sv-slider::-moz-range-track {
                    background: #4a4a4a;
                    height: 6px;
                    border-radius: 3px;
                }
                .sv-editable-value {
                    color: #7fdbff;
                    font-weight: 500;
                }
                /* 下拉框样式 */
                .sv-select-input {
                    padding: 8px 12px;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    outline: none;
                    background: #f0f0f0;
                    color: #333;
                    cursor: pointer;
                    transition: background 0.2s;
                    min-width: 80px;
                }
                .sv-select-input:hover {
                    background: #e0e0e0;
                }
                .sv-slider-value {
                    min-width: 36px;
                    font-size: 13px;
                    color: #00d9ff;
                    font-weight: 600;
                    text-align: right;
                }

                /* 区域触发样式 */
                .sv-trigger-zone {
                    position: fixed;
                    border: 2px dashed rgba(0, 217, 255, 0.6);
                    background: rgba(0, 217, 255, 0.1);
                    pointer-events: none;
                    z-index: 2147483644 !important;
                    display: none;
                    transition: border-color 0.3s, background 0.3s;
                }
                .sv-trigger-zone.active {
                    border-color: rgba(0, 217, 255, 0.9);
                    background: rgba(0, 217, 255, 0.2);
                }
                .sv-trigger-zone.highlight {
                    border-color: rgba(0, 255, 136, 0.9);
                    background: rgba(0, 255, 136, 0.25);
                }
                .sv-trigger-zone.active-zone {
                    pointer-events: all !important;
                    /* 完全覆盖区域，拦截滚轮等事件 */
                    z-index: 2147483643 !important;
                }

                /* 区域编辑遮罩 */
                .sv-zone-editor-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 2147483643 !important;
                    display: none;
                    pointer-events: none;  /* 允许点击事件穿透 */
                }
                .sv-zone-editor-overlay.show {
                    display: block;
                }
                .sv-zone-editor-box {
                    position: absolute;
                    border: 2px solid #00d9ff;
                    background: rgba(0, 217, 255, 0.1);
                    cursor: move;
                    pointer-events: auto;  /* 编辑框接收事件 */
                }
                .sv-zone-editor-handle {
                    position: absolute;
                    width: 12px;
                    height: 12px;
                    background: #00d9ff;
                    border-radius: 50%;
                }
                .sv-zone-editor-handle.nw { top: -6px; left: -6px; cursor: nw-resize; }
                .sv-zone-editor-handle.ne { top: -6px; right: -6px; cursor: ne-resize; }
                .sv-zone-editor-handle.sw { bottom: -6px; left: -6px; cursor: sw-resize; }
                .sv-zone-editor-handle.se { bottom: -6px; right: -6px; cursor: se-resize; }
                /* 四条边拖拽手柄 */
                .sv-zone-editor-handle.edge.n { top: -4px; left: 50%; transform: translateX(-50%); width: 24px; height: 8px; border-radius: 4px; cursor: n-resize; }
                .sv-zone-editor-handle.edge.s { bottom: -4px; left: 50%; transform: translateX(-50%); width: 24px; height: 8px; border-radius: 4px; cursor: s-resize; }
                .sv-zone-editor-handle.edge.e { right: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 24px; border-radius: 4px; cursor: e-resize; }
                .sv-zone-editor-handle.edge.w { left: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 24px; border-radius: 4px; cursor: w-resize; }

                /* 区域编辑按钮样式 */
                .sv-zone-editor-buttons {
                    position: fixed;
                    bottom: 30px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    gap: 16px;
                    z-index: 2147483645 !important;
                    pointer-events: auto;  /* 按钮接收事件 */
                }
                .sv-zone-btn {
                    padding: 12px 32px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .sv-zone-btn-cancel {
                    background: rgba(255, 255, 255, 0.9);
                    color: #666;
                }
                .sv-zone-btn-cancel:hover {
                    background: #fff;
                    color: #333;
                }
                .sv-zone-btn-save {
                    background: #00d9ff;
                    color: #fff;
                }
                .sv-zone-btn-save:hover {
                    background: #00b8d9;
                }

                /* 深色模式 */
                .bilibili-scroll-volume-settings.sv-dark-mode {
                    background: #1a1a1a;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-settings-header {
                    background: linear-gradient(135deg, #2a2a2a, #1a1a1a);
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-settings-body {
                    background: #1a1a1a;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-setting-item {
                    border-bottom-color: #333;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-setting-label {
                    color: #e0e0e0;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-setting-desc {
                    color: #aaa;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-settings-footer {
                    background: #1a1a1a;
                    border-top-color: #333;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-settings-footer span {
                    color: #aaa;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-key-btn {
                    background: #e0e0e0;
                    color: #333;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-key-btn:hover {
                    background: #d0d0d0;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-select-input {
                    background: #e0e0e0;
                    color: #333;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-select-input:hover {
                    background: #d0d0d0;
                }
                .bilibili-scroll-volume-settings.sv-dark-mode .sv-key-btn.sv-zone-btn-active {
                    background: #00d9ff !important;
                    color: #e8f8ff !important;
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

            // 全屏音量指示器（放在播放器容器内）
            const indicatorFull = document.createElement('div');
            indicatorFull.id = 'scroll-volume-indicator-full';
            indicatorFull.innerHTML = `
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

            // 等待播放器加载后，将其添加到播放器容器内
            this.volumeIndicatorFull = indicatorFull;
            this.tryAppendIndicatorToPlayer();

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
                            <div class="sv-setting-label">全屏模式</div>
                            <div class="sv-setting-desc">视频/网页全屏时的触发方式</div>
                        </div>
                        <select class="sv-select-input sv-key-btn" id="sv-fullscreen-mode-select">
                            <option value="1">禁用</option>
                            <option value="2">启用</option>
                            <option value="3" selected>直接触发（无需按键）</option>
                        </select>
                    </div>
                    <div class="sv-setting-item">
                        <div>
                            <div class="sv-setting-label">触发按键</div>
                            <div class="sv-setting-desc">按住此键 + 滚轮调节音量</div>
                        </div>
                        <button class="sv-setting-btn sv-key-btn" id="sv-trigger-key-btn">空格</button>
                    </div>
                    <div class="sv-setting-item" style="display: flex; align-items: center; gap: 12px;">
                        <div style="flex-shrink: 0;">
                            <div class="sv-setting-label">步长</div>
                            <div class="sv-setting-desc">双击输入（1-100）</div>
                        </div>
                        <div class="sv-slider-container" style="flex-shrink: 0;">
                            <span class="sv-editable-value" id="sv-volume-step-display" style="min-width: 35px; text-align: center; cursor: pointer;">5%</span>
                            <span class="sv-unit">%</span>
                        </div>
                        <input type="range" class="sv-slider" id="sv-volume-step-slider" min="1" max="100" value="5" style="flex: 1;">
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
                    <div class="sv-setting-item" id="sv-zone-setting-item" style="flex-direction: column; align-items: flex-start; gap: 6px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <div class="sv-setting-label">指定区域触发</div>
                            <label class="sv-toggle-switch">
                                <input type="checkbox" id="sv-trigger-zone-toggle">
                                <span class="sv-toggle-slider"></span>
                            </label>
                        </div>
                        <div class="sv-setting-desc">鼠标在该区域内时无需按键即可触发</div>
                        <div style="display: flex; gap: 8px; justify-content: center; width: 100%;">
                            <button class="sv-setting-btn sv-key-btn" id="sv-edit-zone-btn" style="background: #e8f8ff; color: #00d9ff;">编辑区域</button>
                            <button class="sv-setting-btn sv-key-btn" id="sv-show-zone-btn" style="background: #e8f8ff; color: #00d9ff;">显示区域</button>
                        </div>
                    </div>
                </div>
                <div class="sv-settings-footer">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 13px; color: #666;">深色模式</span>
                        <label class="sv-toggle-switch">
                            <input type="checkbox" id="sv-dark-mode-toggle">
                            <span class="sv-toggle-slider"></span>
                        </label>
                    </div>
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

            // 初始化全屏状态监听
            this.initFullscreenListener();

            // 绑定设置面板事件
            this.bindSettingsEvents();
        }

        /** 初始化全屏状态监听 */
        initFullscreenListener() {
            const updateFullscreenState = () => {
                this.isFullscreen = this.checkFullscreenState();
            };

            document.addEventListener('fullscreenchange', updateFullscreenState);
            document.addEventListener('webkitfullscreenchange', updateFullscreenState);
            document.addEventListener('msfullscreenchange', updateFullscreenState);
        }

        /** 绑定设置面板事件 */
        bindSettingsEvents() {
            const closeBtn = settingsPanel.querySelector('.sv-settings-close');
            closeBtn.addEventListener('click', () => {
                settingsPanel.classList.remove('show');
            });

            // 设置面板拖拽功能
            const settingsHeader = settingsPanel.querySelector('.sv-settings-header');
            let isDragging = false;
            let dragOffsetX = 0;
            let dragOffsetY = 0;

            settingsHeader.addEventListener('mousedown', (e) => {
                // 只响应左键
                if (e.button !== 0) return;
                isDragging = true;
                const rect = settingsPanel.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                settingsPanel.style.transition = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const x = e.clientX - dragOffsetX;
                const y = e.clientY - dragOffsetY;
                // 限制在视口内
                const maxX = window.innerWidth - settingsPanel.offsetWidth;
                const maxY = window.innerHeight - settingsPanel.offsetHeight;
                settingsPanel.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
                settingsPanel.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
                settingsPanel.style.right = 'auto';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
                settingsPanel.style.transition = '';
            });

            const keyBtn = document.getElementById('sv-trigger-key-btn');
            keyBtn.addEventListener('click', () => {
                enterKeyListening();
            });

            // 绑定全屏模式选择事件
            const fullscreenModeSelect = document.getElementById('sv-fullscreen-mode-select');
            fullscreenModeSelect.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                setFullscreenMode(value);
                this.fullscreenMode = value;
                const modeText = { 1: '禁用', 2: '启用', 3: '直接触发' };
                showToast(`全屏模式已调整为: ${modeText[value]}`);
            });

            // 绑定步长编辑事件（双击打开输入框）
            const volumeStepDisplay = document.getElementById('sv-volume-step-display');
            let inputEl = null;
            
            volumeStepDisplay.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const currentValue = parseInt(getVolumeStepPercent()) || 5;
                
                // 创建输入框
                inputEl = document.createElement('input');
                inputEl.type = 'number';
                inputEl.className = 'sv-number-input';
                inputEl.min = 1;
                inputEl.max = 100;
                inputEl.value = currentValue;
                inputEl.style.cssText = 'width: 50px; padding: 2px 5px; border: 1px solid #00d9ff; border-radius: 4px; text-align: center; font-size: 14px;';
                
                // 替换显示元素
                volumeStepDisplay.textContent = '';
                volumeStepDisplay.appendChild(inputEl);
                inputEl.focus();
                inputEl.select();
                
                // 失焦或回车确认
                const confirmInput = () => {
                    let value = parseInt(inputEl.value) || 5;
                    value = Math.max(1, Math.min(100, value));
                    setVolumeStepPercent(value);
                    this.volumeStepPercent = value;
                    volumeStepDisplay.textContent = value + '%';
                    showToast(`步长已调整为 ${value}%`);
                };
                
                inputEl.addEventListener('blur', confirmInput);
                inputEl.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        inputEl.blur();
                    } else if (ev.key === 'Escape') {
                        volumeStepDisplay.textContent = currentValue + '%';
                    }
                });
            });

            // 同步显示初始化
            const volumeStepSlider = document.getElementById('sv-volume-step-slider');
            const syncDisplayValue = () => {
                const value = parseInt(getVolumeStepPercent()) || 5;
                if (volumeStepDisplay) {
                    volumeStepDisplay.textContent = value + '%';
                }
                if (volumeStepSlider) {
                    volumeStepSlider.value = value;
                    volumeStepSlider.style.setProperty('--progress', (value / 100) * 100 + '%');
                }
            };
            syncDisplayValue();

            // 滑块变化时同步
            volumeStepSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                volumeStepDisplay.textContent = value + '%';
                // 更新滑块背景进度
                const progress = (value / 100) * 100;
                volumeStepSlider.style.setProperty('--progress', progress + '%');
            });
            volumeStepSlider.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                setVolumeStepPercent(value);
                this.volumeStepPercent = value;
                volumeStepDisplay.textContent = value + '%';
                const progress = (value / 100) * 100;
                volumeStepSlider.style.setProperty('--progress', progress + '%');
                showToast(`步长已调整为 ${value}%`);
            });

            // 绑定开关事件
            const hoverToggle = document.getElementById('sv-require-hover-toggle');
            hoverToggle.addEventListener('change', (e) => {
                const requireHover = e.target.checked;
                setRequireHoverOnVideo(requireHover);
                this.requireHoverOnVideo = requireHover;
                showToast(requireHover ? '已开启：需鼠标在视频上' : '已关闭：页面任意位置均可触发');
            });

            // 绑定区域触发开关
            const zoneToggle = document.getElementById('sv-trigger-zone-toggle');
            zoneToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                setTriggerZoneEnabled(enabled);
                this.triggerZoneEnabled = enabled;
                this.updateTriggerZoneElement();
                showToast(enabled ? '已开启区域触发' : '已关闭区域触发');
            });

            // 绑定编辑区域按钮
            const editZoneBtn = document.getElementById('sv-edit-zone-btn');
            const updateEditZoneBtnStyle = () => {
                const isDarkMode = settingsPanel.classList.contains('sv-dark-mode');
                if (isDarkMode) {
                    editZoneBtn.style.background = '#00d9ff';
                    editZoneBtn.style.color = '#111';
                } else {
                    editZoneBtn.style.background = '#e8f8ff';
                    editZoneBtn.style.color = '#00d9ff';
                }
            };
            updateEditZoneBtnStyle();
            editZoneBtn.addEventListener('click', () => {
                this.startZoneEditing();
            });

            // 绑定显示区域按钮
            const showZoneBtn = document.getElementById('sv-show-zone-btn');
            const updateShowZoneBtn = () => {
                const isDarkMode = settingsPanel.classList.contains('sv-dark-mode');
                showZoneBtn.textContent = this.showTriggerZone ? '显示区域' : '隐藏区域';
                if (isDarkMode) {
                    // 深色模式下反转颜色
                    showZoneBtn.style.background = this.showTriggerZone ? '#00d9ff' : '#3a3a3a';
                    showZoneBtn.style.color = this.showTriggerZone ? '#111' : '#888';
                } else {
                    showZoneBtn.style.background = this.showTriggerZone ? '#e8f8ff' : '#f0f0f0';
                    showZoneBtn.style.color = this.showTriggerZone ? '#00d9ff' : '#999';
                }
            };
            updateShowZoneBtn();
            showZoneBtn.addEventListener('click', () => {
                this.showTriggerZone = !this.showTriggerZone;
                setShowTriggerZone(this.showTriggerZone);
                this.updateTriggerZoneElement();
                updateShowZoneBtn();
                showToast(this.showTriggerZone ? '已显示区域' : '已隐藏区域');
            });

            // 绑定深色模式开关
            const darkModeToggle = document.getElementById('sv-dark-mode-toggle');
            // 加载保存的设置
            const savedDarkMode = GM_getValue('sv-dark-mode', false);
            darkModeToggle.checked = savedDarkMode;
            if (savedDarkMode) {
                settingsPanel.classList.add('sv-dark-mode');
            }
            // 根据当前模式更新按钮样式
            updateShowZoneBtn();
            updateEditZoneBtnStyle();

            darkModeToggle.addEventListener('change', (e) => {
                const isDarkMode = e.target.checked;
                if (isDarkMode) {
                    settingsPanel.classList.add('sv-dark-mode');
                } else {
                    settingsPanel.classList.remove('sv-dark-mode');
                }
                GM_setValue('sv-dark-mode', isDarkMode);
                updateShowZoneBtn();
                updateEditZoneBtnStyle();
                showToast(isDarkMode ? '已开启深色模式' : '已关闭深色模式');
            });
        }

        updateVolumeIndicator(volume) {
            if (!CONFIG.showVolumeIndicator) return;

            const percentage = Math.round(volume * 100);
            const inFullscreen = this.checkFullscreenState();

            // 根据全屏状态选择指示器
            const currentIndicator = inFullscreen ? this.volumeIndicatorFull : this.volumeIndicator;
            if (!currentIndicator) return;

            const bar = currentIndicator.querySelector('.scroll-volume-bar');
            const valueEl = currentIndicator.querySelector('.scroll-volume-value');

            bar.style.width = `${Math.min(100, percentage)}%`;
            valueEl.textContent = `${percentage}%`;

            if (percentage > 100) {
                valueEl.classList.add('boosted');
                bar.style.background = 'linear-gradient(90deg, #ff6b6b, #ff4757)';
            } else {
                valueEl.classList.remove('boosted');
                bar.style.background = 'linear-gradient(90deg, #00d9ff, #00ff88)';
            }

            // 全屏模式：显示内嵌指示器，隐藏全局指示器
            // 普通模式：显示全局指示器，隐藏内嵌指示器
            if (inFullscreen) {
                this.volumeIndicator.classList.remove('show');
                currentIndicator.classList.add('show');
            } else {
                if (this.volumeIndicatorFull) {
                    this.volumeIndicatorFull.classList.remove('show');
                }
                this.volumeIndicator.classList.add('show');
            }

            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.volumeIndicator.classList.remove('show');
                if (this.volumeIndicatorFull) {
                    this.volumeIndicatorFull.classList.remove('show');
                }
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
        const volumeStep = getVolumeStepPercent();
        const fullscreenMode = getFullscreenMode();
        const zoneEnabled = getTriggerZoneEnabled();
        const btn = document.getElementById('sv-trigger-key-btn');
        const toggle = document.getElementById('sv-require-hover-toggle');
        const slider = document.getElementById('sv-volume-step-slider');
        const input = document.getElementById('sv-volume-step-input');
        const sliderValue = document.getElementById('sv-volume-step-value');
        const fullscreenSelect = document.getElementById('sv-fullscreen-mode-select');
        const zoneToggle = document.getElementById('sv-trigger-zone-toggle');
        if (btn) {
            btn.textContent = keyCodeToName(key);
        }
        if (toggle) {
            toggle.checked = requireHover;
        }
        if (slider) {
            slider.value = volumeStep;
        }
        if (input) {
            input.value = volumeStep;
        }
        if (sliderValue) {
            sliderValue.textContent = volumeStep + '%';
        }
        if (fullscreenSelect) {
            fullscreenSelect.value = fullscreenMode;
        }
        if (zoneToggle) {
            zoneToggle.checked = zoneEnabled;
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
