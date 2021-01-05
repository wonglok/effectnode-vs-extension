import ReactDOM from 'react-dom';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from 'react-three-fiber';
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { AnimationMixer, MathUtils, Vector3 } from 'three';
import * as THREE from 'three';
import { getMouseDegrees } from './utils';
import { getFirstTouchPos, getMousePos } from "./utils";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import create from 'zustand';

// CustomEvent
/* global document acquireVsCodeApi window Uint8Array console Blob CustomEvent URL setTimeout */
const vscode = window.acquireVsCodeApi();
let AppGlobals = {
	gl: false,
	lookAtMouse: false
};

const useActors = create((set, get) => {
	let idx = 0;
	let val = window.localStorage.getItem('actor_idx');
	if (val) {
		idx = Number(val);
	}
	return {
		ACTOR: window.VIEWER.ACTORS[idx],
		ACTORS: window.VIEWER.ACTORS,
		lookAtMouse: false,
		setLookAtMouse: (v) => {
			set({ lookAtMouse: v });
		},
		chooseActor: (v) => {
			let index = window.VIEWER.ACTORS.findIndex(e => e.url === v.url);
			window.localStorage.setItem('actor_idx', index);
			set({ ACTOR: v });
		}
	};
});


function moveJoint (mouse, joint, degreeLimit = 40) {
  let degrees = getMouseDegrees(mouse.current.x, mouse.current.y, degreeLimit);
  joint.rotation.xD = MathUtils.lerp(joint.rotation.xD || 0, degrees.y, 0.1);
  joint.rotation.yD = MathUtils.lerp(joint.rotation.yD || 0, degrees.x, 0.1);
  joint.rotation.x = THREE.Math.degToRad(joint.rotation.xD);
  joint.rotation.y = THREE.Math.degToRad(joint.rotation.yD);
}

function Box (props) {
  // This reference will give us direct access to the mesh
  const mesh = useRef();

  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  // Rotate mesh every frame, this is outside of React without overhead
  useFrame(() => {
    mesh.current.rotation.x = mesh.current.rotation.y += 0.01;
  });

  return (
    <mesh
      {...props}
      ref={mesh}
      scale={active ? [1.5, 1.5, 1.5] : [1, 1, 1]}
      onClick={(event) => {
				setActive(!active);
			}}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}>
      <boxBufferGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
    </mesh>
  );
}

