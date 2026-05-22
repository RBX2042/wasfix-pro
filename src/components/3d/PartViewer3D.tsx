"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Box, Cylinder, Torus, Environment, ContactShadows } from "@react-three/drei";
import { useRef, Suspense } from "react";
import * as THREE from "three";

function PartShape({ category }: { category: string }) {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5;
    }
  });

  const materialProps = { metalness: 0.7, roughness: 0.3 };
  const color = "#1a6b6b";
  const accent = "#c94b2a";

  switch (category) {
    case "PUMP":
      return (
        <group ref={meshRef}>
          <Cylinder args={[0.5, 0.5, 0.45, 16]}>
            <meshStandardMaterial color={color} {...materialProps} />
          </Cylinder>
          <Cylinder args={[0.18, 0.18, 0.7, 8]} position={[0.55, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <meshStandardMaterial color={accent} {...materialProps} />
          </Cylinder>
          <Cylinder args={[0.12, 0.12, 0.5, 8]} position={[0, 0.42, 0]}>
            <meshStandardMaterial color="#444" {...materialProps} />
          </Cylinder>
        </group>
      );
    case "BELT":
      return (
        <group ref={meshRef}>
          <Torus args={[0.65, 0.1, 12, 48]}>
            <meshStandardMaterial color="#222" metalness={0.4} roughness={0.7} />
          </Torus>
          <Torus args={[0.65, 0.06, 8, 48]}>
            <meshStandardMaterial color="#444" metalness={0.4} roughness={0.6} />
          </Torus>
        </group>
      );
    case "HEATING":
      return (
        <group ref={meshRef}>
          <Cylinder args={[0.08, 0.08, 1.6, 8]}>
            <meshStandardMaterial color={color} metalness={0.85} roughness={0.2} />
          </Cylinder>
          <Torus args={[0.32, 0.05, 8, 18]} position={[0, 0.4, 0]}>
            <meshStandardMaterial color={color} metalness={0.85} roughness={0.2} />
          </Torus>
          <Torus args={[0.32, 0.05, 8, 18]} position={[0, -0.4, 0]}>
            <meshStandardMaterial color={color} metalness={0.85} roughness={0.2} />
          </Torus>
          <Box args={[0.4, 0.15, 0.15]} position={[0, 0.85, 0]}>
            <meshStandardMaterial color={accent} {...materialProps} />
          </Box>
        </group>
      );
    case "DOOR":
      return (
        <group ref={meshRef}>
          <Torus args={[0.7, 0.1, 16, 32]}>
            <meshStandardMaterial color="#1a1a2e" metalness={0.85} roughness={0.15} />
          </Torus>
          <Cylinder args={[0.6, 0.6, 0.04, 32]} rotation={[Math.PI / 2, 0, 0]}>
            <meshPhysicalMaterial color="#4fc3f7" transmission={0.6} thickness={0.5} opacity={0.5} transparent />
          </Cylinder>
        </group>
      );
    case "MOTOR":
      return (
        <group ref={meshRef}>
          <Cylinder args={[0.5, 0.5, 0.7, 24]}>
            <meshStandardMaterial color={color} {...materialProps} />
          </Cylinder>
          <Cylinder args={[0.55, 0.55, 0.1, 24]} position={[0, 0.4, 0]}>
            <meshStandardMaterial color="#222" metalness={0.6} roughness={0.4} />
          </Cylinder>
          <Cylinder args={[0.55, 0.55, 0.1, 24]} position={[0, -0.4, 0]}>
            <meshStandardMaterial color="#222" metalness={0.6} roughness={0.4} />
          </Cylinder>
          <Cylinder args={[0.08, 0.08, 1.0, 8]}>
            <meshStandardMaterial color="#777" metalness={0.95} roughness={0.05} />
          </Cylinder>
        </group>
      );
    case "VALVE":
      return (
        <group ref={meshRef}>
          <Box args={[0.6, 0.4, 0.4]}>
            <meshStandardMaterial color={accent} {...materialProps} />
          </Box>
          <Cylinder args={[0.12, 0.12, 0.4, 8]} position={[0.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <meshStandardMaterial color="#999" metalness={0.85} />
          </Cylinder>
          <Cylinder args={[0.12, 0.12, 0.4, 8]} position={[0, -0.32, 0]}>
            <meshStandardMaterial color="#999" metalness={0.85} />
          </Cylinder>
        </group>
      );
    case "BEARING":
      return (
        <group ref={meshRef}>
          <Torus args={[0.5, 0.18, 16, 32]}>
            <meshStandardMaterial color="#888" metalness={0.95} roughness={0.05} />
          </Torus>
          <Cylinder args={[0.32, 0.32, 0.18, 24]} rotation={[Math.PI / 2, 0, 0]}>
            <meshStandardMaterial color="#444" metalness={0.85} roughness={0.15} />
          </Cylinder>
        </group>
      );
    case "FILTER":
      return (
        <group ref={meshRef}>
          <Cylinder args={[0.45, 0.45, 0.5, 12]}>
            <meshStandardMaterial color={color} metalness={0.5} roughness={0.5} />
          </Cylinder>
          <Cylinder args={[0.5, 0.5, 0.08, 24]} position={[0, 0.27, 0]}>
            <meshStandardMaterial color={accent} {...materialProps} />
          </Cylinder>
        </group>
      );
    case "ELECTRONICS":
      return (
        <group ref={meshRef}>
          <Box args={[1, 0.06, 0.7]}>
            <meshStandardMaterial color="#0a4a2a" metalness={0.4} roughness={0.6} />
          </Box>
          {Array.from({ length: 6 }).map((_, i) => (
            <Box key={i} args={[0.08, 0.08, 0.08]} position={[(i % 3) * 0.25 - 0.25, 0.07, Math.floor(i / 3) * 0.2 - 0.1]}>
              <meshStandardMaterial color={i % 2 === 0 ? "#000" : "#444"} metalness={0.5} />
            </Box>
          ))}
        </group>
      );
    case "HOSE":
      return (
        <group ref={meshRef}>
          <Torus args={[0.5, 0.12, 12, 24]}>
            <meshStandardMaterial color="#222" metalness={0.3} roughness={0.7} />
          </Torus>
        </group>
      );
    default:
      return (
        <group ref={meshRef}>
          <Box args={[0.8, 0.8, 0.4]}>
            <meshStandardMaterial color={color} {...materialProps} />
          </Box>
        </group>
      );
  }
}

export default function PartViewer3D({ category = "OTHER" }: { category?: string }) {
  return (
    <div className="w-full h-72 md:h-96 bg-gradient-to-br from-muted to-muted/50 rounded-xl overflow-hidden border">
      <Canvas camera={{ position: [0, 0, 3], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} color="#c94b2a" />
        <Suspense fallback={null}>
          <PartShape category={category} />
          <ContactShadows position={[0, -1, 0]} opacity={0.4} scale={4} blur={2} />
          <Environment preset="studio" />
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.5} />
      </Canvas>
    </div>
  );
}
