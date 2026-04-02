/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Hands, Results, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { ANCIENT_SCRIPTS, Theme, ScriptItem } from './constants';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
// Fix for MediaPipe Emscripten error: "Module.arguments has been replaced with plain arguments_"
try {
  delete (window as any).arguments;
} catch (e) {}
(window as any).arguments = undefined;

interface Particle {
  x: number;
  y: number;
  vx: number; // Horizontal velocity
  vy: number; // Vertical velocity
  speed: number;
  item: ScriptItem;
  targetItem?: ScriptItem;
  transitionProgress?: number;
  opacity: number;
  fontSize: number;
  phi: number; // For oscillation
  depth: number; // 0 to 1, for parallax
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  color: string;
}

interface CarvedCharacter {
  x: number;
  y: number;
  item: ScriptItem;
  opacity: number;
  scale: number;
  createdAt: number;
}

interface EffectParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 to 0
  item: ScriptItem;
  fontSize: number;
  rotation: number;
  vRotation: number;
  opacity: number;
  type?: 'WATER' | 'RAIN' | 'FIRE' | 'SPARK' | 'WIND' | 'THUNDER' | 'LOTUS' | 'TREE' | 'SCROLL' | 'EYE' | 'DEFAULT';
  amplitude?: number;
  frequency?: number;
  phase?: number;
  isBubble?: boolean;
}

