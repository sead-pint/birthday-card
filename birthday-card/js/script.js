import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * 状态机配置
 * 0: 等待开始
 * 1: 三丽鸥Intro (等待张开手掌)
 * 2: 星空粒子爱心 (等待比心)
 * 3: 蛋糕与吹气 (等待吹灭)
 * 4: 最终贺卡
 */
const state = {
    current: 0,
    handDetected: false,
    gestureVerified: false, 
    blowLevel: 0,
    candleExtinguished: false
};

// DOM 元素
const uiScenes = [
    null, // placeholder
    document.getElementById('scene-intro'),
    document.getElementById('scene-particles-ui'),
    document.getElementById('scene-cake-ui'),
    document.getElementById('scene-letter')
];
const particleHint = document.getElementById('particle-hint-text');
const meterFill = document.getElementById('meter-fill');
const typewriterText = document.getElementById('typewriter-text');
const bgMusic = document.getElementById('bgMusic');
const birthdaySong = document.getElementById('birthdaySong');

// 祝福原文
const letterText = `亲爱的媛媛公主：\n\n生日快乐呀宝宝！\n\n虽然现在我不在你身边，\n但这是我做的一个电子贺卡，\n有烟花和小蛋糕嘿嘿，\n虽然还不够好，\n但也挺有意思的吧？\n\n在这新的一年里，\n祝你能够无限从容的追逐梦想，\n能够顺顺利利的实现愿望，\n希望我们越来越好。\n\n爱你的，\n咩咩`;

// --- Three.js 变量 ---
let camera, scene, renderer, controls;
let particles;
let particleSystem;
let clock = new THREE.Clock();
// 粒子目标位置数组
let transformTargets = {
    sphere: [],
    heart: [],
    text: [],
    cake: [],
    cloud: [],
    number: []
};
let currentPositions = []; // 当前粒子实际位置

// --- 触摸交互变量 ---
let touchStartTime = 0;
let isPressing = false;
let pressInterval = null;

// --- 初始化入口 ---
document.getElementById('start-overlay').addEventListener('click', async function() {
    this.style.opacity = 0;
    this.style.pointerEvents = 'none'; // 防止点透
    
    // 播放音乐
    bgMusic.volume = 0.5;
    bgMusic.play().catch(e => console.log('Need interaction'));
    
    // 启动流程
    initThreeJS();
    document.getElementById('webgl-canvas').style.display = 'block'; // 显示画布
    animateParticlesTo('cloud'); // 初始形态：漫天飞舞
    controls.autoRotate = true;  // 开启缓慢旋转
    controls.autoRotateSpeed = 0.5;
    
    // 绑定触摸事件
    setupInteraction();

    setTimeout(() => {
        this.style.display = 'none';
    }, 1000); 
});

