"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, RoundedBox, Sphere, Environment, MeshDistortMaterial } from "@react-three/drei";
import { useRef, Suspense } from "react";
import * as THREE from "three";

function WashingMachineModel() {
  const groupRef = useRef<THREE.Group>(null);
  const drumRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.15;
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.05 - 0.5;
    }
    if (drumRef.current) {
      drumRef.current.rotation.z = state.clock.elapsedTime * 1.4;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.5, 0]}>
      {/* Body */}
      <RoundedBox args={[2, 2.2, 1.8]} radius={0.12} position={[0, 0, 0]}>
        <meshStandardMaterial color="#f5f0e8" metalness={0.2} roughness={0.5} />
      </RoundedBox>

      {/* Door ring */}
      <mesh position={[0, 0.05, 0.92]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.06, 32]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.85} roughness={0.15} />
      </mesh>

      {/* Glass */}
      <mesh position={[0, 0.05, 0.96]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.02, 32]} />
        <meshPhysicalMaterial
          color="#4fc3f7"
          metalness={0.1}
          roughness={0.05}
          transmission={0.6}
          thickness={0.5}
          opacity={0.5}
          transparent
        />
      </mesh>

      {/* Spinning drum */}
      <mesh ref={drumRef} position={[0, 0.05, 0.88]}>
        <torusGeometry args={[0.42, 0.05, 8, 24]} />
        <meshStandardMaterial color="#1a6b6b" metalness={0.9} roughness={0.1} emissive="#1a6b6b" emissiveIntensity={0.15} />
      </mesh>

      {/* Display panel */}
      <RoundedBox args={[2, 0.35, 0.18]} radius={0.04} position={[0, 1.25, 0.85]}>
        <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.3} />
      </RoundedBox>

      {/* Display screen */}
      <mesh position={[-0.4, 1.25, 0.96]}>
        <planeGeometry args={[0.7, 0.18]} />
        <meshStandardMaterial color="#00ff9d" emissive="#00ff9d" emissiveIntensity={1.2} />
      </mesh>

      {/* Knob */}
      <mesh position={[0.6, 1.25, 0.97]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.06, 16]} />
        <meshStandardMaterial color="#c94b2a" metalness={0.7} roughness={0.2} />
      </mesh>

      {/* Detergent drawer */}
      <RoundedBox args={[0.8, 0.12, 0.16]} radius={0.02} position={[-0.5, 1.25, 0.92]}>
        <meshStandardMaterial color="#e0e0e0" metalness={0.3} />
      </RoundedBox>

      {/* Feet */}
      {[-0.7, 0.7].map((x, i) => (
        <mesh key={i} position={[x, -1.18, 0.5]}>
          <cylinderGeometry args={[0.09, 0.11, 0.08, 8]} />
          <meshStandardMaterial color="#222" metalness={0.5} />
        </mesh>
      ))}

      {/* Floating water droplets */}
      {Array.from({ length: 6 }).map((_, i) => (
        <Float key={i} speed={1.5 + i * 0.3} rotationIntensity={1} floatIntensity={0.6}>
          <Sphere
            args={[0.05, 12, 12]}
            position={[
              Math.cos((i / 6) * Math.PI * 2) * 1.6,
              Math.sin((i / 6) * Math.PI * 2) * 0.7,
              0.2,
            ]}
          >
            <meshStandardMaterial color="#4fc3f7" emissive="#4fc3f7" emissiveIntensity={0.4} opacity={0.75} transparent />
          </Sphere>
        </Float>
      ))}
    </group>
  );
}

function FloatingAccents() {
  return (
    <>
      <Float speed={2} floatIntensity={1.2} position={[2.6, 1, -1]}>
        <mesh>
          <torusGeometry args={[0.28, 0.07, 8, 14]} />
          <meshStandardMaterial color="#c94b2a" metalness={0.8} roughness={0.25} />
        </mesh>
      </Float>
      <Float speed={3} floatIntensity={1.5} position={[2.2, -0.8, 0]}>
        <Sphere args={[0.18, 16, 16]}>
          <MeshDistortMaterial color="#4fc3f7" distort={0.4} speed={2} opacity={0.7} transparent />
        </Sphere>
      </Float>
      <Float speed={1.5} floatIntensity={0.8} position={[-2.6, 0.5, -1]}>
        <mesh>
          <boxGeometry args={[0.15, 0.6, 0.12]} />
          <meshStandardMaterial color="#1a6b6b" metalness={0.7} roughness={0.3} />
        </mesh>
      </Float>
    </>
  );
}

export default function HeroScene() {
  return (
    <div className="w-full h-[420px] md:h-[500px] lg:h-[560px]">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-5, -2, -3]} intensity={0.4} color="#4fc3f7" />
        <pointLight position={[0, 2, 3]} intensity={0.6} color="#1a6b6b" />

        <Suspense fallback={null}>
          <WashingMachineModel />
          <FloatingAccents />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}