function GLBItem ({ mouse, ...props }) {
	let hdr = window.VIEWER.HDR;
	let ACTOROBJ = useActors(s => s.ACTOR);
	let ACTOR = ACTOROBJ.url;

	const mixer = useMemo(() => new AnimationMixer(), [ACTOR]);

	const group = useRef();
	const controls = useRef();
	const actions = useRef();

	const { camera, scene, gl } = useThree();
	let gltf = false;
	let fbx = false;

	let animations = false;
	let mounter = false;

	let action = false;

	useMemo(() => {
		if (window.VIEWER.MODE === 'ACTION_PREVIEW') {
			if (ACTOR.indexOf('.fbx') !== -1) {
				fbx = useLoader(FBXLoader, ACTOR);
			} else if (ACTOR.indexOf('.glb') !== -1) {
				gltf = useLoader(GLTFLoader, ACTOR);
			}

			if (window.VIEWER.SELECTED.indexOf('.fbx') !== -1) {
				action = useLoader(FBXLoader, window.VIEWER.SELECTED);
			} else if (window.VIEWER.SELECTED.indexOf('.glb') !== -1) {
				action = useLoader(GLTFLoader, window.VIEWER.SELECTED);
			}

			if (gltf) {
				mounter = gltf.scene;
				animations = action.animations;
			}
			if (fbx) {
				mounter = fbx;
				animations = action.animations;
			}
		} else if (window.VIEWER.MODE === 'MODEL_PREVIEW') {
			if (window.VIEWER.SELECTED.indexOf('.fbx') !== -1) {
				fbx = useLoader(FBXLoader, window.VIEWER.SELECTED);
			} else if (window.VIEWER.SELECTED.indexOf('.glb') !== -1) {
				gltf = useLoader(GLTFLoader, window.VIEWER.SELECTED);
			}

			if (gltf) {
				mounter = gltf.scene;
				animations = gltf.animations;
			}
			if (fbx) {
				mounter = fbx;
				animations = fbx.animations;
			}
		}
	}, [ACTOR]);

	useEffect(() => {
		mounter.traverse((item) => {
			console.log(item.name);
			// if (item.material) {
			// 	item.material.envMap = scene.environment;
			// }
		});
	});

	useEffect(() => {
		if (hdr) {
			const pmremGenerator = new THREE.PMREMGenerator( gl );
			pmremGenerator.compileEquirectangularShader();
			new RGBELoader()
					.setDataType( THREE.UnsignedByteType )
					.load(hdr, (texture) => {
						const envMap = pmremGenerator.fromEquirectangular( texture ).texture;
						// scene.background = envMap;
						scene.environment = envMap;
					});
		}
	}, [hdr]);

	useEffect(() => {
		if (!controls.current) {
			camera.fov = 30;
			camera.near = 0.01;
			camera.far = 5000;
			camera.updateProjectionMatrix();
			controls.current = new OrbitControls( camera, gl.domElement );
			controls.current.enableDamping = true;
		}
		controls.current.minDistance = 1;
		controls.current.maxDistance = 10000000;
		// controls.current.target.set( 0, 0, - 0.2 );

		// controls.current.using = false
		// controls.current.addEventListener('change', () => {
		// 	controls.current.using = true
		// 	setTimeout(() => {
		// 		controls.current.using = false
		// 	}, 1000)
		// })

		// camera.position.z = 20 * 1;
		// camera.position.y = 10 * 1;
		mounter.position.set(0, 0, 0);
		mounter.scale.set(0.2, 0.2, 0.2);
		mounter.traverse((item) => {
			if (item.name === 'mixamorigSpine') {
				item.getWorldPosition(controls.current.target);
				controls.current.update();
			}

			if (item.name === 'mixamorigHead') {
				item.getWorldPosition(camera.position);
				camera.position.z += 30 * 4;
			}
		});
	});

	useFrame(() => {
		if (controls.current) {
			controls.current.update();
		}
	});

	const worldPos = useMemo(() => {
		return new Vector3(0, 0, 0);
	}, [ACTOR]);

	const last = useMemo(() => {
		return new Vector3(0, 0, 0);
	}, [ACTOR]);

	const diff = useMemo(() => {
		return new Vector3(0, 0, 0);
	}, [ACTOR]);

	useFrame(() => {
		mounter.traverse((item) => {
			if (item.isBone && item.name === 'mixamorigHead') {
				item.getWorldPosition(worldPos);
				if (last.length() === 0.0) {
					last.copy(worldPos);
				} else {
					diff.copy(worldPos).sub(last);
					last.copy(worldPos);
				}

				if (diff.length() > 0) {
					controls.current.object.position.add(diff);
				}
			}
			// if (item.isBone && item.name === 'mixamorigHips') {
			// 	controls.current.target.lerp(worldPos, 0.2);
			// }
		});
	});

	useEffect(() => {
		mounter.traverse((item) => {
			if (item.isMesh) {
				item.castShadow = true;
			}
		});
	},);


  useFrame((state, delta) => mixer.update(delta));
  useEffect(() => {
    actions.current = { defaultAction: mixer.clipAction(animations[0], group.current) };
		actions.current.defaultAction.play();

    return () => {
			mixer.uncacheRoot(group.current);
		};
  });

  useFrame((state, delta) => {
		if (AppGlobals.lookAtMouse)  {
			let mixamorigNeck = mounter.getObjectByName('mixamorigNeck');
			if (mixamorigNeck) {
				moveJoint(mouse, mixamorigNeck, 34);
			}
			let mixamorigSpine = mounter.getObjectByName('mixamorigSpine');
			if (mixamorigSpine) {
				moveJoint(mouse, mixamorigSpine, 40);
			}
		}
	});

	return <group ref={group} {...props} dispose={null}>
		{/* {action && <primitive object={action.getObjectByName('mixamorigHips')} />} */}
		{<primitive object={mounter} />}
	</group>;
}

function MyScene ({ mouse }) {
	return <>
		<ambientLight intensity={0.3} />
		<ShadowMod  />
		<pointLight intensity={1} position={[10, 10, 10]} />
		<Suspense fallback={null}>
			<GLBItem position-y={-5} mouse={mouse}></GLBItem>
		</Suspense>
		{/* {!(url) && <Box position={[0, 0, 0]} />} */}
	</>;
}