function setupInteraction() {
    // 场景1：点击任意位置进入星空
    // 修改：绑定到 start-overlay 之后的遮罩或者直接 document
    // 因为 start-overlay 消失后，我们实际上是在 interact with ui-layer or canvas
    // 但 scene-intro 本身是一个覆盖全屏的 div，如果它没隐藏，点它就行
    document.getElementById('scene-intro').addEventListener('click', () => {
        // 由于 start-overlay 点击时没有显式设置 state.current=1，这里兼容 0 或 1
        if (state.current === 0 || state.current === 1) {
            switchState(2);
        }
    });

    // 场景2：点击切换粒子形态
    document.getElementById('scene-particles-ui').addEventListener('click', () => {
        if (state.current === 2) {
             if (!state.gestureVerified) {
                 // 第一次点击：倒计时
                 particleHint.innerText = ""; // 清空提示
                 state.gestureVerified = true;
                 
                 // 1. 先展示金色祝福语 (中文)
                 createTextParticles("生日快乐", false);
                 animateParticlesTo('text');
                 changeParticleColors('#FFD700'); // 金色
                 
                 // 停止由于爱心旋转带来的快速转动，方便看字
                 controls.autoRotate = false; // 修正：完全停止旋转
                 // 调整视角为正面
                 // 使用 gsap 缓动相机会更平滑，但直接设置也行
                 // gsap.to(controls.object.position, {x: 0, y: 0, z: 50, duration: 1}); 简单重置即可
                 
                 // 启动背景烟花循环 (每 400ms 放两个，左右各一)
                 const fwInterval = setInterval(() => {
                     // 左边一个 [-100, -20]
                     spawnBackgroundFirework(-60); 
                     // 右边一个 [20, 100]
                     spawnBackgroundFirework(60);
                 }, 400);

                 // 2. 5秒后进入倒计时
                 setTimeout(() => {
                     clearInterval(fwInterval); // 停止放烟花
                     startCountdown(); 
                 }, 5000);
             }
        }
    });

    // 场景3：长按吹蜡烛
    const cakeUi = document.getElementById('scene-cake-ui');
    
    // 鼠标/手指按下
    const startPress = (e) => {
        if (state.current !== 3 || state.candleExtinguished) return;
        isPressing = true;
        
        // 开启循环增加
        if (!pressInterval) {
            pressInterval = setInterval(() => {
                if(isPressing) {
                   // 加快进度，约 1.5秒充满 (100 / 4 * 50ms = 1250ms)
                   state.blowLevel += 4; 
                   updateBlowMeter();
                } else {
                    // 如果没按住（理论上会被 clearInterval，但防止逻辑漏洞）
                    // 增加回退机制，模拟气不够了
                    if (state.blowLevel > 0) {
                        state.blowLevel -= 2;
                        updateBlowMeter();
                    }
                }
            }, 50);
        }
    };

    // 鼠标/手指松开
    const endPress = (e) => {
        isPressing = false;
        // 如果松开，让它自动回退，而不是立即清除Interval
        // 这样如果没有吹灭，进度条会慢慢掉下来
        // 但是为了代码简单，这里先不做复杂的 decay loop，
        // 只要松手就停止增加，并且稍微扣一点惩罚，或者保持现状
        
        clearInterval(pressInterval);
        pressInterval = null;
        
        // 如果想增加难度，可以在这里加一行：
        // state.blowLevel = Math.max(0, state.blowLevel - 10);
        // updateBlowMeter();
    };

    cakeUi.addEventListener('mousedown', startPress);
    cakeUi.addEventListener('touchstart', startPress);
    
    cakeUi.addEventListener('mouseup', endPress);
    cakeUi.addEventListener('touchend', endPress);
    cakeUi.addEventListener('mouseleave', endPress);
}

function updateBlowMeter() {
    const percentage = Math.min(100, state.blowLevel);
    meterFill.style.width = percentage + "%";
    
    // 随机晃动火焰
    if (Math.random() > 0.5) {
        // ... 此处省略复杂的火焰ThreeJS操作，简化为逻辑
    }

    if (state.blowLevel >= 100) {
        extinguishCandle();
        isPressing = false;
        clearInterval(pressInterval);
    }
}

