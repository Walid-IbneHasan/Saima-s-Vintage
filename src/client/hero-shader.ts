/*
 * Hero background shader (progressive enhancement only).
 *
 * Paints a soft, clay-toned organic gradient onto #hero-shader using WebGL.
 * Ported from the Stitch "Heritage Minimalist" design. Lives in the client
 * bundle (not an inline <script>) so it satisfies the strict CSP. If WebGL or
 * the canvas is unavailable, the CSS gradient underneath remains — the hero is
 * fully usable without this. Honours prefers-reduced-motion (single frame).
 */
export function initHeroShader(): void {
  const canvas = document.getElementById('hero-shader');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const gl =
    canvas.getContext('webgl') ||
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
  if (!gl) return;

  const syncSize = (): void => {
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncSize).observe(canvas);
  }
  syncSize();

  const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
  const fs = `precision highp float;
uniform float u_time;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  float noise = sin(uv.x * 3.0 + u_time * 0.2) * cos(uv.y * 3.0 + u_time * 0.3);
  noise += sin(uv.x * 5.0 - u_time * 0.1) * cos(uv.y * 2.0 + u_time * 0.4) * 0.5;
  vec3 color1 = vec3(0.988, 0.976, 0.973); // surface
  vec3 color2 = vec3(0.627, 0.322, 0.176); // clay
  vec3 finalColor = mix(color1, color2, noise * 0.05 + 0.05);
  gl_FragColor = vec4(finalColor, 1.0);
}`;

  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };

  const prog = gl.createProgram();
  const vShader = compile(gl.VERTEX_SHADER, vs);
  const fShader = compile(gl.FRAGMENT_SHADER, fs);
  if (!prog || !vShader || !fShader) return;
  gl.attachShader(prog, vShader);
  gl.attachShader(prog, fShader);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const pos = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'u_time');

  const draw = (t: number): void => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (uTime) gl.uniform1f(uTime, t * 0.001);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    draw(0); // static single frame
    return;
  }

  const render = (t: number): void => {
    if (typeof ResizeObserver === 'undefined') syncSize();
    draw(t);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}
