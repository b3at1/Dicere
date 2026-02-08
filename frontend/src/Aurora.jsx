// src/Aurora.jsx
import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

// 1) Vertex Shader
const VERT = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 0, 1);
}
`;

// 2) Fragment Shader (Simplex Noise + Color Mixing)
const FRAG = `
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform float uBlend;

varying vec2 vUv;

vec3 permute(vec3 x) {
    return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
            -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    vec3 c1 = uColorStops[0];
    vec3 c2 = uColorStops[1];
    vec3 c3 = uColorStops[2];

    // Increased noise scale and time influence for better visibility
    float noise = snoise(vUv * uAmplitude * 2.5 + uTime * 0.5);
    
    // Create aurora-like bands
    float t = vUv.y + noise * 0.3;
    
    vec3 color = mix(c1, c2, smoothstep(0.0, 1.2, vUv.y)); // Gradient base
    
    // Add the aurora highlight color (c3) based on noise
    // Using a sine wave pattern mixed with noise for "ribbons"
    float ribbon = smoothstep(0.0, 1.0, sin(vUv.y * 10.0 + uTime + noise * 5.0) * 0.5 + 0.5);
    
    color = mix(color, c3, noise * uBlend);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

export default function Aurora({
    colorStops = ["#00d8ff", "#7cff67", "#00d8ff"],
    amplitude = 1.0,
    blend = 0.5,
    speed = 1.0, 
}) {
    const ctnDom = useRef(null);
    const glRef = useRef(null);

    useEffect(() => {
        const ctn = ctnDom.current;
        if (!ctn) return;

        const renderer = new Renderer({
            alpha: true,
            premultipliedAlpha: false,
            dpr: Math.min(window.devicePixelRatio, 2), // Handle retina
        });
        const gl = renderer.gl;
        gl.clearColor(0, 0, 0, 1); // Set clear color to black to avoid transparent background issues
        
        // Handle Resize
        function resize() {
            if (!ctn) return;
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
        window.addEventListener('resize', resize);
        resize();

        // Check if we already have a canvas, if so remove it (cleanup)
        if (ctn.querySelector('canvas')) {
            ctn.innerHTML = '';
        }
        ctn.appendChild(gl.canvas);

        const geometry = new Triangle(gl);

        // Convert hex strings to OGL Color objects (vec3)
        // OGL Color takes standard hex string (e.g. "#ffffff")
        const c1 = new Color(colorStops[0]);
        const c2 = new Color(colorStops[1]);
        const c3 = new Color(colorStops[2]);

        const program = new Program(gl, {
            vertex: VERT,
            fragment: FRAG,
            uniforms: {
                uTime: { value: 0 },
                uAmplitude: { value: amplitude },
                uColorStops: { value: [c1, c2, c3] },
                uBlend: { value: blend }
            },
        });

        const mesh = new Mesh(gl, { geometry, program });
        let animateId;
        let time = 0;

        function update(t) {
            animateId = requestAnimationFrame(update);
            time += 0.005 * speed;  
            program.uniforms.uTime.value = time;
            
            renderer.render({ scene: mesh });
        }
        animateId = requestAnimationFrame(update);

        glRef.current = { renderer, program, mesh };

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animateId);
            if (ctn && gl.canvas.parentNode === ctn) {
                ctn.removeChild(gl.canvas);
            }
        };
    }, [JSON.stringify(colorStops), amplitude, blend, speed]);

    return <div ref={ctnDom} style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none'
    }} />;
}