function switchState(newState) {
    console.log(`Switching from ${state.current} to ${newState}`);
    
    // 隐藏当前UI
    if (uiScenes[state.current]) {
        uiScenes[state.current].classList.remove('active');
    }
    
    // 强制状态流转逻辑修正，确保从0开始是正确的
    if (state.current === 0 && newState === 1) {
        // 这里的逻辑稍微调整，因为上面点击 Overlay 并没有设 state=1，而是保持0等待Intro点击
        // 实际上我们可以让 Overlay点击后进入 state 1 (Intro)
    }

    state.current = newState;
    
    // 显示新UI
    if (uiScenes[state.current]) {
        setTimeout(() => {
            uiScenes[state.current].classList.add('active');
        }, 500);
    }
    
    // 状态特定逻辑，不仅要隐藏Intro，还要确保文字真的消失
        const intro = document.getElementById('scene-intro');
        intro.classList.remove('active'); // 移除 active 类，触发 CSS 动画淡出
        intro.style.display = 'none'; // 强制隐藏
        
    if (newState === 1) {
        // 其实默认就是 Intro界面显示了
    } else if (newState === 2) {
        // 进入星空爱心场景
        document.getElementById('webgl-canvas').style.display = 'block';
        
        // 立即变换为爱心
        animateParticlesTo('heart'); 
        
        // 将粒子颜色变为粉色
        changeParticleColors(0xff9a9e); 

        // 提示文案小心心
        particleHint.innerText = "点击爱心许愿 💕";

        // 重置交互状态
        state.gestureVerified = false; 

        // 加快爱心旋转速度
        controls.autoRotate = true;
        controls.autoRotateSpeed = 4.0; 

    } else if (newState === 3) {
        // 蛋糕场景 - 缤纷烟花蛋糕
        state.blowLevel = 0;
        state.candleExtinguished = false;
        if(meterFill) meterFill.style.width = '0%';
        
        animateParticlesTo('cake');
        
        // 专门处理一下蛋糕的颜色
        // 保持烟花的彩色作为蛋糕底色，但把蜡烛改成火焰色
        const colors = particles.attributes.color.array;
        const colorObj = new THREE.Color();
        const cakeTargets = transformTargets.cake;

        for(let i=0; i<currentPositions.length; i++) {
             // 识别层级并上色 (根据 Y 坐标)
             // 由于现在有复杂的波浪花边，单纯靠 Y 坐标判断可能会串色
             // 但为了简单，我们还是用 Y 轴分层，只是稍微调整阈值
             
             // 实际上我们可以通过判断半径来辅助上色，但这里先主要靠高度
             const targetY = cakeTargets[i] ? cakeTargets[i].y : 0;
             
             if (targetY > 15) {
                 // 火焰
                 colorObj.setStyle('#FFD700'); 
                 if(Math.random() > 0.7) colorObj.setStyle('#FF4500');
             } 
             else if (targetY > 10) {
                 // 蜡烛 或 顶层花边
                 // 如果半径比较大，说明是花边
                 const tx = cakeTargets[i].x;
                 const tz = cakeTargets[i].z;
                 const rad = Math.sqrt(tx*tx + tz*tz);
                 
                 if (rad > 2) {
                     // 顶层花边/奶油 (纯白)
                     colorObj.setStyle('#FFFFFF'); 
                 } else {
                     // 蜡烛身 (粉)
                     colorObj.setStyle('#FF69B4');
                 }
             }
             else if (targetY > 4) {
                 // 顶层主体 (白色)
                 colorObj.setStyle('#FFF8DC'); 
             }
             else if (targetY > -4) {
                 // 中层主体 (黄色)
                 // 检测是否是接缝处的花边(Y接近4或-4)
                 colorObj.setStyle('#FFFFE0'); 
                 // 稍微加深一点让奶油花边显现出来
                 if(Math.random() > 0.8) colorObj.setStyle('#F0E68C');
             }
             else {
                 // 底层 (粉色)
                 // 花边检测
                 const rad = Math.sqrt(cakeTargets[i].x*cakeTargets[i].x + cakeTargets[i].z*cakeTargets[i].z);
                 if (targetY > -5 && rad > 11) {
                      // 底层上方的花边，用白色点缀
                      colorObj.setStyle('#FFFFFF');
                 } else {
                      colorObj.setStyle('#FFB6C1');
                 }
             }

             // 应用颜色
             colors[i*3] = colorObj.r;
             colors[i*3+1] = colorObj.g;
             colors[i*3+2] = colorObj.b;
             
             // 再次减慢汇聚速度
             // 0.02 左右，让过程像是一个悠长的“倒带”效果，约 2.5-3 秒完成
             currentPositions[i].speed = 0.02 + Math.random() * 0.01;
        }
        particles.attributes.color.needsUpdate = true;

        controls.autoRotate = true; 
        controls.autoRotateSpeed = 2.0;
    } else if (newState === 4) {
        // 贺卡场景
        bgMusic.pause();
        birthdaySong.play();
        
        // 1. 背景虚化 (CSS滤镜)
        document.getElementById('webgl-canvas').classList.add('blur-bg');
        
        // 2. 延迟触发 CSS 动画 (Card Pop)，等外层容器显示出来
        setTimeout(() => {
            const envelope = document.getElementById('final-card');
            // 先移除类名以重置动画
            envelope.classList.remove('card-pop-animation');
            // 强制重绘
            void envelope.offsetWidth; 
            envelope.classList.add('card-pop-animation');
        }, 600); // 比容器显示的500ms稍晚一点

        // 点击信封开启逻辑
        document.getElementById('final-card').addEventListener('click', openLetter);
    }
}

