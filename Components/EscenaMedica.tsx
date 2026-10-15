"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Estado que refleja la escena: cambia la velocidad, la apertura de la
 * cápsula y el color del resplandor según lo que ocurre con el documento. */
export type EstadoEscena =
  | "reposo"
  | "procesando"
  | "ok"
  | "revision"
  | "error";

const AJUSTES: Record<
  EstadoEscena,
  { giro: number; separacion: number; brillo: number; intensidad: number }
> = {
  reposo: { giro: 0.22, separacion: 0, brillo: 0x2dd4bf, intensidad: 14 },
  procesando: { giro: 1.5, separacion: 0.5, brillo: 0x5eead4, intensidad: 40 },
  ok: { giro: 0.35, separacion: 0, brillo: 0x34d399, intensidad: 28 },
  revision: { giro: 0.35, separacion: 0.16, brillo: 0xfbbf24, intensidad: 28 },
  error: { giro: 0.12, separacion: 0, brillo: 0xf87171, intensidad: 28 },
};

const COLOR_TEAL = 0x0e8f88;
const COLOR_MARFIL = 0xf4efe4;
const COLOR_CORAL = 0xe9674a;

/** Mitad de cápsula: perfil de revolución con la punta hacia +Y. */
function mediaCapsula(radio: number, largo: number): THREE.LatheGeometry {
  const puntos: THREE.Vector2[] = [];
  const pasos = 28;
  for (let i = 0; i <= pasos; i++) {
    const a = (i / pasos) * (Math.PI / 2);
    puntos.push(new THREE.Vector2(Math.sin(a) * radio, largo + Math.cos(a) * radio));
  }
  puntos.push(new THREE.Vector2(radio, 0));
  return new THREE.LatheGeometry(puntos, 64);
}

/** Tableta con bordes redondeados. */
function tableta(radio: number, alto: number): THREE.LatheGeometry {
  const borde = alto * 0.45;
  const puntos: THREE.Vector2[] = [new THREE.Vector2(0, alto / 2)];
  puntos.push(new THREE.Vector2(radio - borde, alto / 2));
  const pasos = 10;
  for (let i = 1; i <= pasos; i++) {
    const a = (i / pasos) * (Math.PI / 2);
    puntos.push(
      new THREE.Vector2(
        radio - borde + Math.sin(a) * borde,
        alto / 2 - borde + Math.cos(a) * borde,
      ),
    );
  }
  puntos.push(new THREE.Vector2(radio, -alto / 2 + borde));
  for (let i = 1; i <= pasos; i++) {
    const a = (i / pasos) * (Math.PI / 2);
    puntos.push(
      new THREE.Vector2(
        radio - borde + Math.cos(a) * borde,
        -alto / 2 + borde - Math.sin(a) * borde,
      ),
    );
  }
  puntos.push(new THREE.Vector2(0, -alto / 2));
  return new THREE.LatheGeometry(puntos, 56);
}

function material(color: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    ...extra,
  });
}

type Flotante = {
  objeto: THREE.Object3D;
  base: THREE.Vector3;
  amplitud: number;
  velocidad: number;
  fase: number;
  giro: THREE.Vector3;
};