const THEME_COLORS: Record<Theme, { r: number, g: number, b: number, a: number, glowR: number, glowG: number, glowB: number }> = {
  SACRED: { r: 255, g: 255, b: 210, a: 0.02, glowR: 255, glowG: 215, glowB: 0 },
  LIFE: { r: 180, g: 255, b: 235, a: 0.02, glowR: 64, glowG: 224, glowB: 208 },
  POWER: { r: 255, g: 210, b: 210, a: 0.02, glowR: 255, glowG: 69, glowB: 0 },
  PEACE: { r: 210, g: 230, b: 255, a: 0.02, glowR: 135, glowG: 206, glowB: 250 },
  CREATION: { r: 255, g: 180, b: 255, a: 0.03, glowR: 255, glowG: 105, glowB: 180 },
  WISDOM: { r: 230, g: 210, b: 255, a: 0.02, glowR: 147, glowG: 112, glowB: 219 },
  ORACLE: { r: 255, g: 245, b: 220, a: 0.04, glowR: 139, glowG: 69, glowB: 19 }, // Earthy brown for Oracle Bone
  CONFLICT: { r: 100, g: 0, b: 0, a: 0.05, glowR: 255, glowG: 0, glowB: 0 },
  HARMONY: { r: 255, g: 255, b: 255, a: 0.03, glowR: 0, glowG: 255, glowB: 255 },
  CHAOS: { r: 255, g: 255, b: 255, a: 0.01, glowR: 255, glowG: 255, glowB: 255 }
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const riverCanvasRef = useRef<HTMLCanvasElement>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>('CHAOS');
  const [showThemeName, setShowThemeName] = useState(false);
  const [gestureName, setGestureName] = useState<string>('NONE');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ScriptItem | null>(null);
  const [hoveredItem, setHoveredItem] = useState<ScriptItem | null>(null);
  const [density, setDensity] = useState(1.0);
  const [isPinching, setIsPinching] = useState(false);
  const pullingItemRef = useRef<{ item: ScriptItem, x: number, y: number, progress: number } | null>(null);
  const [globalForce, setGlobalForce] = useState<{vx: number, vy: number, duration: number} | null>(null);
  const particles = useRef<Particle[]>([]);
  const effectParticles = useRef<EffectParticle[]>([]);
  const charOverrideRef = useRef<string | null>(null);
  const charOverrideTimerRef = useRef<number>(0);
  const ripples = useRef<Ripple[]>([]);
  const themeRef = useRef<Theme>('CHAOS');
  const interpolatedTheme = useRef({
    r: 255, g: 255, b: 255, a: 0.01,
    glowR: 255, glowG: 255, glowB: 255
  });
  const latestLandmarks = useRef<any[]>([]);
  const hoverStartTimeRef = useRef<number>(0);
  const lastHoveredItemRef = useRef<ScriptItem | null>(null);
  const smoothedIndexPos = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const clickBuffer = useRef<boolean[]>([]);
  const wasPinching = useRef(false);
  const backgroundFlashRef = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const densityRef = useRef(density);
  const creationRatioRef = useRef(0.5);
  const gestureHistory = useRef<string[]>([]);
  const gestureConfidenceRef = useRef(0);
  const leftHandPos = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const leftHandGesture = useRef<string>('NONE');
  const carvingPath = useRef<{x: number, y: number}[]>([]);
  const carvedCharacters = useRef<CarvedCharacter[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const carvingSoundNode = useRef<AudioNode | null>(null);

  const lerp = (start: number, end: number, amt: number) => start + (end - start) * amt;

  const startCarvingSound = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtx.current;
    if (ctx.state === 'suspended') ctx.resume();

    const bufferSize = ctx.sampleRate * 1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.value = 0.03;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
    carvingSoundNode.current = noise;
  };

  const stopCarvingSound = () => {
    if (carvingSoundNode.current) {
      try {
        (carvingSoundNode.current as AudioBufferSourceNode).stop();
      } catch(e) {}
      carvingSoundNode.current = null;
    }
  };

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  // --- Particle System Logic ---
  const initParticles = (width: number, height: number, currentDensity: number) => {
    const baseCount = Math.floor(width / 15);
    const count = Math.floor(baseCount * currentDensity);
    particles.current = Array.from({ length: count }, () => {
      const depth = Math.random();
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: 0,
        speed: 0.15 + depth * 0.6, // Even slower, more meditative flow
        item: getRandomItem(themeRef.current),
        opacity: 0.2 + depth * 0.6, // Slightly more opaque for clarity
        fontSize: 12 + depth * 36,
        phi: Math.random() * Math.PI * 2,
        depth: depth,
      };
    });
  };

  const getRandomItem = (theme: Theme) => {
    const items = ANCIENT_SCRIPTS[theme];
    if (theme === 'ORACLE') return items[Math.floor(Math.random() * items.length)];
    
    // Dynamic bias: 50% chance to pick a Hieroglyph or Cuneiform if available
    if (Math.random() > 0.5) {
      const ancientItems = items.filter(item => 
        item.meaning.includes('古埃及') || item.meaning.includes('楔形文字')
      );
      if (ancientItems.length > 0) {
        return ancientItems[Math.floor(Math.random() * ancientItems.length)];
      }
    }
    
    return items[Math.floor(Math.random() * items.length)];
  };

  const triggerEffect = (item: ScriptItem) => {
    const canvas = riverCanvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas;
    
    // Clear existing effects to avoid overload
    effectParticles.current = [];

    const count = 80;
    const theme = themeRef.current;
    const char = item.char;
    const meaning = item.meaning;

    // Remove character override for the river to keep it diverse
    // charOverrideRef.current = char;
    charOverrideTimerRef.current = 150;

    // Apply a temporary global force to the main river
    if (meaning.includes('雨') || char === '雨' || (theme === 'LIFE' && !meaning.includes('水') && !meaning.includes('河'))) {
      setGlobalForce({ vx: 0, vy: 14, duration: 150 });
    } else if (meaning.includes('水') || char === '水' || meaning.includes('河') || char === '河') {
      // Water effect: Swaying river force
      setGlobalForce({ vx: 14, vy: 2, duration: 250 });
    } else if (meaning.includes('火') || meaning.includes('炎') || char === '火' || theme === 'POWER') {
      setGlobalForce({ vx: 0, vy: -14, duration: 150 });
    } else if (meaning.includes('风') || char === '风') {
      setGlobalForce({ vx: 18, vy: 3, duration: 180 });
    } else if (meaning.includes('雷') || char === '雷') {
      setGlobalForce({ vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, duration: 50 });
    } else if (meaning.includes('山') || char === '山') {
      setGlobalForce({ vx: 0, vy: -0.8, duration: 200 });
    } else if (meaning.includes('莲花') || char === '𓎛') {
      // Lotus Bloom: Gentle outward expansion
      setGlobalForce({ vx: 0, vy: 0.5, duration: 200 });
    } else if (meaning.includes('木') || char === '木') {
      // Tree Growth: Gentle upward lift
      setGlobalForce({ vx: 0, vy: -0.5, duration: 250 });
    } else if (theme === 'CONFLICT') {
      setGlobalForce({ vx: (Math.random() - 0.5) * 25, vy: (Math.random() - 0.5) * 25, duration: 100 });
    }

    const isFire = meaning.includes('火') || meaning.includes('炎') || char === '火';
    if (isFire) {
      const flameCount = 50; // Significantly reduced for performance
      const centerX = width / 2;
      const centerY = height / 2 + 100;
      
      for (let i = 0; i < flameCount; i++) {
        const baseWidth = 40; 
        const offsetX = (Math.random() - 0.5) * baseWidth;
        const offsetY = (Math.random() - 0.5) * 20;
        const initialLife = 4.0 + Math.random() * 1.5;
        
        effectParticles.current.push({
          x: centerX + offsetX,
          y: centerY + offsetY,
          vx: (Math.random() - 0.5) * 0.2, 
          vy: -(0.1 + Math.random() * 0.2), 
          life: initialLife,
          item: item,
          fontSize: 35 + Math.random() * 25, // Larger particles
          rotation: (Math.random() - 0.5) * 0.5, // Less rotation for better character legibility
          vRotation: (Math.random() - 0.5) * 0.05,
          opacity: 1,
          type: 'FIRE',
          amplitude: offsetX, 
          frequency: Math.random() * 100,
          phase: initialLife, 
        });

        // Fewer sparks
        if (i % 10 === 0) {
          effectParticles.current.push({
            x: centerX + offsetX,
            y: centerY + offsetY,
            vx: (Math.random() - 0.5) * 3,
            vy: -(4 + Math.random() * 6),
            life: 0.8 + Math.random() * 1.0,
            item: item,
            fontSize: 6 + Math.random() * 8,
            rotation: Math.random() * Math.PI * 2,
            vRotation: (Math.random() - 0.5) * 0.3,
            opacity: 1,
            type: 'SPARK',
          });
        }
      }
      return;
    }

    const isEye = char === '𓁻' || meaning.includes('视觉') || meaning.includes('目');
    if (isEye) {
      const eyeWidth = width * 0.5;
      const eyeHeight = height * 0.25;
      const centerX = width / 2;
      const centerY = height / 2;
      
      // Eye outline
      const outlineCount = 60;
      for (let i = 0; i < outlineCount; i++) {
        const angle = (i / outlineCount) * Math.PI * 2;
        const tx = centerX + Math.cos(angle) * eyeWidth / 2;
        const ty = centerY + Math.sin(angle) * eyeHeight / 2;
        
        effectParticles.current.push({
          x: centerX + (Math.random() - 0.5) * 100,
          y: centerY + (Math.random() - 0.5) * 100,
          vx: 0,
          vy: 0,
          life: 3.0,
          item: getRandomItem(theme),
          fontSize: 12 + Math.random() * 10,
          rotation: 0,
          vRotation: 0,
          opacity: 0,
          type: 'EYE',
          amplitude: tx, // Target X
          frequency: ty, // Target Y (base)
          phase: angle, // Angle for blink calculation
        });
      }
      
      // Pupil
      const pupilCount = 40;
      for (let i = 0; i < pupilCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (eyeHeight / 3);
        const tx = centerX + Math.cos(angle) * dist;
        const ty = centerY + Math.sin(angle) * dist;
        
        effectParticles.current.push({
          x: centerX,
          y: centerY,
          vx: 0,
          vy: 0,
          life: 3.0,
          item: item, // Use the eye character for pupil
          fontSize: 16 + Math.random() * 12,
          rotation: 0,
          vRotation: 0.05,
          opacity: 0,
          type: 'EYE',
          amplitude: tx,
          frequency: ty,
          phase: -1, // Pupil flag
        });
      }
      return;
    }

    const isScroll = char === '𓓏' || meaning.includes('卷轴');
    if (isScroll) {
      const scrollWidth = width * 0.7;
      const scrollHeight = height * 0.4;
      const startX = width * 0.85;
      const startY = height / 2 - scrollHeight / 2;
      const rows = 8;
      const cols = 20;
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const targetX = startX - (c * (scrollWidth / cols));
          const y = startY + (r * (scrollHeight / rows)) + (Math.random() - 0.5) * 10;
          
          effectParticles.current.push({
            x: startX,
            y: y,
            vx: 0,
            vy: 0,
            life: 3.0,
            item: getRandomItem(theme),
            fontSize: 14 + Math.random() * 8,
            rotation: 0,
            vRotation: 0,
            opacity: 0,
            type: 'SCROLL',
            amplitude: targetX,
            frequency: c * 4, // Sequential delay
            phase: startX,
          });
        }
      }
      // Add roll particles
      for (let i = 0; i < 25; i++) {
        effectParticles.current.push({
          x: startX,
          y: startY + Math.random() * scrollHeight,
          vx: 0,
          vy: 0,
          life: 3.0,
          item: item,
          fontSize: 24 + Math.random() * 12,
          rotation: 0,
          vRotation: 0.12,
          opacity: 1,
          type: 'SCROLL',
          amplitude: -1, // Roll flag
          frequency: 0,
          phase: startX,
        });
      }
      return;
    }

    const isThunder = meaning.includes('雷') || char === '雷';
    if (isThunder) {
      const strikeCount = 100;
      const startX = width * (0.2 + Math.random() * 0.6);
      let currentX = startX;
      let currentY = -50;
      
      // Create a jagged lightning path
      for (let i = 0; i < strikeCount; i++) {
        const stepY = (height + 100) / strikeCount;
        currentY += stepY;
        // Jagged movement: mostly vertical but with sharp horizontal jumps
        currentX += (Math.random() - 0.5) * 120;
        
        // Add particles along the path
        const pCount = 2 + Math.floor(Math.random() * 3);
        for (let j = 0; j < pCount; j++) {
          const initialLife = 0.6 + Math.random() * 0.4;
          effectParticles.current.push({
            x: currentX + (Math.random() - 0.5) * 30,
            y: currentY + (Math.random() - 0.5) * 30,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            life: initialLife,
            item: item,
            fontSize: 25 + Math.random() * 35,
            rotation: (Math.random() - 0.5) * 1.0,
            vRotation: (Math.random() - 0.5) * 0.2,
            opacity: 0, // Start hidden
            type: 'THUNDER',
            amplitude: initialLife, // Store initial life
            frequency: i * 0.008, // Sequential delay for "劈下" effect
            phase: currentX, // Store original X for slight jitter
          });
        }
      }
      
      // Screen shake and global force
      setGlobalForce({ vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, duration: 150 });
      return;
    }

    const isLotus = meaning.includes('莲花') || char === '𓎛';
    const isTree = meaning.includes('木') || char === '木';
    const isRain = meaning.includes('雨') || char === '雨';
    const effectCount = (isLotus || isTree || isRain) ? 200 : 120; // More particles for special effects
    
    for (let i = 0; i < effectCount; i++) {
      let randomItem = getRandomItem(theme);
      
      let x = Math.random() * width;
      let y = Math.random() * height;
      let vx = 0;
      let vy = 0;
      let life = 1.0;
      let vRotation = (Math.random() - 0.5) * 0.3;
      let amplitude = 0;
      let frequency = 0;
      let phase = 0;
      let isBubble = false;

      // Use the triggered character for special effects like lotus or tree
      if (isLotus || isTree) {
        randomItem = item;
        // Add a core/trunk: particles that stay near the center
        if (isLotus && i < 30) {
          x = width / 2 + (Math.random() - 0.5) * 20;
          y = height / 2 + (Math.random() - 0.5) * 20;
          vx = (Math.random() - 0.5) * 0.5;
          vy = (Math.random() - 0.5) * 0.5;
          life = 3.0 + Math.random() * 1.0;
          amplitude = -1; // Special core flag
        } else if (isTree) {
          // Tree logic is handled in the main if/else block below for structure
        }
      }
      if (isLotus) {
        // Lotus Bloom: Layered petals expanding from center
        const layers = 3;
        const layer = i % layers;
        const petalCount = 8 + layer * 4;
        const petalIndex = Math.floor(i / layers) % petalCount;
        const angleOffset = (petalIndex / petalCount) * Math.PI * 2;
        const angleInPetal = (Math.random() - 0.5) * (Math.PI / petalCount) * 1.2;
        const angle = angleOffset + angleInPetal;
        x = width / 2;
        y = height / 2;
        const speed = (1.5 + layer * 1.5) + Math.random() * 3;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
        life = 2.5 + Math.random() * 1.0;
        vRotation = (Math.random() - 0.5) * 0.05;
        phase = angle;
        amplitude = layer;
      } else if (isTree) {
        // Tree Growth effect: Sequential growth from bottom
        x = width / 2 + (Math.random() - 0.5) * 20;
        y = height + 10 + Math.random() * 50;
        
        const isTrunk = i < 60;
        if (isTrunk) {
          // Trunk particles: move up to different heights and stop
          amplitude = -1; // Trunk moving state
          phase = height - (0.1 + Math.random() * 0.7) * height; // Target height
          vy = -(4 + Math.random() * 6); // Significantly faster growth
          vx = (Math.random() - 0.5) * 0.5;
        } else {
          // Branch particles: move up then branch out
          amplitude = 0; // Branch moving up state
          phase = height - (0.3 + Math.random() * 0.5) * height; // Sprout height
          
          // More vertical bias for branches to avoid "spray" look
          const branchAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.4;
          frequency = branchAngle; // Target angle
          
          vy = -(4 + Math.random() * 6); // Significantly faster growth
          vx = (Math.random() - 0.5) * 0.5;
        }
        life = 3.0 + Math.random() * 1.0; 
        vRotation = (Math.random() - 0.5) * 0.02;
      } else if (meaning.includes('水') || char === '水' || meaning.includes('河') || char === '河') {
        // Water logic
        x = -50 - Math.random() * 400;
        y = (height * 0.3) + Math.random() * (height * 0.4);
        vx = 6 + Math.random() * 10;
        vy = (Math.random() - 0.5) * 2;
        life = 2.5 + Math.random() * 1.0;
        amplitude = 3 + Math.random() * 8;
        frequency = 0.01 + Math.random() * 0.02;
        phase = Math.random() * Math.PI * 2;
        isBubble = Math.random() > 0.7;
      } else if (isRain || (theme === 'LIFE' && !meaning.includes('水') && !meaning.includes('河'))) {
        // Rain logic
        x = Math.random() * width;
        y = -100 - Math.random() * 1000; // Start higher for continuous feel
        vy = 8 + Math.random() * 12; // Slower fall for rain
        vx = (Math.random() - 0.5) * 0.5; // Very little horizontal drift
        life = 2.5 + Math.random() * 1.0; // Longer life for slower fall
        vRotation = (Math.random() - 0.5) * 0.05; // Less rotation for rain
      } else if (meaning.includes('火') || meaning.includes('炎') || char === '火' || theme === 'POWER') {
        // Fire logic: Create a flame shape
        // Particles start at a base and move upwards with some horizontal spread
        const spread = (i / count) * 60; // Wider at bottom, narrower as we go through the loop? No, let's just use random
        x = width / 2 + (Math.random() - 0.5) * 50;
        y = height / 2 + 30;
        
        // Upward velocity with slight random horizontal drift
        vx = (Math.random() - 0.5) * 4;
        vy = -(8 + Math.random() * 12);
        life = 1.0 + Math.random() * 0.8;
        vRotation = (Math.random() - 0.5) * 0.2;
        
        // Store initial offset for flickering
        amplitude = x - width / 2; 
        frequency = 0.1 + Math.random() * 0.2; // Flicker speed
        phase = Math.random() * Math.PI * 2;
      } else if (meaning.includes('风') || char === '风') {
        // Wind logic
        x = -100 - Math.random() * 500;
        y = Math.random() * height;
        vx = 15 + Math.random() * 10;
        vy = (Math.random() - 0.5) * 4;
        life = 3.0;
      } else if (meaning.includes('雷') || char === '雷') {
        // Thunder logic
        x = Math.random() * width;
        y = Math.random() * height;
        vx = (Math.random() - 0.5) * 25;
        vy = (Math.random() - 0.5) * 25;
        life = 1.2;
      } else if (theme === 'PEACE' || theme === 'HARMONY') {
        // Drift effect: Slow drift from center
        x = width / 2 + (Math.random() - 0.5) * 150;
        y = height / 2 + (Math.random() - 0.5) * 150;
        vx = (Math.random() - 0.5) * 5;
        vy = (Math.random() - 0.5) * 5;
        life = 3.0;
      } else if (theme === 'SACRED' || theme === 'ORACLE' || theme === 'WISDOM') {
        // Radiate effect: Burst from center
        x = width / 2;
        y = height / 2;
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 12;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
        life = 3.0;
      } else {
        // Default: Random burst
        x = width / 2 + (Math.random() - 0.5) * 100;
        y = height / 2 + (Math.random() - 0.5) * 100;
        vx = (Math.random() - 0.5) * 10;
        vy = (Math.random() - 0.5) * 10;
        life = 3.0;
      }

      effectParticles.current.push({
        x, y, vx, vy,
        life,
        item: randomItem,
        fontSize: (isTree && i < 60) ? 32 + Math.random() * 16 : 
                  (isLotus || isTree) ? 24 + Math.random() * 32 : 
                  isRain ? 10 + Math.random() * 40 : // High size variation for rain
                  12 + Math.random() * 24,
        rotation: (isTree && i < 60) ? 0 : isRain ? 0 : Math.random() * Math.PI * 2,
        vRotation: (isTree && i < 60) ? 0 : isRain ? 0 : vRotation,
        opacity: (isLotus || isTree) ? 1.0 : 0.9,
        type: (meaning.includes('水') || char === '水' || meaning.includes('河') || char === '河') ? 'WATER' : 
              (meaning.includes('雨') || char === '雨') ? 'RAIN' :
              (meaning.includes('火') || meaning.includes('炎') || char === '火') ? 'FIRE' :
              (meaning.includes('风') || char === '风') ? 'WIND' :
              (meaning.includes('雷') || char === '雷') ? 'THUNDER' : 
              (meaning.includes('莲花') || char === '𓎛') ? 'LOTUS' : 
              (meaning.includes('木') || char === '木') ? 'TREE' : 'DEFAULT',
        amplitude,
        frequency,
        phase,
        isBubble
      });
    }
  };

  const updateParticles = (width: number, height: number) => {
    let speedMult = 1.0;
    
    if (themeRef.current === 'POWER') speedMult = 1.6;
    else if (themeRef.current === 'LIFE') speedMult = 0.6;
    else if (themeRef.current === 'CONFLICT') speedMult = 2.5;
    else if (themeRef.current === 'HARMONY') speedMult = 0.3;
    else if (themeRef.current === 'CREATION') {
      speedMult = lerp(1.6, 0.6, creationRatioRef.current);
    }

    const pList = particles.current;
    
    // Left hand interaction: Aggregation/Dispersion
    const lhPos = leftHandPos.current;
    const lhGesture = leftHandGesture.current;

    for (let i = 0; i < pList.length; i++) {
      const p = pList[i];
      
      if (lhGesture === 'FIST') {
        // Aggregation: Pull towards left hand
        const dx = lhPos.x - p.x;
        const dy = lhPos.y - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 160000) { // 400 * 400
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / 400) * 0.25;
          p.vx += dx * force * 0.08;
          p.vy += dy * force * 0.08;
        }
      } else if (lhGesture === 'OPEN_PALM') {
        // Dispersion: Push away from left hand
        const dx = p.x - lhPos.x;
        const dy = p.y - lhPos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 62500) { // 250 * 250
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / 250) * 0.5;
          p.vx += dx * force * 0.15;
          p.vy += dy * force * 0.15;
        }
      }

      // 1. Basic river flow (Vertical only)
      let flowVy = p.speed * speedMult;
      let flowVx = 0;

      // Apply friction to velocities from hand interaction
      p.vx *= 0.92;
      p.vy *= 0.92;

      // Apply global force if active
      if (globalForce) {
        const forceRatio = globalForce.duration / 150;
        flowVx += globalForce.vx * forceRatio;
        flowVy += globalForce.vy * forceRatio;
        
        // Add some turbulence during force
        if (themeRef.current === 'CONFLICT' || Math.abs(globalForce.vx) > 10 || Math.abs(globalForce.vy) > 10) {
          flowVx += (Math.random() - 0.5) * 5 * forceRatio;
          flowVy += (Math.random() - 0.5) * 5 * forceRatio;
        }
      }

      p.y += flowVy;
      p.x += flowVx;

      // 2. Boundary check & Reset
      if (p.y > height + 50) {
        p.y = -50;
        p.x = Math.random() * width;
        p.phi = Math.random() * Math.PI * 2;
        p.item = getRandomItem(themeRef.current);
      } else if (p.y < -50) {
        p.y = height + 50;
        p.x = Math.random() * width;
      }
      
      if (p.x > width + 50) p.x = -50;
      else if (p.x < -50) p.x = width + 50;
    }

    // Update Global Force and Override Timer
    if (charOverrideTimerRef.current > 0) {
      charOverrideTimerRef.current--;
      if (charOverrideTimerRef.current === 0) charOverrideRef.current = null;
    }

    if (globalForce) {
      if (globalForce.duration > 0) {
        setGlobalForce(prev => prev ? { ...prev, duration: prev.duration - 1 } : null);
      } else {
        setGlobalForce(null);
      }
    }

    // Update Effect Particles
    const eList = effectParticles.current;
    for (let i = eList.length - 1; i >= 0; i--) {
      const ep = eList[i];
      
      // Special swaying motion for water
      if (ep.type === 'WATER') {
        const amp = ep.amplitude || 4;
        const freq = ep.frequency || 0.02;
        const phase = ep.phase || 0;
        ep.vy = Math.sin(ep.x * freq + Date.now() * 0.005 + phase) * amp;
      } else if (ep.type === 'LOTUS') {
        const layer = ep.amplitude || 0;
        
        if (layer === -1) {
          // Core: stay near center with slight drift
          ep.vx *= 0.9;
          ep.vy *= 0.9;
          ep.y -= 0.05; // Gentle rise
        } else {
          // Petals: Slow down and curve
          ep.vx *= 0.96;
          ep.vy *= 0.96;
          
          const angle = ep.phase || 0;
          const progress = 1.0 - ep.life / 5.0;
          const curveFactor = Math.sin(progress * Math.PI) * (0.8 + layer * 0.4);
          
          ep.x += Math.cos(angle + Math.PI/2) * curveFactor;
          ep.y += Math.sin(angle + Math.PI/2) * curveFactor;
          
          if (layer === 0) ep.y -= 0.2;
        }
      } else if (ep.type === 'TREE') {
        const state = ep.amplitude || 0;
        const targetY = ep.phase || 0;
        
        if (state === -1) {
          // Trunk: moving up
          if (ep.y <= targetY) {
            ep.amplitude = -2; // Stopped state
            ep.vx = 0;
            ep.vy = 0;
          }
        } else if (state === -2) {
          // Trunk: stopped
          ep.vx = 0;
          ep.vy = 0;
          ep.vRotation = 0;
        } else if (state === 0) {
          // Branch: moving up
          if (ep.y <= targetY) {
            ep.amplitude = 1; // Spreading state
            const angle = ep.frequency || 0;
            const speed = 1.5 + Math.random() * 2.5; // Controlled spread
            ep.vx = Math.cos(angle) * speed;
            ep.vy = Math.sin(angle) * speed;
          }
        } else if (state === 1) {
          // Branch: spreading
          ep.vx *= 0.97; 
          ep.vy *= 0.97;
          // Add slight sway
          ep.vx += Math.sin(Date.now() * 0.002 + (ep.phase || 0)) * 0.03;
          ep.vy -= 0.02; // Slight upward lift even while spreading
        }

        // Dynamic size variation based on life cycle
        const lifeProgress = ep.life / 9.0; // Normalized life
        const sizePulse = Math.sin(lifeProgress * Math.PI);
        ep.fontSize = (state === -1 || state === -2 ? 30 : 20) * (0.5 + sizePulse * 1.5);
      } else if (ep.type === 'SCROLL') {
        const targetX = ep.amplitude || 0;
        const delay = ep.frequency || 0;
        const startX = ep.phase || 0;
        
        if (targetX === -1) {
          // This is a "roll" particle that moves left to represent the unfolding edge
          const elapsedFrames = (10.0 - ep.life) * 100;
          const currentCol = elapsedFrames / 3;
          const scrollWidth = width * 0.7;
          const cols = 20;
          ep.x = startX - currentCol * (scrollWidth / cols);
          
          if (ep.x < width * 0.1) ep.opacity *= 0.8;
          ep.y += Math.sin(Date.now() * 0.02 + ep.x * 0.1) * 2;
        } else {
          // This is a "body" particle
          if (delay > 0) {
            ep.frequency!--;
            ep.x = startX;
            ep.opacity = 0;
          } else {
            // Move to targetX
            ep.x = lerp(ep.x, targetX, 0.08);
            ep.opacity = lerp(ep.opacity, 1.0, 0.05);
            // Gentle wave
            ep.y += Math.sin(Date.now() * 0.005 + ep.x * 0.02) * 0.4;
          }
        }
      } else if (ep.type === 'FIRE') {
        const initialLife = ep.phase || 4.0;
        const elapsed = initialLife - ep.life;
        const stayDuration = 0.8; 
        
        if (elapsed < stayDuration) {
          // Phase 1: Staying in place, building up
          ep.vy -= 0.03; 
          ep.vx += Math.sin(Date.now() * 0.03 + (ep.frequency || 0)) * 0.5;
          ep.vx *= 0.8;
          ep.fontSize *= 1.01; 
        } else {
          // Phase 2: Spreading and rising
          const spreadFactor = Math.min(1.0, (elapsed - stayDuration) * 1.2);
          ep.vy -= 0.3 * spreadFactor; 
          const spreadDirection = (ep.amplitude || 0) > 0 ? 1 : -1;
          
          // Tapering effect: move towards center as it rises
          const taper = Math.max(0, 1 - (elapsed - stayDuration) / 2);
          ep.vx += spreadDirection * 0.15 * spreadFactor * taper;
          
          ep.vx += Math.sin(Date.now() * 0.015 + (ep.frequency || 0)) * 1.0;
          ep.vx *= 0.92;
          ep.fontSize *= 0.97; // Shrink faster for tapering look
        }
        
        const lifeRatio = ep.life / initialLife; 
        ep.opacity = Math.pow(lifeRatio, 0.5); 
        ep.x += Math.sin(Date.now() * 0.01 + ep.y * 0.04) * 0.8;
        if (ep.life < 0.5) ep.opacity *= 0.8;
      } else if (ep.type === 'SPARK') {
        ep.vy += 0.1; // Gravity
        ep.vx *= 0.98;
        ep.vy *= 0.98;
        ep.opacity *= 0.98;
        ep.fontSize *= 0.99;
      } else if (ep.type === 'THUNDER') {
        const initialLife = ep.amplitude || 1.0;
        const elapsed = initialLife - ep.life;
        const strikeDelay = ep.frequency || 0;
        
        if (elapsed < strikeDelay) {
          ep.opacity = 0;
        } else {
          // Rapid flickering
          const flicker = Math.sin((elapsed - strikeDelay) * 60) > 0 ? 1 : 0.4;
          ep.opacity = flicker * (ep.life / initialLife);
          ep.fontSize *= 1.02; // Slight expansion
          ep.x += (Math.random() - 0.5) * 5; // Jitter
        }
      } else if (ep.type === 'EYE') {
        const tx = ep.amplitude || 0;
        const tyBase = ep.frequency || 0;
        const angle = ep.phase || 0;
        const centerY = height / 2;
        
        // Blink logic: use a sine wave to scale the Y distance from center
        const blinkCycle = Date.now() * 0.002;
        const blinkFactor = Math.max(0.1, Math.abs(Math.sin(blinkCycle)));
        
        let ty = tyBase;
        if (angle !== -1) { // Outline particles
          const dy = tyBase - centerY;
          ty = centerY + dy * blinkFactor;
        } else { // Pupil particles
          // Pupil stays mostly in place but can jitter slightly
          ty = tyBase + Math.sin(Date.now() * 0.01) * 2;
          ep.opacity = blinkFactor > 0.3 ? 1 : 0; // Pupil disappears when eye is closed
        }
        
        ep.x = lerp(ep.x, tx, 0.1);
        ep.y = lerp(ep.y, ty, 0.1);
        ep.opacity = lerp(ep.opacity, angle === -1 ? (blinkFactor > 0.3 ? 1 : 0) : 1, 0.1);
      }

      ep.x += ep.vx;
      ep.y += ep.vy;
      ep.rotation += ep.vRotation;
      ep.life -= 0.01;
      if (ep.life <= 0) {
        eList.splice(i, 1);
      }
    }
  };

  const drawRiver = () => {
    const canvas = riverCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Interpolate theme colors for smooth transition
    let target = THEME_COLORS[themeRef.current];

    // Dynamic CREATION theme blending
    if (themeRef.current === 'CREATION') {
      const power = THEME_COLORS.POWER;
      const life = THEME_COLORS.LIFE;
      const ratio = creationRatioRef.current;
      target = {
        r: lerp(power.r, life.r, ratio),
        g: lerp(power.g, life.g, ratio),
        b: lerp(power.b, life.b, ratio),
        a: lerp(power.a, life.a, ratio),
        glowR: lerp(power.glowR, life.glowR, ratio),
        glowG: lerp(power.glowG, life.glowG, ratio),
        glowB: lerp(power.glowB, life.glowB, ratio),
      };
    }

    const speed = 0.05; // Transition speed
    
    interpolatedTheme.current.r = lerp(interpolatedTheme.current.r, target.r, speed);
    interpolatedTheme.current.g = lerp(interpolatedTheme.current.g, target.g, speed);
    interpolatedTheme.current.b = lerp(interpolatedTheme.current.b, target.b, speed);
    interpolatedTheme.current.a = lerp(interpolatedTheme.current.a, target.a, speed);
    interpolatedTheme.current.glowR = lerp(interpolatedTheme.current.glowR, target.glowR, speed);
    interpolatedTheme.current.glowG = lerp(interpolatedTheme.current.glowG, target.glowG, speed);
    interpolatedTheme.current.glowB = lerp(interpolatedTheme.current.glowB, target.glowB, speed);

    const { r, g, b, a, glowR, glowG, glowB } = interpolatedTheme.current;
    
    const width = canvas.width;
    const height = canvas.height;

    // Background clear with stronger theme tint (30% of theme color for distinct atmosphere)
    ctx.fillStyle = `rgba(${r * 0.25}, ${g * 0.25}, ${b * 0.25}, 0.8)`; 
    ctx.fillRect(0, 0, width, height);

    if (backgroundFlashRef.current > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${backgroundFlashRef.current * 0.2})`;
      ctx.fillRect(0, 0, width, height);
      backgroundFlashRef.current -= 0.03;
    }

    // --- Life Theme: Background Ripples ---
    if (themeRef.current === 'LIFE' && Math.random() < 0.02) {
      ripples.current.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 5,
        maxRadius: 150 + Math.random() * 100,
        opacity: 0.15,
        color: `${glowR}, ${glowG}, ${glowB}`
      });
    }

    // --- Power Theme: Fire Background Perturbation ---
    if (themeRef.current === 'POWER') {
      const t = Date.now() * 0.001; // Slower base speed
      
      // 1. Roiling Fire Gradients (Existing)
      for (let i = 0; i < 2; i++) {
        const flicker = (Math.sin(t * (1.5 + i)) * 0.02 + Math.cos(t * (0.7 - i * 0.3)) * 0.015 + 0.07);
        const shiftX = Math.sin(t * (0.8 + i * 0.4)) * (width * 0.25);
        const shiftY = Math.cos(t * (0.6 + i * 0.5)) * (height * 0.15);
        
        const fireGrad = ctx.createRadialGradient(
          width / 2 + shiftX, height * 0.2 + shiftY, 0,
          width / 2 + shiftX, height * 0.2 + shiftY, height * 0.9
        );
        
        fireGrad.addColorStop(0, `rgba(255, 69, 0, ${flicker * 1.6})`);
        fireGrad.addColorStop(0.5, `rgba(255, 140, 0, ${flicker * 0.8})`);
        fireGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = fireGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Two Distinct Fluctuating Wave Parts (New)
      ctx.save();
      for (let i = 0; i < 2; i++) {
        const waveT = t * (0.8 + i * 0.5);
        const baseY = height * (0.6 + i * 0.2);
        const waveAmp = height * (0.08 + i * 0.04) * (0.8 + Math.sin(t * 0.5) * 0.2);
        const freq = 0.0015 + i * 0.001;
        
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 25) {
          const y = baseY + Math.sin(x * freq + waveT) * waveAmp + Math.cos(x * freq * 0.5 - waveT * 0.7) * (waveAmp * 0.5);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        
        const waveGrad = ctx.createLinearGradient(0, baseY - waveAmp, 0, height);
        const alpha = 0.06 + i * 0.04;
        waveGrad.addColorStop(0, `rgba(255, 50, 0, ${alpha})`);
        waveGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = waveGrad;
        ctx.fill();
      }
      ctx.restore();
    }
    
    // Get index tip for interaction
    const landmarks = latestLandmarks.current;
    const indexTip = landmarks?.[0]?.[8];
    let indexX = -1000;
    let indexY = -1000;

    if (indexTip) {
      // Mirrored X coordinate: (1 - x) * width
      indexX = (1 - indexTip.x) * width;
      indexY = indexTip.y * height;
    }

    // Draw a more pronounced radial gradient based on theme
    const grad = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, width
    );
    // Increased opacity for the center glow (using a multiplier on 'a')
    grad.addColorStop(0, `rgba(${glowR}, ${glowG}, ${glowB}, ${Math.min(a * 6, 0.3)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Draw characters
    const lishuFont = '"LiSu", "SimLi", "STLibaiti", "Ma Shan Zheng", cursive';
    const currentParticles = particles.current;
    const glowColor = `rgba(${glowR}, ${glowG}, ${glowB}, 0.4)`;
    ctx.shadowColor = glowColor;
    
    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i];
      // Magnetic effect & Proximity highlighting
      const dx = p.x - indexX;
      const dy = p.y - indexY;
      const distSq = dx * dx + dy * dy;
      
      let pOpacity = p.opacity;
      
      // Nuanced character transformations based on confidence
      const conf = gestureConfidenceRef.current;
      let pScale = 1.0;
      let pGlow = 8 * p.depth;
      let pX = p.x;
      let pY = p.y;

      // Dynamic density/visibility adjustment for themes
      if (themeRef.current === 'CREATION') {
        const densityMult = lerp(1.3, 0.7, creationRatioRef.current);
        pOpacity *= densityMult;
        pScale = 0.8 + conf * 0.4;
      } else if (themeRef.current === 'POWER') {
        pOpacity *= (1.0 + conf * 0.5);
        pScale = 1.0 + conf * 0.3;
      } else if (themeRef.current === 'LIFE') {
        pOpacity *= (0.5 + conf * 0.5);
        pScale = 0.9 + conf * 0.2;
      } else if (themeRef.current === 'CONFLICT') {
        pOpacity *= 1.5;
        pScale = 1.1 + Math.sin(Date.now() * 0.01) * 0.1; // Jittery effect
      } else if (themeRef.current === 'HARMONY') {
        pOpacity *= 0.8;
        pScale = 1.0;
        // Align characters slightly
        p.vx *= 0.9;
      } else if (themeRef.current === 'SACRED') {
        // Float towards center if high confidence
        const centerX = width / 2;
        const dxC = centerX - p.x;
        pX += dxC * conf * 0.05;
        pScale = 1.0 + conf * 0.2;
      } else if (themeRef.current === 'WISDOM') {
        pOpacity *= (0.7 + conf * 0.3);
        pGlow += conf * 15;
      }

      if (distSq < 22500) { // 150 * 150
        const distToIndex = Math.sqrt(distSq);
        const factor = 1 - (distToIndex / 150);
        // Pull towards finger
        pX -= dx * factor * 0.15;
        pY -= dy * factor * 0.15;
        // Increase visibility and highlight
        pOpacity = Math.min(1, pOpacity + factor * 0.7);
        pGlow += factor * 40; // Stronger glow
        pScale += factor * 0.5; // Scale boost for highlighting
      }

      // Optimization: Only apply shadow if it's significant and close to the viewer
      if (pGlow > 5) {
        ctx.shadowBlur = pGlow; 
      } else {
        ctx.shadowBlur = 0;
      }
      
      ctx.font = `${p.fontSize * pScale}px ${lishuFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      if (p.targetItem && p.transitionProgress !== undefined) {
        p.transitionProgress += 0.03; // Speed of transition
        const progress = Math.max(0, Math.min(1, p.transitionProgress));
        
        // Draw old character fading out
        if (progress < 1) {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pOpacity * (1 - progress)})`;
          ctx.fillText(p.item.char, pX, pY);
        }
        
        // Draw new character fading in
        if (progress > 0) {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pOpacity * progress})`;
          ctx.fillText(p.targetItem.char, pX, pY);
        }

        if (progress >= 1) {
          p.item = p.targetItem;
          p.targetItem = undefined;
          p.transitionProgress = undefined;
        }
      } else {
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pOpacity})`;
        const displayChar = charOverrideRef.current || p.item.char;
        ctx.fillText(displayChar, pX, pY);
      }
    }

    ctx.shadowBlur = 0;

    // Draw Effect Particles
    const eList = effectParticles.current;
    if (eList.length > 0) {
      ctx.save();
      for (let i = 0; i < eList.length; i++) {
        const ep = eList[i];
        let currentGlowR = glowR;
        let currentGlowG = glowG;
        let currentGlowB = glowB;
        
        if (ep.type === 'LOTUS') {
          const layer = ep.amplitude || 0;
          if (layer === -1) {
            // Core: bright yellow-ish pink
            currentGlowR = 255;
            currentGlowG = 220;
            currentGlowB = 180;
          } else {
            // Petals: vary pink based on layer
            currentGlowR = 255;
            currentGlowG = 150 + layer * 20;
            currentGlowB = 200 + layer * 10;
          }
        } else if (ep.type === 'FIRE') {
          const initialLife = ep.phase || 4.0;
          const elapsed = initialLife - ep.life;
          const stayDuration = 0.8;
          
          if (elapsed < stayDuration) {
            // Core: White-hot
            currentGlowR = 255;
            currentGlowG = 255;
            currentGlowB = 220;
          } else {
            // Transition: Yellow -> Orange -> Red
            const progress = (elapsed - stayDuration) / (initialLife - stayDuration);
            if (progress < 0.25) {
              currentGlowR = 255;
              currentGlowG = 240;
              currentGlowB = 100;
            } else if (progress < 0.6) {
              currentGlowR = 255;
              currentGlowG = 160;
              currentGlowB = 40;
            } else {
              currentGlowR = 255;
              currentGlowG = 60;
              currentGlowB = 20;
            }
          }
        } else if (ep.type === 'SPARK') {
          currentGlowR = 255;
          currentGlowG = 255;
          currentGlowB = 100;
        } else if (ep.type === 'TREE') {
          // Unified Vibrant Green for the whole tree
          currentGlowR = 50;
          currentGlowG = 205;
          currentGlowB = 50;
        } else if (ep.type === 'SCROLL') {
          // Golden parchment color
          currentGlowR = 255;
          currentGlowG = 215;
          currentGlowB = 120;
        } else if (ep.type === 'EYE') {
          // Mystical Cyan/White
          currentGlowR = 180;
          currentGlowG = 255;
          currentGlowB = 255;
        } else if (ep.type === 'THUNDER') {
          // Electric Blue/White
          currentGlowR = 200;
          currentGlowG = 230;
          currentGlowB = 255;
        }

        ctx.globalAlpha = ep.life * ep.opacity;
        ctx.fillStyle = `rgba(${currentGlowR}, ${currentGlowG}, ${currentGlowB}, 1)`;
        ctx.font = `${ep.fontSize}px ${lishuFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.save();
        ctx.translate(ep.x, ep.y);
        ctx.rotate(ep.rotation);
        
        // Optimization: Only apply shadow for specific types or if life is high
        const useShadow = eList.length < 80 && ep.type !== 'SCROLL' && ep.type !== 'FIRE';
        
        if (useShadow || ep.type === 'EYE' || ep.type === 'THUNDER') {
          ctx.shadowBlur = ep.type === 'EYE' || ep.type === 'THUNDER' ? 20 : 15;
          ctx.shadowColor = `rgba(${currentGlowR}, ${currentGlowG}, ${currentGlowB}, 0.8)`;
        } else if (ep.type === 'SCROLL') {
          // Use a simpler glow for scroll to save performance
          ctx.shadowBlur = 0; 
          if (ep.opacity > 0.5) {
             ctx.fillStyle = `rgba(${currentGlowR}, ${currentGlowG}, ${currentGlowB}, ${ep.life * ep.opacity * 0.3})`;
             ctx.fillText(ep.item.char, 1, 1); // Simple fake shadow
          }
        } else {
          ctx.shadowBlur = 0;
        }
        
        ctx.fillStyle = `rgba(${currentGlowR}, ${currentGlowG}, ${currentGlowB}, 1)`;
        
        if (ep.isBubble) {
          ctx.beginPath();
          ctx.arc(0, 0, ep.fontSize * 0.2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${currentGlowR}, ${currentGlowG}, ${currentGlowB}, 0.8)`;
          ctx.lineWidth = 1;
          ctx.stroke();
          // Add a tiny highlight
          ctx.beginPath();
          ctx.arc(-ep.fontSize * 0.05, -ep.fontSize * 0.05, 1, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();
        } else {
          // Draw main character
          ctx.fillText(ep.item.char, 0, 0);
          
          // Draw motion trail
          if (Math.abs(ep.vx) > 2 || Math.abs(ep.vy) > 2) {
            ctx.globalAlpha *= 0.5;
            ctx.fillText(ep.item.char, -ep.vx * 0.5, -ep.vy * 0.5);
            ctx.globalAlpha *= 0.5;
            ctx.fillText(ep.item.char, -ep.vx, -ep.vy);
          }
        }
        
        ctx.restore();
      }
      ctx.restore();
    }

    // Draw and update ripples
    if (ripples.current.length > 0) {
      ripples.current = ripples.current.filter(r => r.opacity > 0.01);
      ripples.current.forEach(r => {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r.color}, ${r.opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        r.radius += 2;
        r.opacity *= 0.96;
      });
    }

    // Draw "Pull Out" Animation
    if (pullingItemRef.current) {
      const p = pullingItemRef.current;
      p.progress += 0.06; // Slightly faster speed
      
      const targetX = canvas.width / 2;
      const targetY = canvas.height / 2;
      const currentX = lerp(p.x, targetX, p.progress);
      const currentY = lerp(p.y, targetY, p.progress);

      if (p.progress >= 1.0) {
        // Animation complete, trigger effect and show modal
        triggerEffect(p.item);
        setSelectedItem(p.item);
        
        // Add a massive center shockwave
        ripples.current.push({
          x: targetX,
          y: targetY,
          radius: 20,
          maxRadius: 400,
          opacity: 1.0,
          color: '255, 255, 255'
        });
        
        pullingItemRef.current = null;
      } else {
        // Draw the character being pulled out and moving to center
        ctx.save();
        const scale = 1.0 + p.progress * 6.0; // Grows up to 7x
        const opacity = 1.0; // Keep full opacity for the "grabbed" feel
        const glow = 30 + p.progress * 100;
        
        ctx.translate(currentX, currentY);
        ctx.shadowBlur = glow;
        ctx.shadowColor = `rgba(${glowR}, ${glowG}, ${glowB}, 0.8)`;
        ctx.fillStyle = `rgba(${glowR}, ${glowG}, ${glowB}, ${opacity})`;
        ctx.font = `${32 * scale}px ${lishuFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.item.char, 0, 0);
        ctx.restore();
      }
    }

    updateParticles(width, height);

    animationFrameId.current = requestAnimationFrame(drawRiver);
  };

  // --- Hit Testing for Particles ---
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = riverCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find the particle closest to the click
    let found: Particle | null = null;
    let minDist = 30; // Threshold for clicking

    particles.current.forEach((p) => {
      const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
      if (dist < minDist) {
        minDist = dist;
        found = p;
      }
    });

    if (found) {
      const p = found as Particle;
      // Remove from river immediately
      particles.current = particles.current.filter(part => part !== p);
      
      // Start "pull out" animation instead of immediate effect
      pullingItemRef.current = {
        item: p.item,
        x: p.x,
        y: p.y,
        progress: 0
      };
      
      // Add ripple
      ripples.current.push({
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 100,
        opacity: 0.8,
        color: '255, 255, 255'
      });
    }
  };

  // --- Gesture Detection Logic ---
  const detectGesture = (results: Results) => {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      setGestureName('NONE');
      setCurrentTheme('CHAOS');
      themeRef.current = 'CHAOS';
      return;
    }

    const getHandInfo = (landmarks: any) => {
      const getDistSq = (p1: any, p2: any) => {
        return Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
      };

      // Robust finger extension check: tip distance from wrist vs PIP distance from wrist (3D)
      const isFingerExtended = (wrist: any, tip: any, pip: any) => {
        const dTipWristSq = Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2) + Math.pow(tip.z - wrist.z, 2);
        const dPipWristSq = Math.pow(pip.x - wrist.x, 2) + Math.pow(pip.y - wrist.y, 2) + Math.pow(pip.z - wrist.z, 2);
        return dTipWristSq > dPipWristSq * 1.2;
      };

      const wrist = landmarks[0];
      const thumbTip = landmarks[4];
      const thumbIp = landmarks[3];
      const thumbMcp = landmarks[2];

      // Thumb is special: check distance from pinky base or just extension (3D)
      const thumbExtended = (Math.pow(thumbTip.x - thumbMcp.x, 2) + Math.pow(thumbTip.y - thumbMcp.y, 2) + Math.pow(thumbTip.z - thumbMcp.z, 2)) > 
                            (Math.pow(thumbIp.x - thumbMcp.x, 2) + Math.pow(thumbIp.y - thumbMcp.y, 2) + Math.pow(thumbIp.z - thumbMcp.z, 2)) * 1.1;

      const fingers = [
        isFingerExtended(wrist, landmarks[8], landmarks[6]),  // Index
        isFingerExtended(wrist, landmarks[12], landmarks[10]), // Middle
        isFingerExtended(wrist, landmarks[16], landmarks[14]), // Ring
        isFingerExtended(wrist, landmarks[20], landmarks[18])  // Pinky
      ];
      
      const extendedCount = fingers.filter(f => f).length + (thumbExtended ? 1 : 0);
      
      let type = 'NONE';
      let confidence = extendedCount / 5;

      if (extendedCount >= 4) {
        type = 'OPEN_PALM';
      } else if (extendedCount <= 1 && !thumbExtended) {
        type = 'FIST';
      } else if (thumbExtended && extendedCount === 1) {
        type = 'THUMBS_UP';
      } else if (fingers[0] && fingers[1] && !fingers[2] && !fingers[3] && !thumbExtended) {
        type = 'PEACE';
      } else if (fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]) {
        // More robust index pointing: only index is extended, others are curled
        type = 'INDEX_POINTING';
      }

      return { type, confidence, wrist, fingers, thumbExtended };
    };

    const handInfos = results.multiHandLandmarks.map((landmarks, i) => {
      const info = getHandInfo(landmarks);
      const handedness = results.multiHandedness ? results.multiHandedness[i] : null;
      return { ...info, label: handedness ? handedness.label : 'Unknown' };
    });

    const leftHand = handInfos.find(h => h.label === 'Left');
    const rightHand = handInfos.find(h => h.label === 'Right');

    // --- CRITICAL: Require BOTH hands for interaction ---
    if (!leftHand || !rightHand) {
      // Reset all interaction states if one hand is missing
      setIsPinching(false);
      setHoveredItem(null);
      setSelectedItem(null);
      wasPinching.current = false;
      gestureConfidenceRef.current = 0;
      if (gestureHistory.current.length > 0) {
        gestureHistory.current.shift();
      }
      return;
    }

    // --- 1. Interaction Logic (Right Hand) ---
    // Right hand only handles index finger selection
    const rightIdx = handInfos.indexOf(rightHand);
    const primaryLandmarks = results.multiHandLandmarks[rightIdx];
    
    // Index Finger landmarks for pointing
    const indexTip = primaryLandmarks[8];
    
    // Click detection: Triggered when BOTH index and middle fingers are extended (and others are curled)
    // Hover is active when at least index finger is extended (and others are curled)
    const isPointing = rightHand.fingers[0] && !rightHand.fingers[2] && !rightHand.fingers[3];
    const isClicking = rightHand.fingers[0] && rightHand.fingers[1] && !rightHand.fingers[2] && !rightHand.fingers[3];
    
    const rawClicking = isClicking;
    
    // Debounce click state
    clickBuffer.current.push(rawClicking);
    if (clickBuffer.current.length > 5) clickBuffer.current.shift();
    const currentlyClicking = clickBuffer.current.filter(c => c).length >= 4;
    
    setIsPinching(currentlyClicking);

    // Hover detection (closest to index tip)
    const canvas = riverCanvasRef.current;
    if (canvas && isPointing) {
      // Smoothing for cursor position to reduce jitter
      const rawX = (1 - indexTip.x) * canvas.width;
      const rawY = indexTip.y * canvas.height;
      
      if (smoothedIndexPos.current.x === 0 && smoothedIndexPos.current.y === 0) {
        smoothedIndexPos.current.x = rawX;
        smoothedIndexPos.current.y = rawY;
      } else {
        smoothedIndexPos.current.x = lerp(smoothedIndexPos.current.x, rawX, 0.3);
        smoothedIndexPos.current.y = lerp(smoothedIndexPos.current.y, rawY, 0.3);
      }
      
      const x = smoothedIndexPos.current.x;
      const y = smoothedIndexPos.current.y;
      
      let closest: Particle | null = null;
      let minHoverDistSq = 6400; // 80 * 80

      const pList = particles.current;
      for (let i = 0; i < pList.length; i++) {
        const p = pList[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const dSq = dx * dx + dy * dy;
        if (dSq < minHoverDistSq) {
          minHoverDistSq = dSq;
          closest = p;
        }
      }
      if (closest) {
        if (lastHoveredItemRef.current === closest.item) {
          const hoverDuration = Date.now() - hoverStartTimeRef.current;
          if (hoverDuration > 500) {
            // Trigger a subtle ripple
            const conf = gestureConfidenceRef.current || 0.5;
            const { glowR, glowG, glowB } = interpolatedTheme.current;
            ripples.current.push({
              x: closest.x,
              y: closest.y,
              radius: 5,
              opacity: 0.3 + conf * 0.4,
              color: `${glowR}, ${glowG}, ${glowB}`
            });
            // Reset timer so it doesn't spam ripples, or we could add a cooldown
            hoverStartTimeRef.current = Date.now(); 
          }
        } else {
          lastHoveredItemRef.current = closest.item;
          hoverStartTimeRef.current = Date.now();
        }
      } else {
        lastHoveredItemRef.current = null;
        hoverStartTimeRef.current = 0;
      }

      setHoveredItem(closest ? closest.item : null);
    }

    // Trigger click on click start
    if (currentlyClicking && !wasPinching.current) {
      if (canvas) {
        const x = smoothedIndexPos.current.x;
        const y = smoothedIndexPos.current.y;
        
        let found: Particle | null = null;
        let minDistSq = 2500; // 50 * 50

        const pList = particles.current;
        for (let i = 0; i < pList.length; i++) {
          const p = pList[i];
          const dx = p.x - x;
          const dy = p.y - y;
          const dSq = dx * dx + dy * dy;
          if (dSq < minDistSq) {
            minDistSq = dSq;
            found = p;
          }
        }

        if (found) {
          const p = found as Particle;
          // Remove from river immediately
          particles.current = particles.current.filter(part => part !== p);

          // Start "pull out" animation instead of immediate effect
          pullingItemRef.current = {
            item: p.item,
            x: p.x,
            y: p.y,
            progress: 0
          };
          
          // Add ripple
          ripples.current.push({
            x: p.x,
            y: p.y,
            radius: 10,
            maxRadius: 100,
            opacity: 0.8,
            color: '255, 255, 255'
          });
        }
      }
    } else if (!currentlyClicking && wasPinching.current) {
      setSelectedItem(null);
    }
    wasPinching.current = currentlyClicking;

    // --- 2. Theme/Gesture Logic (Left Hand) ---
    // Left hand only handles gesture switching
    let detected: string = leftHand.type;
    gestureConfidenceRef.current = leftHand.confidence;

    // Update left hand position and gesture for particle interaction
    const leftIdx = handInfos.indexOf(leftHand);
    const leftLandmarks = results.multiHandLandmarks[leftIdx];
    const leftWrist = leftLandmarks[0];
    const riverCanvas = riverCanvasRef.current;
    if (riverCanvas) {
      leftHandPos.current = {
        x: (1 - leftWrist.x) * riverCanvas.width,
        y: leftWrist.y * riverCanvas.height
      };
    }
    leftHandGesture.current = detected;

    // Smoothing: Use a buffer to stabilize gesture detection
    gestureHistory.current.push(detected);
    if (gestureHistory.current.length > 12) { // Increased buffer for better stability
      gestureHistory.current.shift();
    }

    // Find the most frequent gesture in the buffer
    const counts: Record<string, number> = {};
    gestureHistory.current.forEach(g => {
      if (g) counts[g] = (counts[g] || 0) + 1;
    });
    
    // Find max count
    let maxCount = 0;
    let smoothedDetected = 'NONE';
    for (const g in counts) {
      if (counts[g] > maxCount) {
        maxCount = counts[g];
        smoothedDetected = g;
      }
    }

    // Requirement: Must be the same gesture for at least 75% of the buffer (9/12)
    if (maxCount < 9) {
      smoothedDetected = gestureName; // Keep current if not stable enough
    }

    if (smoothedDetected !== gestureName) {
      setGestureName(smoothedDetected);
      const themeMap: Record<string, Theme> = {
        PRAYER: 'SACRED',
        OPEN_PALM: 'LIFE',
        FIST: 'WISDOM',
        PEACE: 'PEACE',
        POWER_LIFE: 'CREATION',
        LIFE_POWER: 'CONFLICT',
        DUAL_PEACE: 'HARMONY',
        THUMBS_UP: 'POWER',
        INDEX_POINTING: 'ORACLE',
        NONE: 'CHAOS'
      };
      const newTheme = themeMap[smoothedDetected] || 'CHAOS';
      
      setCurrentTheme(prev => {
        if (prev !== newTheme) {
          themeRef.current = newTheme;

          const canvas = riverCanvasRef.current;
          if (canvas) {
            // Gradual transformation of all characters in the river
            const pList = particles.current;
            for (let i = 0; i < pList.length; i++) {
              const p = pList[i];
              p.targetItem = getRandomItem(newTheme);
              // Stagger the start of the transition based on X position for a "wave" effect
              // We'll use a negative progress to delay the start
              p.transitionProgress = -(p.x / canvas.width) * 0.5; 
            }

            // Add a large central ripple for dramatic feedback
            backgroundFlashRef.current = 1.0;
            setShowThemeName(true);
            setTimeout(() => setShowThemeName(false), 1500);
            ripples.current.push({
              x: canvas.width / 2,
              y: canvas.height / 2,
              radius: 20,
              maxRadius: Math.max(canvas.width, canvas.height),
              opacity: 0.6,
              color: '255, 255, 255'
            });
          }
          return newTheme;
        }
        return prev;
      });
    }
  };

  // --- Initialization ---
  useEffect(() => {
    const canvas = riverCanvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles(canvas.width, canvas.height, densityRef.current);
      drawRiver();
    }

    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
      },
    });

    hands.onResults((results) => {
      detectGesture(results);
      
      // Prioritize Right Hand for river interaction (magnetic effects, etc.)
      if (results.multiHandLandmarks && results.multiHandedness) {
        const rightIdx = results.multiHandedness.findIndex(h => h.label === 'Right');
        if (rightIdx !== -1) {
          // Put right hand at index 0 for the river drawing logic
          const ordered = [...results.multiHandLandmarks];
          const rightHand = ordered.splice(rightIdx, 1)[0];
          ordered.unshift(rightHand);
          latestLandmarks.current = ordered;
        } else {
          latestLandmarks.current = results.multiHandLandmarks;
        }
      } else {
        latestLandmarks.current = [];
      }
      
      const canvasCtx = canvasRef.current?.getContext('2d');
      if (canvasCtx && canvasRef.current) {
        const mpWidth = canvasRef.current.width;
        const mpHeight = canvasRef.current.height;
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, mpWidth, mpHeight);
        if (results.multiHandLandmarks) {
          for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: 'rgba(255, 255, 255, 0.3)', lineWidth: 1 });
            
            // Draw Glowy Light Point at Index Tip (Only for Right Hand)
            const handedness = results.multiHandedness?.[results.multiHandLandmarks.indexOf(landmarks)];
            if (handedness?.label === 'Right') {
              const indexTip = landmarks[8];
              const x = indexTip.x * mpWidth;
              const y = indexTip.y * mpHeight;
              
              // Outer Glow
              const glowRadius = isPinching ? 30 : 20;
              const glow = canvasCtx.createRadialGradient(x, y, 0, x, y, glowRadius);
              glow.addColorStop(0, isPinching ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.4)');
              glow.addColorStop(0.5, isPinching ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)');
              glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
              
              canvasCtx.beginPath();
              canvasCtx.arc(x, y, glowRadius, 0, Math.PI * 2);
              canvasCtx.fillStyle = glow;
              canvasCtx.fill();
              
              // Core Point
              canvasCtx.beginPath();
              canvasCtx.arc(x, y, isPinching ? 6 : 4, 0, Math.PI * 2);
              canvasCtx.fillStyle = 'white';
              canvasCtx.shadowBlur = 10;
              canvasCtx.shadowColor = 'white';
              canvasCtx.fill();
              canvasCtx.shadowBlur = 0;
              
              // Pointer Ring
              canvasCtx.beginPath();
              canvasCtx.arc(x, y, isPinching ? 12 : 8, 0, Math.PI * 2);
              canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              canvasCtx.lineWidth = 1;
              canvasCtx.stroke();
              
              // Draw "Click" Ring
              if (isPinching) {
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, 25, 0, Math.PI * 2);
                canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                canvasCtx.setLineDash([5, 5]);
                canvasCtx.stroke();
                canvasCtx.setLineDash([]);
              }
            }
          }
        }
        canvasCtx.restore();
      }
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    let camera: Camera | null = null;
    if (videoRef.current) {
      camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            try {
              await hands.send({ image: videoRef.current });
            } catch (err) {
              console.error("Hands send error:", err);
            }
          }
        },
        width: 640,
        height: 480,
      });

      // Add a small delay to ensure WASM is ready before starting the camera
      var startTimeout = setTimeout(() => {
        camera?.start()
          .then(() => {
            setIsCameraActive(true);
            setCameraError(null);
          })
          .catch((err) => {
            console.error("Camera start error:", err);
            if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
              setCameraError("摄像头权限被拒绝。请在浏览器地址栏点击摄像头图标允许访问，或点击下方按钮尝试在独立窗口打开。");
            } else {
              setCameraError("无法启动摄像头。请检查设备连接或权限设置。");
            }
          });
      }, 1500);
    }

    const handleResize = () => {
      const canvas = riverCanvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initParticles(canvas.width, canvas.height, densityRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      if (startTimeout) clearTimeout(startTimeout);
      window.removeEventListener('resize', handleResize);
      if (camera) camera.stop();
      hands.close();
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  // Handle density changes
  useEffect(() => {
    const canvas = riverCanvasRef.current;
    if (canvas) {
      initParticles(canvas.width, canvas.height, density);
    }
  }, [density]);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans text-white">
      {/* Background River Canvas with Zoom & Depth Effect */}
      <motion.div
        className="absolute inset-0 w-full h-full"
      >
        <canvas
          ref={riverCanvasRef}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-pointer pointer-events-auto"
        />
      </motion.div>

      {/* Overlay UI */}
      <div className="absolute inset-0 flex flex-col items-center justify-between p-8 pointer-events-none">
        {/* Top: Removed Theme Indicator as requested */}
        <div className="mt-12" />

        {/* Center: Interactive Hint (Only if no gesture detected) */}
        {gestureName === 'NONE' && !selectedItem && !hoveredItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center max-w-md"
          >
            <p className="text-sm font-light text-white/20 leading-relaxed">
              Use both hands to start interaction.<br/>
              Left hand: Change theme with gestures.<br/>
              Right hand: Select character with index finger.<br/>
              <span className="italic tracking-widest uppercase text-[10px] mt-2 block">双掌齐出 开启探索 | 左手易势 右手点选</span>
            </p>
          </motion.div>
        )}

        {/* Hovered Item Highlight UI removed as requested */}

        {/* Bottom Right: Camera Feed (Made smaller as requested) */}
        <div className="absolute bottom-8 right-8 flex flex-col items-end gap-6 pointer-events-auto">
          {/* Density Control */}
          <div className="flex flex-col items-end gap-2 bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/5 shadow-xl">
            <span className="text-[8px] uppercase tracking-[0.3em] text-white/30">River Density</span>
            <input 
              type="range" 
              min="0.2" 
              max="3.0" 
              step="0.1" 
              value={density} 
              onChange={(e) => setDensity(parseFloat(e.target.value))}
              className="w-32 accent-white/40 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            />
          </div>

          <div className="relative w-40 h-30 rounded-xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-sm shadow-2xl">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover opacity-60 scale-x-[-1]"
              autoPlay
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
            />
            {!isCameraActive && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-[8px] text-white/30 uppercase tracking-widest">
                Init...
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 p-2 text-center">
                <p className="text-[8px] text-white leading-tight mb-2">{cameraError}</p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-2 py-1 bg-white/20 text-white text-[8px] rounded hover:bg-white/30 transition-colors border border-white/20"
                  >
                    重试
                  </button>
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-2 py-1 bg-white text-black text-[8px] rounded hover:bg-white/80 transition-colors"
                  >
                    新窗口打开
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {gestureName !== 'NONE' && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-right"
            >
              <span className="text-[8px] uppercase tracking-[0.3em] text-white/20 block">Gesture</span>
              <span className="text-xs font-mono tracking-wider text-white/60">{gestureName.replace('_', ' ')}</span>
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showThemeName && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.2, y: -20 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          >
            <div className="text-center">
              <h2 className="text-8xl font-ancient text-white/20 tracking-[0.5em] uppercase blur-sm">
                {currentTheme}
              </h2>
              <p className="text-[10px] tracking-[1em] text-white/10 mt-4 uppercase">
                Theme Transformation
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Explore Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none overflow-hidden"
            onClick={() => setSelectedItem(null)}
          >
            {/* Central Glow - Made more intense for depth */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15)_0%,transparent_80%)]" />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.5, filter: "blur(10px)" }}
              animate={{ 
                opacity: 1, 
                scale: 1, 
                filter: "blur(0px)",
                y: [0, -20, 0],
                rotate: 0
              }}
              exit={{ opacity: 0, scale: 0.1, y: 100, rotate: 10 }}
              transition={{ 
                type: 'spring', 
                damping: 18, 
                stiffness: 90,
                y: {
                  repeat: Infinity,
                  duration: 5,
                  ease: "easeInOut"
                }
              }}
              className="text-center space-y-12 pointer-events-auto relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Decorative Halo */}
              <motion.div 
                animate={{ 
                  scale: [1, 1.1, 1],
                  opacity: [0.3, 0.6, 0.3],
                  rotate: 360
                }}
                transition={{ 
                  duration: 10, 
                  repeat: Infinity, 
                  ease: "linear" 
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30rem] h-[30rem] border border-white/5 rounded-full pointer-none"
              >
                <div className="absolute inset-0 border border-white/10 rounded-full scale-90 opacity-50" />
                <div className="absolute inset-0 border border-white/5 rounded-full scale-110 opacity-30" />
              </motion.div>

              <div className="relative">
                <motion.div
                  animate={{ 
                    textShadow: [
                      "0 0 40px rgba(255,255,255,0.4)",
                      "0 0 80px rgba(255,255,255,0.7)",
                      "0 0 40px rgba(255,255,255,0.4)"
                    ]
                  }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="text-[18rem] font-ancient text-white leading-none select-none drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                >
                  {selectedItem.char}
                </motion.div>
              </div>

              <div className="space-y-6 relative z-20">
                <div className="flex flex-col items-center space-y-2">
                  <span className="w-12 h-[1px] bg-white/20 mb-2" />
                  <h3 className="text-[13px] uppercase tracking-[0.8em] text-white/40 font-light">Ancient Script</h3>
                  <span className="w-12 h-[1px] bg-white/20 mt-2" />
                </div>
                <p className="text-5xl font-light tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)] max-w-2xl mx-auto">
                  {selectedItem.meaning}
                </p>
              </div>

              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.1)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedItem(null)}
                className="mt-20 px-14 py-4 rounded-full border border-white/10 text-[12px] uppercase tracking-[0.5em] text-white/50 hover:text-white hover:border-white/40 transition-all backdrop-blur-md"
              >
                Return to Flow
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project Advice Modal / Section */}
      <div className="absolute top-4 right-4 pointer-events-auto">
        <button 
          onClick={() => {
            const el = document.getElementById('advice-panel');
            if (el) el.classList.toggle('hidden');
          }}
          className="text-[10px] uppercase tracking-widest text-white/20 hover:text-white/60 transition-colors"
        >
          Project Advice & Font Guide
        </button>
      </div>

      <div id="advice-panel" className="hidden absolute inset-0 z-50 bg-black/95 backdrop-blur-2xl p-12 overflow-y-auto pointer-events-auto">
        <div className="max-w-3xl mx-auto space-y-16 py-12">
          <div className="flex justify-between items-start border-b border-white/10 pb-8">
            <div>
              <h2 className="text-5xl font-light tracking-tight mb-2">Next Steps</h2>
              <p className="text-white/30 uppercase tracking-[0.3em] text-xs">Implementation Guide</p>
            </div>
            <button 
              onClick={() => document.getElementById('advice-panel')?.classList.add('hidden')}
              className="text-white/40 hover:text-white text-sm uppercase tracking-widest"
            >
              Close [ESC]
            </button>
          </div>

          <section className="space-y-6">
            <h3 className="text-2xl font-medium text-white/90">如何导入您的自定义字体？</h3>
            <div className="bg-white/5 p-8 rounded-2xl space-y-4 font-mono text-sm border border-white/5">
              <p className="text-white/40 mb-4">// 1. 在 src/index.css 中添加以下代码</p>
              <pre className="text-emerald-400">
{`@font-face {
  font-family: 'MyAncientFont';
  src: url('./assets/fonts/your-font-file.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}`}
              </pre>
              <p className="text-white/40 mt-8">// 2. 在 App.tsx 的 Canvas 绘制逻辑中修改字体名称</p>
              <pre className="text-sky-400">
{`ctx.font = \`\${p.fontSize}px "MyAncientFont", sans-serif\`;`}
              </pre>
            </div>
            <p className="text-white/60 leading-relaxed">
              导入后，Canvas 将会使用您的自定义字体渲染所有古文字。请确保字体文件已放入项目目录，并正确引用路径。
            </p>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-white/80">1. 视觉进阶：流体动力学</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                目前文字是线性下落。下一步可以引入 <b>Simplex Noise</b> 或 <b>Vector Fields</b>，让文字像真实的流水一样绕过您的手势，或者在点击时产生涟漪扩散效果。
              </p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-white/80">2. 交互进阶：手势组合</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                增加“双手联动”逻辑。例如：左手握拳（力量）+ 右手平摊（生命）= 创造出一种全新的混合主题文字。这会极大增加程序的探索深度。
              </p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-white/80">3. 性能优化：Instanced Rendering</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                如果文字数量增加到数千个，建议切换到 <b>Three.js</b> 的 InstancedMesh。这能让您在保持 60FPS 的同时，为每个文字添加 3D 旋转和深度感。
              </p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-white/80">4. 跨媒介尝试：投影艺术</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                将此程序投影到实体墙面或水幕上。通过调整摄像头的对比度，可以实现观众在墙前挥手，文字随之起舞的沉浸式公共艺术装置。
              </p>
            </div>
          </section>

          <div className="pt-12 border-t border-white/10 text-center">
            <p className="text-[10px] uppercase tracking-[0.5em] text-white/20">Ancient Script River v2.0</p>
          </div>
        </div>
      </div>
    </div>
  );
}