window.addEventListener('ready-gl', ({ detail }) => {
	// let { gl } = detail;
});
// window.addEventListener('message', (e) => {
// 	// if (e.data && e.data.type === 'loadGLB') {
// 	// 	let url = e.data.url;
// 	// 	let hdr = e.data.hdr;
// 	// 	// window.dispatchEvent(new CustomEvent('ready-glb', { detail: { url, hdr } }));
// 	// }
// });

// vscode.postMessage({ type: 'ready' });
// vscode.postMessage({ type: 'loadGLB' });

// console.log(hdr, url);
// window.dispatchEvent(new CustomEvent('ready-glb', { detail: { url, hdr } }));

// function Floor () {
// 	return <mesh receiveShadow={true} rotation-x={-0.5 * Math.PI} position-y={-10}>
// 		<meshBasicMaterial color="#bababa"></meshBasicMaterial>
// 		<planeBufferGeometry args={[10000, 10000, 2, 2]}></planeBufferGeometry>
// 	</mesh>;
// }

function ShadowMod({ ...props }) {
	const d = 8.5 * 2 * 4;

  return (
		<>
		<directionalLight
			castShadow
			intensity={0.2}
			position={[-10, 20, 18]}

			shadow-camera-left={d * -1}
			shadow-camera-bottom={d * -1}
			shadow-camera-right={d}
			shadow-camera-top={d}
			shadow-camera-near={0.1}
			shadow-camera-far={1500}
		/>
    <group frustumCulled={false} rotation={[-0.5 * Math.PI, 0, 0]} position={[0, -5.15, 0]} {...props}>
      <mesh frustumCulled={false} receiveShadow renderOrder={2}>
        <planeBufferGeometry args={[500, 500, 1, 1]} />
        <shadowMaterial shadowSide={THREE.DoubleSide} side={THREE.DoubleSide} transparent opacity={0.5} />
      </mesh>

      <mesh frustumCulled={false}  receiveShadow renderOrder={1}>
        <planeBufferGeometry args={[500, 500, 1, 1]} />
        <meshBasicMaterial shadowSide={THREE.DoubleSide} side={THREE.DoubleSide} color="#bababa" transparent opacity={0.5} />
      </mesh>
    </group>
		</>
  );
}

window.addEventListener('keydown', (event) => {
	if (event.metaKey && (event.key === 'r')) {
		vscode.postMessage({ type: 'reload' });
	}
});

function Actors () {
	const actors = useActors(s => s.ACTORS);
	const chooseActor = useActors(s => s.chooseActor);
	// const lookAtMouse = useActors(s => s.lookAtMouse);
	// const setLookAtMouse = useActors(s => s.setLookAtMouse);
	let btns = actors.map((a, i) => <div key={a.name + i} onClick={() => { chooseActor(a); }} style={{ color: '#222222', backgroundColor: '#ececec', display: 'inline-block', padding: '10px 20px' }}>{a.displayName}</div>);
	return <div>
		{window.VIEWER.MODE === 'ACTION_PREVIEW' && btns}
		<div onClick={() => { AppGlobals.lookAtMouse = !AppGlobals.lookAtMouse; }} style={{ color: '#222222', backgroundColor: '#ececec', display: 'inline-block', padding: '10px 20px' }}>Look At Mouse</div>
	</div>;
}

function App () {
	const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    mouse.current.x = window.innerWidth / 2;
    mouse.current.y = window.innerHeight / 2;
	});
	return <div style={{ height: `calc(100%)` }}>
		<div style={{ display: 'block', height: '40px' }} >
			<Actors></Actors>
		</div>
		<div style={{ height: `calc(100% - 40px)` }}>
		<Canvas
			shadowMap
			pixelRatio={[1.25, 2.5]}

			onPointerMove={(e) => { mouse.current = getMousePos(e); }}
			onTouchMove={(e) => { mouse.current = getFirstTouchPos(e); }}
			onTouchStart={(e) => { mouse.current = getFirstTouchPos(e); }}

			colorManagement
			onCreated={(gl) => {
				AppGlobals.gl = gl; gl.toneMapping = THREE.ACESFilmicToneMapping;
				gl.outputEncoding = THREE.sRGBEncoding;
				window.dispatchEvent(new CustomEvent('ready-gl', { detail: { gl } })); }} className="full" style={{ width: '100%', height: '100%'
			}}>
				<MyScene mouse={mouse}></MyScene>
			</Canvas>
		</div>
	</div>;
}

ReactDOM.render(
  <App></App>,
  document.getElementById('root')
);