function spawnBackgroundFirework(xBias = 0) {
    // 创建一个临时的粒子系统模拟烟花
    const count = 80 + Math.random() * 50; // 稍微减少单次数量，因为现在一次放两个
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const colorObj = new THREE.Color();
    
    // 随机位置 (根据 Bias 决定区域)
    // xBias < 0: 左侧区域 [-120, -30]
    // xBias > 0: 右侧区域 [30, 120]
    // xBias = 0: 全屏随机
    
    let centerX;
    if (xBias === 0) {
        centerX = (Math.random() - 0.5) * 200;
    } else {
        // 在 Bias 周围 40 的范围内波动
        centerX = xBias + (Math.random() - 0.5) * 80;
    }

    const centerY = (Math.random() - 0.5) * 100; // [-50, 50] 高度随机
    const centerZ = -20 - Math.random() * 40;  
    
    // 随机颜色
    const hue = Math.random();
    
    for(let i=0; i<count; i++) {
        // 球形分布
        const r = Math.random() * 2; 
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        positions[i*3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i*3+2] = r * Math.cos(phi);
        
        colorObj.setHSL(hue + (Math.random()-0.5)*0.2, 1.0, 0.6 + Math.random()*0.2); 
        colors[i*3] = colorObj.r;
        colors[i*3+1] = colorObj.g;
        colors[i*3+2] = colorObj.b;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 3.0, // 雪花般大小 (0.8 -> 3.0)
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        map: getTexture() // 使用贴图，产生柔和的光晕
    });
    
    const mesh = new THREE.Points(geometry, material);
    mesh.position.set(centerX, centerY, centerZ);
    scene.add(mesh);
    
    // 动画：扩散 + 消失 (gsap update specific to individual particles is hard, so update mesh scale)
    const duration = 1.5 + Math.random() * 1.0; 
    
    gsap.to(mesh.scale, {
        x: 20, 
        y: 20,
        z: 20,
        duration: duration,
        ease: "power2.out"
    });
    
    gsap.to(material, {
        opacity: 0,
        duration: duration * 0.4,
        delay: duration * 0.6,
        ease: "power2.in",
        onComplete: () => {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        }
    });
}

function startCountdown() {
    controls.autoRotate = false; // 确保不转
    controls.autoRotateSpeed = 0.5; 
    
    // 倒计时开始，变回白色
    changeParticleColors('#FFFFFF');

    // 3 (数字)
    createTextParticles("3", true);
    animateParticlesTo('text');

    setTimeout(() => {
        // 2 (数字)
        createTextParticles("2", true);
        animateParticlesTo('text');
    }, 1000);

    setTimeout(() => {
        // 1 (数字)
        createTextParticles("1", true);
        animateParticlesTo('text');
    }, 2000);

    setTimeout(() => {
        // 结束倒计时，触发烟花
        triggerFirework();
    }, 3000);
}

function triggerFirework() {
    // 1. 蓄力阶段：汇聚成点
    for(let i=0; i<currentPositions.length; i++) {
        currentPositions[i].tx = 0;
        currentPositions[i].ty = 0; // 中心点
        currentPositions[i].tz = 0;
        currentPositions[i].speed = 0.1; 
    }
    
    // 缩小粒子，模拟远处的火种
    if(particleSystem) particleSystem.material.size = 2.0;

    // 2. 第一阶段：主爆炸 (慢动作，大粒子，鲜艳)
    setTimeout(() => {
        const colors = particles.attributes.color.array;
        const colorObj = new THREE.Color();
        
        // 放大粒子，模拟燃烧的火球
        if(particleSystem) particleSystem.material.size = 4.0;

        for(let i=0; i<currentPositions.length; i++) {
             // 鲜艳的焰色 (金/红/紫/蓝)
             const hue = Math.random() > 0.5 ? 
                        (Math.random() * 0.1 + 0.0) : // 红-橙-金
                        (Math.random() * 0.3 + 0.5);   // 蓝-紫-粉
             colorObj.setHSL(hue, 1.0, 0.6);
             colors[i*3] = colorObj.r;
             colors[i*3+1] = colorObj.g;
             colors[i*3+2] = colorObj.b;

             // 形成一个扩大的球体，模拟第一波冲击波
             // 保持轨迹整齐
             const r = 60 + Math.random() * 20; // 相对集中的半径
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.acos(2 * Math.random() - 1);
             
             currentPositions[i].tx = r * Math.sin(phi) * Math.cos(theta);
             currentPositions[i].ty = r * Math.sin(phi) * Math.sin(theta);
             currentPositions[i].tz = r * Math.cos(phi);
             
             // 极慢动作
             currentPositions[i].speed = 0.02;
        }
        particles.attributes.color.needsUpdate = true;
        
        // 音效
        const pop = document.getElementById('popSound');
        if(pop) { pop.currentTime = 0; pop.play().catch(()=>{}); }
        
    }, 1000); 

    // 3. 第二阶段：二次炸开 (满屏烟花秀，但保持在屏幕内)
    setTimeout(() => {
        // 粒子变小，模拟散开的火星
        if(particleSystem) particleSystem.material.size = 1.5;

        for(let i=0; i<currentPositions.length; i++) {
             // 再次加速扩散
             // 调整：大幅减小半径，确保粒子停留在可视范围内
             // 摄像机Z=50，视野高度约70-80。半径设为 30-60 即可填满屏幕
             const r = 30 + Math.random() * 40; 
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.acos(2 * Math.random() - 1);

             currentPositions[i].tx = r * Math.sin(phi) * Math.cos(theta) * 1.8; // 宽屏拉伸
             currentPositions[i].ty = r * Math.sin(phi) * Math.sin(theta) + 5; // 稍微向上偏移
             currentPositions[i].tz = r * Math.cos(phi) * 0.5; // 压扁Z轴
             
             // 速度稍慢，保持悬浮感
             currentPositions[i].speed = 0.02 + Math.random() * 0.02;
        }
    }, 2800); // 1.8秒后二次爆炸

    // 4. 结束，迅速变成蛋糕
    setTimeout(() => {
        if(particleSystem) particleSystem.material.size = 0.8; // 恢复正常大小
        switchState(3);
    }, 6000); 
}

