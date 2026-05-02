"use client";
import { Mesh, MathUtils, type Texture } from 'three';
import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Center, useTexture } from '@react-three/drei';

type PreviewAngles = {
  azimuth: number;
  tilt: number;
};

type BasePreviewMeshProps = PreviewAngles & {
  color?: string;
  texture?: Texture;
  thickness?: number;
};

type TexturedObjectProps = PreviewAngles & {
  imageUrl: string;
};

type PreviewObjectProps = PreviewAngles & {
  imageUrl: string | null;
};

function BasePreviewMesh({
  azimuth,
  tilt,
  color = '#a3a6ff',
  texture,
  thickness = 0.2,
}: BasePreviewMeshProps) {
  const meshRef = useRef<Mesh>(null);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const targetY = MathUtils.degToRad(azimuth);
    const targetX = MathUtils.degToRad(tilt);

    meshRef.current.rotation.y = MathUtils.damp(
      meshRef.current.rotation.y,
      targetY,
      8,
      delta
    );

    meshRef.current.rotation.x = MathUtils.damp(
      meshRef.current.rotation.x,
      targetX,
      8,
      delta
    );

    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.4) * 0.05;
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[2, 3, thickness]} />
      <meshStandardMaterial
        color={texture ? 'white' : color}
        map={texture}
        roughness={0.25}
        metalness={0.55}
      />
    </mesh>
  );
}

function TexturedObject({ azimuth, tilt, imageUrl }: TexturedObjectProps) {
  const texture = useTexture(imageUrl);
  return <BasePreviewMesh azimuth={azimuth} tilt={tilt} texture={texture} />;
}

function UntexturedObject({ azimuth, tilt }: PreviewAngles) {
  return <BasePreviewMesh azimuth={azimuth} tilt={tilt} color="#a3a6ff" />;
}

function PreviewObject({ azimuth, tilt, imageUrl }: PreviewObjectProps) {
  if (imageUrl) {
    return <TexturedObject azimuth={azimuth} tilt={tilt} imageUrl={imageUrl} />;
  }
  return <UntexturedObject azimuth={azimuth} tilt={tilt} />;
}

export default function ThreeScene({ azimuth, tilt, imageUrl }: { azimuth: number; tilt: number; imageUrl: string | null }) {
  return (
    <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 2]}>
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
      <Center>
        <PreviewObject azimuth={azimuth} tilt={tilt} imageUrl={imageUrl} />
      </Center>
      <ContactShadows position={[0, -2, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      <Environment preset="city" />
      <OrbitControls enableZoom={true} enablePan={false} enableRotate={false} />
    </Canvas>
  );
}
