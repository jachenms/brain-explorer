import assert from "node:assert/strict";

import * as THREE from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

const geometry = new THREE.SphereGeometry(1, 320, 180);
const material = new THREE.MeshBasicMaterial({
  side: THREE.FrontSide,
});
const cortex = new THREE.Mesh(geometry, material);
cortex.name = "representative-cortex";
cortex.updateMatrixWorld(true);

const raycaster = new THREE.Raycaster();
const rays = [];
for (let row = -2; row <= 2; row += 1) {
  for (let column = -3; column <= 3; column += 1) {
    rays.push(
      new THREE.Ray(
        new THREE.Vector3(column * 0.16, row * 0.16, 3),
        new THREE.Vector3(0, 0, -1),
      ),
    );
  }
}

function queryAllRays(mesh) {
  let hitCount = 0;
  for (const ray of rays) {
    raycaster.ray.copy(ray);
    hitCount += raycaster.intersectObject(mesh, false).length;
  }
  return hitCount;
}

function timedMedian(mesh) {
  queryAllRays(mesh);
  const samples = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const startedAt = performance.now();
    const hitCount = queryAllRays(mesh);
    samples.push(performance.now() - startedAt);
    assert.ok(hitCount >= rays.length, "every representative ray hits");
  }
  samples.sort((a, b) => a - b);
  return samples[1];
}

const baselineMilliseconds = timedMedian(cortex);
const buildStartedAt = performance.now();
computeBoundsTree.call(geometry);
const buildMilliseconds = performance.now() - buildStartedAt;
cortex.raycast = acceleratedRaycast;
const acceleratedMilliseconds = timedMedian(cortex);

const proxy = new THREE.Mesh(
  new THREE.SphereGeometry(0.14, 16, 8),
  new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
);
proxy.name = "enclosed-proxy";
proxy.position.z = 0.4;
proxy.updateMatrixWorld(true);
raycaster.ray.set(
  new THREE.Vector3(0, 0, 3),
  new THREE.Vector3(0, 0, -1),
);
const completeIntersections = raycaster.intersectObjects(
  [cortex, proxy],
  false,
);
assert.equal(
  completeIntersections[0]?.object,
  cortex,
  "visible cortex remains the nearest geometric hit",
);
assert.ok(
  completeIntersections.some((intersection) => intersection.object === proxy),
  "complete intersections retain the enclosed proxy behind cortex",
);
assert.ok(
  acceleratedMilliseconds < baselineMilliseconds,
  "BVH ray queries must outperform baseline triangle traversal",
);

const triangles = geometry.index
  ? geometry.index.count / 3
  : geometry.getAttribute("position").count / 3;
const report = {
  triangles,
  queriesPerSample: rays.length,
  baselineMilliseconds: Number(baselineMilliseconds.toFixed(3)),
  bvhBuildMilliseconds: Number(buildMilliseconds.toFixed(3)),
  acceleratedMilliseconds: Number(acceleratedMilliseconds.toFixed(3)),
  speedup: Number(
    (baselineMilliseconds / acceleratedMilliseconds).toFixed(2),
  ),
  completeIntersectionObjects: completeIntersections.map(
    (intersection) => intersection.object.name,
  ),
  firstHitOnly: false,
};
console.log(JSON.stringify(report, null, 2));

disposeBoundsTree.call(geometry);
geometry.dispose();
material.dispose();
proxy.geometry.dispose();
proxy.material.dispose();