// 动态生成文字/数字粒子目标
function createTextParticles(text, isNumber = false) {
    // 增加画布分辨率以提高采样精度
    const width = 600;
    const height = 300;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#ffffff';
    
    // 针对数字和中文使用不同的字体配置
    if (isNumber) {
        ctx.font = 'bold 200px Arial'; 
    } else {
        // 增大中文字号，改用黑体以获得更清晰的笔画
        ctx.font = 'bold 160px "Microsoft YaHei", "SimHei", Arial'; 
    }
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width/2, height/2);
    
    const imageData = ctx.getImageData(0, 0, width, height).data;
    const validPoints = [];
    
    // 摄像机在平面 (x, z) 上的角度
    const angle = Math.atan2(camera.position.x, camera.position.z);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // 采样步长
    // 减小步长，极大幅度增加采样点密度 (2 -> 1)
    const step = 1;
    
    // 立体厚度层数 (3D挤出)
    // 稍微减少层数，把粒子用在刀刃上(表面密度)
    const layers = 3; 
    const depthSpacing = 2.0; // 层间距

    for(let y=0; y<height; y+=step) { 
        for(let x=0; x<width; x+=step) {
            if(imageData[(y*width + x)*4] > 128) { 
                // 原始 2D 坐标 (中心0,0)
                // 统一缩放系数，因为现在字号都很大
                const scale = 0.18; 
                
                const x0 = (x - width/2) * scale; 
                const y0 = -(y - height/2) * scale;
                
                // === 3D 挤出逻辑 ===
                // 为每个有效像素点生成多个深度上的点
                for (let l = 0; l < layers; l++) {
                    // 让粒子在 Z 轴（相对文字朝向）上分布
                    const offsetZ = (l - (layers-1)/2) * depthSpacing;
                    
                    const z0 = offsetZ;
                    
                    const x_rot = x0 * cosA + z0 * sinA;
                    const z_rot = -x0 * sinA + z0 * cosA;

                    validPoints.push({
                        x: x_rot, 
                        y: y0, 
                        z: z_rot
                    });
                }
            }
        }
    }
    
    transformTargets.text = []; 
    
    // 这里的逻辑很关键：
    // 如果有效点 (validPoints) 远多于 粒子总数 (currentPositions.length)
    // 我们必须随机采样 validPoints，否则文字只会显示一半 (数组前面的部分)
    
    // 如果粒子总数多，我们必须复用有效点
    
    const totalParticles = currentPositions.length;
    const validCount = validPoints.length;
    
    // 为了防止文字“走型”（即某些笔画缺失），当点不够用时，我们需要更智能的采样
    // 或者简单粗暴：如果不通过随机采样，而是按比例抽取，可以保证形状完整
    
    if (validCount > totalParticles) {
        // 有效点太多了，粒子不够 -> 均匀稀释
        // 比如有 10000 个点，只有 5000 个粒子，每 2 个取 1 个
        const step = validCount / totalParticles;
        for (let i = 0; i < totalParticles; i++) {
            const idx = Math.floor(i * step);
            if (idx < validCount) {
                transformTargets.text.push(validPoints[idx]);
            } else {
                transformTargets.text.push(validPoints[validCount - 1]);
            }
        }
    } else {
        // 粒子够用 -> 全部填满，剩下的随机复用增强密度
        for (let i = 0; i < totalParticles; i++) {
            if (i < validCount) {
                transformTargets.text.push(validPoints[i]);
            } else {
                // 复用：随机取一个有效位
                const p = validPoints[Math.floor(Math.random() * validCount)];
                transformTargets.text.push({
                    x: p.x + (Math.random()-0.5) * 0.2, // 极小抖动，增加厚实感
                    y: p.y + (Math.random()-0.5) * 0.2,
                    z: p.z + (Math.random()-0.5) * 0.2
                });
            }
        }
    }
}

