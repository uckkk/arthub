import React, { Suspense, useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, useGLTF, Center, Html, PerspectiveCamera } from '@react-three/drei';
import { Loader2, RotateCcw, Sun, Moon, Grid3x3, Box, Layers } from 'lucide-react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { convertFileSrc } from '@tauri-apps/api/tauri';

// Auto-rotate component
function AutoRotate({ enabled }: { enabled: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (enabled && ref.current) ref.current.rotation.y += delta * 0.5;
  });
  return <group ref={ref} />;
}

// Fit model to camera view
function FitToView() {
  const { camera, scene } = useThree();
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return;
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    let dist = maxDim / (2 * Math.tan(fov / 2));
    dist *= 1.5;
    camera.position.set(center.x + dist * 0.5, center.y + dist * 0.3, center.z + dist);
    camera.lookAt(center);
    (camera as THREE.PerspectiveCamera).near = dist / 100;
    (camera as THREE.PerspectiveCamera).far = dist * 100;
    camera.updateProjectionMatrix();
  }, [camera, scene]);
  return null;
}
﻿
// Generic model loader
function ModelFromUrl({ url, ext }: { url: string; ext: string }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const [error, setError] = useState('');
  const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([]);
  const [activeAnim, setActiveAnim] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const lowerExt = ext.toLowerCase();
        if (lowerExt === 'gltf' || lowerExt === 'glb') {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const { scene, animations: anims } = await new Promise<any>((ok, fail) => {
            const loader = new GLTFLoader();
            loader.load(url, ok, undefined, fail);
          });
          if (!cancelled) { setObj(scene); if (anims?.length) setAnimations(anims); }
        } else if (lowerExt === 'fbx') {
          const loader = new FBXLoader();
          const result = await new Promise<THREE.Group>((ok, fail) => loader.load(url, ok, undefined, fail));
          if (!cancelled) { setObj(result); if ((result as any).animations?.length) setAnimations((result as any).animations); }
        } else if (lowerExt === 'obj') {
          const loader = new OBJLoader();
          const result = await new Promise<THREE.Group>((ok, fail) => loader.load(url, ok, undefined, fail));
          if (!cancelled) setObj(result);
        } else if (lowerExt === 'stl') {
          const loader = new STLLoader();
          const geo = await new Promise<THREE.BufferGeometry>((ok, fail) => loader.load(url, ok, undefined, fail));
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.6 }));
          if (!cancelled) setObj(mesh);
        }
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.message || 'Load failed';
        // Provide user-friendly error messages
        if (msg.includes('FBX version not supported')) {
          const ver = msg.match(/FileVersion:\s*(\d+)/)?.[1] || '';
          setError(`不支持的 FBX 版本 (${ver})\n仅支持 FBX 7.x (2011+)\n请用 DCC 工具重新导出为 FBX 2014/2019 格式`);
        } else if (msg.includes('Unexpected token')) {
          setError('文件格式解析失败\n文件可能已损坏或格式不正确');
        } else {
          setError(msg);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [url, ext]);

  // Animation mixer
  useEffect(() => {
    if (!obj || animations.length === 0) return;
    const mx = new THREE.AnimationMixer(obj);
    setMixer(mx);
    const action = mx.clipAction(animations[activeAnim]);
    action.play();
    return () => { mx.stopAllAction(); };
  }, [obj, animations, activeAnim]);

  useFrame((_, delta) => { mixer?.update(delta); });

  if (error) return (
    <Html center>
      <div className="flex flex-col items-center gap-2 text-center max-w-xs">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <Box size={24} className="text-red-400" />
        </div>
        {error.split('\n').map((line, i) => (
          <div key={i} className={i === 0 ? 'text-red-400 text-sm font-medium' : 'text-[#888] text-xs'}>
            {line}
          </div>
        ))}
      </div>
    </Html>
  );
  if (!obj) return <Html center><Loader2 className='animate-spin text-white' size={32} /></Html>;
  return <Center><primitive object={obj} /></Center>;
}
﻿
// Main 3D Viewer Component
interface ModelViewerProps {
  filePath: string;
  fileExt: string;
  fileName: string;
}

export default function ModelViewer3D({ filePath, fileExt, fileName }: ModelViewerProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [envPreset, setEnvPreset] = useState<'studio' | 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'apartment' | 'city' | 'park' | 'lobby'>('studio');
  const url = convertFileSrc(filePath);

  const envOptions: { value: typeof envPreset; label: string }[] = [
    { value: 'studio', label: 'Studio' },
    { value: 'sunset', label: 'Sunset' },
    { value: 'dawn', label: 'Dawn' },
    { value: 'warehouse', label: 'Warehouse' },
    { value: 'city', label: 'City' },
    { value: 'park', label: 'Park' },
    { value: 'lobby', label: 'Lobby' },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a] rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none flex items-center gap-2 px-3 py-2 bg-[#111] border-b border-[#222]">
        <span className="text-xs text-[#888] truncate flex-1">{fileName}</span>
        <button onClick={() => setAutoRotate(!autoRotate)}
          className={'p-1.5 rounded transition-colors ' + (autoRotate ? 'bg-[#2563eb]/20 text-[#3b82f6]' : 'text-[#666] hover:text-[#aaa]')}
          title="Auto Rotate"><RotateCcw size={13} /></button>
        <button onClick={() => setShowGrid(!showGrid)}
          className={'p-1.5 rounded transition-colors ' + (showGrid ? 'bg-[#2563eb]/20 text-[#3b82f6]' : 'text-[#666] hover:text-[#aaa]')}
          title="Grid"><Grid3x3 size={13} /></button>
        <button onClick={() => setWireframe(!wireframe)}
          className={'p-1.5 rounded transition-colors ' + (wireframe ? 'bg-[#2563eb]/20 text-[#3b82f6]' : 'text-[#666] hover:text-[#aaa]')}
          title="Wireframe"><Box size={13} /></button>
        <select value={envPreset} onChange={e => setEnvPreset(e.target.value as typeof envPreset)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-[#aaa] px-2 py-1 outline-none">
          {envOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {/* Canvas */}
      <div className="flex-1 relative">
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <PerspectiveCamera makeDefault position={[3, 2, 5]} fov={45} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 5, 5]} intensity={1} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center><Loader2 className="animate-spin text-white" size={32} /></Html>}>
            <Environment preset={envPreset} background={false} />
            <ModelFromUrl url={url} ext={fileExt} />
            <FitToView />
          </Suspense>
          {showGrid && <Grid args={[20, 20]} cellSize={0.5} cellThickness={0.5} cellColor='#333' sectionSize={2} sectionThickness={1} sectionColor='#555' fadeDistance={20} infiniteGrid />}
          <OrbitControls autoRotate={autoRotate} autoRotateSpeed={2} enableDamping dampingFactor={0.1} />
        </Canvas>
      </div>
    </div>
  );
}