export default function EscenaMedica({ estado }: { estado: EstadoEscena }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const estadoRef = useRef<EstadoEscena>(estado);

  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

  useEffect(() => {
    const host = contenedor.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      host.dataset.fallo = "1";
      return;
    }

    const movimientoReducido = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camara.position.set(0, 0.2, 9.5);

    // Reflejos de estudio sin descargar nada: entorno procedural de three.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    escena.environment = entorno;
    escena.environmentIntensity = 0.9;

    const luzClave = new THREE.DirectionalLight(0xffffff, 2.2);
    luzClave.position.set(3, 4, 5);
    escena.add(luzClave);

    const resplandor = new THREE.PointLight(AJUSTES.reposo.brillo, AJUSTES.reposo.intensidad, 14, 1.6);
    resplandor.position.set(-1.5, -0.5, -2.2);
    escena.add(resplandor);

    const raiz = new THREE.Group();
    escena.add(raiz);

    // ---- Cápsula principal ----
    const radio = 0.62;
    const largo = 0.95;
    const matA = material(COLOR_TEAL);
    const matB = material(COLOR_MARFIL, { roughness: 0.34 });

    const geoA = mediaCapsula(radio, largo);
    const geoB = mediaCapsula(radio * 0.965, largo + 0.3);

    const mitadA = new THREE.Mesh(geoA, matA);
    mitadA.material.side = THREE.DoubleSide;
    const mitadB = new THREE.Mesh(geoB, matB);
    mitadB.material.side = THREE.DoubleSide;
    mitadB.rotation.z = Math.PI;
    mitadB.position.y = 0.3;

    const capsula = new THREE.Group();
    capsula.add(mitadA, mitadB);
    capsula.rotation.z = 0.95;

    const giroCapsula = new THREE.Group();
    giroCapsula.add(capsula);
    giroCapsula.position.set(0.1, 0, 0);
    raiz.add(giroCapsula);

    // ---- Tabletas flotantes ----
    const flotantes: Flotante[] = [];
    const geoTableta = tableta(0.42, 0.17);
    const geoRanura = new THREE.BoxGeometry(0.74, 0.012, 0.03);
    const matRanura = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.18 });

    function agregarTableta(color: number, x: number, y: number, z: number, escala: number, giro: THREE.Vector3) {
      const grupo = new THREE.Group();
      const cuerpo = new THREE.Mesh(geoTableta, material(color, { roughness: 0.4, clearcoat: 0.6 }));
      const ranura = new THREE.Mesh(geoRanura, matRanura);
      ranura.position.y = 0.0855;
      grupo.add(cuerpo, ranura);
      grupo.scale.setScalar(escala);
      grupo.position.set(x, y, z);
      grupo.rotation.set(0.9, 0.3, 0.4);
      raiz.add(grupo);
      flotantes.push({
        objeto: grupo,
        base: grupo.position.clone(),
        amplitud: 0.12 + Math.random() * 0.08,
        velocidad: 0.5 + Math.random() * 0.4,
        fase: Math.random() * Math.PI * 2,
        giro,
      });
    }
    agregarTableta(COLOR_MARFIL, -2.35, 1.35, 0.6, 1, new THREE.Vector3(0.1, 0.35, 0.05));
    agregarTableta(COLOR_CORAL, 2.2, -1.5, 0.9, 0.8, new THREE.Vector3(0.2, -0.3, 0.1));
    agregarTableta(COLOR_TEAL, -1.9, -1.75, -0.3, 0.7, new THREE.Vector3(-0.15, 0.25, 0.2));

    // ---- Molécula ----
    const molecula = new THREE.Group();
    const geoAtomo = new THREE.SphereGeometry(1, 32, 32);
    const geoEnlace = new THREE.CylinderGeometry(0.035, 0.035, 1, 12);
    const matEnlace = material(0xcfe7e3, { roughness: 0.3 });
    const atomos: Array<[number, THREE.Vector3, number]> = [
      [0.26, new THREE.Vector3(0, 0, 0), COLOR_TEAL],
      [0.17, new THREE.Vector3(0.62, 0.38, 0.1), COLOR_MARFIL],
      [0.17, new THREE.Vector3(-0.5, 0.5, -0.2), COLOR_MARFIL],
      [0.2, new THREE.Vector3(0.1, -0.7, 0.25), COLOR_CORAL],
    ];
    atomos.forEach(([r, pos, color], i) => {
      const atomo = new THREE.Mesh(geoAtomo, material(color));
      atomo.scale.setScalar(r);
      atomo.position.copy(pos);
      molecula.add(atomo);
      if (i > 0) {
        const enlace = new THREE.Mesh(geoEnlace, matEnlace);
        const longitud = pos.length();
        enlace.scale.y = longitud;
        enlace.position.copy(pos).multiplyScalar(0.5);
        enlace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
        molecula.add(enlace);
      }
    });
    molecula.position.set(2.45, 1.45, -0.4);
    raiz.add(molecula);
    flotantes.push({
      objeto: molecula,
      base: molecula.position.clone(),
      amplitud: 0.14,
      velocidad: 0.45,
      fase: 1.7,
      giro: new THREE.Vector3(0.1, 0.4, 0.08),
    });

    // ---- Hélice de ADN ----
    const adn = new THREE.Group();
    const geoPunto = new THREE.SphereGeometry(0.075, 20, 20);
    const geoPeldano = new THREE.CylinderGeometry(0.018, 0.018, 1, 8);
    const matHebraA = material(0x5eead4, { roughness: 0.2 });
    const matHebraB = material(COLOR_MARFIL, { roughness: 0.25 });
    const matPeldano = new THREE.MeshStandardMaterial({ color: 0x9bd3cc, transparent: true, opacity: 0.55 });
    const pares = 22;
    const altura = 3.8;
    const radioHelice = 0.34;
    for (let i = 0; i < pares; i++) {
      const t = i / (pares - 1);
      const y = (t - 0.5) * altura;
      const a = t * Math.PI * 3.2;
      const p1 = new THREE.Vector3(Math.cos(a) * radioHelice, y, Math.sin(a) * radioHelice);
      const p2 = new THREE.Vector3(-p1.x, y, -p1.z);
      const e1 = new THREE.Mesh(geoPunto, matHebraA);
      e1.position.copy(p1);
      const e2 = new THREE.Mesh(geoPunto, matHebraB);
      e2.position.copy(p2);
      const peldano = new THREE.Mesh(geoPeldano, matPeldano);
      peldano.scale.y = radioHelice * 2;
      peldano.position.set(0, y, 0);
      peldano.rotation.z = Math.PI / 2;
      peldano.rotation.y = -a;
      adn.add(e1, e2, peldano);
    }
    adn.position.set(-2.9, -0.1, -1.2);
    adn.rotation.z = 0.18;
    raiz.add(adn);

    // ---- Tamaño y bucle ----
    function ajustar() {
      const ancho = Math.max(host!.clientWidth, 1);
      const alto = Math.max(host!.clientHeight, 1);
      renderer.setSize(ancho, alto, false);
      camara.aspect = ancho / alto;
      // En pantallas estrechas se aleja la cámara para que todo quepa.
      camara.position.z = camara.aspect < 0.9 ? 11.5 : camara.aspect < 1.3 ? 9.8 : 8.4;
      camara.updateProjectionMatrix();
    }
    ajustar();

    const puntero = { x: 0, y: 0 };
    function alMoverPuntero(e: PointerEvent) {
      puntero.x = (e.clientX / window.innerWidth) * 2 - 1;
      puntero.y = (e.clientY / window.innerHeight) * 2 - 1;
    }
    if (!movimientoReducido) {
      window.addEventListener("pointermove", alMoverPuntero, { passive: true });
    }

    const colorActual = new THREE.Color(AJUSTES.reposo.brillo);
    const colorObjetivo = new THREE.Color();
    let giroActual: number = AJUSTES.reposo.giro;
    let separacionActual = 0;
    let anguloCapsula = 0.6;
    let visible = true;
    let pestanaActiva = !document.hidden;
    let cuadro = 0;
    let anterior = performance.now();
    let transcurrido = 0;

    function dibujar() {
      const ahora = performance.now();
      const dt = Math.min((ahora - anterior) / 1000, 0.05);
      anterior = ahora;
      transcurrido += dt;
      const t = transcurrido;
      const objetivo = AJUSTES[estadoRef.current];
      const suavizado = 1 - Math.pow(0.001, dt);

      giroActual += (objetivo.giro - giroActual) * suavizado;
      separacionActual += (objetivo.separacion - separacionActual) * suavizado;
      colorObjetivo.setHex(objetivo.brillo);
      colorActual.lerp(colorObjetivo, suavizado);
      resplandor.color.copy(colorActual);
      resplandor.intensity += (objetivo.intensidad - resplandor.intensity) * suavizado;

      anguloCapsula += giroActual * dt;
      giroCapsula.rotation.y = anguloCapsula;
      capsula.position.y = Math.sin(t * 0.9) * 0.12;
      mitadA.position.y = separacionActual;
      mitadB.position.y = 0.3 - separacionActual;

      for (const f of flotantes) {
        f.objeto.position.y = f.base.y + Math.sin(t * f.velocidad + f.fase) * f.amplitud;
        f.objeto.rotation.x += f.giro.x * dt;
        f.objeto.rotation.y += f.giro.y * dt;
        f.objeto.rotation.z += f.giro.z * dt;
      }
      adn.rotation.y += 0.35 * dt;

      raiz.rotation.y += (puntero.x * 0.18 - raiz.rotation.y) * 0.04;
      raiz.rotation.x += (puntero.y * 0.1 - raiz.rotation.x) * 0.04;

      renderer.render(escena, camara);
    }

    function bucle() {
      cuadro = requestAnimationFrame(bucle);
      if (visible && pestanaActiva) dibujar();
    }

    const observador = new ResizeObserver(() => {
      ajustar();
      if (movimientoReducido) dibujar();
    });
    observador.observe(host);

    const interseccion = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
    });
    interseccion.observe(host);

    function alCambiarPestana() {
      pestanaActiva = !document.hidden;
      if (pestanaActiva) anterior = performance.now();
    }
    document.addEventListener("visibilitychange", alCambiarPestana);

    if (movimientoReducido) {
      // Pose fija: un solo fotograma, sin bucle de animación.
      dibujar();
    } else {
      bucle();
    }
    host.dataset.lista = "1";

    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      interseccion.disconnect();
      window.removeEventListener("pointermove", alMoverPuntero);
      document.removeEventListener("visibilitychange", alCambiarPestana);
      escena.traverse((nodo) => {
        if (nodo instanceof THREE.Mesh) {
          const m = nodo.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      [geoA, geoB, geoTableta, geoRanura, geoAtomo, geoEnlace, geoPunto, geoPeldano].forEach((g) => g.dispose());
      entorno.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      delete host.dataset.lista;
    };
  }, []);

  return <div ref={contenedor} className="escena" aria-hidden="true" />;
}