function extinguishCandle() {
    if (state.candleExtinguished) return;
    state.candleExtinguished = true;
    
    // 效果
    controls.autoRotate = false;
    
    // 播放音效
    const pop = document.getElementById('popSound');
    if(pop) pop.play();

    // 粒子爆炸散开 (向外飞)
    explodeParticles();
    
    // 缩短等待时间，让信封紧接着爆炸出现
    setTimeout(() => {
        switchState(4);
    }, 800);
}

// --- Three.js 核心逻辑 ---
function initThreeJS() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50; // 较远的视角

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('webgl-canvas'), alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 创建粒子系统
    createParticleSystem();
    
    // 创建背景雪花/星星
    createBackgroundParticles();

    // 生成目标形状数据
    generateGeometries();

    animate();
}

function createParticleSystem() {
    // 增加粒子总数以支持更清晰的文字显示
    const particleCount = 5000; // 3000 -> 5000
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);


    const colorObj = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
        // 初始位置：随机分布在球体内
        const x = Math.random() * 100 - 50;
        const y = Math.random() * 100 - 50;
        const z = Math.random() * 100 - 50;
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // 颜色：白色雪花/星星
        colorObj.setHSL(0.0, 0.0, 0.9 + Math.random() * 0.1); // 白色
        colors[i * 3] = colorObj.r;
        colors[i * 3 + 1] = colorObj.g;
        colors[i * 3 + 2] = colorObj.b;
        
        // 记录当前位置对象，方便计算
        currentPositions.push({ x: x, y: y, z: z, tx: x, ty: y, tz: z, speed: Math.random() * 0.05 + 0.02 });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 材质
    const material = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        map: getTexture(),
        blending: THREE.AdditiveBlending,
        depthTest: false,
        transparent: true,
        opacity: 0.8
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
    particles = geometry;
}

function changeParticleColors(hexColor) {
    if (!particles) return;
    const colors = particles.attributes.color.array;
    const colorObj = new THREE.Color(hexColor);
    
    for (let i = 0; i < colors.length; i += 3) {
        // 稍微加一点点随机亮度，避免死板
        const hsl = {};
        colorObj.getHSL(hsl);
        const l = hsl.l + (Math.random() - 0.5) * 0.2;
        const newColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, l)));
        
        colors[i] = newColor.r;
        colors[i+1] = newColor.g;
        colors[i+2] = newColor.b;
    }
    particles.attributes.color.needsUpdate = true;
}

function createBackgroundParticles() {
    const bgGeometry = new THREE.BufferGeometry();
    const bgCount = 1000;
    const bgPos = new Float32Array(bgCount * 3);
    
    for(let i=0; i<bgCount; i++){
        bgPos[i*3] = (Math.random() - 0.5) * 400;
        bgPos[i*3+1] = (Math.random() - 0.5) * 400;
        bgPos[i*3+2] = (Math.random() - 0.5) * 400; 
    }
    bgGeometry.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    const bgMat = new THREE.PointsMaterial({
        size: 0.5, color: 0xffffff, transparent: true, opacity: 0.4
    });
    const bgSystem = new THREE.Points(bgGeometry, bgMat);
    scene.add(bgSystem);
}

