import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, extend } from '@react-three/fiber'
import { EffectComposer, Bloom, Noise } from '@react-three/postprocessing'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

const VanishingBlockMaterial = shaderMaterial(
  // Uniforms
  {
    u_time: 0,
    u_color: new THREE.Color(0.2, 0.2, 0.2),
    u_background_color: new THREE.Color(0x1e1e1e),
  },
  // Vertex Shader
  /*glsl*/`
    varying vec3 v_normal;
    varying vec3 v_position;
    void main() {
      v_normal = normal;
      v_position = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  /*glsl*/`
    uniform float u_time;
    uniform vec3 u_color;
    uniform vec3 u_background_color;
    varying vec3 v_normal;
    varying vec3 v_position;
    
    // Classic Perlin 3D Noise
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    // Simple lighting calculation
    float calculateLighting(vec3 normal) {
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        float diff = max(dot(normalize(normal), lightDir), 0.0);
        return 0.3 + 0.7 * diff;
    }

    void main() {
      float noise = random(v_position.xy * 2.5 + u_time * 0.2);
      
      float gradient = smoothstep(0.2, 0.9, abs(v_normal.y));
      
      vec3 final_color = mix(u_color, u_background_color, gradient + noise * 0.8);
      
      // Apply lighting
      float lighting = calculateLighting(v_normal);
      final_color *= lighting;
      
      final_color = max(final_color, vec3(0.02, 0.02, 0.02));

      gl_FragColor = vec4(final_color, 1.0);
    }
  `
)

extend({ VanishingBlockMaterial })

const Block = ({ position, color, size, rotationSpeed }) => {
  const ref = useRef()
  const materialRef = useRef()

  useFrame((state, delta) => {
    if(!ref.current) return
    ref.current.rotation.x += delta * rotationSpeed.x
    ref.current.rotation.y += delta * rotationSpeed.y
    if(materialRef.current) {
      materialRef.current.u_time += delta;
    }
  })

  const u_color = useMemo(() => new THREE.Color(color), [color])

  return (
    <mesh ref={ref} position={position} scale={size.map(s => s/2)}>
      <boxGeometry args={[2, 2, 2]} />
      <vanishingBlockMaterial ref={materialRef} u_color={u_color} />
    </mesh>
  )
}

const AnimatedGroup = ({ blocks }) => {
  const groupRef = useRef()

  useFrame((state, delta) => {
    if(groupRef.current) {
      groupRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      {blocks.map((block, i) => (
        <Block key={i} {...block} />
      ))}
    </group>
  );
}

const BlockAnimation = () => {
  const [isWebGL2Supported, setIsWebGL2Supported] = useState(false)
  const [hasCheckedSupport, setHasCheckedSupport] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHasCheckedSupport(true)
      return
    }

    let supported = false
    try {
      const canvas = document.createElement('canvas')
      supported = !!canvas.getContext('webgl2')
    } catch (error) {
      supported = false
    }

    setIsWebGL2Supported(supported)
    setHasCheckedSupport(true)
  }, [])

  if (!hasCheckedSupport || !isWebGL2Supported) {
    return (
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(135deg, rgba(30,30,30,0.85) 0%, rgba(15,15,15,0.9) 50%, rgba(26,26,26,0.85) 100%)',
        }}
      />
    )
  }

  const blocks = useMemo(() => {
    const temp = []
    const colors = ['#666666', '#888888', '#AAAAAA'];
    const minDistance = 3; // Minimum distance between block centers
    
    // Helper function to check if a position is too close to existing blocks
    const isTooClose = (newPos, existingBlocks, newSize) => {
      return existingBlocks.some(block => {
        const distance = Math.sqrt(
          Math.pow(newPos[0] - block.position[0], 2) +
          Math.pow(newPos[1] - block.position[1], 2) +
          Math.pow(newPos[2] - block.position[2], 2)
        );
        // Consider both block sizes for better spacing
        const combinedSize = (Math.max(...newSize) + Math.max(...block.size)) / 2;
        return distance < minDistance + combinedSize;
      });
    };
    
    // Generate blocks with collision detection
    for (let i = 0; i < 15; i++) {
      let position;
      let size = [
        1 + Math.random() * 2, 
        1 + Math.random() * 2, 
        1 + Math.random() * 2
      ];
      let attempts = 0;
      const maxAttempts = 50;
      
      // Try to find a non-overlapping position
      do {
        position = [
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ];
        attempts++;
      } while (isTooClose(position, temp, size) && attempts < maxAttempts);
      
      temp.push({
        position,
        color: colors[Math.floor(Math.random() * colors.length)],
        size,
        rotationSpeed: {
          x: Math.random() * 0.1,
          y: Math.random() * 0.1,
        }
      });
    }
    return temp
  }, [])

  return (
    <div className="absolute inset-0 z-0">
      <Canvas camera={{ position: [0, 0, 10], fov: 50 }}>
        {/* Enhanced lighting setup */}
        <ambientLight intensity={0.15} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-3, 2, 3]} intensity={0.8} color="#4A90E2" />
        <pointLight position={[-5, -5, -10]} intensity={0.6} color="#007BFF" />
        <pointLight position={[8, 8, 8]} intensity={0.4} color="#FF6B6B" />
        
        <AnimatedGroup blocks={blocks} />
        
        <EffectComposer>
          <Bloom luminanceThreshold={0.1} luminanceSmoothing={0.9} height={400} intensity={0.8} />
          <Noise opacity={0.03} />
        </EffectComposer>

        <fog attach="fog" args={['#1E1E1E', 15, 35]} />
      </Canvas>
    </div>
  )
}

export default BlockAnimation 