function getTexture() {
    // 简单的圆形纹理 - 雪花/星星 (白色核心，边缘透明)
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    // 纯白光晕
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function generateGeometries() {
    const count = currentPositions.length;
    
    // 1. 用于“心形”的目标位置
    // 使用更精确的 Heart Surface 公式，确保面朝摄像机 (Y轴向上)
    const scale = 12; // 缩放系数
    let heartPointsFound = 0;
    
    // 为了防止死循环，我们用计数器，但一般随机点足够多
    while(heartPointsFound < count) {
        // 随机采样范围
        const x = (Math.random() - 0.5) * 3 * scale;
        const y = (Math.random() - 0.5) * 3 * scale;
        const z = (Math.random() - 0.5) * 1.5 * scale; // Z轴扁平一点

        const xx = x / scale;
        const yy = y / scale;
        const zz = z / scale;

        // 公式: (x^2 + 9/4z^2 + y^2 - 1)^3 - x^2*y^3 - 9/80*z^2*y^3 <= 0
        // 这里 y 是向上轴
        const a = xx*xx + 2.25*zz*zz + yy*yy - 1;
        
        if (a*a*a - (xx*xx + 0.1125*zz*zz) * yy*yy*yy <= 0) {
             transformTargets.heart.push({x: x, y: y, z: z});
             heartPointsFound++;
        }
    }

    // 2. 其他形状 (Cake, Sphere, Cloud)
    for (let i = 0; i < count; i++) {
        // --- Cake (3 Layers + Candle) ---
        let cx, cy, cz;
        // 使用更具结构化的分布，勾勒轮廓
        // 分配：底层(30%), 中层(25%), 顶层(25%), 蜡烛(5%), 装饰/花边(15%)
        
        const type = Math.random();
        
        if (type < 0.3) {
            // === 底层 (粉色) ===
            // 重点在于边缘轮廓
            const rBase = 12;
            const hBase = 8; // 高度
            const yBase = -12; // 起始Y
            
            const r = (Math.random() > 0.3) ? rBase : (Math.random() * rBase); // 70%概率在表面
            const theta = Math.random() * Math.PI * 2;
            cx = r * Math.cos(theta);
            cz = r * Math.sin(theta);
            cy = yBase + Math.random() * hBase;
        } 
        else if (type < 0.55) {
            // === 中层 (黄色) ===
            const rBase = 8;
            const hBase = 8;
            const yBase = -4; 
            
            const r = (Math.random() > 0.3) ? rBase : (Math.random() * rBase);
            const theta = Math.random() * Math.PI * 2;
            cx = r * Math.cos(theta);
            cz = r * Math.sin(theta);
            cy = yBase + Math.random() * hBase;
        }
        else if (type < 0.8) {
             // === 顶层 (白色) ===
            const rBase = 5;
            const hBase = 6;
            const yBase = 4;
            
            const r = (Math.random() > 0.2) ? rBase : (Math.random() * rBase); // 80%在表面
            const theta = Math.random() * Math.PI * 2;
            cx = r * Math.cos(theta);
            cz = r * Math.sin(theta);
            cy = yBase + Math.random() * hBase;
        }
        else if (type < 0.95) {
            // === 装饰花边 (Cream/Lace) ===
            // 在每一层的连接处生成波浪形圆环
            const layer = Math.random();
            let rRing, yRing;
            
            if (layer < 0.33) {
                // 底层顶部花边
                rRing = 12.5; yRing = -4; 
            } else if (layer < 0.66) {
                // 中层顶部花边
                rRing = 8.5; yRing = 4;
            } else {
                // 顶层顶部花边
                rRing = 5.5; yRing = 10;
            }
            
            const theta = Math.random() * Math.PI * 2;
            // 波浪偏移
            const wave = Math.sin(theta * 12) * 0.5; // 12个波峰
            
            cx = (rRing + wave * 0.5) * Math.cos(theta);
            cz = (rRing + wave * 0.5) * Math.sin(theta);
            cy = yRing + wave; 
        }
        else if (type < 0.98) {
             // === 蜡烛身 ===
             cx = (Math.random() - 0.5) * 0.8; 
             cz = (Math.random() - 0.5) * 0.8;
             cy = 10 + Math.random() * 5; 
        } else {
             // === 蜡烛火焰 ===
             const r = Math.random() * 1.0 * (1 - Math.pow(Math.random(), 2)); 
             const theta = Math.random() * Math.PI * 2;
             cx = r * Math.cos(theta);
             cz = r * Math.sin(theta);
             cy = 15 + Math.random() * 3; 
        }
        transformTargets.cake.push({x: cx, y: cy, z: cz});
        
        // --- Sphere ---
        transformTargets.cake.push({x: cx, y: cy, z: cz});
        
        // --- Sphere ---
        const r_sphere = 20;
        const theta_s = Math.random() * Math.PI * 2;
        const phi_s = Math.acos(2 * Math.random() - 1);
        const xs = r_sphere * Math.sin(phi_s) * Math.cos(theta_s);
        const ys = r_sphere * Math.sin(phi_s) * Math.sin(theta_s);
        const zs = r_sphere * Math.cos(phi_s);
        transformTargets.sphere.push({x: xs, y: ys, z: zs});

        // --- Cloud ---
        const xc = (Math.random() - 0.5) * 160; 
        const yc = (Math.random() - 0.5) * 100;
        const zc = (Math.random() - 0.5) * 100;
        transformTargets.cloud.push({x: xc, y: yc, z: zc});
    }
}

// 动画核心
function animateParticlesTo(shape) {
    let target = [];
    if (shape === 'heart') target = transformTargets.heart;
    if (shape === 'cake') target = transformTargets.cake;
    if (shape === 'sphere') target = transformTargets.sphere;
    // number 和 text 共用 text 目标数组
    if (shape === 'text' || shape === 'number') target = transformTargets.text; 
    if (shape === 'cloud') target = transformTargets.cloud;
    
    // 更新每个粒子的目标
    for(let i=0; i<currentPositions.length; i++) {
        if(target[i]) {
            currentPositions[i].tx = target[i].x;
            currentPositions[i].ty = target[i].y;
            currentPositions[i].tz = target[i].z;
        }
    }
}

function transformToText(textStr) {
    // 复杂，这里简化，不生成文字粒子了，太耗性能
    // 或者用 CSS 覆盖在上面显示文字
    // 既然要求粒子变字，我们先不做那么复杂的FontLoader，
    // 而是简单地让现有粒子保持心形，UI上覆盖文字提示即可，
    // 因为手机性能也是问题。
    // 如果非常需要，可以把心形变成球形表示等待。
    
    // 这里做个简单的：散开一点点
    for(let i=0; i<currentPositions.length; i++) {
        currentPositions[i].tx *= 1.2;
        currentPositions[i].ty *= 1.2;
        currentPositions[i].tz *= 1.2;
    }
}

function explodeParticles() {
    // 爆炸逻辑：所有粒子沿径向飞出，模拟冲击波
    // 确保从中心向外爆
    for(let i=0; i<currentPositions.length; i++) {
        // 当前位置当作起点方向
        // 如果当前位置太靠近 0，给一个随机方向
        let dx = currentPositions[i].x;
        let dy = currentPositions[i].y;
        let dz = currentPositions[i].z;
        
        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1 && Math.abs(dz) < 0.1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dz = Math.random() - 0.5;
        }
        
        // 归一化并放大
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const force = 100 + Math.random() * 200; // 爆炸力度
        
        currentPositions[i].tx = (dx / len) * force;
        currentPositions[i].ty = (dy / len) * force;
        currentPositions[i].tz = (dz / len) * force;
        
        // 快速飞出 -> 改为慢动作飞出
        // 原来是 0.1 + random*0.1，现在减慢到 0.005，极慢
        currentPositions[i].speed = 0.005 + Math.random() * 0.005;
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    controls.update();

    if (particles && state.current >= 2) {
        const positions = particles.attributes.position.array;
        
        for (let i = 0; i < currentPositions.length; i++) {
            const p = currentPositions[i];
            
            // 缓动动画 Lerp
            p.x += (p.tx - p.x) * p.speed;
            p.y += (p.ty - p.y) * p.speed;
            p.z += (p.tz - p.z) * p.speed;
            
            // 加上一点点随机扰动（像呼吸/飘动）
            const time = Date.now() * 0.001;
            const noise = Math.sin(time + i) * 0.05;

            positions[i * 3] = p.x + noise;
            positions[i * 3 + 1] = p.y + noise;
            positions[i * 3 + 2] = p.z + noise;
        }
        
        particles.attributes.position.needsUpdate = true;
        
        // 如果是蛋糕蜡烛场景，可以让蜡烛部分的粒子闪烁（火焰效果）
        // 省略细节优化，通过颜色变化亦可
    }

    renderer.render(scene, camera);
}


// --- 最终书信逻辑 ---
function openLetter() {
    const card = document.getElementById('final-card');
    card.style.transform = "rotateX(180deg)"; // 简单的翻转示意
    card.style.opacity = 0;
    
    setTimeout(() => {
        document.querySelector('.final-card-container').style.display = 'none';
        const letter = document.getElementById('letter-content');
        letter.style.display = 'block';
        
        // 淡入
        let op = 0;
        const fadeInt = setInterval(() => {
            if (op >= 1) clearInterval(fadeInt);
            letter.style.opacity = op;
            op += 0.05;
        }, 30);
        
        // 打字机效果
        typeWriter(letterText, 0);
    }, 500);
}

function typeWriter(text, i) {
    if (i < text.length) {
        if (text.charAt(i) === '\n') {
            typewriterText.innerHTML += '<br>';
        } else {
            typewriterText.innerHTML += text.charAt(i);
        }
        // 自动滚动到底部
        const contentDiv = document.getElementById('letter-content');
        contentDiv.scrollTop = contentDiv.scrollHeight;
        
        setTimeout(() => typeWriter(text, i + 1), 100);
    }
}

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});